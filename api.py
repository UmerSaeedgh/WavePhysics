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


# ========== TEST TYPES ==========

class TestTypeCreate(BaseModel):
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool = True


class TestTypeUpdate(BaseModel):
    name: Optional[str] = None
    interval_weeks: Optional[int] = None
    rrule: Optional[str] = None
    default_lead_weeks: Optional[int] = None
    active: Optional[bool] = None


class TestTypeRead(BaseModel):
    id: int
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool


@app.get("/test-types", response_model=List[TestTypeRead])
def list_test_types(
    active_only: bool = Query(False, description="Filter to active only"),
    db: sqlite3.Connection = Depends(get_db)
):
    if active_only:
        cur = db.execute(
            "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM test_types WHERE active = 1 ORDER BY name"
        )
    else:
        cur = db.execute("SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM test_types ORDER BY name")
    rows = cur.fetchall()
    return [TestTypeRead(**dict(row)) for row in rows]


@app.get("/test-types/{test_type_id}", response_model=TestTypeRead)
def get_test_type(test_type_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM test_types WHERE id = ?",
        (test_type_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Test type not found")

    return TestTypeRead(**dict(row))


@app.post("/test-types", response_model=TestTypeRead, status_code=status.HTTP_201_CREATED)
def create_test_type(payload: TestTypeCreate, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            "INSERT INTO test_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?)",
            (payload.name, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Test type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM test_types WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return TestTypeRead(**dict(row))


@app.put("/test-types/{test_type_id}", response_model=TestTypeRead)
def update_test_type(test_type_id: int, payload: TestTypeUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM test_types WHERE id = ?", (test_type_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Test type not found")

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
        values.append(test_type_id)
        try:
            db.execute(
                f"UPDATE test_types SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Test type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM test_types WHERE id = ?",
        (test_type_id,),
    ).fetchone()
    return TestTypeRead(**dict(row))


@app.delete("/test-types/{test_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test_type(test_type_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM test_types WHERE id = ?", (test_type_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Test type not found")

    return


@app.post("/test-types/seed", status_code=status.HTTP_201_CREATED)
def seed_test_types(db: sqlite3.Connection = Depends(get_db)):
    """Seed default test types"""
    defaults = [
        ("NM Audit", 13, "FREQ=WEEKLY;INTERVAL=13", 3),
        ("ACR PET / Gamma camera ACR", 26, "FREQ=WEEKLY;INTERVAL=26", 4),
        ("X-ray/CT physics testing", 52, "FREQ=WEEKLY;INTERVAL=52", 5),
    ]
    
    created = []
    for name, interval, rrule_str, lead_weeks in defaults:
        # Check if exists
        existing = db.execute("SELECT id FROM test_types WHERE name = ?", (name,)).fetchone()
        if existing:
            continue
        
        cur = db.execute(
            "INSERT INTO test_types (name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, 1)",
            (name, interval, rrule_str, lead_weeks),
        )
        created.append(cur.lastrowid)
    
    db.commit()
    return {"created": len(created), "ids": created}


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
    """List all equipments for a client"""
    query = "SELECT id, client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom FROM client_equipments WHERE client_id = ?"
    params = [client_id]
    
    if active_only:
        query += " AND active = 1"
    
    query += " ORDER BY is_custom, name"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [EquipmentRead(**dict(row)) for row in rows]


@app.get("/equipments/{equipment_id}", response_model=EquipmentRead)
def get_equipment(equipment_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom FROM client_equipments WHERE id = ?",
        (equipment_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")

    return EquipmentRead(**dict(row))


@app.post("/clients/{client_id}/equipments", response_model=EquipmentRead, status_code=status.HTTP_201_CREATED)
def create_client_equipment(client_id: int, payload: EquipmentCreate, db: sqlite3.Connection = Depends(get_db)):
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Ensure client_id matches
    if payload.client_id != client_id:
        raise HTTPException(status_code=400, detail="Client ID mismatch")

    # Normalize name to uppercase
    name_upper = payload.name.upper()
    
    # Check for existing equipment case-insensitively
    existing = db.execute("SELECT id FROM client_equipments WHERE client_id = ? AND UPPER(name) = ?", (client_id, name_upper)).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Equipment name must be unique per client (case-insensitive)")

    try:
        cur = db.execute(
            "INSERT INTO client_equipments (client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom) VALUES (?, ?, ?, ?, ?, ?, 1)",
            (payload.client_id, name_upper, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Equipment name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom FROM client_equipments WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return EquipmentRead(**dict(row))


@app.put("/equipments/{equipment_id}", response_model=EquipmentRead)
def update_equipment(equipment_id: int, payload: EquipmentUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id, is_custom FROM client_equipments WHERE id = ?", (equipment_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    # Don't allow editing default equipments (only custom ones)
    if row['is_custom'] == 0:
        raise HTTPException(status_code=400, detail="Cannot edit default equipment. Only custom equipments can be modified.")

    fields = []
    values = []

    if payload.name is not None:
        # Normalize name to uppercase
        name_upper = payload.name.upper()
        # Check for duplicate (case-insensitive) excluding current equipment
        client_id_row = db.execute("SELECT client_id FROM client_equipments WHERE id = ?", (equipment_id,)).fetchone()
        if client_id_row:
            existing = db.execute("SELECT id FROM client_equipments WHERE client_id = ? AND UPPER(name) = ? AND id != ?", (client_id_row['client_id'], name_upper, equipment_id)).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="Equipment name must be unique per client (case-insensitive)")
        fields.append("name = ?")
        values.append(name_upper)
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
                f"UPDATE client_equipments SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Equipment name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom FROM client_equipments WHERE id = ?",
        (equipment_id,),
    ).fetchone()
    return EquipmentRead(**dict(row))


@app.delete("/equipments/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(equipment_id: int, db: sqlite3.Connection = Depends(get_db)):
    # Check if it's a custom equipment (only custom can be deleted)
    row = db.execute("SELECT is_custom FROM client_equipments WHERE id = ?", (equipment_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    if row['is_custom'] == 0:
        raise HTTPException(status_code=400, detail="Cannot delete default equipment. Only custom equipments can be deleted.")
    
    cur = db.execute("DELETE FROM client_equipments WHERE id = ?", (equipment_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Equipment not found")

    return


@app.post("/clients/{client_id}/equipments/seed-defaults", status_code=status.HTTP_201_CREATED)
def seed_default_equipments(client_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Seed default equipments for a client"""
    # Verify client exists
    client_row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    created = []
    for name, interval, rrule_str, lead_weeks in DEFAULT_EQUIPMENTS:
        # Check if exists for this client
        existing = db.execute("SELECT id FROM client_equipments WHERE client_id = ? AND name = ?", (client_id, name)).fetchone()
        if existing:
            continue
        
        cur = db.execute(
            "INSERT INTO client_equipments (client_id, name, interval_weeks, rrule, default_lead_weeks, active, is_custom) VALUES (?, ?, ?, ?, ?, 1, 0)",
            (client_id, name, interval, rrule_str, lead_weeks),
        )
        created.append(cur.lastrowid)
    
    db.commit()
    return {"created": len(created), "ids": created}


# ========== SCHEDULES ==========

def compute_next_due_date(anchor_date: dt.date, rrule_str: str, last_generated_until: Optional[dt.date] = None) -> dt.date:
    """Compute the next due date from anchor using rrule"""
    try:
        # Parse rrule
        rule = rrule.rrulestr(rrule_str, dtstart=anchor_date)
        
        # Get next occurrence after last_generated_until or today
        after_date = last_generated_until or dt.date.today()
        
        # Get next occurrence
        occurrences = list(rule.after(after_date, inc=False))
        if occurrences:
            return occurrences[0].date()
        else:
            # If no future occurrence, calculate from anchor
            return anchor_date
    except Exception as e:
        # Fallback: add interval_weeks to anchor
        return anchor_date


class ScheduleCreate(BaseModel):
    site_id: int
    equipment_id: int
    anchor_date: str  # YYYY-MM-DD
    due_date: Optional[str] = None  # YYYY-MM-DD (manual due date)
    lead_weeks: Optional[int] = None
    timezone: Optional[str] = None
    equipment_identifier: Optional[str] = None
    notes: Optional[str] = None


class ScheduleUpdate(BaseModel):
    equipment_id: Optional[int] = None
    anchor_date: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD (manual due date)
    lead_weeks: Optional[int] = None
    timezone: Optional[str] = None
    equipment_identifier: Optional[str] = None
    notes: Optional[str] = None


class ScheduleRead(BaseModel):
    id: int
    site_id: int
    equipment_id: int
    equipment_name: Optional[str] = None
    anchor_date: str
    due_date: Optional[str] = None  # YYYY-MM-DD (manual due date)
    lead_weeks: Optional[int]
    timezone: Optional[str]
    equipment_identifier: Optional[str]
    notes: Optional[str]
    last_generated_until: Optional[str]
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    site_name: Optional[str] = None
    site_address: Optional[str] = None
    completed: bool = False
    completed_at: Optional[str] = None  # YYYY-MM-DD HH:MM:SS timestamp when completed


@app.get("/schedules", response_model=List[ScheduleRead])
def list_schedules(
    site_id: Optional[int] = Query(None, description="Filter by site"),
    db: sqlite3.Connection = Depends(get_db)
):
    if site_id:
        cur = db.execute(
            """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id, 
                      COALESCE(ce.name, tt.name) as equipment_name,
                      sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                      COALESCE(sch.completed, 0) as completed, sch.completed_at,
                      c.name as client_name, c.address as client_address,
                      s.name as site_name, s.address as site_address
               FROM schedules sch
               LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
               LEFT JOIN test_types tt ON sch.test_type_id = tt.id
               LEFT JOIN sites s ON sch.site_id = s.id
               LEFT JOIN clients c ON s.client_id = c.id
               WHERE sch.site_id = ? AND COALESCE(sch.completed, 0) = 0 ORDER BY sch.anchor_date""",
            (site_id,)
        )
    else:
        cur = db.execute(
            """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                      COALESCE(ce.name, tt.name) as equipment_name,
                      sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                      COALESCE(sch.completed, 0) as completed, sch.completed_at,
                      c.name as client_name, c.address as client_address,
                      s.name as site_name, s.address as site_address
               FROM schedules sch
               LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
               LEFT JOIN test_types tt ON sch.test_type_id = tt.id
               LEFT JOIN sites s ON sch.site_id = s.id
               LEFT JOIN clients c ON s.client_id = c.id
               WHERE COALESCE(sch.completed, 0) = 0 ORDER BY sch.anchor_date"""
        )
    rows = cur.fetchall()
    
    result = []
    for row in rows:
        schedule_dict = dict(row)
        schedule_dict['completed'] = bool(schedule_dict.get('completed', 0))
        result.append(ScheduleRead(**schedule_dict))
    
    return result


@app.get("/schedules/completed", response_model=List[ScheduleRead])
def list_completed_schedules(
    site_id: Optional[int] = Query(None, description="Filter by site"),
    db: sqlite3.Connection = Depends(get_db)
):
    if site_id:
        cur = db.execute(
            """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id, 
                      COALESCE(ce.name, tt.name) as equipment_name,
                      sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                      COALESCE(sch.completed, 0) as completed, sch.completed_at,
                      c.name as client_name, c.address as client_address,
                      s.name as site_name, s.address as site_address
               FROM schedules sch
               LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
               LEFT JOIN test_types tt ON sch.test_type_id = tt.id
               LEFT JOIN sites s ON sch.site_id = s.id
               LEFT JOIN clients c ON s.client_id = c.id
               WHERE sch.site_id = ? AND COALESCE(sch.completed, 0) = 1 ORDER BY sch.completed_at DESC, sch.anchor_date DESC""",
            (site_id,)
        )
    else:
        cur = db.execute(
            """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                      COALESCE(ce.name, tt.name) as equipment_name,
                      sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                      COALESCE(sch.completed, 0) as completed, sch.completed_at,
                      c.name as client_name, c.address as client_address,
                      s.name as site_name, s.address as site_address
               FROM schedules sch
               LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
               LEFT JOIN test_types tt ON sch.test_type_id = tt.id
               LEFT JOIN sites s ON sch.site_id = s.id
               LEFT JOIN clients c ON s.client_id = c.id
               WHERE COALESCE(sch.completed, 0) = 1 ORDER BY sch.completed_at DESC, sch.anchor_date DESC"""
        )
    rows = cur.fetchall()
    
    result = []
    for row in rows:
        schedule_dict = dict(row)
        schedule_dict['completed'] = bool(schedule_dict.get('completed', 0))
        result.append(ScheduleRead(**schedule_dict))
    
    return result


# Schedule quick view endpoints - must come before /schedules/{schedule_id}
class ScheduleWithDetails(BaseModel):
    id: int
    site_id: int
    equipment_id: Optional[int]
    equipment_name: Optional[str] = "Unknown"
    anchor_date: str
    due_date: Optional[str]
    next_due_date: Optional[str] = None
    site_name: Optional[str] = "Unknown"
    client_name: Optional[str] = "Unknown"
    notes: Optional[str] = None
    equipment_identifier: Optional[str] = None


@app.get("/schedules/overdue", response_model=List[ScheduleWithDetails])
def get_overdue_schedules(db: sqlite3.Connection = Depends(get_db)):
    """Get schedules with due dates that are overdue"""
    today = dt.date.today()
    
    cur = db.execute(
        """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                  COALESCE(ce.name, tt.name) as equipment_name,
                  sch.anchor_date, sch.due_date, sch.equipment_identifier, sch.notes,
                  COALESCE(s.name, 'Unknown') as site_name,
                  COALESCE(c.name, 'Unknown') as client_name
           FROM schedules sch
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE COALESCE(sch.completed, 0) = 0 
             AND sch.due_date IS NOT NULL 
             AND sch.due_date < ?
           ORDER BY sch.due_date""",
        (today.isoformat(),)
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(ScheduleWithDetails(**row_dict))
    return result


@app.get("/schedules/due-this-month", response_model=List[ScheduleWithDetails])
def get_due_this_month_schedules(db: sqlite3.Connection = Depends(get_db)):
    """Get schedules due this month"""
    today = dt.date.today()
    month_start = dt.date(today.year, today.month, 1)
    if today.month == 12:
        month_end = dt.date(today.year + 1, 1, 1)
    else:
        month_end = dt.date(today.year, today.month + 1, 1)
    
    cur = db.execute(
        """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                  COALESCE(ce.name, tt.name) as equipment_name,
                  sch.anchor_date, sch.due_date, sch.equipment_identifier, sch.notes,
                  COALESCE(s.name, 'Unknown') as site_name,
                  COALESCE(c.name, 'Unknown') as client_name
           FROM schedules sch
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE COALESCE(sch.completed, 0) = 0 
             AND sch.due_date IS NOT NULL 
             AND sch.due_date >= ? AND sch.due_date < ?
           ORDER BY sch.due_date""",
        (month_start.isoformat(), month_end.isoformat())
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(ScheduleWithDetails(**row_dict))
    return result


@app.get("/schedules/upcoming", response_model=List[ScheduleWithDetails])
def get_upcoming_schedules(
    weeks: int = Query(5, description="Look ahead weeks"),
    db: sqlite3.Connection = Depends(get_db)
):
    """Get upcoming schedules within the specified weeks"""
    today = dt.date.today()
    end_date = today + dt.timedelta(weeks=weeks)
    
    cur = db.execute(
        """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                  COALESCE(ce.name, tt.name) as equipment_name,
                  sch.anchor_date, sch.due_date, sch.equipment_identifier, sch.notes,
                  COALESCE(s.name, 'Unknown') as site_name,
                  COALESCE(c.name, 'Unknown') as client_name
           FROM schedules sch
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE COALESCE(sch.completed, 0) = 0 
             AND sch.due_date IS NOT NULL 
             AND sch.due_date >= ? AND sch.due_date <= ?
           ORDER BY sch.due_date""",
        (today.isoformat(), end_date.isoformat())
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(ScheduleWithDetails(**row_dict))
    return result


@app.post("/schedules/{schedule_id}/complete", response_model=ScheduleRead)
def complete_schedule(schedule_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Mark a schedule as completed"""
    print(f"[DEBUG] Complete schedule endpoint called with schedule_id: {schedule_id}")
    row = db.execute("SELECT id FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Set completed = 1 and record the timestamp
    completed_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute("UPDATE schedules SET completed = 1, completed_at = ? WHERE id = ?", (completed_at, schedule_id))
    db.commit()
    
    # Return updated schedule
    return get_schedule(schedule_id, db)


@app.post("/schedules/{schedule_id}/undo", response_model=ScheduleRead)
def undo_schedule(schedule_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Set completed = 0 and clear the timestamp
    db.execute("UPDATE schedules SET completed = 0, completed_at = NULL WHERE id = ?", (schedule_id,))
    db.commit()
    
    # Return updated schedule
    return get_schedule(schedule_id, db)


@app.get("/schedules/{schedule_id}", response_model=ScheduleRead)
def get_schedule(schedule_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                  COALESCE(ce.name, tt.name) as equipment_name,
                  sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                  COALESCE(sch.completed, 0) as completed, sch.completed_at,
                  c.name as client_name, c.address as client_address,
                  s.name as site_name, s.address as site_address
           FROM schedules sch
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           WHERE sch.id = ?""",
        (schedule_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule_dict = dict(row)
    schedule_dict['completed'] = bool(schedule_dict.get('completed', 0))
    return ScheduleRead(**schedule_dict)


@app.post("/schedules", response_model=ScheduleRead, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleCreate, db: sqlite3.Connection = Depends(get_db)):
    # Verify site exists and get client_id
    site_row = db.execute("SELECT id, timezone, client_id FROM sites WHERE id = ?", (payload.site_id,)).fetchone()
    if site_row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    # Verify equipment exists and belongs to the same client
    equipment_row = db.execute("SELECT id, client_id, name FROM client_equipments WHERE id = ?", (payload.equipment_id,)).fetchone()
    if equipment_row is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    if equipment_row['client_id'] != site_row['client_id']:
        raise HTTPException(status_code=400, detail="Equipment does not belong to the same client as the site")

    # Get or create test_type for this equipment
    test_type = db.execute("SELECT id FROM test_types WHERE name = ?", (equipment_row['name'],)).fetchone()
    if test_type:
        test_type_id = test_type['id']
    else:
        # Create test_type entry
        cur = db.execute(
            "INSERT INTO test_types (name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?)",
            (equipment_row['name'], 52, "FREQ=WEEKLY;INTERVAL=52", 4)
        )
        db.commit()
        test_type_id = cur.lastrowid

    # Use site timezone if not provided
    timezone = payload.timezone or site_row['timezone']

    try:
        # Check if schedule already exists - UNIQUE constraint is on (site_id, equipment_id, anchor_date)
        existing = db.execute(
            "SELECT id FROM schedules WHERE site_id = ? AND equipment_id = ? AND anchor_date = ?",
            (payload.site_id, payload.equipment_id, payload.anchor_date)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Schedule already exists for this site/equipment/anchor_date")
        
        cur = db.execute(
            "INSERT INTO schedules (site_id, equipment_id, test_type_id, anchor_date, due_date, lead_weeks, timezone, equipment_identifier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (payload.site_id, payload.equipment_id, test_type_id, payload.anchor_date, payload.due_date, payload.lead_weeks, timezone, payload.equipment_identifier, payload.notes),
        )
        db.commit()
    except HTTPException:
        raise
    except sqlite3.IntegrityError as e:
        error_str = str(e)
        if "UNIQUE constraint" in error_str:
            raise HTTPException(status_code=400, detail="Schedule already exists for this site/equipment/anchor_date")
        else:
            raise HTTPException(status_code=400, detail=f"Database error: {error_str}")

    row = db.execute(
        """SELECT sch.id, sch.site_id, sch.equipment_id,
                  COALESCE(ce.name, 'Unknown') as equipment_name,
                  sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                  COALESCE(sch.completed, 0) as completed, sch.completed_at,
                  c.name as client_name, c.address as client_address,
                  s.name as site_name, s.address as site_address
           FROM schedules sch
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           WHERE sch.id = ?""",
        (cur.lastrowid,),
    ).fetchone()
    
    schedule_dict = dict(row)
    schedule_dict['completed'] = bool(schedule_dict.get('completed', 0))
    return ScheduleRead(**schedule_dict)


@app.put("/schedules/{schedule_id}", response_model=ScheduleRead)
def update_schedule(schedule_id: int, payload: ScheduleUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id, site_id FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # If updating equipment_id, verify it belongs to the same client
    if payload.equipment_id is not None:
        site_info = db.execute("SELECT client_id FROM sites WHERE id = ?", (row['site_id'],)).fetchone()
        equipment_info = db.execute("SELECT client_id FROM client_equipments WHERE id = ?", (payload.equipment_id,)).fetchone()
        if equipment_info is None:
            raise HTTPException(status_code=404, detail="Equipment not found")
        if equipment_info['client_id'] != site_info['client_id']:
            raise HTTPException(status_code=400, detail="Equipment does not belong to the same client as the site")

    fields = []
    values = []

    if payload.equipment_id is not None:
        fields.append("equipment_id = ?")
        values.append(payload.equipment_id)
    if payload.anchor_date is not None:
        fields.append("anchor_date = ?")
        values.append(payload.anchor_date)
    if payload.due_date is not None:
        fields.append("due_date = ?")
        values.append(payload.due_date)
    if payload.lead_weeks is not None:
        fields.append("lead_weeks = ?")
        values.append(payload.lead_weeks)
    if payload.timezone is not None:
        fields.append("timezone = ?")
        values.append(payload.timezone)
    if payload.equipment_identifier is not None:
        fields.append("equipment_identifier = ?")
        values.append(payload.equipment_identifier)
    if payload.notes is not None:
        fields.append("notes = ?")
        values.append(payload.notes)

    if fields:
        values.append(schedule_id)
        try:
            db.execute(
                f"UPDATE schedules SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Schedule conflict")

    row = db.execute(
        """SELECT sch.id, sch.site_id, COALESCE(sch.equipment_id, sch.test_type_id) as equipment_id,
                  COALESCE(ce.name, tt.name) as equipment_name,
                  sch.anchor_date, sch.due_date, sch.lead_weeks, sch.timezone, sch.equipment_identifier, sch.notes, sch.last_generated_until,
                  COALESCE(sch.completed, 0) as completed, sch.completed_at,
                  c.name as client_name, c.address as client_address,
                  s.name as site_name, s.address as site_address
           FROM schedules sch
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           WHERE sch.id = ?""",
        (schedule_id,),
    ).fetchone()
    
    schedule_dict = dict(row)
    schedule_dict['completed'] = bool(schedule_dict.get('completed', 0))
    return ScheduleRead(**schedule_dict)


@app.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")

    return


# ========== WORK ORDERS ==========

class WorkOrderCreate(BaseModel):
    schedule_id: int
    due_date: str  # YYYY-MM-DD
    planned_date: Optional[str] = None
    invoice_ref: Optional[str] = None
    notes: Optional[str] = None


class WorkOrderUpdate(BaseModel):
    due_date: Optional[str] = None
    planned_date: Optional[str] = None
    done_date: Optional[str] = None
    status: Optional[str] = None  # 'PLANNED', 'DUE', 'DONE'
    invoice_ref: Optional[str] = None
    notes: Optional[str] = None


class WorkOrderRead(BaseModel):
    id: int
    schedule_id: int
    due_date: str
    planned_date: Optional[str]
    done_date: Optional[str]
    status: str
    invoice_ref: Optional[str]
    notes: Optional[str]


@app.get("/work-orders", response_model=List[WorkOrderRead])
def list_work_orders(
    schedule_id: Optional[int] = Query(None, description="Filter by schedule"),
    status: Optional[str] = Query(None, description="Filter by status"),
    db: sqlite3.Connection = Depends(get_db)
):
    query = "SELECT id, schedule_id, due_date, planned_date, done_date, status, invoice_ref, notes FROM work_orders WHERE 1=1"
    params = []
    
    if schedule_id:
        query += " AND schedule_id = ?"
        params.append(schedule_id)
    if status:
        query += " AND status = ?"
        params.append(status)
    
    query += " ORDER BY due_date"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [WorkOrderRead(**dict(row)) for row in rows]


# Quick view endpoints must come before parameterized routes
class WorkOrderWithDetails(WorkOrderRead):
    site_name: Optional[str] = "Unknown"
    client_name: Optional[str] = "Unknown"
    equipment_name: Optional[str] = "Unknown"


@app.get("/work-orders/due-this-month", response_model=List[WorkOrderWithDetails])
def get_due_this_month(db: sqlite3.Connection = Depends(get_db)):
    """Get work orders due this month"""
    today = dt.date.today()
    month_start = dt.date(today.year, today.month, 1)
    if today.month == 12:
        month_end = dt.date(today.year + 1, 1, 1)
    else:
        month_end = dt.date(today.year, today.month + 1, 1)
    
    cur = db.execute(
        """SELECT wo.id, wo.schedule_id, wo.due_date, wo.planned_date, wo.done_date, wo.status, wo.invoice_ref, wo.notes,
                  COALESCE(s.name, 'Unknown') as site_name, 
                  COALESCE(c.name, 'Unknown') as client_name, 
                  COALESCE(ce.name, tt.name, 'Unknown') as equipment_name
           FROM work_orders wo
           LEFT JOIN schedules sch ON wo.schedule_id = sch.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE wo.due_date >= ? AND wo.due_date < ? AND wo.status != 'DONE'
           ORDER BY wo.due_date""",
        (month_start.isoformat(), month_end.isoformat())
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        # Ensure all string fields have valid values
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(WorkOrderWithDetails(**row_dict))
    return result


@app.get("/work-orders/overdue", response_model=List[WorkOrderWithDetails])
def get_overdue(db: sqlite3.Connection = Depends(get_db)):
    """Get overdue work orders"""
    today = dt.date.today()
    
    cur = db.execute(
        """SELECT wo.id, wo.schedule_id, wo.due_date, wo.planned_date, wo.done_date, wo.status, wo.invoice_ref, wo.notes,
                  COALESCE(s.name, 'Unknown') as site_name, 
                  COALESCE(c.name, 'Unknown') as client_name, 
                  COALESCE(ce.name, tt.name, 'Unknown') as equipment_name
           FROM work_orders wo
           LEFT JOIN schedules sch ON wo.schedule_id = sch.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE wo.due_date < ? AND wo.status != 'DONE'
           ORDER BY wo.due_date""",
        (today.isoformat(),)
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        # Ensure all string fields have valid values
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(WorkOrderWithDetails(**row_dict))
    return result


@app.get("/work-orders/upcoming", response_model=List[WorkOrderWithDetails])
def get_upcoming(
    weeks: int = Query(5, description="Look ahead weeks"),
    db: sqlite3.Connection = Depends(get_db)
):
    """Get upcoming work orders within lead time"""
    today = dt.date.today()
    end_date = today + dt.timedelta(weeks=weeks)
    
    cur = db.execute(
        """SELECT wo.id, wo.schedule_id, wo.due_date, wo.planned_date, wo.done_date, wo.status, wo.invoice_ref, wo.notes,
                  COALESCE(s.name, 'Unknown') as site_name, 
                  COALESCE(c.name, 'Unknown') as client_name, 
                  COALESCE(ce.name, tt.name, 'Unknown') as equipment_name
           FROM work_orders wo
           LEFT JOIN schedules sch ON wo.schedule_id = sch.id
           LEFT JOIN sites s ON sch.site_id = s.id
           LEFT JOIN clients c ON s.client_id = c.id
           LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
           LEFT JOIN test_types tt ON sch.test_type_id = tt.id
           WHERE wo.due_date >= ? AND wo.due_date <= ? AND wo.status != 'DONE'
           ORDER BY wo.due_date""",
        (today.isoformat(), end_date.isoformat())
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        row_dict = dict(row)
        # Ensure all string fields have valid values
        row_dict['site_name'] = row_dict.get('site_name') or 'Unknown'
        row_dict['client_name'] = row_dict.get('client_name') or 'Unknown'
        row_dict['equipment_name'] = row_dict.get('equipment_name') or 'Unknown'
        result.append(WorkOrderWithDetails(**row_dict))
    return result


@app.get("/work-orders/{work_order_id}", response_model=WorkOrderRead)
def get_work_order(work_order_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, schedule_id, due_date, planned_date, done_date, status, invoice_ref, notes FROM work_orders WHERE id = ?",
        (work_order_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Work order not found")

    return WorkOrderRead(**dict(row))


@app.post("/work-orders", response_model=WorkOrderRead, status_code=status.HTTP_201_CREATED)
def create_work_order(payload: WorkOrderCreate, db: sqlite3.Connection = Depends(get_db)):
    # Verify schedule exists
    schedule_row = db.execute("SELECT id FROM schedules WHERE id = ?", (payload.schedule_id,)).fetchone()
    if schedule_row is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Determine status based on due_date
    due_date = parse_date(payload.due_date).date()
    today = dt.date.today()
    if due_date < today:
        work_status = 'DUE'
    elif due_date == today:
        work_status = 'DUE'
    else:
        work_status = 'PLANNED'

    try:
        cur = db.execute(
            "INSERT INTO work_orders (schedule_id, due_date, planned_date, status, invoice_ref, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (payload.schedule_id, payload.due_date, payload.planned_date, work_status, payload.invoice_ref, payload.notes),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Work order already exists for this schedule/due_date")

    row = db.execute(
        "SELECT id, schedule_id, due_date, planned_date, done_date, status, invoice_ref, notes FROM work_orders WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return WorkOrderRead(**dict(row))


@app.post("/work-orders/from-schedule/{schedule_id}", response_model=WorkOrderRead, status_code=status.HTTP_201_CREATED)
def create_work_order_from_schedule(schedule_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Create a work order from the next due date of a schedule"""
    schedule = db.execute(
        "SELECT id, site_id, COALESCE(equipment_id, test_type_id) as equipment_id, anchor_date, last_generated_until FROM schedules WHERE id = ?",
        (schedule_id,),
    ).fetchone()
    
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Get equipment rrule (try client_equipments first, fallback to test_types for migration)
    equipment = db.execute("SELECT rrule FROM client_equipments WHERE id = ?", (schedule['equipment_id'],)).fetchone()
    if not equipment:
        # Fallback to test_types for backward compatibility
        equipment = db.execute("SELECT rrule FROM test_types WHERE id = ?", (schedule['equipment_id'],)).fetchone()
    
    if equipment is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    # Compute next due date
    anchor = parse_date(schedule['anchor_date']).date()
    last_gen = parse_date(schedule['last_generated_until']).date() if schedule['last_generated_until'] else None
    next_due = compute_next_due_date(anchor, equipment['rrule'], last_gen)
    
    # Check if work order already exists
    existing = db.execute(
        "SELECT id FROM work_orders WHERE schedule_id = ? AND due_date = ?",
        (schedule_id, next_due.isoformat())
    ).fetchone()
    
    if existing:
        raise HTTPException(status_code=400, detail="Work order already exists for this due date")
    
    # Create work order
    today = dt.date.today()
    work_status = 'DUE' if next_due <= today else 'PLANNED'
    
    cur = db.execute(
        "INSERT INTO work_orders (schedule_id, due_date, status) VALUES (?, ?, ?)",
        (schedule_id, next_due.isoformat(), work_status),
    )
    
    # Update schedule's last_generated_until
    db.execute(
        "UPDATE schedules SET last_generated_until = ? WHERE id = ?",
        (next_due.isoformat(), schedule_id)
    )
    
    db.commit()
    
    row = db.execute(
        "SELECT id, schedule_id, due_date, planned_date, done_date, status, invoice_ref, notes FROM work_orders WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return WorkOrderRead(**dict(row))


@app.put("/work-orders/{work_order_id}", response_model=WorkOrderRead)
def update_work_order(work_order_id: int, payload: WorkOrderUpdate, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM work_orders WHERE id = ?", (work_order_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Work order not found")

    fields = []
    values = []

    if payload.due_date is not None:
        fields.append("due_date = ?")
        values.append(payload.due_date)
    if payload.planned_date is not None:
        fields.append("planned_date = ?")
        values.append(payload.planned_date)
    if payload.done_date is not None:
        fields.append("done_date = ?")
        values.append(payload.done_date)
        # Auto-set status to DONE if done_date is provided
        if payload.status is None:
            fields.append("status = ?")
            values.append('DONE')
    if payload.status is not None:
        if payload.status not in ['PLANNED', 'DUE', 'DONE']:
            raise HTTPException(status_code=400, detail="Status must be PLANNED, DUE, or DONE")
        # Only update status if done_date wasn't set
        if payload.done_date is None:
            fields.append("status = ?")
            values.append(payload.status)
    if payload.invoice_ref is not None:
        fields.append("invoice_ref = ?")
        values.append(payload.invoice_ref)
    if payload.notes is not None:
        fields.append("notes = ?")
        values.append(payload.notes)

    if fields:
        values.append(work_order_id)
        try:
            db.execute(
                f"UPDATE work_orders SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Work order conflict")

    row = db.execute(
        "SELECT id, schedule_id, due_date, planned_date, done_date, status, invoice_ref, notes FROM work_orders WHERE id = ?",
        (work_order_id,),
    ).fetchone()
    return WorkOrderRead(**dict(row))


@app.delete("/work-orders/{work_order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_order(work_order_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM work_orders WHERE id = ?", (work_order_id,))
    db.commit()

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Work order not found")

    return


# ========== NOTES ==========

class NoteCreate(BaseModel):
    scope: str  # 'CLIENT', 'SITE', 'WORK_ORDER'
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
    if payload.scope not in ['CLIENT', 'SITE', 'WORK_ORDER']:
        raise HTTPException(status_code=400, detail="Scope must be CLIENT, SITE, or WORK_ORDER")
    
    # Verify scope entity exists
    if payload.scope == 'CLIENT':
        scope_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.scope_id,)).fetchone()
    elif payload.scope == 'SITE':
        scope_row = db.execute("SELECT id FROM sites WHERE id = ?", (payload.scope_id,)).fetchone()
    else:
        scope_row = db.execute("SELECT id FROM work_orders WHERE id = ?", (payload.scope_id,)).fetchone()
    
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
    scope: str  # 'CLIENT', 'SITE', 'WORK_ORDER'
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
    if payload.scope not in ['CLIENT', 'SITE', 'WORK_ORDER']:
        raise HTTPException(status_code=400, detail="Scope must be CLIENT, SITE, or WORK_ORDER")
    
    # Verify scope entity exists
    if payload.scope == 'CLIENT':
        scope_row = db.execute("SELECT id FROM clients WHERE id = ?", (payload.scope_id,)).fetchone()
    elif payload.scope == 'SITE':
        scope_row = db.execute("SELECT id FROM sites WHERE id = ?", (payload.scope_id,)).fetchone()
    else:
        scope_row = db.execute("SELECT id FROM work_orders WHERE id = ?", (payload.scope_id,)).fetchone()
    
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


@app.get("/contacts/rollup/work-order/{work_order_id}", response_model=List[ContactRollup])
def get_work_order_contacts(work_order_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Get all contacts for a work order (site-level and parent client-level)"""
    # Get work order's site_id
    wo = db.execute(
        """SELECT s.id as site_id, s.client_id 
           FROM work_orders wo
           JOIN schedules sch ON wo.schedule_id = sch.id
           JOIN sites s ON sch.site_id = s.id
           WHERE wo.id = ?""",
        (work_order_id,)
    ).fetchone()
    
    if wo is None:
        raise HTTPException(status_code=404, detail="Work order not found")
    
    site_id = wo['site_id']
    client_id = wo['client_id']
    
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


# ========== REPORTS ==========

class ClientReport(BaseModel):
    client_id: int
    client_name: str
    total_sites: int
    total_schedules: int
    total_work_orders: int
    overdue_count: int
    due_this_month_count: int


class EquipmentReport(BaseModel):
    equipment_id: int
    equipment_name: str
    total_schedules: int
    total_work_orders: int
    overdue_count: int
    due_this_month_count: int


@app.get("/reports/by-client", response_model=List[ClientReport])
def report_by_client(db: sqlite3.Connection = Depends(get_db)):
    """Report grouped by client"""
    today = dt.date.today()
    month_start = dt.date(today.year, today.month, 1)
    if today.month == 12:
        month_end = dt.date(today.year + 1, 1, 1)
    else:
        month_end = dt.date(today.year, today.month + 1, 1)
    
    cur = db.execute(
        """SELECT 
               c.id as client_id,
               c.name as client_name,
               COUNT(DISTINCT s.id) as total_sites,
               COUNT(DISTINCT sch.id) as total_schedules,
               COUNT(DISTINCT wo.id) as total_work_orders,
               SUM(CASE WHEN wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as overdue_count,
               SUM(CASE WHEN wo.due_date >= ? AND wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as due_this_month_count
           FROM clients c
           LEFT JOIN sites s ON c.id = s.client_id
           LEFT JOIN schedules sch ON s.id = sch.site_id
           LEFT JOIN work_orders wo ON sch.id = wo.schedule_id
           GROUP BY c.id, c.name
           ORDER BY c.name""",
        (today.isoformat(), month_start.isoformat(), month_end.isoformat())
    )
    rows = cur.fetchall()
    return [ClientReport(**dict(row)) for row in rows]


@app.get("/reports/by-equipment", response_model=List[EquipmentReport])
def report_by_equipment(db: sqlite3.Connection = Depends(get_db)):
    """Report grouped by equipment"""
    today = dt.date.today()
    month_start = dt.date(today.year, today.month, 1)
    if today.month == 12:
        month_end = dt.date(today.year + 1, 1, 1)
    else:
        month_end = dt.date(today.year, today.month + 1, 1)
    
    cur = db.execute(
        """SELECT 
               COALESCE(ce.id, tt.id) as equipment_id,
               COALESCE(ce.name, tt.name) as equipment_name,
               COUNT(DISTINCT sch.id) as total_schedules,
               COUNT(DISTINCT wo.id) as total_work_orders,
               SUM(CASE WHEN wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as overdue_count,
               SUM(CASE WHEN wo.due_date >= ? AND wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as due_this_month_count
           FROM client_equipments ce
           LEFT JOIN schedules sch ON ce.id = sch.equipment_id
           LEFT JOIN work_orders wo ON sch.id = wo.schedule_id
           GROUP BY ce.id, ce.name
           UNION ALL
           SELECT 
               tt.id as equipment_id,
               tt.name as equipment_name,
               COUNT(DISTINCT sch.id) as total_schedules,
               COUNT(DISTINCT wo.id) as total_work_orders,
               SUM(CASE WHEN wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as overdue_count,
               SUM(CASE WHEN wo.due_date >= ? AND wo.due_date < ? AND wo.status != 'DONE' THEN 1 ELSE 0 END) as due_this_month_count
           FROM test_types tt
           LEFT JOIN schedules sch ON tt.id = sch.test_type_id AND sch.equipment_id IS NULL
           LEFT JOIN work_orders wo ON sch.id = wo.schedule_id
           WHERE sch.id IS NOT NULL
           GROUP BY tt.id, tt.name
           ORDER BY equipment_name""",
        (today.isoformat(), month_start.isoformat(), month_end.isoformat(), today.isoformat(), month_start.isoformat(), month_end.isoformat())
    )
    rows = cur.fetchall()
    return [EquipmentReport(**dict(row)) for row in rows]


# ========== ICS EXPORT ==========

@app.get("/work-orders/export/ics")
def export_work_orders_ics(
    work_order_ids: Optional[str] = Query(None, description="Comma-separated work order IDs"),
    schedule_id: Optional[int] = Query(None, description="Export all work orders for a schedule"),
    client_id: Optional[int] = Query(None, description="Export all work orders for a client"),
    db: sqlite3.Connection = Depends(get_db)
):
    """Export work orders to ICS calendar format"""
    query = """SELECT wo.id, wo.due_date, wo.planned_date, wo.status, wo.notes,
                      c.name as client_name, s.name as site_name, 
                      COALESCE(ce.name, tt.name, 'Unknown') as equipment_name,
                      s.address as site_address
               FROM work_orders wo
               JOIN schedules sch ON wo.schedule_id = sch.id
               JOIN sites s ON sch.site_id = s.id
               JOIN clients c ON s.client_id = c.id
               LEFT JOIN client_equipments ce ON sch.equipment_id = ce.id
               LEFT JOIN test_types tt ON sch.test_type_id = tt.id
               WHERE 1=1"""
    params = []
    
    if work_order_ids:
        ids = [int(x.strip()) for x in work_order_ids.split(',')]
        query += " AND wo.id IN (" + ','.join(['?'] * len(ids)) + ")"
        params.extend(ids)
    elif schedule_id:
        query += " AND wo.schedule_id = ?"
        params.append(schedule_id)
    elif client_id:
        query += " AND s.client_id = ?"
        params.append(client_id)
    
    query += " ORDER BY wo.due_date"
    cur = db.execute(query, params)
    rows = cur.fetchall()
    
    cal = Calendar()
    cal.add('prodid', '-//Service Schedule Manager//EN')
    cal.add('version', '2.0')
    
    for row in rows:
        event = Event()
        event.add('summary', f"{row['equipment_name']} @ {row['site_name']}")
        event.add('description', f"Client: {row['client_name']}\\nSite: {row['site_name']}\\nEquipment: {row['equipment_name']}")
        if row['site_address']:
            event.add('location', row['site_address'])
        
        # Use planned_date if available, otherwise due_date
        event_date = parse_date(row['planned_date'] if row['planned_date'] else row['due_date']).date()
        event.add('dtstart', dt.datetime.combine(event_date, dt.time(9, 0)))  # Default to 9 AM
        event.add('dtend', dt.datetime.combine(event_date, dt.time(17, 0)))   # Default to 5 PM
        
        if row['notes']:
            event.add('description', f"{event.get('description')}\\n\\nNotes: {row['notes']}")
        
        event.add('status', 'CONFIRMED' if row['status'] == 'DONE' else 'TENTATIVE')
        cal.add_component(event)
    
    return Response(
        content=cal.to_ical(),
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=work-orders.ics"}
    )


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
            elif equipment_col is None and any(x in col_lower for x in ['equipment', 'test', 'test_type', 'type', 'modality']):
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
            # Prioritize 'identifier' or 'equipment_identifier' - these are the most specific
            elif identifier_col is None and ('identifier' in col_lower or 'equipment_identifier' in col_lower):
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
        print(f"  - Identifier: {identifier_col}")
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
            "schedules_created": 0,
            "errors": []
        }
        
        # Process each row
        client_map = {}  # name -> id
        site_map = {}    # (client_id, site_name) -> id
        equipment_map = {}  # (client_id, equipment_name) -> id
        
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
                            
                            # Seed default equipments for new client
                            for name, interval, rrule_str, lead_weeks in DEFAULT_EQUIPMENTS:
                                try:
                                    db.execute(
                                        "INSERT INTO client_equipments (client_id, name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?, ?)",
                                        (client_id, name, interval, rrule_str, lead_weeks)
                                    )
                                except sqlite3.IntegrityError:
                                    pass  # Already exists
                            db.commit()
                        
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
                
                equipment_name = str(row[equipment_col]).strip().upper()
                if not equipment_name or equipment_name in ['NAN', 'NONE', '']:
                    continue
                
                equipment_key = (client_id, equipment_name)
                if equipment_key not in equipment_map:
                    existing = db.execute(
                        "SELECT id FROM client_equipments WHERE client_id = ? AND UPPER(name) = ?",
                        (client_id, equipment_name)
                    ).fetchone()
                    if existing:
                        equipment_id = existing['id']
                        db.execute("UPDATE client_equipments SET name = ? WHERE id = ?", (equipment_name, equipment_id))
                        db.commit()
                    else:
                        cur = db.execute(
                            "INSERT INTO client_equipments (client_id, name, interval_weeks, rrule, default_lead_weeks, is_custom) VALUES (?, ?, ?, ?, ?, ?)",
                            (client_id, equipment_name, 52, "FREQ=WEEKLY;INTERVAL=52", 4, 1)
                        )
                        db.commit()
                        equipment_id = cur.lastrowid
                        stats["equipments_created"] += 1
                    equipment_map[equipment_key] = equipment_id
                equipment_id = equipment_map[equipment_key]
                
                # Get or create test_type for this equipment (test_type_id FK requires it)
                test_type = db.execute("SELECT id FROM test_types WHERE name = ?", (equipment_name,)).fetchone()
                if test_type:
                    test_type_id = test_type['id']
                else:
                    # Create test_type entry
                    cur = db.execute(
                        "INSERT INTO test_types (name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?)",
                        (equipment_name, 52, "FREQ=WEEKLY;INTERVAL=52", 4)
                    )
                    db.commit()
                    test_type_id = cur.lastrowid
                
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
                
                # Get equipment identifier - make sure we're reading from the correct column
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
                
                # Get default lead_weeks from equipment if not provided
                if lead_weeks is None:
                    eq_row = db.execute("SELECT default_lead_weeks FROM client_equipments WHERE id = ?", (equipment_id,)).fetchone()
                    lead_weeks = eq_row['default_lead_weeks'] if eq_row and eq_row['default_lead_weeks'] else 4
                
                try:
                    db.execute(
                        "INSERT INTO schedules (site_id, equipment_id, test_type_id, anchor_date, due_date, lead_weeks, timezone, equipment_identifier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (site_id, equipment_id, test_type_id, anchor_date, due_date, lead_weeks, timezone, equipment_identifier, notes)
                    )
                    db.commit()
                    stats["schedules_created"] += 1
                except sqlite3.IntegrityError as e:
                    error_str = str(e)
                    if "UNIQUE constraint" not in error_str:
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