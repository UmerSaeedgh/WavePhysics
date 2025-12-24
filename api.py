import datetime as dt
from typing import Optional, List
from dateutil import rrule
from dateutil.parser import parse as parse_date
from icalendar import Calendar, Event
from fastapi.responses import Response

import sqlite3
import pandas as pd
import io
from fastapi import FastAPI, Depends, HTTPException, status, Query, UploadFile, File
from pydantic import BaseModel

from sql import connect_db, init_schema

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    conn = connect_db()
    try:
        yield conn
    finally:
        conn.close()


@app.on_event("startup")
def on_startup():
    # Use your existing schema exactly as written
    conn = connect_db()
    try:
        init_schema(conn)
    finally:
        conn.close()


@app.get("/")
def root():
    return {"message": "Service Schedule Manager API", "docs": "/docs", "status": "running"}


class ClientCreate(BaseModel):
    name: str
    address: Optional[str] = None
    billing_info: Optional[str] = None
    notes: Optional[str] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    billing_info: Optional[str] = None
    notes: Optional[str] = None


class ClientRead(BaseModel):
    id: int
    name: str
    address: Optional[str]
    billing_info: Optional[str]
    notes: Optional[str]


@app.get("/clients", response_model=List[ClientRead])
def list_clients(db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("SELECT id, name, address, billing_info, notes FROM clients ORDER BY name")
    rows = cur.fetchall()
    return [ClientRead(**dict(row)) for row in rows]

@app.get("/clients/{client_id}", response_model=ClientRead)
def get_client(client_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, name, address, billing_info, notes FROM clients WHERE id = ?",
        (client_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Client not found")

    return ClientRead(**dict(row))

#Creating Client
@app.post("/clients", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(payload: ClientCreate, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            "INSERT INTO clients (name, address, billing_info, notes) VALUES (?, ?, ?, ?)",
            (payload.name, payload.address, payload.billing_info, payload.notes),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Client name must be unique")

    row = db.execute(
        "SELECT id, name, address, billing_info, notes FROM clients WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return ClientRead(**dict(row))

#Update Client
@app.put("/clients/{client_id}", response_model=ClientRead)
def update_client(client_id: int, payload: ClientUpdate, db: sqlite3.Connection = Depends(get_db)):
    
    row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Client not found")

    
    fields = []
    values = []

    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name)
    if payload.address is not None:
        fields.append("address = ?")
        values.append(payload.address)
    if payload.billing_info is not None:
        fields.append("billing_info = ?")
        values.append(payload.billing_info)
    if payload.notes is not None:
        fields.append("notes = ?")
        values.append(payload.notes)

    if fields:  # if there is something to update
        values.append(client_id)
        try:
            db.execute(
                f"UPDATE clients SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Client name must be unique")

    # return fresh row
    row = db.execute(
        "SELECT id, name, address, billing_info, notes FROM clients WHERE id = ?",
        (client_id,),
    ).fetchone()
    return ClientRead(**dict(row))

#Delete Client
@app.delete("/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM clients WHERE id = ?", (client_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Client not found")

    return


# ========== SITES ==========

class SiteCreate(BaseModel):
    client_id: int
    name: str
    address: Optional[str] = None
    timezone: str = "America/Chicago"
    notes: Optional[str] = None


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    timezone: Optional[str] = None
    notes: Optional[str] = None


class SiteRead(BaseModel):
    id: int
    client_id: int
    name: str
    address: Optional[str]
    timezone: str
    notes: Optional[str]


@app.get("/sites", response_model=List[SiteRead])
def list_sites(
    client_id: Optional[int] = Query(None, description="Filter by client"),
    db: sqlite3.Connection = Depends(get_db)
):
    if client_id:
        cur = db.execute(
            "SELECT id, client_id, name, address, timezone, notes FROM sites WHERE client_id = ? ORDER BY name",
            (client_id,)
        )
    else:
        cur = db.execute("SELECT id, client_id, name, address, timezone, notes FROM sites ORDER BY name")
    rows = cur.fetchall()
    return [SiteRead(**dict(row)) for row in rows]


@app.get("/sites/{site_id}", response_model=SiteRead)
def get_site(site_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, client_id, name, address, timezone, notes FROM sites WHERE id = ?",
        (site_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    return SiteRead(**dict(row))


@app.post("/sites", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(payload: SiteCreate, db: sqlite3.Connection = Depends(get_db)):
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")

    try:
        cur = db.execute(
            "INSERT INTO sites (client_id, name, address, timezone, notes) VALUES (?, ?, ?, ?, ?)",
            (payload.client_id, payload.name, payload.address, payload.timezone, payload.notes),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Site name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, address, timezone, notes FROM sites WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return SiteRead(**dict(row))


@app.put("/sites/{site_id}", response_model=SiteRead)
def update_site(site_id: int, payload: SiteUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM sites WHERE id = ?", (site_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    fields = []
    values = []

    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name)
    if payload.address is not None:
        fields.append("address = ?")
        values.append(payload.address)
    if payload.timezone is not None:
        fields.append("timezone = ?")
        values.append(payload.timezone)
    if payload.notes is not None:
        fields.append("notes = ?")
        values.append(payload.notes)

    if fields:
        values.append(site_id)
        try:
            db.execute(
                f"UPDATE sites SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Site name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, address, timezone, notes FROM sites WHERE id = ?",
        (site_id,),
    ).fetchone()
    return SiteRead(**dict(row))


@app.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(site_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM sites WHERE id = ?", (site_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Site not found")

    return


# ========== CONTACTS ==========

class ContactCreate(BaseModel):
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class ContactRead(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: Optional[str]
    phone: Optional[str]


@app.get("/contacts", response_model=List[ContactRead])
def list_contacts(db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("SELECT id, first_name, last_name, email, phone FROM contacts ORDER BY last_name, first_name")
    rows = cur.fetchall()
    return [ContactRead(**dict(row)) for row in rows]


@app.get("/contacts/{contact_id}", response_model=ContactRead)
def get_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, first_name, last_name, email, phone FROM contacts WHERE id = ?",
        (contact_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    return ContactRead(**dict(row))


@app.post("/contacts", response_model=ContactRead, status_code=status.HTTP_201_CREATED)
def create_contact(payload: ContactCreate, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO contacts (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)",
        (payload.first_name, payload.last_name, payload.email, payload.phone),
    )
    db.commit()

    row = db.execute(
        "SELECT id, first_name, last_name, email, phone FROM contacts WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return ContactRead(**dict(row))


@app.put("/contacts/{contact_id}", response_model=ContactRead)
def update_contact(contact_id: int, payload: ContactUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    fields = []
    values = []

    if payload.first_name is not None:
        fields.append("first_name = ?")
        values.append(payload.first_name)
    if payload.last_name is not None:
        fields.append("last_name = ?")
        values.append(payload.last_name)
    if payload.email is not None:
        fields.append("email = ?")
        values.append(payload.email)
    if payload.phone is not None:
        fields.append("phone = ?")
        values.append(payload.phone)

    if fields:
        values.append(contact_id)
        db.execute(
            f"UPDATE contacts SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        db.commit()

    row = db.execute(
        "SELECT id, first_name, last_name, email, phone FROM contacts WHERE id = ?",
        (contact_id,),
    ).fetchone()
    return ContactRead(**dict(row))


@app.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Contact not found")

    return


# ========== CONTACT LINKS ==========

class ContactLinkCreate(BaseModel):
    contact_id: int
    scope: str  # 'CLIENT' or 'SITE'
    scope_id: int
    role: str
    is_primary: bool = False


class ContactLinkUpdate(BaseModel):
    role: Optional[str] = None
    is_primary: Optional[bool] = None


class ContactLinkRead(BaseModel):
    id: int
    contact_id: int
    scope: str
    scope_id: int
    role: str
    is_primary: bool


@app.get("/contact-links", response_model=List[ContactLinkRead])
def list_contact_links(
    scope: Optional[str] = Query(None, description="Filter by scope (CLIENT or SITE)"),
    scope_id: Optional[int] = Query(None, description="Filter by scope_id"),
    db: sqlite3.Connection = Depends(get_db)
):
    query = "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE 1=1"
    params = []
    
    if scope:
        query += " AND scope = ?"
        params.append(scope)
    if scope_id:
        query += " AND scope_id = ?"
        params.append(scope_id)
    
    query += " ORDER BY scope, scope_id, role"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [ContactLinkRead(**dict(row)) for row in rows]


@app.get("/contact-links/{link_id}", response_model=ContactLinkRead)
def get_contact_link(link_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE id = ?",
        (link_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Contact link not found")

    return ContactLinkRead(**dict(row))


@app.post("/contact-links", response_model=ContactLinkRead, status_code=status.HTTP_201_CREATED)
def create_contact_link(payload: ContactLinkCreate, db: sqlite3.Connection = Depends(get_db)):
    if payload.scope not in ['CLIENT', 'SITE']:
        raise HTTPException(status_code=400, detail="Scope must be 'CLIENT' or 'SITE'")

    # Verify contact exists
    contact_row = db.execute("SELECT id FROM contacts WHERE id = ?", (payload.contact_id,)).fetchone()
    if contact_row is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Verify scope entity exists
    if payload.scope == 'CLIENT':
        scope_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.scope_id,)).fetchone()
    else:
        scope_row = db.execute("SELECT id FROM sites WHERE id = ?", (payload.scope_id,)).fetchone()
    
    if scope_row is None:
        raise HTTPException(status_code=404, detail=f"{payload.scope} not found")

    try:
        cur = db.execute(
            "INSERT INTO contact_links (contact_id, scope, scope_id, role, is_primary) VALUES (?, ?, ?, ?, ?)",
            (payload.contact_id, payload.scope, payload.scope_id, payload.role, 1 if payload.is_primary else 0),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Contact link already exists for this scope/role")

    row = db.execute(
        "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return ContactLinkRead(**dict(row))


@app.put("/contact-links/{link_id}", response_model=ContactLinkRead)
def update_contact_link(link_id: int, payload: ContactLinkUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM contact_links WHERE id = ?", (link_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Contact link not found")

    fields = []
    values = []

    if payload.role is not None:
        fields.append("role = ?")
        values.append(payload.role)
    if payload.is_primary is not None:
        fields.append("is_primary = ?")
        values.append(1 if payload.is_primary else 0)

    if fields:
        values.append(link_id)
        db.execute(
            f"UPDATE contact_links SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        db.commit()

    row = db.execute(
        "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE id = ?",
        (link_id,),
    ).fetchone()
    return ContactLinkRead(**dict(row))


@app.delete("/contact-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact_link(link_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM contact_links WHERE id = ?", (link_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Contact link not found")

    return


# ========== EQUIPMENT TYPES ==========

class EquipmentTypeCreate(BaseModel):
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool = True


class EquipmentTypeUpdate(BaseModel):
    name: Optional[str] = None
    interval_weeks: Optional[int] = None
    rrule: Optional[str] = None
    default_lead_weeks: Optional[int] = None
    active: Optional[bool] = None


class EquipmentTypeRead(BaseModel):
    id: int
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool


@app.get("/equipment-types", response_model=List[EquipmentTypeRead])
def list_equipment_types(
    active_only: bool = Query(False, description="Filter to active only"),
    db: sqlite3.Connection = Depends(get_db)
):
    if active_only:
        cur = db.execute(
            "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE active = 1 ORDER BY name"
        )
    else:
        cur = db.execute("SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types ORDER BY name")
    rows = cur.fetchall()
    return [EquipmentTypeRead(**dict(row)) for row in rows]


@app.get("/equipment-types/{equipment_type_id}", response_model=EquipmentTypeRead)
def get_equipment_type(equipment_type_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (equipment_type_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment type not found")

    return EquipmentTypeRead(**dict(row))


@app.post("/equipment-types", response_model=EquipmentTypeRead, status_code=status.HTTP_201_CREATED)
def create_equipment_type(payload: EquipmentTypeCreate, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?)",
            (payload.name, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Equipment type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return EquipmentTypeRead(**dict(row))


@app.put("/equipment-types/{equipment_type_id}", response_model=EquipmentTypeRead)
def update_equipment_type(equipment_type_id: int, payload: EquipmentTypeUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment type not found")

    fields = []
    values = []

    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name)
    if payload.interval_weeks is not None:
        fields.append("interval_weeks = ?")
        values.append(payload.interval_weeks)
    if payload.rrule is not None:
        fields.append("rrule = ?")
        values.append(payload.rrule)
    if payload.default_lead_weeks is not None:
        fields.append("default_lead_weeks = ?")
        values.append(payload.default_lead_weeks)
    if payload.active is not None:
        fields.append("active = ?")
        values.append(1 if payload.active else 0)

    if fields:
        values.append(equipment_type_id)
        try:
            db.execute(
                f"UPDATE equipment_types SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Equipment type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (equipment_type_id,),
    ).fetchone()
    return EquipmentTypeRead(**dict(row))


@app.delete("/equipment-types/{equipment_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_type(equipment_type_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM equipment_types WHERE id = ?", (equipment_type_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Equipment type not found")

    return


@app.post("/equipment-types/seed", status_code=status.HTTP_201_CREATED)
def seed_equipment_types(db: sqlite3.Connection = Depends(get_db)):
    """Seed default equipment types"""
    defaults = [
        ("NM Audit", 13, "FREQ=WEEKLY;INTERVAL=13", 3),
        ("ACR PET / Gamma camera ACR", 26, "FREQ=WEEKLY;INTERVAL=26", 4),
        ("X-ray/CT physics testing", 52, "FREQ=WEEKLY;INTERVAL=52", 5),
    ]
    
    created = []
    for name, interval, rrule_str, lead_weeks in defaults:
        # Check if exists
        existing = db.execute("SELECT id FROM equipment_types WHERE name = ?", (name,)).fetchone()
        if existing:
            continue
        
        cur = db.execute(
            "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, 1)",
            (name, interval, rrule_str, lead_weeks),
        )
        created.append(cur.lastrowid)
    
    db.commit()
    return {"created": len(created), "ids": created}


# ========== EQUIPMENT RECORDS ==========

class EquipmentRecordCreate(BaseModel):
    client_id: int
    site_id: int
    equipment_type_id: int
    equipment_name: str
    anchor_date: str  # YYYY-MM-DD
    due_date: Optional[str] = None  # YYYY-MM-DD
    interval_weeks: int = 52
    lead_weeks: Optional[int] = None
    active: bool = True
    notes: Optional[str] = None
    timezone: Optional[str] = None


class EquipmentRecordUpdate(BaseModel):
    site_id: Optional[int] = None
    equipment_type_id: Optional[int] = None
    equipment_name: Optional[str] = None
    anchor_date: Optional[str] = None
    due_date: Optional[str] = None
    interval_weeks: Optional[int] = None
    lead_weeks: Optional[int] = None
    active: Optional[bool] = None
    notes: Optional[str] = None
    timezone: Optional[str] = None


class EquipmentRecordRead(BaseModel):
    id: int
    client_id: int
    site_id: int
    equipment_type_id: int
    equipment_name: str
    anchor_date: str
    due_date: Optional[str] = None
    interval_weeks: int
    lead_weeks: Optional[int] = None
    active: bool
    notes: Optional[str] = None
    timezone: Optional[str] = None
    client_name: Optional[str] = None
    site_name: Optional[str] = None
    equipment_type_name: Optional[str] = None


@app.get("/equipment-records", response_model=List[EquipmentRecordRead])
def list_equipment_records(
    client_id: Optional[int] = Query(None, description="Filter by client"),
    active_only: bool = Query(False, description="Filter to active only"),
    db: sqlite3.Connection = Depends(get_db)
):
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      s.name as site_name,
                      et.name as equipment_type_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               WHERE 1=1"""
    params = []
    
    if client_id:
        query += " AND er.client_id = ?"
        params.append(client_id)
    
    if active_only:
        query += " AND er.active = 1"
    
    query += " ORDER BY er.anchor_date DESC"
    
    cur = db.execute(query, params)
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/upcoming", response_model=List[EquipmentRecordRead])
def get_upcoming_equipment_records(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    weeks: Optional[int] = Query(None, description="Number of weeks from today"),
    db: sqlite3.Connection = Depends(get_db)
):
    today = dt.date.today()
    
    if weeks:
        end_date_obj = today + dt.timedelta(weeks=weeks)
        start_date_obj = today
    elif start_date and end_date:
        start_date_obj = dt.datetime.strptime(start_date, "%Y-%m-%d").date()
        end_date_obj = dt.datetime.strptime(end_date, "%Y-%m-%d").date()
    else:
        # Default to 2 weeks
        start_date_obj = today
        end_date_obj = today + dt.timedelta(weeks=2)
    
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      s.name as site_name,
                      et.name as equipment_type_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               WHERE er.active = 1 
                 AND (er.due_date IS NOT NULL AND er.due_date >= ? AND er.due_date <= ?)
               ORDER BY er.due_date"""
    
    cur = db.execute(query, (start_date_obj.isoformat(), end_date_obj.isoformat()))
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/overdue", response_model=List[EquipmentRecordRead])
def get_overdue_equipment_records(db: sqlite3.Connection = Depends(get_db)):
    today = dt.date.today()
    
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      s.name as site_name,
                      et.name as equipment_type_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               WHERE er.active = 1 
                 AND er.due_date IS NOT NULL 
                 AND er.due_date < ?
               ORDER BY er.due_date"""
    
    cur = db.execute(query, (today.isoformat(),))
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/{equipment_record_id}", response_model=EquipmentRecordRead)
def get_equipment_record(equipment_record_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                  er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                  er.active, er.notes, er.timezone,
                  c.name as client_name,
                  s.name as site_name,
                  et.name as equipment_type_name
           FROM equipment_record er
           LEFT JOIN clients c ON er.client_id = c.id
           LEFT JOIN sites s ON er.site_id = s.id
           LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
           WHERE er.id = ?""",
        (equipment_record_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment record not found")

    record_dict = dict(row)
    record_dict['active'] = bool(record_dict.get('active', 1))
    return EquipmentRecordRead(**record_dict)


@app.post("/equipment-records", response_model=EquipmentRecordRead, status_code=status.HTTP_201_CREATED)
def create_equipment_record(payload: EquipmentRecordCreate, db: sqlite3.Connection = Depends(get_db)):
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Verify site exists and belongs to the client
    site_row = db.execute("SELECT id, client_id FROM sites WHERE id = ?", (payload.site_id,)).fetchone()
    if site_row is None:
        raise HTTPException(status_code=404, detail="Site not found")
    if site_row['client_id'] != payload.client_id:
        raise HTTPException(status_code=400, detail="Site does not belong to the specified client")
    
    # Verify equipment type exists
    equipment_type_row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (payload.equipment_type_id,)).fetchone()
    if equipment_type_row is None:
        raise HTTPException(status_code=404, detail="Equipment type not found")
    
    try:
        cur = db.execute(
            "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, active, notes, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (payload.client_id, payload.site_id, payload.equipment_type_id, payload.equipment_name, payload.anchor_date, payload.due_date, payload.interval_weeks, payload.lead_weeks, 1 if payload.active else 0, payload.notes, payload.timezone),
        )
        db.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")

    return get_equipment_record(cur.lastrowid, db)


@app.put("/equipment-records/{equipment_record_id}", response_model=EquipmentRecordRead)
def update_equipment_record(equipment_record_id: int, payload: EquipmentRecordUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM equipment_record WHERE id = ?", (equipment_record_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment record not found")

    # Verify equipment type if being updated
    if payload.equipment_type_id is not None:
        equipment_type_row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (payload.equipment_type_id,)).fetchone()
        if equipment_type_row is None:
            raise HTTPException(status_code=404, detail="Equipment type not found")

    # Verify site if being updated
    if payload.site_id is not None:
        site_row = db.execute("SELECT id, client_id FROM sites WHERE id = ?", (payload.site_id,)).fetchone()
        if site_row is None:
            raise HTTPException(status_code=404, detail="Site not found")
        # Get current record to check client_id
        current_record = db.execute("SELECT client_id FROM equipment_record WHERE id = ?", (equipment_record_id,)).fetchone()
        if current_record and site_row['client_id'] != current_record['client_id']:
            raise HTTPException(status_code=400, detail="Site does not belong to the same client")

    fields = []
    values = []

    if payload.site_id is not None:
        fields.append("site_id = ?")
        values.append(payload.site_id)
    if payload.equipment_type_id is not None:
        fields.append("equipment_type_id = ?")
        values.append(payload.equipment_type_id)
    if payload.equipment_name is not None:
        fields.append("equipment_name = ?")
        values.append(payload.equipment_name)
    if payload.anchor_date is not None:
        fields.append("anchor_date = ?")
        values.append(payload.anchor_date)
    if payload.due_date is not None:
        fields.append("due_date = ?")
        values.append(payload.due_date)
    if payload.interval_weeks is not None:
        fields.append("interval_weeks = ?")
        values.append(payload.interval_weeks)
    if payload.lead_weeks is not None:
        fields.append("lead_weeks = ?")
        values.append(payload.lead_weeks)
    if payload.active is not None:
        fields.append("active = ?")
        values.append(1 if payload.active else 0)
    if payload.notes is not None:
        fields.append("notes = ?")
        values.append(payload.notes)
    if payload.timezone is not None:
        fields.append("timezone = ?")
        values.append(payload.timezone)

    if fields:
        values.append(equipment_record_id)
        try:
            db.execute(
                f"UPDATE equipment_record SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError as e:
            raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")

    return get_equipment_record(equipment_record_id, db)


@app.delete("/equipment-records/{equipment_record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_record(equipment_record_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM equipment_record WHERE id = ?", (equipment_record_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Equipment record not found")

    return


# ========== CLIENT EQUIPMENTS ==========

# Default equipment list
DEFAULT_EQUIPMENTS = [
    ("RSO-Certificate of X-ray Registration", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("RSO-Radioactive Material License", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Radiation Licensing & Program Setup", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Shielding Design & Public Exposure Surveys", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Patient Radiation Dose Evaluation & NM Misadministration", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("General Radiation Safety Awareness Workshop", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Quarterly Audits", 13, "FREQ=WEEKLY;INTERVAL=13", 3),
    ("SPECT Testing", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("PET Testing", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Computed Tomography", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("General Radiography", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Fluoroscopy", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Magnetic Resonance Imaging", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
    ("Mammography (MQSA)", 52, "FREQ=WEEKLY;INTERVAL=52", 4),
]


class EquipmentCreate(BaseModel):
    client_id: int
    name: str
    interval_weeks: int = 52
    rrule: str = "FREQ=WEEKLY;INTERVAL=52"
    default_lead_weeks: int = 4
    active: bool = True


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    interval_weeks: Optional[int] = None
    rrule: Optional[str] = None
    default_lead_weeks: Optional[int] = None
    active: Optional[bool] = None


class EquipmentRead(BaseModel):
    id: int
    client_id: int
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool
    is_custom: bool


@app.get("/clients/{client_id}/equipments", response_model=List[EquipmentRead])
def list_client_equipments(
    client_id: int,
    active_only: bool = Query(False, description="Filter to active only"),
    db: sqlite3.Connection = Depends(get_db)
):
    """List all equipment types (global, not per-client) - maintained for backward compatibility"""
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    query = "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE 1=1"
    params = []
    
    if active_only:
        query += " AND active = 1"
    
    query += " ORDER BY name"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    # Adapt equipment_types to EquipmentRead format (with client_id and is_custom=False)
    return [EquipmentRead(
        id=row['id'],
        client_id=client_id,
        name=row['name'],
        interval_weeks=row['interval_weeks'],
        rrule=row['rrule'],
        default_lead_weeks=row['default_lead_weeks'],
        active=bool(row['active']),
        is_custom=False
    ) for row in rows]


@app.get("/equipments/{equipment_id}", response_model=EquipmentRead)
def get_equipment(equipment_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Get equipment type - maintained for backward compatibility"""
    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (equipment_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")

    # Try to get a client_id from equipment_record if any exists, otherwise use 0
    client_row = db.execute(
        "SELECT client_id FROM equipment_record WHERE equipment_type_id = ? LIMIT 1",
        (equipment_id,)
    ).fetchone()
    client_id = client_row['client_id'] if client_row else 0

    return EquipmentRead(
        id=row['id'],
        client_id=client_id,
        name=row['name'],
        interval_weeks=row['interval_weeks'],
        rrule=row['rrule'],
        default_lead_weeks=row['default_lead_weeks'],
        active=bool(row['active']),
        is_custom=False
    )


@app.post("/clients/{client_id}/equipments", response_model=EquipmentRead, status_code=status.HTTP_201_CREATED)
def create_client_equipment(client_id: int, payload: EquipmentCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create equipment type (global) - maintained for backward compatibility"""
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Check for existing equipment type case-insensitively
    existing = db.execute("SELECT id FROM equipment_types WHERE UPPER(name) = ?", (payload.name.upper(),)).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Equipment type name must be unique (case-insensitive)")

    try:
        cur = db.execute(
            "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?)",
            (payload.name, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Equipment type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return EquipmentRead(
        id=row['id'],
        client_id=client_id,
        name=row['name'],
        interval_weeks=row['interval_weeks'],
        rrule=row['rrule'],
        default_lead_weeks=row['default_lead_weeks'],
        active=bool(row['active']),
        is_custom=False
    )


@app.put("/equipments/{equipment_id}", response_model=EquipmentRead)
def update_equipment(equipment_id: int, payload: EquipmentUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update equipment type (global) - maintained for backward compatibility"""
    row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (equipment_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")

    fields = []
    values = []

    if payload.name is not None:
        # Check for duplicate (case-insensitive) excluding current equipment
        existing = db.execute("SELECT id FROM equipment_types WHERE UPPER(name) = ? AND id != ?", (payload.name.upper(), equipment_id)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Equipment type name must be unique (case-insensitive)")
        fields.append("name = ?")
        values.append(payload.name)
    if payload.interval_weeks is not None:
        fields.append("interval_weeks = ?")
        values.append(payload.interval_weeks)
    if payload.rrule is not None:
        fields.append("rrule = ?")
        values.append(payload.rrule)
    if payload.default_lead_weeks is not None:
        fields.append("default_lead_weeks = ?")
        values.append(payload.default_lead_weeks)
    if payload.active is not None:
        fields.append("active = ?")
        values.append(1 if payload.active else 0)

    if fields:
        values.append(equipment_id)
        try:
            db.execute(
                f"UPDATE equipment_types SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Equipment type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (equipment_id,),
    ).fetchone()
    
    # Try to get a client_id from equipment_record if any exists, otherwise use 0
    client_row = db.execute(
        "SELECT client_id FROM equipment_record WHERE equipment_type_id = ? LIMIT 1",
        (equipment_id,)
    ).fetchone()
    client_id = client_row['client_id'] if client_row else 0
    
    return EquipmentRead(
        id=row['id'],
        client_id=client_id,
        name=row['name'],
        interval_weeks=row['interval_weeks'],
        rrule=row['rrule'],
        default_lead_weeks=row['default_lead_weeks'],
        active=bool(row['active']),
        is_custom=False
    )


@app.delete("/equipments/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(equipment_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Delete equipment type (global) - maintained for backward compatibility"""
    # Check if equipment type exists
    row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (equipment_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    # Check if it's being used by any equipment_record
    used = db.execute("SELECT id FROM equipment_record WHERE equipment_type_id = ? LIMIT 1", (equipment_id,)).fetchone()
    if used:
        raise HTTPException(status_code=400, detail="Cannot delete equipment type that is in use by equipment records")
    
    cur = db.execute("DELETE FROM equipment_types WHERE id = ?", (equipment_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Equipment not found")

    return


@app.post("/clients/{client_id}/equipments/seed-defaults", status_code=status.HTTP_201_CREATED)
def seed_default_equipments(client_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Seed default equipment types (global) - maintained for backward compatibility"""
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    created = []
    for name, interval, rrule_str, lead_weeks in DEFAULT_EQUIPMENTS:
        # Check if equipment type already exists (global, not per-client)
        existing = db.execute("SELECT id FROM equipment_types WHERE name = ?", (name,)).fetchone()
        if existing:
            continue
        
        cur = db.execute(
            "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, 1)",
            (name, interval, rrule_str, lead_weeks),
        )
        created.append(cur.lastrowid)
    
    db.commit()
    return {"created": len(created), "ids": created}


# ========== NOTES ==========

class NoteCreate(BaseModel):
    scope: str  # 'CLIENT', 'SITE'
    scope_id: int
    body: str


class NoteRead(BaseModel):
    id: int
    scope: str
    scope_id: int
    body: str
    created_at: str


@app.get("/notes", response_model=List[NoteRead])
def list_notes(
    scope: Optional[str] = Query(None, description="Filter by scope"),
    scope_id: Optional[int] = Query(None, description="Filter by scope_id"),
    db: sqlite3.Connection = Depends(get_db)
):
    query = "SELECT id, scope, scope_id, body, created_at FROM notes WHERE 1=1"
    params = []
    
    if scope:
        query += " AND scope = ?"
        params.append(scope)
    if scope_id:
        query += " AND scope_id = ?"
        params.append(scope_id)
    
    query += " ORDER BY created_at DESC"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [NoteRead(**dict(row)) for row in rows]


@app.post("/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
def create_note(payload: NoteCreate, db: sqlite3.Connection = Depends(get_db)):
    if payload.scope not in ['CLIENT', 'SITE']:
        raise HTTPException(status_code=400, detail="Scope must be CLIENT or SITE")
    
    # Verify scope entity exists
    if payload.scope == 'CLIENT':
        scope_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.scope_id,)).fetchone()
    else:
        scope_row = db.execute("SELECT id FROM sites WHERE id = ?", (payload.scope_id,)).fetchone()
    
    if scope_row is None:
        raise HTTPException(status_code=404, detail=f"{payload.scope} not found")
    
    cur = db.execute(
        "INSERT INTO notes (scope, scope_id, body) VALUES (?, ?, ?)",
        (payload.scope, payload.scope_id, payload.body),
    )
    db.commit()
    
    row = db.execute(
        "SELECT id, scope, scope_id, body, created_at FROM notes WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return NoteRead(**dict(row))


@app.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    
    return


# ========== ATTACHMENTS ==========

class AttachmentCreate(BaseModel):
    scope: str  # 'CLIENT', 'SITE'
    scope_id: int
    filename: str
    url_or_path: str


class AttachmentRead(BaseModel):
    id: int
    scope: str
    scope_id: int
    filename: str
    url_or_path: str
    uploaded_at: str


@app.get("/attachments", response_model=List[AttachmentRead])
def list_attachments(
    scope: Optional[str] = Query(None, description="Filter by scope"),
    scope_id: Optional[int] = Query(None, description="Filter by scope_id"),
    db: sqlite3.Connection = Depends(get_db)
):
    query = "SELECT id, scope, scope_id, filename, url_or_path, uploaded_at FROM attachments WHERE 1=1"
    params = []
    
    if scope:
        query += " AND scope = ?"
        params.append(scope)
    if scope_id:
        query += " AND scope_id = ?"
        params.append(scope_id)
    
    query += " ORDER BY uploaded_at DESC"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [AttachmentRead(**dict(row)) for row in rows]


@app.post("/attachments", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
def create_attachment(payload: AttachmentCreate, db: sqlite3.Connection = Depends(get_db)):
    if payload.scope not in ['CLIENT', 'SITE']:
        raise HTTPException(status_code=400, detail="Scope must be CLIENT or SITE")
    
    # Verify scope entity exists
    if payload.scope == 'CLIENT':
        scope_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.scope_id,)).fetchone()
    else:
        scope_row = db.execute("SELECT id FROM sites WHERE id = ?", (payload.scope_id,)).fetchone()
    
    if scope_row is None:
        raise HTTPException(status_code=404, detail=f"{payload.scope} not found")
    
    cur = db.execute(
        "INSERT INTO attachments (scope, scope_id, filename, url_or_path) VALUES (?, ?, ?, ?)",
        (payload.scope, payload.scope_id, payload.filename, payload.url_or_path),
    )
    db.commit()
    
    row = db.execute(
        "SELECT id, scope, scope_id, filename, url_or_path, uploaded_at FROM attachments WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return AttachmentRead(**dict(row))


@app.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(attachment_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
    db.commit()
    
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    return


# ========== CONTACT ROLL-UPS ==========

class ContactRollup(BaseModel):
    contact_id: int
    first_name: str
    last_name: str
    email: Optional[str]
    phone: Optional[str]
    role: str
    is_primary: bool
    scope: str  # 'CLIENT' or 'SITE'
    scope_name: str  # Client name or Site name


@app.get("/contacts/rollup/client/{client_id}", response_model=List[ContactRollup])
def get_client_contacts(client_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Get all contacts for a client (client-level and site-level)"""
    cur = db.execute(
        """SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
                  cl.role, cl.is_primary, cl.scope,
                  CASE 
                    WHEN cl.scope = 'CLIENT' THEN cli.name
                    WHEN cl.scope = 'SITE' THEN s.name
                  END as scope_name
           FROM contact_links cl
           JOIN contacts c ON cl.contact_id = c.id
           LEFT JOIN clients cli ON cl.scope = 'CLIENT' AND cl.scope_id = cli.id
           LEFT JOIN sites s ON cl.scope = 'SITE' AND cl.scope_id = s.id
           WHERE (cl.scope = 'CLIENT' AND cl.scope_id = ?)
              OR (cl.scope = 'SITE' AND s.client_id = ?)
           ORDER BY cl.is_primary DESC, cl.scope, cl.role, c.last_name, c.first_name""",
        (client_id, client_id)
    )
    rows = cur.fetchall()
    return [ContactRollup(**dict(row)) for row in rows]


@app.get("/contacts/rollup/site/{site_id}", response_model=List[ContactRollup])
def get_site_contacts(site_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Get all contacts for a site (site-level and parent client-level)"""
    # Get site's client_id first
    site = db.execute("SELECT client_id FROM sites WHERE id = ?", (site_id,)).fetchone()
    if site is None:
        raise HTTPException(status_code=404, detail="Site not found")
    
    client_id = site['client_id']
    
    cur = db.execute(
        """SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
                  cl.role, cl.is_primary, cl.scope,
                  CASE 
                    WHEN cl.scope = 'CLIENT' THEN cli.name
                    WHEN cl.scope = 'SITE' THEN s.name
                  END as scope_name
           FROM contact_links cl
           JOIN contacts c ON cl.contact_id = c.id
           LEFT JOIN clients cli ON cl.scope = 'CLIENT' AND cl.scope_id = cli.id
           LEFT JOIN sites s ON cl.scope = 'SITE' AND cl.scope_id = s.id
           WHERE (cl.scope = 'CLIENT' AND cl.scope_id = ?)
              OR (cl.scope = 'SITE' AND cl.scope_id = ?)
           ORDER BY cl.is_primary DESC, cl.scope, cl.role, c.last_name, c.first_name""",
        (client_id, site_id)
    )
    rows = cur.fetchall()
    return [ContactRollup(**dict(row)) for row in rows]


# ========== EXCEL IMPORT ==========

@app.post("/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    site_id: Optional[int] = Query(None, description="Optional: Import to specific site"),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import data from Excel file. 
    If site_id is provided: Only Equipment and Due Date columns are required.
    If site_id is not provided: Client, Site, Equipment, and Due Date columns are required.
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    # If site_id is provided, verify it exists and get client_id
    target_site_id = None
    target_client_id = None
    if site_id:
        site_row = db.execute("SELECT id, client_id FROM sites WHERE id = ?", (site_id,)).fetchone()
        if not site_row:
            raise HTTPException(status_code=404, detail="Site not found")
        target_site_id = site_row['id']
        target_client_id = site_row['client_id']
    
    try:
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Store original column names for debugging
        original_columns = list(df.columns)
        
        # Normalize column names (case-insensitive, remove spaces)
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_').str.replace('-', '_')
        
        # Debug: print column mapping
        print(f"[DEBUG] Original columns: {original_columns}")
        print(f"[DEBUG] Normalized columns: {list(df.columns)}")
        
        # Try to identify columns
        client_col = None
        site_col = None
        equipment_col = None
        anchor_date_col = None
        due_date_col = None
        lead_weeks_col = None
        timezone_col = None
        address_col = None
        notes_col = None
        identifier_col = None
        
        # First pass: look for exact matches or high-priority patterns
        for col in df.columns:
            col_lower = col.lower().strip()
            if client_col is None and any(x in col_lower for x in ['client', 'customer']):
                client_col = col
            elif site_col is None and any(x in col_lower for x in ['site', 'location', 'facility']):
                site_col = col
            # "identifier" column = Equipment Identifier (dropdown value - used to match/create equipment)
            elif equipment_col is None and ('identifier' in col_lower or 'equipment_identifier' in col_lower):
                equipment_col = col
            # Other equipment type patterns (but NOT "equipment" itself, as that's the name)
            elif equipment_col is None and any(x in col_lower for x in ['test', 'equipment_type', 'type', 'modality']):
                equipment_col = col
            elif anchor_date_col is None and any(x in col_lower for x in ['anchor', 'anchor_date', 'start_date', 'initial_date']):
                anchor_date_col = col
            elif due_date_col is None and any(x in col_lower for x in ['due', 'due_date', 'next_due']):
                due_date_col = col
            elif lead_weeks_col is None and any(x in col_lower for x in ['lead', 'lead_weeks', 'lead_weeks_override']):
                lead_weeks_col = col
            elif timezone_col is None and any(x in col_lower for x in ['timezone', 'tz', 'time_zone']):
                timezone_col = col
            elif address_col is None and 'address' in col_lower:
                address_col = col
            elif notes_col is None and 'note' in col_lower:
                notes_col = col
            # "equipment" or "equipment_name" column = Equipment Name (stored in equipment_record.equipment_name)
            elif identifier_col is None and 'equipment_name' in col_lower:
                identifier_col = col
            elif identifier_col is None and col_lower == 'equipment':
                identifier_col = col
        
        # Second pass: look for less specific patterns if identifier not found yet
        if identifier_col is None:
            for col in df.columns:
                col_lower = col.lower().strip()
                if any(x in col_lower for x in ['serial', 'serial_number']):
                    identifier_col = col
                    break
        
        # Debug: print which columns were identified
        print(f"[DEBUG] Identified columns:")
        print(f"  - Equipment: {equipment_col}")
        print(f"  - Anchor Date: {anchor_date_col}")
        print(f"  - Due Date: {due_date_col}")
        print(f"  - Equipment Name/Identifier: {identifier_col}")
        print(f"  - Notes: {notes_col}")
        if identifier_col and len(df) > 0:
            # Show sample values from the identifier column
            sample_val = df[identifier_col].iloc[0] if identifier_col in df.columns else None
            print(f"  - Identifier column sample value (first row): {repr(sample_val)} (type: {type(sample_val).__name__})")
        
        # Check required columns based on whether site_id is provided
        if target_site_id:
            # Need equipment and anchor date (due date is optional)
            if not equipment_col or not anchor_date_col:
                missing = []
                if not equipment_col: missing.append("Equipment/Test Type")
                if not anchor_date_col: missing.append("Anchor Date")
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required columns: {', '.join(missing)}. Found columns: {', '.join(df.columns)}"
                )
        else:
            # Need client, site, equipment, and anchor date
            if not client_col or not site_col or not equipment_col or not anchor_date_col:
                missing = []
                if not client_col: missing.append("Client")
                if not site_col: missing.append("Site")
                if not equipment_col: missing.append("Equipment/Test Type")
                if not anchor_date_col: missing.append("Anchor Date")
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required columns: {', '.join(missing)}. Found columns: {', '.join(df.columns)}"
                )
        
        # Track what was created
        stats = {
            "clients_created": 0,
            "sites_created": 0,
            "equipments_created": 0,
            "equipment_records_created": 0,
            "duplicates_skipped": 0,
            "errors": []
        }
        
        # Process each row
        client_map = {}  # name -> id
        site_map = {}    # (client_id, site_name) -> id
        equipment_map = {}  # equipment_type_name (uppercase) -> equipment_type_id
        
        for idx, row in df.iterrows():
            try:
                if target_site_id:
                    # Importing to a specific site - skip client/site creation
                    client_id = target_client_id
                    site_id = target_site_id
                else:
                    # Get or create client
                    client_name = str(row[client_col]).strip()
                    if not client_name or client_name.lower() in ['nan', 'none', '']:
                        continue
                    
                    if client_name not in client_map:
                        # Check if client exists
                        existing = db.execute("SELECT id FROM clients WHERE name = ?", (client_name,)).fetchone()
                        if existing:
                            client_id = existing['id']
                        else:
                            # Create client
                            cur = db.execute(
                                "INSERT INTO clients (name, address) VALUES (?, ?)",
                                (client_name, str(row[address_col]).strip() if address_col and pd.notna(row.get(address_col)) else None)
                            )
                            db.commit()
                            client_id = cur.lastrowid
                            stats["clients_created"] += 1
                        
                        client_map[client_name] = client_id
                    
                    client_id = client_map[client_name]
                    
                    # Get or create site
                    site_name = str(row[site_col]).strip()
                    if not site_name or site_name.lower() in ['nan', 'none', '']:
                        continue
                    
                    site_key = (client_id, site_name)
                    if site_key not in site_map:
                        existing = db.execute(
                            "SELECT id FROM sites WHERE client_id = ? AND name = ?",
                            (client_id, site_name)
                        ).fetchone()
                        if existing:
                            site_id = existing['id']
                        else:
                            cur = db.execute(
                                "INSERT INTO sites (client_id, name, address, timezone) VALUES (?, ?, ?, ?)",
                                (client_id, site_name, None, "America/Chicago")
                            )
                            db.commit()
                            site_id = cur.lastrowid
                            stats["sites_created"] += 1
                        
                        site_map[site_key] = site_id
                    
                    site_id = site_map[site_key]
                
                # equipment_col now points to "identifier" column (equipment type/dropdown value)
                equipment_type_name = str(row[equipment_col]).strip()
                if not equipment_type_name or equipment_type_name.upper() in ['NAN', 'NONE', '']:
                    continue
                
                # Get or create equipment_type
                equipment_type_key = equipment_type_name.upper()
                if equipment_type_key not in equipment_map:
                    existing = db.execute(
                        "SELECT id, interval_weeks, default_lead_weeks FROM equipment_types WHERE UPPER(name) = ?",
                        (equipment_type_key,)
                    ).fetchone()
                    if existing:
                        equipment_type_id = existing['id']
                    else:
                        # Create equipment_type entry
                        cur = db.execute(
                            "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?)",
                            (equipment_type_name, 52, "FREQ=WEEKLY;INTERVAL=52", 4)
                        )
                        db.commit()
                        equipment_type_id = cur.lastrowid
                        stats["equipments_created"] += 1
                    equipment_map[equipment_type_key] = equipment_type_id
                equipment_type_id = equipment_map[equipment_type_key]
                
                # Parse anchor date (required)
                if pd.isna(row[anchor_date_col]):
                    continue
                try:
                    if isinstance(row[anchor_date_col], pd.Timestamp):
                        anchor_date = row[anchor_date_col].date().isoformat()
                    elif isinstance(row[anchor_date_col], dt.date):
                        anchor_date = row[anchor_date_col].isoformat()
                    else:
                        anchor_date = parse_date(str(row[anchor_date_col])).date().isoformat()
                except:
                    continue
                
                # Parse due date (optional)
                due_date = None
                if due_date_col and pd.notna(row.get(due_date_col)):
                    try:
                        if isinstance(row[due_date_col], pd.Timestamp):
                            due_date = row[due_date_col].date().isoformat()
                        elif isinstance(row[due_date_col], dt.date):
                            due_date = row[due_date_col].isoformat()
                        else:
                            due_date = parse_date(str(row[due_date_col])).date().isoformat()
                    except:
                        pass  # If due date parsing fails, leave it as None
                
                # Parse lead weeks (optional)
                lead_weeks = None
                if lead_weeks_col and pd.notna(row.get(lead_weeks_col)):
                    try:
                        lead_weeks = int(float(row[lead_weeks_col]))
                    except:
                        pass  # If parsing fails, leave as None
                
                # Parse timezone (optional)
                timezone = None
                if timezone_col and pd.notna(row.get(timezone_col)):
                    timezone = str(row[timezone_col]).strip()
                    if not timezone or timezone.lower() in ['nan', 'none', '']:
                        timezone = None
                
                # Get notes and equipment identifier
                notes = str(row[notes_col]).strip() if notes_col and pd.notna(row.get(notes_col)) else None
                if notes and notes.lower() in ['nan', 'none', '']:
                    notes = None
                
                # Get equipment name (textarea value) - identifier_col now points to "equipment" column
                # This will be stored in equipment_record.equipment_name field
                equipment_identifier = None
                if identifier_col and pd.notna(row.get(identifier_col)):
                    raw_value = row[identifier_col]
                    # Convert to string, but handle numeric values specially
                    if pd.isna(raw_value):
                        equipment_identifier = None
                    else:
                        # If it's a number, it's likely the wrong column (probably equipment_id) - skip it
                        if isinstance(raw_value, (int, float)):
                            if idx == 0:  # Only warn on first row
                                print(f"[DEBUG] WARNING: Identifier column '{identifier_col}' contains numeric value '{raw_value}' - skipping (likely wrong column)")
                            # Skip numeric identifiers - they're probably equipment_id, not equipment_identifier
                            equipment_identifier = None
                        else:
                            equipment_identifier = str(raw_value).strip()
                        
                        # Debug: log the first row to verify column mapping
                        if idx == 0:
                            print(f"[DEBUG] Row {idx + 2}: Identifier column '{identifier_col}' raw value: {repr(raw_value)}, converted: '{equipment_identifier}'")
                        
                        if equipment_identifier and equipment_identifier.lower() in ['nan', 'none', '']:
                            equipment_identifier = None
                
                # Get default timezone from site if not provided
                if not timezone:
                    site_row = db.execute("SELECT timezone FROM sites WHERE id = ?", (site_id,)).fetchone()
                    timezone = site_row['timezone'] if site_row and site_row['timezone'] else "America/Chicago"
                
                # Get default lead_weeks from equipment_type if not provided
                if lead_weeks is None:
                    eq_type_row = db.execute("SELECT default_lead_weeks FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
                    lead_weeks = eq_type_row['default_lead_weeks'] if eq_type_row and eq_type_row['default_lead_weeks'] else 4
                
                # Get interval_weeks from equipment_type
                eq_type_row = db.execute("SELECT interval_weeks FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
                interval_weeks = eq_type_row['interval_weeks'] if eq_type_row and eq_type_row['interval_weeks'] else 52
                
                # Use equipment_identifier as equipment_name, or fallback to equipment_type_name
                equipment_name = equipment_identifier if equipment_identifier else equipment_type_name
                
                try:
                    db.execute(
                        "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                        (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes)
                    )
                    db.commit()
                    stats["equipment_records_created"] += 1
                except sqlite3.IntegrityError as e:
                    error_str = str(e)
                    if "UNIQUE constraint" in error_str:
                        stats["duplicates_skipped"] += 1
                    else:
                        stats["errors"].append(f"Row {idx + 2}: {error_str}")
                except Exception as e:
                    stats["errors"].append(f"Row {idx + 2}: {str(e)}")
                
            except:
                continue
        
        return {
            "message": "Import completed",
            "stats": stats,
            "total_rows_processed": len(df)
        }
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="Excel file is empty")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")


# ========== EQUIPMENT IMPORT/EXPORT ==========

@app.post("/admin/import/equipments")
async def import_equipments(
    file: UploadFile = File(...),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import equipment records from Excel file.
    Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date
    - If client or site doesn't exist, the row is skipped (voided)
    - If equipment type doesn't exist, it will be created in equipment_types table
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    try:
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names (case-insensitive, remove spaces)
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_').str.replace('-', '_')
        
        # Identify columns
        client_col = None
        site_col = None
        equipment_type_col = None  # Equipment Type (dropdown value - maps to equipment_type_id)
        equipment_name_col = None  # Equipment Name (text field)
        anchor_date_col = None
        due_date_col = None
        interval_col = None  # Interval (weeks)
        lead_weeks_col = None
        timezone_col = None
        notes_col = None
        
        for col in df.columns:
            col_lower = col.lower().strip()
            if client_col is None and any(x in col_lower for x in ['client', 'customer']):
                client_col = col
            elif site_col is None and any(x in col_lower for x in ['site', 'location', 'facility']):
                site_col = col
            elif equipment_type_col is None and any(x in col_lower for x in ['equipment_type', 'equipmenttype', 'type', 'test', 'modality']):
                # Equipment Type (dropdown value - maps to equipment_type_id)
                equipment_type_col = col
            elif equipment_name_col is None and ('equipment_name' in col_lower or 'equipmentname' in col_lower):
                # Equipment Name (text field)
                equipment_name_col = col
            elif equipment_name_col is None and col_lower == 'equipment' and 'type' not in col_lower:
                # "equipment" column = Equipment Name (but not if it's "equipment_type")
                equipment_name_col = col
            elif anchor_date_col is None and any(x in col_lower for x in ['anchor', 'anchor_date', 'start_date', 'initial_date']):
                anchor_date_col = col
            elif due_date_col is None and any(x in col_lower for x in ['due', 'due_date', 'next_due']):
                due_date_col = col
            elif interval_col is None and any(x in col_lower for x in ['interval', 'interval_weeks', 'weeks']):
                interval_col = col
            elif lead_weeks_col is None and any(x in col_lower for x in ['lead', 'lead_weeks', 'lead_weeks_override']):
                lead_weeks_col = col
            elif timezone_col is None and any(x in col_lower for x in ['timezone', 'tz', 'time_zone']):
                timezone_col = col
            elif notes_col is None and 'note' in col_lower:
                notes_col = col
        
        # Check required columns
        if not client_col or not site_col or not equipment_type_col or not equipment_name_col or not anchor_date_col:
            missing = []
            if not client_col: missing.append("Client")
            if not site_col: missing.append("Site")
            if not equipment_type_col: missing.append("Equipment Type")
            if not equipment_name_col: missing.append("Equipment Name")
            if not anchor_date_col: missing.append("Anchor Date")
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {', '.join(missing)}. Found columns: {', '.join(df.columns)}"
            )
        
        # Track statistics
        stats = {
            "rows_processed": 0,
            "rows_skipped": 0,
            "equipment_records_created": 0,
            "equipment_types_created": 0,
            "duplicates_skipped": 0,
            "errors": []
        }
        
        # Process each row
        for idx, row in df.iterrows():
            stats["rows_processed"] += 1
            try:
                # Get client name
                client_name = str(row[client_col]).strip()
                if not client_name or client_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing client name")
                    continue
                
                # Match client (must exist, don't create)
                client_row = db.execute("SELECT id FROM clients WHERE name = ?", (client_name,)).fetchone()
                if not client_row:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Client '{client_name}' not found")
                    continue
                client_id = client_row['id']
                
                # Get site name
                site_name = str(row[site_col]).strip()
                if not site_name or site_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing site name")
                    continue
                
                # Match site (must exist under client, don't create)
                site_row = db.execute(
                    "SELECT id, timezone FROM sites WHERE client_id = ? AND name = ?",
                    (client_id, site_name)
                ).fetchone()
                if not site_row:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Site '{site_name}' not found for client '{client_name}'")
                    continue
                site_id = site_row['id']
                default_timezone = site_row['timezone'] or "America/Chicago"
                
                # Get equipment type (dropdown value)
                equipment_type_name = str(row[equipment_type_col]).strip()
                if not equipment_type_name or equipment_type_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing equipment type")
                    continue
                
                # Get or create equipment_type
                equipment_type = db.execute("SELECT id, interval_weeks, default_lead_weeks FROM equipment_types WHERE name = ?", (equipment_type_name,)).fetchone()
                if equipment_type:
                    equipment_type_id = equipment_type['id']
                    default_interval_weeks = equipment_type['interval_weeks'] or 52
                    default_lead_weeks = equipment_type['default_lead_weeks'] or 4
                else:
                    # Create new equipment_type
                    rrule_str = "FREQ=WEEKLY;INTERVAL=52"
                    cur = db.execute(
                        "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?)",
                        (equipment_type_name, 52, rrule_str, 4)
                    )
                    db.commit()
                    equipment_type_id = cur.lastrowid
                    default_interval_weeks = 52
                    default_lead_weeks = 4
                    stats["equipment_types_created"] += 1
                
                # Get equipment name (required)
                equipment_name = str(row[equipment_name_col]).strip()
                if not equipment_name or equipment_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing equipment name")
                    continue
                
                # Parse anchor date (required)
                if pd.isna(row[anchor_date_col]):
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing anchor date")
                    continue
                
                try:
                    if isinstance(row[anchor_date_col], pd.Timestamp):
                        anchor_date = row[anchor_date_col].date().isoformat()
                    elif isinstance(row[anchor_date_col], dt.date):
                        anchor_date = row[anchor_date_col].isoformat()
                    else:
                        anchor_date = parse_date(str(row[anchor_date_col])).date().isoformat()
                except Exception as e:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Invalid anchor date: {str(e)}")
                    continue
                
                # Parse due date (optional)
                due_date = None
                if due_date_col and pd.notna(row.get(due_date_col)):
                    try:
                        if isinstance(row[due_date_col], pd.Timestamp):
                            due_date = row[due_date_col].date().isoformat()
                        elif isinstance(row[due_date_col], dt.date):
                            due_date = row[due_date_col].isoformat()
                        else:
                            due_date = parse_date(str(row[due_date_col])).date().isoformat()
                    except:
                        pass
                
                # Parse lead weeks (optional)
                lead_weeks = None
                if lead_weeks_col and pd.notna(row.get(lead_weeks_col)):
                    try:
                        lead_weeks = int(float(row[lead_weeks_col]))
                    except:
                        pass
                if lead_weeks is None:
                    lead_weeks = default_lead_weeks
                
                # Parse timezone (optional)
                timezone = None
                if timezone_col and pd.notna(row.get(timezone_col)):
                    timezone = str(row[timezone_col]).strip()
                    if timezone.lower() in ['nan', 'none', '']:
                        timezone = None
                if not timezone:
                    timezone = default_timezone
                
                # Get notes (optional)
                notes = None
                if notes_col and pd.notna(row.get(notes_col)):
                    notes = str(row[notes_col]).strip()
                    if notes.lower() in ['nan', 'none', '']:
                        notes = None
                
                # Get interval_weeks from Excel file if provided, otherwise from equipment_type
                interval_weeks = None
                if interval_col and pd.notna(row.get(interval_col)):
                    try:
                        interval_weeks = int(float(row[interval_col]))
                    except:
                        pass
                if interval_weeks is None:
                    # Fall back to equipment_type's interval
                    eq_type_row = db.execute("SELECT interval_weeks FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
                    interval_weeks = eq_type_row['interval_weeks'] if eq_type_row and eq_type_row['interval_weeks'] else 52
                
                # Create equipment_record
                try:
                    db.execute(
                        "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                        (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes)
                    )
                    db.commit()
                    stats["equipment_records_created"] += 1
                except sqlite3.IntegrityError as e:
                    error_str = str(e)
                    if "UNIQUE constraint" in error_str:
                        stats["duplicates_skipped"] += 1
                    else:
                        stats["errors"].append(f"Row {idx + 2}: {error_str}")
                except Exception as e:
                    stats["errors"].append(f"Row {idx + 2}: {str(e)}")
                    
            except Exception as e:
                stats["rows_skipped"] += 1
                stats["errors"].append(f"Row {idx + 2}: {str(e)}")
        
        return {
            "message": "Import completed",
            "stats": stats,
            "total_rows_processed": len(df)
        }
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="Excel file is empty")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")


@app.post("/admin/import/temporary")
async def import_temporary_data(
    file: UploadFile = File(...),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import equipment records from Excel file (temporary data upload).
    Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date
    - If client or site doesn't exist, they will be created automatically
    - If equipment type doesn't exist, it will be created in equipment_types table
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    try:
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names (case-insensitive, remove spaces)
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_').str.replace('-', '_')
        
        # Identify columns
        client_col = None
        site_col = None
        equipment_col = None  # Equipment Identifier (dropdown value)
        equipment_name_col = None  # Equipment Name (textarea value)
        anchor_date_col = None
        due_date_col = None
        interval_col = None  # Interval (weeks)
        lead_weeks_col = None
        timezone_col = None
        notes_col = None
        
        for col in df.columns:
            col_lower = col.lower().strip()
            if client_col is None and any(x in col_lower for x in ['client', 'customer']):
                client_col = col
            elif site_col is None and any(x in col_lower for x in ['site', 'location', 'facility']):
                site_col = col
            elif equipment_col is None and ('identifier' in col_lower or 'equipment_identifier' in col_lower):
                # "identifier" column = Equipment Identifier (dropdown value - used to match/create equipment)
                equipment_col = col
            elif equipment_col is None and any(x in col_lower for x in ['test', 'equipment_type', 'type', 'modality']):
                # Other equipment identifier patterns (but NOT "equipment" itself, as that's the name)
                equipment_col = col
            elif equipment_name_col is None and 'equipment_name' in col_lower:
                # "equipment_name" column = Equipment Name (textarea value - stored in schedule.equipment_identifier)
                equipment_name_col = col
            elif equipment_name_col is None and col_lower == 'equipment':
                # "equipment" column = Equipment Name (textarea value - stored in schedule.equipment_identifier)
                equipment_name_col = col
            elif anchor_date_col is None and any(x in col_lower for x in ['anchor', 'anchor_date', 'start_date', 'initial_date']):
                anchor_date_col = col
            elif due_date_col is None and any(x in col_lower for x in ['due', 'due_date', 'next_due']):
                due_date_col = col
            elif interval_col is None and any(x in col_lower for x in ['interval', 'interval_weeks', 'weeks']):
                interval_col = col
            elif lead_weeks_col is None and any(x in col_lower for x in ['lead', 'lead_weeks', 'lead_weeks_override']):
                lead_weeks_col = col
            elif timezone_col is None and any(x in col_lower for x in ['timezone', 'tz', 'time_zone']):
                timezone_col = col
            elif notes_col is None and 'note' in col_lower:
                notes_col = col
        
        # Check required columns
        if not client_col or not site_col or not equipment_col or not equipment_name_col or not anchor_date_col:
            missing = []
            if not client_col: missing.append("Client")
            if not site_col: missing.append("Site")
            if not equipment_col: missing.append("Equipment/Equipment Identifier")
            if not equipment_name_col: missing.append("Equipment Name")
            if not anchor_date_col: missing.append("Anchor Date")
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {', '.join(missing)}. Found columns: {', '.join(df.columns)}"
            )
        
        # Track statistics
        stats = {
            "rows_processed": 0,
            "rows_skipped": 0,
            "equipment_records_created": 0,
            "equipment_types_created": 0,
            "clients_created": 0,
            "sites_created": 0,
            "duplicates_skipped": 0,
            "errors": []
        }
        
        # Maps to track created clients and sites
        client_map = {}  # name -> id
        site_map = {}  # (client_id, site_name) -> id
        
        # Process each row
        for idx, row in df.iterrows():
            stats["rows_processed"] += 1
            try:
                # Get client name
                client_name = str(row[client_col]).strip()
                if not client_name or client_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing client name")
                    continue
                
                # Get or create client
                if client_name not in client_map:
                    existing = db.execute("SELECT id FROM clients WHERE name = ?", (client_name,)).fetchone()
                    if existing:
                        client_id = existing['id']
                    else:
                        # Create client
                        cur = db.execute(
                            "INSERT INTO clients (name, address) VALUES (?, ?)",
                            (client_name, None)
                        )
                        db.commit()
                        client_id = cur.lastrowid
                        stats["clients_created"] += 1
                    
                    client_map[client_name] = client_id
                
                client_id = client_map[client_name]
                
                # Get site name
                site_name = str(row[site_col]).strip()
                if not site_name or site_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing site name")
                    continue
                
                # Get or create site
                site_key = (client_id, site_name)
                if site_key not in site_map:
                    existing = db.execute(
                        "SELECT id, timezone FROM sites WHERE client_id = ? AND name = ?",
                        (client_id, site_name)
                    ).fetchone()
                    if existing:
                        site_id = existing['id']
                        default_timezone = existing['timezone'] or "America/Chicago"
                    else:
                        # Create site
                        cur = db.execute(
                            "INSERT INTO sites (client_id, name, address, timezone) VALUES (?, ?, ?, ?)",
                            (client_id, site_name, None, "America/Chicago")
                        )
                        db.commit()
                        site_id = cur.lastrowid
                        default_timezone = "America/Chicago"
                        stats["sites_created"] += 1
                    
                    site_map[site_key] = (site_id, default_timezone)
                
                site_id, default_timezone = site_map[site_key]
                
                # Get equipment type (dropdown value)
                equipment_type_name = str(row[equipment_col]).strip()
                if not equipment_type_name or equipment_type_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing equipment type")
                    continue
                
                # Get or create equipment_type
                equipment_type = db.execute("SELECT id, interval_weeks, default_lead_weeks FROM equipment_types WHERE name = ?", (equipment_type_name,)).fetchone()
                if equipment_type:
                    equipment_type_id = equipment_type['id']
                    default_interval_weeks = equipment_type['interval_weeks'] or 52
                    default_lead_weeks = equipment_type['default_lead_weeks'] or 4
                else:
                    # Create new equipment_type
                    rrule_str = "FREQ=WEEKLY;INTERVAL=52"
                    cur = db.execute(
                        "INSERT INTO equipment_types (name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?)",
                        (equipment_type_name, 52, rrule_str, 4)
                    )
                    db.commit()
                    equipment_type_id = cur.lastrowid
                    default_interval_weeks = 52
                    default_lead_weeks = 4
                    stats["equipment_types_created"] += 1
                
                # Get equipment name (required)
                equipment_name = str(row[equipment_name_col]).strip() if equipment_name_col and pd.notna(row.get(equipment_name_col)) else None
                if not equipment_name or equipment_name.lower() in ['nan', 'none', '']:
                    # Use equipment type name as fallback
                    equipment_name = equipment_type_name
                
                # Parse anchor date (required)
                if pd.isna(row[anchor_date_col]):
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing anchor date")
                    continue
                
                try:
                    if isinstance(row[anchor_date_col], pd.Timestamp):
                        anchor_date = row[anchor_date_col].date().isoformat()
                    elif isinstance(row[anchor_date_col], dt.date):
                        anchor_date = row[anchor_date_col].isoformat()
                    else:
                        anchor_date = parse_date(str(row[anchor_date_col])).date().isoformat()
                except Exception as e:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Invalid anchor date: {str(e)}")
                    continue
                
                # Parse due date (optional)
                due_date = None
                if due_date_col and pd.notna(row.get(due_date_col)):
                    try:
                        if isinstance(row[due_date_col], pd.Timestamp):
                            due_date = row[due_date_col].date().isoformat()
                        elif isinstance(row[due_date_col], dt.date):
                            due_date = row[due_date_col].isoformat()
                        else:
                            due_date = parse_date(str(row[due_date_col])).date().isoformat()
                    except:
                        pass
                
                # Parse interval weeks from Excel file if provided, otherwise use default
                interval_weeks = None
                if interval_col and pd.notna(row.get(interval_col)):
                    try:
                        interval_weeks = int(float(row[interval_col]))
                    except:
                        pass
                if interval_weeks is None:
                    interval_weeks = default_interval_weeks
                
                # Parse lead weeks (optional)
                lead_weeks = None
                if lead_weeks_col and pd.notna(row.get(lead_weeks_col)):
                    try:
                        lead_weeks = int(float(row[lead_weeks_col]))
                    except:
                        pass
                if lead_weeks is None:
                    lead_weeks = default_lead_weeks
                
                # Parse timezone (optional)
                timezone = None
                if timezone_col and pd.notna(row.get(timezone_col)):
                    timezone = str(row[timezone_col]).strip()
                    if timezone.lower() in ['nan', 'none', '']:
                        timezone = None
                if not timezone:
                    timezone = default_timezone
                
                # Get notes (optional)
                notes = None
                if notes_col and pd.notna(row.get(notes_col)):
                    notes = str(row[notes_col]).strip()
                    if notes.lower() in ['nan', 'none', '']:
                        notes = None
                
                # Create equipment_record
                try:
                    db.execute(
                        "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes, 1)
                    )
                    db.commit()
                    stats["equipment_records_created"] += 1
                except sqlite3.IntegrityError as e:
                    error_str = str(e)
                    if "UNIQUE constraint" in error_str:
                        stats["duplicates_skipped"] += 1
                    else:
                        stats["errors"].append(f"Row {idx + 2}: {error_str}")
                except Exception as e:
                    stats["errors"].append(f"Row {idx + 2}: {str(e)}")
                    
            except Exception as e:
                stats["rows_skipped"] += 1
                stats["errors"].append(f"Row {idx + 2}: {str(e)}")
        
        return {
            "message": "Import completed",
            "stats": stats,
            "total_rows_processed": len(df)
        }
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="Excel file is empty")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")


@app.get("/admin/export/equipments")
async def export_equipments(
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Export all equipment records to Excel format
    """
    try:
        # Query all equipment records with related data
        cur = db.execute("""
            SELECT 
                c.name as client_name,
                s.name as site_name,
                et.name as equipment_type,
                er.equipment_name,
                er.anchor_date,
                er.due_date,
                er.interval_weeks,
                er.lead_weeks,
                er.timezone,
                er.notes,
                er.active
            FROM equipment_record er
            JOIN clients c ON er.client_id = c.id
            JOIN sites s ON er.site_id = s.id
            JOIN equipment_types et ON er.equipment_type_id = et.id
            WHERE er.active = 1
            ORDER BY c.name, s.name, er.anchor_date
        """)
        
        rows = cur.fetchall()
        
        # Create DataFrame
        data = []
        for row in rows:
            data.append({
                "Client": row['client_name'],
                "Site": row['site_name'],
                "Equipment Type": row['equipment_type'],
                "Equipment Name": row['equipment_name'],
                "Anchor Date": row['anchor_date'],
                "Due Date": row['due_date'] or "",
                "Interval": row['interval_weeks'],
                "Lead Weeks": row['lead_weeks'] or "",
                "Timezone": row['timezone'] or "",
                "Notes": row['notes'] or ""
            })
        
        df = pd.DataFrame(data)
        
        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Equipments')
        
        output.seek(0)
        
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=equipments_export.xlsx"}
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error exporting equipments: {str(e)}")