import datetime as dt
from typing import Optional, List
from dateutil import rrule
from dateutil.parser import parse as parse_date
from icalendar import Calendar, Event
from fastapi.responses import Response

import sqlite3  # kept for type hints and backward compatibility
import psycopg2
import pandas as pd
import io
import hashlib
import secrets
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, HTTPException, status, Query, UploadFile, File, Header, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from sql_postgres import connect_db, init_schema

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

security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)

# Token storage moved to database for multi-instance support on Azure

def hash_password(password: str) -> str:
    """Simple password hashing using SHA256 + salt (for production, use bcrypt)"""
    salt = secrets.token_hex(16)
    return f"{salt}:{hashlib.sha256((salt + password).encode()).hexdigest()}"

def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash"""
    try:
        salt, stored_hash = password_hash.split(":", 1)
        computed_hash = hashlib.sha256((salt + password).encode()).hexdigest()
        return computed_hash == stored_hash
    except:
        return False

def parse_db_datetime(value):
    """Parse datetime from database - handles both PostgreSQL datetime objects and SQLite strings"""
    if isinstance(value, datetime):
        return value  # PostgreSQL returns datetime objects directly
    elif isinstance(value, str):
        return datetime.fromisoformat(value)  # SQLite returns strings
    else:
        raise ValueError(f"Unexpected datetime type: {type(value)}")

def row_to_dict(row):
    """Convert database row to dict, converting datetime/date objects to ISO format strings for Pydantic"""
    import datetime as dt_module
    row_dict = dict(row)
    # Convert datetime and date objects to ISO format strings (PostgreSQL returns these as objects)
    for key, value in row_dict.items():
        if isinstance(value, datetime):
            row_dict[key] = value.isoformat()
        elif isinstance(value, dt_module.date):
            row_dict[key] = value.isoformat()
    return row_dict

def create_token(user_id: int, username: str, is_admin: bool, is_super_admin: bool, business_id: Optional[int], db: sqlite3.Connection) -> str:
    """Create a session token and store in database"""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now() + timedelta(days=7)  # 7 day expiry
    
    # Store token in database
    db.execute(
        "INSERT INTO auth_tokens (token, user_id, username, is_admin, is_super_admin, business_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (token, user_id, username, 1 if is_admin else 0, 1 if is_super_admin else 0, business_id, expires_at.isoformat())
    )
    db.commit()
    
    return token

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: sqlite3.Connection = Depends(get_db)):
    """Get current authenticated user from token stored in database"""
    token = credentials.credentials
    
    # Get token from database (optimized: filter expired tokens in WHERE clause to use index)
    # Use CURRENT_TIMESTAMP for PostgreSQL compatibility
    row = db.execute(
        "SELECT user_id, username, is_admin, is_super_admin, business_id, expires_at FROM auth_tokens WHERE token = ? AND expires_at > CURRENT_TIMESTAMP",
        (token,)
    ).fetchone()
    
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Token is already validated as not expired by the query
    expires_at = parse_db_datetime(row["expires_at"])
    
    row_dict = dict(row)
    return {
        "user_id": row_dict["user_id"],
        "username": row_dict["username"],
        "is_admin": bool(row_dict.get("is_admin", 0)),
        "is_super_admin": bool(row_dict.get("is_super_admin", 0)),
        "business_id": row_dict.get("business_id"),
        "expires_at": expires_at
    }

def get_current_user_optional(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional), db: sqlite3.Connection = Depends(get_db)):
    """Get current authenticated user from token (optional - returns None if not authenticated)"""
    if credentials is None:
        return None
    
    token = credentials.credentials
    
    # Get token from database (optimized: check expiration in WHERE clause)
    row = db.execute(
        "SELECT user_id, username, is_admin, is_super_admin, business_id, expires_at FROM auth_tokens WHERE token = ? AND expires_at > CURRENT_TIMESTAMP",
        (token,)
    ).fetchone()
    
    if not row:
        return None
    
    # Token is already validated as not expired by the query
    expires_at = parse_db_datetime(row["expires_at"])
    
    row_dict = dict(row)
    return {
        "user_id": row_dict["user_id"],
        "username": row_dict["username"],
        "is_admin": bool(row_dict.get("is_admin", 0)),
        "is_super_admin": bool(row_dict.get("is_super_admin", 0)),
        "business_id": row_dict.get("business_id"),
        "expires_at": expires_at
    }

def get_current_admin_user(current_user: dict = Depends(get_current_user)):
    """Ensure current user is admin"""
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

def get_current_super_admin_user(current_user: dict = Depends(get_current_user)):
    """Ensure current user is super admin"""
    if not current_user or not current_user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user

def get_business_id(current_user: dict) -> Optional[int]:
    """Get business_id from current user context. Super admins can have None (they select business)"""
    if current_user.get("is_super_admin"):
        # Super admin can access any business, but must have business_id in token for filtering
        return current_user.get("business_id")
    # Regular users must have a business_id
    business_id = current_user.get("business_id")
    if not business_id:
        raise HTTPException(status_code=403, detail="No business context available")
    return business_id


@app.on_event("startup")
def on_startup():
    # Use your existing schema exactly as written
    conn = connect_db()
    try:
        init_schema(conn)
        # Create default super admin user if no users exist
        user_count = conn.execute("SELECT COUNT(*) as count FROM users").fetchone()['count']
        if user_count == 0:
            # Create super admin user without business_id (superadmin exists without business)
            super_admin_password_hash = hash_password("superadmin")
            conn.execute(
                "INSERT INTO users (username, password_hash, is_admin, is_super_admin, business_id) VALUES (?, ?, ?, ?, ?)",
                ("superadmin", super_admin_password_hash, 1, 1, None)
            )
            conn.commit()
            print("Created default super admin user: username='superadmin', password='superadmin'")
            print("Note: Superadmin exists without a business. Create a business and admin user when needed.")
    finally:
        conn.close()


@app.get("/")
def root():
    return {"message": "Service Schedule Manager API", "docs": "/docs", "status": "running"}


# Authentication Models
class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    user: dict

class UserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False
    business_id: Optional[int] = None  # For super admin to specify business

class UserRead(BaseModel):
    id: int
    username: str
    is_admin: bool
    is_super_admin: Optional[bool] = False
    created_at: str
    business_id: Optional[int] = None
    business_name: Optional[str] = None

# Authentication Endpoints
@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: sqlite3.Connection = Depends(get_db)):
    """Login and get authentication token"""
    user = db.execute(
        "SELECT id, username, password_hash, is_admin, is_super_admin, business_id FROM users WHERE username = ?",
        (payload.username,)
    ).fetchone()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # For super admin, business_id can be None initially (they'll select it)
    # For regular users, use their assigned business_id
    business_id = None if user["is_super_admin"] else user["business_id"]
    
    token = create_token(
        user["id"], 
        user["username"], 
        bool(user["is_admin"]), 
        bool(user["is_super_admin"]),
        business_id,
        db
    )
    
    return LoginResponse(
        token=token,
        user={
            "id": user["id"],
            "username": user["username"],
            "is_admin": bool(user["is_admin"]),
            "is_super_admin": bool(user["is_super_admin"]),
            "business_id": business_id
        }
    )

@app.post("/auth/logout")
def logout(current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    """Logout and invalidate token"""
    # Delete all tokens for this user
    db.execute("DELETE FROM auth_tokens WHERE user_id = ?", (current_user["user_id"],))
    db.commit()
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current authenticated user info"""
    return {
        "id": current_user["user_id"],
        "username": current_user["username"],
        "is_admin": current_user["is_admin"],
        "is_super_admin": current_user.get("is_super_admin", False),
        "business_id": current_user.get("business_id")
    }

class SwitchBusinessRequest(BaseModel):
    business_id: Optional[int] = None

@app.post("/auth/switch-business")
def switch_business(payload: SwitchBusinessRequest, credentials: HTTPAuthorizationCredentials = Depends(security), current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    """Switch business context for super admin (updates token). Set business_id to None to view all businesses."""
    if not current_user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    
    # If business_id is provided, verify it exists
    if payload.business_id is not None:
        business = db.execute("SELECT id FROM businesses WHERE id = ?", (payload.business_id,)).fetchone()
        if not business:
            raise HTTPException(status_code=404, detail="Business not found")
    
    # Update the current token with new business_id (can be None for "all businesses")
    token = credentials.credentials
    db.execute(
        "UPDATE auth_tokens SET business_id = ? WHERE token = ?",
        (payload.business_id, token)
    )
    db.commit()
    
    return {"message": "Business context switched", "business_id": payload.business_id}

# Business Management Endpoints (Super Admin only)
class BusinessCreate(BaseModel):
    name: str
    create_admin_user: Optional[bool] = False
    admin_username: Optional[str] = None
    admin_password: Optional[str] = None

class BusinessRead(BaseModel):
    id: int
    name: str
    created_at: str

@app.get("/businesses", response_model=List[BusinessRead])
def list_businesses(current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """List all businesses (super admin only)"""
    rows = db.execute(
        "SELECT id, name, created_at FROM businesses ORDER BY created_at DESC"
    ).fetchall()
    return [BusinessRead(**row_to_dict(row)) for row in rows]

@app.post("/businesses", response_model=BusinessRead, status_code=status.HTTP_201_CREATED)
def create_business(payload: BusinessCreate, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Create a new business (super admin only). Optionally create an admin user for the business."""
    try:
        cur = db.execute(
            "INSERT INTO businesses (name) VALUES (?)",
            (payload.name,)
        )
        business_id = cur.lastrowid
        db.commit()
        
        # Optionally create admin user for the business
        if payload.create_admin_user and payload.admin_username and payload.admin_password:
            if not payload.admin_username.strip() or not payload.admin_password.strip():
                raise HTTPException(status_code=400, detail="Admin username and password are required when creating admin user")
            
            password_hash = hash_password(payload.admin_password)
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, is_admin, business_id) VALUES (?, ?, ?, ?)",
                    (payload.admin_username.strip(), password_hash, 1, business_id)
                )
                db.commit()
            except (sqlite3.IntegrityError, psycopg2.IntegrityError):
                # Rollback business creation if user creation fails
                db.execute("DELETE FROM businesses WHERE id = ?", (business_id,))
                db.commit()
                raise HTTPException(status_code=400, detail="Username already exists")
        
        row = db.execute("SELECT id, name, created_at FROM businesses WHERE id = ?", (business_id,)).fetchone()
        return BusinessRead(**row_to_dict(row))
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Business name already exists")

@app.put("/businesses/{business_id}", response_model=BusinessRead)
def update_business(business_id: int, payload: BusinessCreate, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Update a business (super admin only)"""
    business = db.execute("SELECT id FROM businesses WHERE id = ?", (business_id,)).fetchone()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    try:
        db.execute(
            "UPDATE businesses SET name = ? WHERE id = ?",
            (payload.name, business_id)
        )
        db.commit()
        row = db.execute("SELECT id, name, created_at FROM businesses WHERE id = ?", (business_id,)).fetchone()
        return BusinessRead(**row_to_dict(row))
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Business name already exists")

# Deleted Records View for Super Admin
class DeletedRecordRead(BaseModel):
    id: int
    name: str
    deleted_at: str
    deleted_by: str
    type: str  # "client", "site", "equipment_record", "equipment_type"
    business_id: Optional[int] = None
    additional_info: Optional[dict] = None

@app.get("/deleted-records", response_model=List[DeletedRecordRead])
def list_deleted_records(
    record_type: Optional[str] = Query(None, description="Filter by type: client, site, equipment_record, equipment_type"),
    business_id: Optional[int] = Query(None, description="Filter by business"),
    current_user: dict = Depends(get_current_super_admin_user),
    db: sqlite3.Connection = Depends(get_db)
):
    """List all deleted records (super admin only)"""
    deleted_records = []
    
    # Get deleted clients
    if not record_type or record_type == "client":
        clients_query = "SELECT id, name, deleted_at, deleted_by, business_id FROM clients WHERE deleted_at IS NOT NULL"
        params = []
        if business_id:
            clients_query += " AND business_id = ?"
            params.append(business_id)
        rows = db.execute(clients_query, params).fetchall()
        for row in rows:
            deleted_at = row["deleted_at"]
            if isinstance(deleted_at, datetime):
                deleted_at = deleted_at.isoformat()
            deleted_records.append({
                "id": row["id"],
                "name": row["name"],
                "deleted_at": deleted_at,
                "deleted_by": row["deleted_by"],
                "type": "client",
                "business_id": row["business_id"],
                "additional_info": None
            })
    
    # Get deleted sites
    if not record_type or record_type == "site":
        sites_query = """SELECT s.id, s.name, s.deleted_at, s.deleted_by, c.business_id, c.name as client_name
                         FROM sites s
                         JOIN clients c ON s.client_id = c.id
                         WHERE s.deleted_at IS NOT NULL"""
        params = []
        if business_id:
            sites_query += " AND c.business_id = ?"
            params.append(business_id)
        rows = db.execute(sites_query, params).fetchall()
        for row in rows:
            deleted_at = row["deleted_at"]
            if isinstance(deleted_at, datetime):
                deleted_at = deleted_at.isoformat()
            deleted_records.append({
                "id": row["id"],
                "name": row["name"],
                "deleted_at": deleted_at,
                "deleted_by": row["deleted_by"],
                "type": "site",
                "business_id": row["business_id"],
                "additional_info": {"client_name": row["client_name"]}
            })
    
    # Get deleted equipment_records
    if not record_type or record_type == "equipment_record":
        equipment_query = """SELECT er.id, er.equipment_name as name, er.deleted_at, er.deleted_by, c.business_id,
                                   c.name as client_name, s.name as site_name
                            FROM equipment_record er
                            JOIN clients c ON er.client_id = c.id
                            LEFT JOIN sites s ON er.site_id = s.id
                            WHERE er.deleted_at IS NOT NULL"""
        params = []
        if business_id:
            equipment_query += " AND c.business_id = ?"
            params.append(business_id)
        rows = db.execute(equipment_query, params).fetchall()
        for row in rows:
            deleted_at = row["deleted_at"]
            if isinstance(deleted_at, datetime):
                deleted_at = deleted_at.isoformat()
            deleted_records.append({
                "id": row["id"],
                "name": row["name"],
                "deleted_at": deleted_at,
                "deleted_by": row["deleted_by"],
                "type": "equipment_record",
                "business_id": row["business_id"],
                "additional_info": {
                    "client_name": row["client_name"],
                    "site_name": row["site_name"]
                }
            })
    
    # Get deleted equipment_types
    if not record_type or record_type == "equipment_type":
        types_query = "SELECT id, name, deleted_at, deleted_by, business_id FROM equipment_types WHERE deleted_at IS NOT NULL"
        params = []
        if business_id:
            types_query += " AND business_id = ?"
            params.append(business_id)
        rows = db.execute(types_query, params).fetchall()
        for row in rows:
            deleted_at = row["deleted_at"]
            if isinstance(deleted_at, datetime):
                deleted_at = deleted_at.isoformat()
            deleted_records.append({
                "id": row["id"],
                "name": row["name"],
                "deleted_at": deleted_at,
                "deleted_by": row["deleted_by"],
                "type": "equipment_type",
                "business_id": row["business_id"],
                "additional_info": None
            })
    
    # Sort by deleted_at descending (most recently deleted first)
    deleted_records.sort(key=lambda x: x["deleted_at"], reverse=True)
    
    return [DeletedRecordRead(**record) for record in deleted_records]

@app.get("/businesses/{business_id}/deletion-summary")
def get_business_deletion_summary(business_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Get a summary of all data that will be deleted with this business (super admin only)"""
    business = db.execute("SELECT id, name FROM businesses WHERE id = ?", (business_id,)).fetchone()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    # Get all client IDs for this business
    client_ids = [row['id'] for row in db.execute("SELECT id FROM clients WHERE business_id = ?", (business_id,)).fetchall()]
    
    # Get all site IDs for clients in this business
    site_ids = []
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        site_ids = [row['id'] for row in db.execute(f"SELECT id FROM sites WHERE client_id IN ({placeholders})", client_ids).fetchall()]
    
    # Count direct relationships
    clients_count = len(client_ids)
    equipment_types_count = db.execute("SELECT COUNT(*) as count FROM equipment_types WHERE business_id = ?", (business_id,)).fetchone()['count']
    users_count = db.execute("SELECT COUNT(*) as count FROM users WHERE business_id = ?", (business_id,)).fetchone()['count']
    
    # Count cascading relationships
    sites_count = len(site_ids)
    equipment_records_count = 0
    equipment_completions_count = 0
    client_equipments_count = 0
    
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        equipment_records_count = db.execute(f"SELECT COUNT(*) as count FROM equipment_record WHERE client_id IN ({placeholders})", client_ids).fetchone()['count']
        client_equipments_count = db.execute(f"SELECT COUNT(*) as count FROM client_equipments WHERE client_id IN ({placeholders})", client_ids).fetchone()['count']
    
    # Count equipment completions (through equipment_record)
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        equipment_record_ids = [row['id'] for row in db.execute(f"SELECT id FROM equipment_record WHERE client_id IN ({placeholders})", client_ids).fetchall()]
        if equipment_record_ids:
            ec_placeholders = ','.join('?' * len(equipment_record_ids))
            equipment_completions_count = db.execute(f"SELECT COUNT(*) as count FROM equipment_completions WHERE equipment_record_id IN ({ec_placeholders})", equipment_record_ids).fetchone()['count']
    
    # Count indirect relationships (contact_links, notes, attachments)
    contact_links_count = 0
    notes_count = 0
    attachments_count = 0
    
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        # Contact links for clients
        contact_links_count += db.execute(f"SELECT COUNT(*) as count FROM contact_links WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids).fetchone()['count']
        # Notes for clients
        notes_count += db.execute(f"SELECT COUNT(*) as count FROM notes WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids).fetchone()['count']
        # Attachments for clients
        attachments_count += db.execute(f"SELECT COUNT(*) as count FROM attachments WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids).fetchone()['count']
    
    if site_ids:
        placeholders = ','.join('?' * len(site_ids))
        # Contact links for sites
        contact_links_count += db.execute(f"SELECT COUNT(*) as count FROM contact_links WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids).fetchone()['count']
        # Notes for sites
        notes_count += db.execute(f"SELECT COUNT(*) as count FROM notes WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids).fetchone()['count']
        # Attachments for sites
        attachments_count += db.execute(f"SELECT COUNT(*) as count FROM attachments WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids).fetchone()['count']
    
    # Count contacts that will be orphaned (contacts linked only to this business's clients/sites)
    # This is complex, so we'll just count total contact_links
    # Contacts themselves won't be deleted, but their links will be
    
    return {
        "business_name": business['name'],
        "counts": {
            "customers": clients_count,
            "sites": sites_count,
            "contacts": contact_links_count,  # Number of contact links (not unique contacts)
            "equipment": equipment_records_count,
            "equipment_types": equipment_types_count,
            "equipment_completions": equipment_completions_count,
            "client_equipments": client_equipments_count,
            "notes": notes_count,
            "attachments": attachments_count,
            "users": users_count
        }
    }

@app.delete("/businesses/{business_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_business(business_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Delete a business and all associated data (super admin only)"""
    business = db.execute("SELECT id FROM businesses WHERE id = ?", (business_id,)).fetchone()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    # Get all client IDs for this business
    client_ids = [row['id'] for row in db.execute("SELECT id FROM clients WHERE business_id = ?", (business_id,)).fetchall()]
    
    # Get all site IDs for clients in this business
    site_ids = []
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        site_ids = [row['id'] for row in db.execute(f"SELECT id FROM sites WHERE client_id IN ({placeholders})", client_ids).fetchall()]
    
    # Delete indirect relationships that don't have foreign keys (contact_links, notes, attachments)
    if client_ids:
        placeholders = ','.join('?' * len(client_ids))
        # Delete contact links for clients
        db.execute(f"DELETE FROM contact_links WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids)
        # Delete notes for clients
        db.execute(f"DELETE FROM notes WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids)
        # Delete attachments for clients
        db.execute(f"DELETE FROM attachments WHERE scope = 'CLIENT' AND scope_id IN ({placeholders})", client_ids)
    
    if site_ids:
        placeholders = ','.join('?' * len(site_ids))
        # Delete contact links for sites
        db.execute(f"DELETE FROM contact_links WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids)
        # Delete notes for sites
        db.execute(f"DELETE FROM notes WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids)
        # Delete attachments for sites
        db.execute(f"DELETE FROM attachments WHERE scope = 'SITE' AND scope_id IN ({placeholders})", site_ids)
    
    # Delete the business (CASCADE will handle: clients, equipment_types, and set users.business_id to NULL)
    db.execute("DELETE FROM businesses WHERE id = ?", (business_id,))
    db.commit()
    return None

# User Management Endpoints (Admin only)
@app.get("/users", response_model=List[UserRead])
def list_users(current_user: dict = Depends(get_current_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """List all users (admin only). Super admin can see all users, regular admin only sees users from their business."""
    is_super_admin = current_user.get("is_super_admin")
    
    if is_super_admin:
        # Super admin can see all users
        rows = db.execute(
            """SELECT u.id, u.username, u.is_admin, u.is_super_admin, u.created_at, 
                      u.business_id, b.name as business_name
               FROM users u
               LEFT JOIN businesses b ON u.business_id = b.id
               ORDER BY u.created_at DESC"""
        ).fetchall()
    else:
        # Regular admin can only see users from their business
        business_id = get_business_id(current_user)
        rows = db.execute(
            """SELECT u.id, u.username, u.is_admin, u.is_super_admin, u.created_at, 
                      u.business_id, b.name as business_name
               FROM users u
               LEFT JOIN businesses b ON u.business_id = b.id
               WHERE u.business_id = ?
               ORDER BY u.created_at DESC""",
            (business_id,)
        ).fetchall()
    
    return [UserRead(**row_to_dict(row)) for row in rows]

@app.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, current_user: dict = Depends(get_current_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Create a new user (admin only). Super admin can create users for any business, regular admin creates for their business."""
    password_hash = hash_password(payload.password)
    
    # Determine business_id: super admin can specify, regular admin uses their business
    business_id = None
    if current_user.get("is_super_admin"):
        # Super admin can create users without business_id (for super admin users) or with a specific business_id
        business_id = payload.business_id if hasattr(payload, 'business_id') and payload.business_id else None
    else:
        business_id = get_business_id(current_user)
    
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash, is_admin, business_id) VALUES (?, ?, ?, ?)",
            (payload.username, password_hash, 1 if payload.is_admin else 0, business_id)
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    row = db.execute(
        "SELECT id, username, is_admin, created_at FROM users WHERE id = ?",
        (cur.lastrowid,)
    ).fetchone()
    return UserRead(**row_to_dict(row))

@app.delete("/users/{user_id}")
def delete_user(user_id: int, current_user: dict = Depends(get_current_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Delete a user (admin only). Super admin can delete any user, regular admin can only delete users from their business."""
    # Prevent deleting yourself
    if user_id == current_user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    # Get user details
    user = db.execute("SELECT id, is_super_admin, business_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent deleting super admin users
    if user.get("is_super_admin") == 1 or user.get("is_super_admin") is True:
        raise HTTPException(status_code=400, detail="Cannot delete super admin users")
    
    # Check business authorization: regular admins can only delete users from their business
    is_super_admin = current_user.get("is_super_admin")
    if not is_super_admin:
        admin_business_id = get_business_id(current_user)
        user_business_id = user.get("business_id")
        
        # Verify user belongs to the same business as the admin
        if user_business_id != admin_business_id:
            raise HTTPException(
                status_code=403, 
                detail="You can only delete users from your own business"
            )
    
    result = db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    
    return {"message": "User deleted successfully"}

# Change password endpoint
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@app.put("/auth/change-password")
def change_password(payload: ChangePasswordRequest, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    """Change current user's password"""
    user = db.execute(
        "SELECT id, password_hash FROM users WHERE id = ?",
        (current_user["user_id"],)
    ).fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify current password
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    
    # Update password
    new_password_hash = hash_password(payload.new_password)
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (new_password_hash, current_user["user_id"])
    )
    db.commit()
    
    # Invalidate all tokens for this user (force re-login)
    db.execute("DELETE FROM auth_tokens WHERE user_id = ?", (current_user["user_id"],))
    db.commit()
    
    return {"message": "Password changed successfully. Please login again."}

# Super admin password change endpoint
class AdminChangePasswordRequest(BaseModel):
    user_id: int
    new_password: str

@app.put("/admin/change-password")
def admin_change_password(payload: AdminChangePasswordRequest, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Change password for any user (super admin only)"""
    if not payload.new_password or len(payload.new_password) < 1:
        raise HTTPException(status_code=400, detail="Password cannot be empty")
    
    # Check if user exists
    user = db.execute(
        "SELECT id FROM users WHERE id = ?",
        (payload.user_id,)
    ).fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update password
    new_password_hash = hash_password(payload.new_password)
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (new_password_hash, payload.user_id)
    )
    db.commit()
    
    # Invalidate all tokens for this user (force re-login)
    db.execute("DELETE FROM auth_tokens WHERE user_id = ?", (payload.user_id,))
    db.commit()
    
    return {"message": "Password changed successfully"}

class ChangeUsernameRequest(BaseModel):
    new_username: str
    password: str  # Require password confirmation for security

@app.put("/auth/change-username")
def change_username(payload: ChangeUsernameRequest, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    """Change current user's username"""
    if not payload.new_username or not payload.new_username.strip():
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    new_username = payload.new_username.strip()
    
    # Check if new username is the same as current
    if new_username.lower() == current_user["username"].lower():
        raise HTTPException(status_code=400, detail="New username must be different from current username")
    
    user = db.execute(
        "SELECT id, password_hash FROM users WHERE id = ?",
        (current_user["user_id"],)
    ).fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify password for security
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    
    # Check if username already exists
    existing_user = db.execute(
        "SELECT id FROM users WHERE username = ? AND id != ?",
        (new_username, current_user["user_id"])
    ).fetchone()
    
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Update username
    try:
        db.execute(
            "UPDATE users SET username = ? WHERE id = ?",
            (new_username, current_user["user_id"])
        )
        # Update username in all tokens for this user
        db.execute(
            "UPDATE auth_tokens SET username = ? WHERE user_id = ?",
            (new_username, current_user["user_id"])
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    return {"message": "Username changed successfully", "new_username": new_username}

# Emergency admin password reset endpoint (for development/testing only)
# WARNING: Remove or secure this endpoint in production!
class ResetPasswordRequest(BaseModel):
    username: str
    new_password: str

@app.post("/auth/reset-password")
def reset_password(payload: ResetPasswordRequest, db: sqlite3.Connection = Depends(get_db)):
    """Reset password for a user (development only - remove in production!)"""
    user = db.execute(
        "SELECT id, username FROM users WHERE username = ?",
        (payload.username,)
    ).fetchone()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update password
    new_password_hash = hash_password(payload.new_password)
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (new_password_hash, user["id"])
    )
    db.commit()
    
    # Invalidate all tokens for this user
    db.execute("DELETE FROM auth_tokens WHERE user_id = ?", (user["id"],))
    db.commit()
    
    return {"message": f"Password reset successfully for user: {payload.username}"}


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
    business_id: Optional[int] = None  # Include business_id for super admin context


@app.get("/clients", response_model=List[ClientRead])
def list_clients(
    include_deleted: bool = Query(False, description="Include deleted records (super admin only)"),
    business_id_filter: Optional[int] = Query(None, description="Filter by business ID (super admin only)"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    # Super admin can filter by any business, regular users are limited to their own
    if current_user.get("is_super_admin") and business_id_filter is not None:
        # Query parameter filter takes precedence
        business_id = business_id_filter
    elif current_user.get("is_super_admin"):
        # Super admin: use business_id from token if set, otherwise show all (None)
        business_id = current_user.get("business_id")
    else:
        # Regular user: must have business_id
        business_id = get_business_id(current_user)
    
    # Super admin can request deleted records, regular users cannot
    if include_deleted and not current_user.get("is_super_admin"):
        include_deleted = False
    
    # Build query based on whether we're filtering by business_id
    if business_id is None:
        # Super admin viewing all clients
        if include_deleted:
            cur = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id, deleted_at, deleted_by FROM clients ORDER BY name"
            )
        else:
            cur = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id FROM clients WHERE deleted_at IS NULL ORDER BY name"
            )
        rows = cur.fetchall()
    else:
        # Filter by business_id
        if include_deleted:
            cur = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id, deleted_at, deleted_by FROM clients WHERE business_id = ? ORDER BY name",
                (business_id,)
            )
        else:
            cur = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id FROM clients WHERE business_id = ? AND deleted_at IS NULL ORDER BY name",
                (business_id,)
            )
        rows = cur.fetchall()
    return [ClientRead(**row_to_dict(row)) for row in rows]

@app.get("/clients/{client_id}", response_model=ClientRead)
def get_client(client_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Super admin can view deleted records, regular users cannot
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any client
            row = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id FROM clients WHERE id = ?",
                (client_id,),
            ).fetchone()
        else:
            # Super admin viewing specific business
            row = db.execute(
                "SELECT id, name, address, billing_info, notes, business_id FROM clients WHERE id = ? AND business_id = ?",
                (client_id, business_id),
            ).fetchone()
    else:
        # Regular user - must filter by business_id and exclude deleted
        row = db.execute(
            "SELECT id, name, address, billing_info, notes, business_id FROM clients WHERE id = ? AND business_id = ? AND deleted_at IS NULL",
            (client_id, business_id),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Client not found")

    return ClientRead(**row_to_dict(row))

#Creating Client
@app.post("/clients", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(payload: ClientCreate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    # For super admins, get business_id from token (can be None if viewing all businesses)
    # For regular users, get_business_id will raise an error if None
    if current_user.get("is_super_admin"):
        business_id = current_user.get("business_id")
        if business_id is None:
            raise HTTPException(status_code=400, detail="No business context available. Please select a business first.")
    else:
        business_id = get_business_id(current_user)
    try:
        cur = db.execute(
            "INSERT INTO clients (business_id, name, address, billing_info, notes) VALUES (?, ?, ?, ?, ?)",
            (business_id, payload.name, payload.address, payload.billing_info, payload.notes),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Client name must be unique within business")

    row = db.execute(
        "SELECT id, name, address, billing_info, notes FROM clients WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return ClientRead(**row_to_dict(row))

#Update Client
@app.put("/clients/{client_id}", response_model=ClientRead)
def update_client(client_id: int, payload: ClientUpdate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Only allow updating non-deleted records (or deleted records if super admin wants to restore)
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any client
            row = db.execute("SELECT id FROM clients WHERE id = ?", (client_id,)).fetchone()
        else:
            # Super admin viewing specific business
            row = db.execute("SELECT id FROM clients WHERE id = ? AND business_id = ?", (client_id, business_id)).fetchone()
    else:
        row = db.execute("SELECT id FROM clients WHERE id = ? AND business_id = ? AND deleted_at IS NULL", (client_id, business_id)).fetchone()
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
        except (sqlite3.IntegrityError, psycopg2.IntegrityError):
            raise HTTPException(status_code=400, detail="Client name must be unique")

    # return fresh row
    row = db.execute(
        "SELECT id, name, address, billing_info, notes FROM clients WHERE id = ?",
        (client_id,),
    ).fetchone()
    return ClientRead(**row_to_dict(row))

#Delete Client
@app.delete("/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Verify client exists and belongs to business
    if is_super_admin and business_id is None:
        # Super admin viewing all businesses - allow access to any client
        client = db.execute("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL", (client_id,)).fetchone()
    else:
        client = db.execute("SELECT id FROM clients WHERE id = ? AND business_id = ? AND deleted_at IS NULL", (client_id, business_id)).fetchone()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Soft delete: mark as deleted
    username = current_user.get("username", "unknown")
    deleted_at = datetime.now().isoformat()
    db.execute(
        "UPDATE clients SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        (deleted_at, username, client_id)
    )
    db.commit()

# Restore endpoints for super admin
@app.post("/clients/{client_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_client(client_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Restore a deleted client (super admin only)"""
    client = db.execute("SELECT id, deleted_at FROM clients WHERE id = ?", (client_id,)).fetchone()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Client is not deleted")
    
    db.execute("UPDATE clients SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (client_id,))
    db.commit()
    return

    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Client not found")

    return


# ========== SITES ==========

class SiteCreate(BaseModel):
    client_id: int
    name: str
    street: Optional[str] = None
    state: Optional[str] = None
    site_registration_license: Optional[str] = None
    timezone: str = "America/Chicago"
    notes: Optional[str] = None


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    street: Optional[str] = None
    state: Optional[str] = None
    site_registration_license: Optional[str] = None
    timezone: Optional[str] = None
    notes: Optional[str] = None


class SiteRead(BaseModel):
    id: int
    client_id: int
    name: str
    street: Optional[str] = None
    state: Optional[str] = None
    site_registration_license: Optional[str] = None
    timezone: str
    notes: Optional[str] = None


@app.get("/sites", response_model=List[SiteRead])
def list_sites(
    client_id: Optional[int] = Query(None, description="Filter by client"),
    include_deleted: bool = Query(False, description="Include deleted records (super admin only)"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Super admin can request deleted records, regular users cannot
    if include_deleted and not is_super_admin:
        include_deleted = False
    
    deleted_filter = "" if include_deleted else "AND s.deleted_at IS NULL"
    
    if client_id:
        # Verify client belongs to business (or exists if viewing all businesses)
        if business_id is not None:
            client = db.execute("SELECT id FROM clients WHERE id = ? AND business_id = ? AND deleted_at IS NULL", (client_id, business_id)).fetchone()
        else:
            client = db.execute("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL", (client_id,)).fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        if include_deleted:
            cur = db.execute(
                f"SELECT id, client_id, name, street, state, site_registration_license, timezone, notes, deleted_at, deleted_by FROM sites WHERE client_id = ? {deleted_filter} ORDER BY name",
                (client_id,)
            )
        else:
            cur = db.execute(
                "SELECT id, client_id, name, street, state, site_registration_license, timezone, notes FROM sites WHERE client_id = ? AND deleted_at IS NULL ORDER BY name",
                (client_id,)
            )
    else:
        # Get all sites for clients in this business (or all businesses if business_id is None)
        if business_id is not None:
            cur = db.execute(
                f"""SELECT s.id, s.client_id, s.name, s.street, s.state, s.site_registration_license, s.timezone, s.notes 
                   FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE c.business_id = ? {deleted_filter}
                   ORDER BY s.name""",
                (business_id,)
            )
        else:
            # Super admin viewing all businesses
            cur = db.execute(
                f"""SELECT s.id, s.client_id, s.name, s.street, s.state, s.site_registration_license, s.timezone, s.notes 
                   FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE 1=1 {deleted_filter}
                   ORDER BY s.name"""
            )
    rows = cur.fetchall()
    return [SiteRead(**row_to_dict(row)) for row in rows]


@app.get("/sites/{site_id}", response_model=SiteRead)
def get_site(site_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Super admin can view deleted records, regular users cannot
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any site
            row = db.execute(
                """SELECT s.id, s.client_id, s.name, s.street, s.state, s.site_registration_license, s.timezone, s.notes 
                   FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE s.id = ?""",
                (site_id,),
            ).fetchone()
        else:
            # Super admin viewing specific business
            row = db.execute(
                """SELECT s.id, s.client_id, s.name, s.street, s.state, s.site_registration_license, s.timezone, s.notes 
                   FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE s.id = ? AND c.business_id = ?""",
                (site_id, business_id),
            ).fetchone()
    else:
        row = db.execute(
            """SELECT s.id, s.client_id, s.name, s.street, s.state, s.site_registration_license, s.timezone, s.notes 
               FROM sites s 
               JOIN clients c ON s.client_id = c.id 
               WHERE s.id = ? AND c.business_id = ? AND s.deleted_at IS NULL""",
            (site_id, business_id),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    return SiteRead(**row_to_dict(row))


@app.post("/sites", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(payload: SiteCreate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    business_id = get_business_id(current_user)
    if business_id is None:
        raise HTTPException(status_code=400, detail="No business context available. Please select a business first.")
    # Verify client exists and belongs to business and is not deleted
    client_row = db.execute("SELECT id FROM clients WHERE id = ? AND business_id = ? AND deleted_at IS NULL", (payload.client_id, business_id)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")

    try:
        cur = db.execute(
            "INSERT INTO sites (client_id, name, street, state, site_registration_license, timezone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (payload.client_id, payload.name, payload.street, payload.state, payload.site_registration_license, payload.timezone, payload.notes),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Site name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, street, state, site_registration_license, timezone, notes FROM sites WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return SiteRead(**row_to_dict(row))


@app.put("/sites/{site_id}", response_model=SiteRead)
def update_site(site_id: int, payload: SiteUpdate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Verify site exists and belongs to business (and is not deleted)
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow updating any site (including deleted for restore)
            row = db.execute(
                """SELECT s.id FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE s.id = ?""",
                (site_id,)
            ).fetchone()
        else:
            # Super admin viewing specific business - exclude deleted records
            row = db.execute(
                """SELECT s.id FROM sites s 
                   JOIN clients c ON s.client_id = c.id 
                   WHERE s.id = ? AND c.business_id = ? AND s.deleted_at IS NULL""",
                (site_id, business_id)
            ).fetchone()
    else:
        # Regular user - must filter by business_id and exclude deleted
        row = db.execute(
            """SELECT s.id FROM sites s 
               JOIN clients c ON s.client_id = c.id 
               WHERE s.id = ? AND c.business_id = ? AND s.deleted_at IS NULL""",
            (site_id, business_id)
        ).fetchone()
    
    if row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    fields = []
    values = []

    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name)
    if payload.street is not None:
        fields.append("street = ?")
        values.append(payload.street)
    if payload.state is not None:
        fields.append("state = ?")
        values.append(payload.state)
    if payload.site_registration_license is not None:
        fields.append("site_registration_license = ?")
        values.append(payload.site_registration_license)
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
        except (sqlite3.IntegrityError, psycopg2.IntegrityError):
            raise HTTPException(status_code=400, detail="Site name must be unique per client")

    row = db.execute(
        "SELECT id, client_id, name, street, state, site_registration_license, timezone, notes FROM sites WHERE id = ?",
        (site_id,),
    ).fetchone()
    return SiteRead(**row_to_dict(row))


@app.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(site_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    business_id = get_business_id(current_user)
    # Verify site belongs to business through client and is not deleted
    site = db.execute(
        """SELECT s.id FROM sites s 
           JOIN clients c ON s.client_id = c.id 
           WHERE s.id = ? AND c.business_id = ? AND s.deleted_at IS NULL""",
        (site_id, business_id)
    ).fetchone()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    # Soft delete: mark as deleted
    username = current_user.get("username", "unknown")
    deleted_at = datetime.now().isoformat()
    db.execute(
        "UPDATE sites SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        (deleted_at, username, site_id)
    )
    db.commit()
    return

@app.post("/sites/{site_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_site(site_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Restore a deleted site (super admin only)"""
    site = db.execute("SELECT id, deleted_at FROM sites WHERE id = ?", (site_id,)).fetchone()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not site.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Site is not deleted")
    
    db.execute("UPDATE sites SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (site_id,))
    db.commit()
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
    return [ContactRead(**row_to_dict(row)) for row in rows]


@app.get("/contacts/{contact_id}", response_model=ContactRead)
def get_contact(contact_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, first_name, last_name, email, phone FROM contacts WHERE id = ?",
        (contact_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    return ContactRead(**row_to_dict(row))


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
    return ContactRead(**row_to_dict(row))


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
    return ContactRead(**row_to_dict(row))


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
    return [ContactLinkRead(**row_to_dict(row)) for row in rows]


@app.get("/contact-links/{link_id}", response_model=ContactLinkRead)
def get_contact_link(link_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE id = ?",
        (link_id,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Contact link not found")

    return ContactLinkRead(**row_to_dict(row))


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
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Contact link already exists for this scope/role")

    row = db.execute(
        "SELECT id, contact_id, scope, scope_id, role, is_primary FROM contact_links WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return ContactLinkRead(**row_to_dict(row))


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
    return ContactLinkRead(**row_to_dict(row))


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
    business_id: Optional[int] = None  # For superadmin to specify business (optional)


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
    business_id: Optional[int] = None
    business_name: Optional[str] = None


class EquipmentTypeGroupedRead(BaseModel):
    """Grouped equipment type for superadmin view - shows name once with all businesses it belongs to"""
    name: str
    interval_weeks: int
    rrule: str
    default_lead_weeks: int
    active: bool
    businesses: List[dict]  # List of {id: int, name: str} for each business, or [{id: None, name: "All Businesses"}] if in all
    equipment_type_ids: List[int]  # List of all equipment type IDs with this name


@app.get("/equipment-types")
def list_equipment_types(
    active_only: bool = Query(False, description="Filter to active only"),
    grouped: bool = Query(False, description="Group by name for superadmin (shows businesses per name)"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    is_super_admin = current_user.get("is_super_admin")
    business_id = current_user.get("business_id") if is_super_admin else get_business_id(current_user)
    
    # If grouped=True and superadmin viewing all businesses, return grouped view
    if grouped and is_super_admin and business_id is None:
        return list_equipment_types_grouped(active_only, current_user, db)
    
    # Build query based on whether we're filtering by business_id
    if business_id is None:
        # Super admin viewing all businesses - show all equipment types with business info
        if active_only:
            cur = db.execute(
                """SELECT et.id, et.name, et.interval_weeks, et.rrule, et.default_lead_weeks, et.active, 
                          et.business_id, 
                          CASE WHEN et.business_id IS NULL THEN 'All Businesses' ELSE b.name END as business_name
                   FROM equipment_types et
                   LEFT JOIN businesses b ON et.business_id = b.id
                   WHERE et.active = 1 AND et.deleted_at IS NULL
                   ORDER BY CASE WHEN et.business_id IS NULL THEN 0 ELSE 1 END, b.name, et.name"""
            )
        else:
            cur = db.execute(
                """SELECT et.id, et.name, et.interval_weeks, et.rrule, et.default_lead_weeks, et.active,
                          et.business_id,
                          CASE WHEN et.business_id IS NULL THEN 'All Businesses' ELSE b.name END as business_name
                   FROM equipment_types et
                   LEFT JOIN businesses b ON et.business_id = b.id
                   WHERE et.deleted_at IS NULL
                   ORDER BY CASE WHEN et.business_id IS NULL THEN 0 ELSE 1 END, b.name, et.name"""
            )
    else:
        # Filter by business_id - include equipment types for this business AND types for all businesses (business_id IS NULL)
        # If both a business-specific and "all businesses" version exist, prefer the "all businesses" version
        # Use a subquery to get unique names, prioritizing "all businesses" versions
        if active_only:
            cur = db.execute(
                """SELECT et_all.id, et_all.name, et_all.interval_weeks, et_all.rrule, et_all.default_lead_weeks, et_all.active, 
                          et_all.business_id, NULL as business_name
                   FROM equipment_types et_all
                   WHERE et_all.business_id IS NULL 
                   AND et_all.active = 1 
                   AND et_all.deleted_at IS NULL
                   UNION
                   SELECT et_biz.id, et_biz.name, et_biz.interval_weeks, et_biz.rrule, et_biz.default_lead_weeks, et_biz.active,
                          et_biz.business_id, NULL as business_name
                   FROM equipment_types et_biz
                   WHERE et_biz.business_id = ?
                   AND et_biz.active = 1
                   AND et_biz.deleted_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM equipment_types et_check 
                     WHERE et_check.name = et_biz.name 
                     AND et_check.business_id IS NULL 
                     AND et_check.active = 1 
                     AND et_check.deleted_at IS NULL
                   )
                   ORDER BY name""",
                (business_id,)
            )
        else:
            cur = db.execute(
                """SELECT et_all.id, et_all.name, et_all.interval_weeks, et_all.rrule, et_all.default_lead_weeks, et_all.active, 
                          et_all.business_id, NULL as business_name
                   FROM equipment_types et_all
                   WHERE et_all.business_id IS NULL 
                   AND et_all.deleted_at IS NULL
                   UNION
                   SELECT et_biz.id, et_biz.name, et_biz.interval_weeks, et_biz.rrule, et_biz.default_lead_weeks, et_biz.active,
                          et_biz.business_id, NULL as business_name
                   FROM equipment_types et_biz
                   WHERE et_biz.business_id = ?
                   AND et_biz.deleted_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM equipment_types et_check 
                     WHERE et_check.name = et_biz.name 
                     AND et_check.business_id IS NULL 
                     AND et_check.deleted_at IS NULL
                   )
                   ORDER BY name""",
                (business_id,)
            )
    rows = cur.fetchall()
    return [EquipmentTypeRead(**row_to_dict(row)) for row in rows]


def list_equipment_types_grouped(
    active_only: bool,
    current_user: dict,
    db: sqlite3.Connection
) -> List[EquipmentTypeGroupedRead]:
    """Group equipment types by name and show which businesses each belongs to"""
    from collections import defaultdict
    
    # Get all equipment types
    if active_only:
        cur = db.execute(
            """SELECT et.id, et.name, et.interval_weeks, et.rrule, et.default_lead_weeks, et.active, 
                      et.business_id, 
                      CASE WHEN et.business_id IS NULL THEN 'All Businesses' ELSE b.name END as business_name
               FROM equipment_types et
               LEFT JOIN businesses b ON et.business_id = b.id
               WHERE et.active = 1 AND et.deleted_at IS NULL
               ORDER BY et.name"""
        )
    else:
        cur = db.execute(
            """SELECT et.id, et.name, et.interval_weeks, et.rrule, et.default_lead_weeks, et.active,
                      et.business_id,
                      CASE WHEN et.business_id IS NULL THEN 'All Businesses' ELSE b.name END as business_name
               FROM equipment_types et
               LEFT JOIN businesses b ON et.business_id = b.id
               WHERE et.deleted_at IS NULL
               ORDER BY et.name"""
        )
    
    rows = cur.fetchall()
    
    # Group by name
    grouped = defaultdict(lambda: {
        'name': None,
        'interval_weeks': None,
        'rrule': None,
        'default_lead_weeks': None,
        'active': None,
        'businesses': [],
        'equipment_type_ids': []
    })
    
    # Get all businesses count to check if "all businesses" means all
    all_businesses_count = db.execute("SELECT COUNT(*) as count FROM businesses").fetchone()['count']
    
    for row in rows:
        row_dict = row_to_dict(row)
        name = row_dict['name']
        
        if grouped[name]['name'] is None:
            grouped[name]['name'] = name
            grouped[name]['interval_weeks'] = row_dict['interval_weeks']
            grouped[name]['rrule'] = row_dict['rrule']
            grouped[name]['default_lead_weeks'] = row_dict['default_lead_weeks']
            grouped[name]['active'] = row_dict['active']
        
        # Add business info
        if row_dict['business_id'] is None:
            # Check if "All Businesses" is already in the list
            if not any(b['id'] is None for b in grouped[name]['businesses']):
                grouped[name]['businesses'].append({'id': None, 'name': 'All Businesses'})
        else:
            # Add specific business if not already added
            if not any(b['id'] == row_dict['business_id'] for b in grouped[name]['businesses']):
                grouped[name]['businesses'].append({
                    'id': row_dict['business_id'],
                    'name': row_dict['business_name']
                })
        
        # Add equipment type ID
        if row_dict['id'] not in grouped[name]['equipment_type_ids']:
            grouped[name]['equipment_type_ids'].append(row_dict['id'])
    
    # Convert to list and check if "All Businesses" means all businesses
    result = []
    for name, data in grouped.items():
        # Check if this equipment type is in all businesses
        # If it has "All Businesses" OR it's in every business individually
        has_all_businesses = any(b['id'] is None for b in data['businesses'])
        if not has_all_businesses:
            # Check if it's in all businesses individually
            specific_businesses_count = len([b for b in data['businesses'] if b['id'] is not None])
            if specific_businesses_count == all_businesses_count:
                # Replace with "All Businesses"
                data['businesses'] = [{'id': None, 'name': 'All Businesses'}]
        
        result.append(EquipmentTypeGroupedRead(**data))
    
    # Sort by name
    result.sort(key=lambda x: x.name)
    return result


@app.get("/equipment-types/{equipment_type_id}", response_model=EquipmentTypeRead)
def get_equipment_type(equipment_type_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    business_id = get_business_id(current_user)
    # Super admin can view deleted records, regular users cannot
    if current_user.get("is_super_admin"):
        row = db.execute(
            "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ? AND business_id = ?",
            (equipment_type_id, business_id),
        ).fetchone()
    else:
        row = db.execute(
            "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ? AND business_id = ? AND deleted_at IS NULL",
            (equipment_type_id, business_id),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment type not found")

    return EquipmentTypeRead(**row_to_dict(row))


@app.post("/equipment-types", response_model=EquipmentTypeRead, status_code=status.HTTP_201_CREATED)
def create_equipment_type(payload: EquipmentTypeCreate, current_user: dict = Depends(get_current_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Create a new equipment type (admin/superadmin only). Admin can only create for their business, superadmin can create for any business."""
    is_super_admin = current_user.get("is_super_admin")
    
    # Determine business_id
    if is_super_admin:
        # Superadmin can specify business_id (for specific business) or None (for all businesses)
        if payload.business_id is not None:
            # Verify business exists
            business_row = db.execute("SELECT id FROM businesses WHERE id = ?", (payload.business_id,)).fetchone()
            if business_row is None:
                raise HTTPException(status_code=404, detail="Business not found")
            business_id = payload.business_id
        else:
            # business_id is None means "all businesses" - this is allowed for superadmin
            business_id = None
    else:
        # Regular admin can only create for their own business
        business_id = get_business_id(current_user)
        if business_id is None:
            raise HTTPException(status_code=400, detail="No business context available")
    
    try:
        cur = db.execute(
            "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?, ?)",
            (business_id, payload.name, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
        # Check if it's a unique constraint violation
        # If business_id is NULL, name must be unique globally
        # If business_id is set, name must be unique within that business
        error_msg = str(e)
        if "UNIQUE" in error_msg.upper() or "unique" in error_msg:
            # Check for existing record with same name
            if business_id is None:
                # For "all businesses", check if name exists globally (with NULL business_id)
                existing = db.execute(
                    "SELECT id FROM equipment_types WHERE name = ? AND business_id IS NULL",
                    (payload.name,)
                ).fetchone()
                if existing:
                    raise HTTPException(status_code=400, detail="Equipment type name must be unique for all businesses")
            else:
                # For specific business, check if name exists for this business OR for all businesses
                existing = db.execute(
                    "SELECT id FROM equipment_types WHERE name = ? AND (business_id = ? OR business_id IS NULL)",
                    (payload.name, business_id)
                ).fetchone()
                if existing:
                    raise HTTPException(status_code=400, detail="Equipment type name must be unique within business")
        # If it's a different constraint error, provide a generic message
        raise HTTPException(status_code=400, detail=f"Database error: {error_msg}")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return EquipmentTypeRead(**row_to_dict(row))


@app.put("/equipment-types/{equipment_type_id}", response_model=EquipmentTypeRead)
def update_equipment_type(equipment_type_id: int, payload: EquipmentTypeUpdate, current_user: dict = Depends(get_current_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Update equipment type (admin/superadmin only)"""
    is_super_admin = current_user.get("is_super_admin")
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    # Only allow updating non-deleted records (or deleted records if super admin wants to restore)
    if is_super_admin:
        if business_id is None:
            # Superadmin viewing all businesses - allow updating any equipment type
            row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
        else:
            # Superadmin viewing specific business
            row = db.execute("SELECT id FROM equipment_types WHERE id = ? AND business_id = ?", (equipment_type_id, business_id)).fetchone()
    else:
        row = db.execute("SELECT id FROM equipment_types WHERE id = ? AND business_id = ? AND deleted_at IS NULL", (equipment_type_id, business_id)).fetchone()
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
        except (sqlite3.IntegrityError, psycopg2.IntegrityError):
            raise HTTPException(status_code=400, detail="Equipment type name must be unique")

    row = db.execute(
        "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
        (equipment_type_id,),
    ).fetchone()
    return EquipmentTypeRead(**row_to_dict(row))


@app.delete("/equipment-types/{equipment_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_type(
    equipment_type_id: int, 
    business_id: Optional[int] = Query(None, description="Specific business to delete from (superadmin only). If None, deletes the specific equipment type."),
    delete_from_all: bool = Query(False, description="Delete from all businesses with this name (superadmin only)"),
    current_user: dict = Depends(get_current_admin_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    """Delete equipment type (admin/superadmin only)
    
    For superadmin:
    - If business_id is provided: delete only from that business
    - If delete_from_all=True: delete all equipment types with the same name from all businesses
    - Otherwise: delete the specific equipment type by ID
    
    For regular admin: delete only from their business
    """
    is_super_admin = current_user.get("is_super_admin")
    username = current_user.get("username", "unknown")
    deleted_at = datetime.now().isoformat()
    
    if is_super_admin:
        if delete_from_all:
            # Delete all equipment types with the same name
            # First get the name of the equipment type
            et_row = db.execute("SELECT name FROM equipment_types WHERE id = ? AND deleted_at IS NULL", (equipment_type_id,)).fetchone()
            if not et_row:
                raise HTTPException(status_code=404, detail="Equipment type not found")
            
            equipment_name = et_row['name']
            # Delete all equipment types with this name
            db.execute(
                "UPDATE equipment_types SET deleted_at = ?, deleted_by = ? WHERE name = ? AND deleted_at IS NULL",
                (deleted_at, username, equipment_name)
            )
            db.commit()
            return
        
        elif business_id is not None:
            # Delete from specific business
            # First verify the equipment type exists and get its details
            et = db.execute(
                "SELECT id, name, interval_weeks, rrule, default_lead_weeks, active, business_id FROM equipment_types WHERE id = ? AND deleted_at IS NULL", 
                (equipment_type_id,)
            ).fetchone()
            if not et:
                raise HTTPException(status_code=404, detail="Equipment type not found")
            
            equipment_name = et['name']
            
            # Check if this equipment type is in "All Businesses" (business_id IS NULL)
            if et['business_id'] is None:
                # This is an "All Businesses" equipment type
                # We need to create entries for all businesses EXCEPT the one being deleted
                # Then delete the "All Businesses" entry
                
                # Get all businesses
                all_businesses = db.execute("SELECT id FROM businesses").fetchall()
                
                # Create equipment type entries for all businesses except the one being deleted
                for biz_row in all_businesses:
                    biz_id = biz_row['id']
                    if biz_id != business_id:
                        # Check if this business already has this equipment type
                        existing = db.execute(
                            "SELECT id FROM equipment_types WHERE name = ? AND business_id = ? AND deleted_at IS NULL",
                            (equipment_name, biz_id)
                        ).fetchone()
                        
                        if not existing:
                            # Create the equipment type for this business
                            db.execute(
                                """INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active)
                                   VALUES (?, ?, ?, ?, ?, ?)""",
                                (biz_id, equipment_name, et['interval_weeks'], et['rrule'], 
                                 et['default_lead_weeks'], et['active'])
                            )
                
                # Delete the "All Businesses" entry
                db.execute(
                    "UPDATE equipment_types SET deleted_at = ?, deleted_by = ? WHERE name = ? AND business_id IS NULL AND deleted_at IS NULL",
                    (deleted_at, username, equipment_name)
                )
            else:
                # This is a business-specific equipment type, just delete it from that business
                db.execute(
                    "UPDATE equipment_types SET deleted_at = ?, deleted_by = ? WHERE name = ? AND business_id = ? AND deleted_at IS NULL",
                    (deleted_at, username, equipment_name, business_id)
                )
            
            db.commit()
            return
        else:
            # Delete specific equipment type by ID
            et = db.execute("SELECT id FROM equipment_types WHERE id = ? AND deleted_at IS NULL", (equipment_type_id,)).fetchone()
            if not et:
                raise HTTPException(status_code=404, detail="Equipment type not found")
            
            db.execute(
                "UPDATE equipment_types SET deleted_at = ?, deleted_by = ? WHERE id = ?",
                (deleted_at, username, equipment_type_id)
            )
            db.commit()
            return
    else:
        # Regular admin - can only delete from their business
        business_id = get_business_id(current_user)
        et = db.execute(
            "SELECT id FROM equipment_types WHERE id = ? AND business_id = ? AND deleted_at IS NULL", 
            (equipment_type_id, business_id)
        ).fetchone()
        if not et:
            raise HTTPException(status_code=404, detail="Equipment type not found")
        
        db.execute(
            "UPDATE equipment_types SET deleted_at = ?, deleted_by = ? WHERE id = ?",
            (deleted_at, username, equipment_type_id)
        )
        db.commit()
        return

@app.post("/equipment-types/{equipment_type_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_equipment_type(equipment_type_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Restore a deleted equipment type (super admin only)"""
    et = db.execute("SELECT id, deleted_at FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
    if not et:
        raise HTTPException(status_code=404, detail="Equipment type not found")
    if not et.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Equipment type is not deleted")
    
    db.execute("UPDATE equipment_types SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (equipment_type_id,))
    db.commit()
    return


@app.post("/equipment-types/seed", status_code=status.HTTP_201_CREATED)
def seed_equipment_types(db: sqlite3.Connection = Depends(get_db)):
    """Seed default equipment types for all businesses (business_id = NULL)"""
    defaults = [
        ("NM Audit", 13, "FREQ=WEEKLY;INTERVAL=13", 3),
        ("ACR PET / Gamma camera ACR", 26, "FREQ=WEEKLY;INTERVAL=26", 4),
        ("X-ray/CT physics testing", 52, "FREQ=WEEKLY;INTERVAL=52", 5),
    ]
    
    created = []
    for name, interval, rrule_str, lead_weeks in defaults:
        # Check if exists for all businesses (business_id IS NULL)
        existing = db.execute("SELECT id FROM equipment_types WHERE name = ? AND business_id IS NULL", (name,)).fetchone()
        if existing:
            continue
        
        cur = db.execute(
            "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?, 1)",
            (None, name, interval, rrule_str, lead_weeks),
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
    make: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
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
    make: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
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
    make: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    anchor_date: str
    due_date: Optional[str] = None
    interval_weeks: int
    lead_weeks: Optional[int] = None
    active: bool
    notes: Optional[str] = None
    timezone: Optional[str] = None
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    client_billing_info: Optional[str] = None
    client_notes: Optional[str] = None
    site_name: Optional[str] = None
    site_street: Optional[str] = None
    site_state: Optional[str] = None
    site_registration_license: Optional[str] = None
    site_timezone: Optional[str] = None
    site_notes: Optional[str] = None
    equipment_type_name: Optional[str] = None
    business_name: Optional[str] = None


@app.get("/equipment-records", response_model=List[EquipmentRecordRead])
def list_equipment_records(
    client_id: Optional[int] = Query(None, description="Filter by client"),
    active_only: Optional[bool] = Query(None, description="Filter to active only"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      c.address as client_address,
                      c.billing_info as client_billing_info,
                      c.notes as client_notes,
                      s.name as site_name,
                      s.street as site_street,
                      s.state as site_state,
                      s.site_registration_license as site_registration_license,
                      s.timezone as site_timezone,
                      s.notes as site_notes,
                      et.name as equipment_type_name,
                      b.name as business_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               LEFT JOIN businesses b ON c.business_id = b.id
               WHERE er.deleted_at IS NULL"""
    params = []
    
    # Filter by business_id if specified (None means all businesses for super admin)
    if business_id is not None:
        query += " AND c.business_id = ?"
        params.append(business_id)
    
    if client_id:
        # Add client_id filter directly to query (no need for separate verification query)
        query += " AND er.client_id = ?"
        params.append(client_id)
        # Also filter by business_id if specified to ensure client belongs to business
        if business_id is not None:
            query += " AND c.business_id = ?"
            params.append(business_id)
    
    # For non-admin users, always filter to active only
    # For admin users, respect the active_only parameter (default to showing all)
    if active_only is None:
        # If not specified, filter by user role
        if not current_user.get("is_admin"):
            active_only = True
        else:
            active_only = False
    
    if active_only:
        query += " AND er.active = 1"
    
    query += " ORDER BY er.anchor_date DESC"
    
    cur = db.execute(query, params)
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = row_to_dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/upcoming", response_model=List[EquipmentRecordRead])
def get_upcoming_equipment_records(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    weeks: Optional[int] = Query(None, description="Number of weeks from today"),
    current_user: dict = Depends(get_current_user),
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
    
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      c.address as client_address,
                      c.billing_info as client_billing_info,
                      c.notes as client_notes,
                      s.name as site_name,
                      s.street as site_street,
                      s.state as site_state,
                      s.site_registration_license as site_registration_license,
                      s.timezone as site_timezone,
                      s.notes as site_notes,
                      et.name as equipment_type_name,
                      b.name as business_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               LEFT JOIN businesses b ON c.business_id = b.id
               WHERE er.deleted_at IS NULL
                 AND er.active = 1 
                 AND (er.due_date IS NOT NULL AND er.due_date >= ? AND er.due_date <= ?)"""
    
    params = [start_date_obj.isoformat(), end_date_obj.isoformat()]
    
    # Filter by business_id if specified (None means all businesses for super admin)
    if business_id is not None:
        query += " AND c.business_id = ?"
        params.append(business_id)
    
    query += " ORDER BY er.due_date"
    
    cur = db.execute(query, params)
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = row_to_dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/overdue", response_model=List[EquipmentRecordRead])
def get_overdue_equipment_records(
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    today = dt.date.today()
    is_super_admin = current_user.get("is_super_admin")
    
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    query = """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      c.address as client_address,
                      c.billing_info as client_billing_info,
                      c.notes as client_notes,
                      s.name as site_name,
                      s.street as site_street,
                      s.state as site_state,
                      s.site_registration_license as site_registration_license,
                      s.timezone as site_timezone,
                      s.notes as site_notes,
                      et.name as equipment_type_name,
                      b.name as business_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               LEFT JOIN businesses b ON c.business_id = b.id
               WHERE er.deleted_at IS NULL
                 AND er.active = 1 
                 AND er.due_date IS NOT NULL 
                 AND er.due_date < ?"""
    
    params = [today.isoformat()]
    
    # Filter by business_id if specified (None means all businesses for super admin)
    if business_id is not None:
        query += " AND c.business_id = ?"
        params.append(business_id)
    
    query += " ORDER BY er.due_date"
    
    cur = db.execute(query, params)
    rows = cur.fetchall()
    result = []
    for row in rows:
        record_dict = row_to_dict(row)
        record_dict['active'] = bool(record_dict.get('active', 1))
        result.append(EquipmentRecordRead(**record_dict))
    return result


@app.get("/equipment-records/{equipment_record_id}", response_model=EquipmentRecordRead)
def get_equipment_record(equipment_record_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Super admin can view deleted records, regular users cannot
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any equipment record
            row = db.execute(
                """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                          er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                          er.active, er.notes, er.timezone,
                          c.name as client_name,
                          c.address as client_address,
                          c.billing_info as client_billing_info,
                          c.notes as client_notes,
                          s.name as site_name,
                          s.street as site_street,
                          s.state as site_state,
                          s.site_registration_license as site_registration_license,
                          s.timezone as site_timezone,
                          s.notes as site_notes,
                          et.name as equipment_type_name,
                          b.name as business_name
                   FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   LEFT JOIN sites s ON er.site_id = s.id
                   LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
                   LEFT JOIN businesses b ON c.business_id = b.id
                   WHERE er.id = ?""",
                (equipment_record_id,),
            ).fetchone()
        else:
            # Super admin viewing specific business
            row = db.execute(
                """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                          er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                          er.active, er.notes, er.timezone,
                          c.name as client_name,
                          c.address as client_address,
                          c.billing_info as client_billing_info,
                          c.notes as client_notes,
                          s.name as site_name,
                          s.street as site_street,
                          s.state as site_state,
                          s.site_registration_license as site_registration_license,
                          s.timezone as site_timezone,
                          s.notes as site_notes,
                          et.name as equipment_type_name,
                          b.name as business_name
                   FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   LEFT JOIN sites s ON er.site_id = s.id
                   LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
                   LEFT JOIN businesses b ON c.business_id = b.id
                   WHERE er.id = ? AND c.business_id = ?""",
                (equipment_record_id, business_id),
            ).fetchone()
    else:
        # Regular user - must filter by business_id and exclude deleted
        row = db.execute(
            """SELECT er.id, er.client_id, er.site_id, er.equipment_type_id, er.equipment_name, 
                      er.make, er.model, er.serial_number, er.anchor_date, er.due_date, er.interval_weeks, er.lead_weeks, 
                      er.active, er.notes, er.timezone,
                      c.name as client_name,
                      c.address as client_address,
                      c.billing_info as client_billing_info,
                      c.notes as client_notes,
                      s.name as site_name,
                      s.street as site_street,
                      s.state as site_state,
                      s.site_registration_license as site_registration_license,
                      s.timezone as site_timezone,
                      s.notes as site_notes,
                      et.name as equipment_type_name,
                      b.name as business_name
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               LEFT JOIN sites s ON er.site_id = s.id
               LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
               LEFT JOIN businesses b ON c.business_id = b.id
               WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
            (equipment_record_id, business_id),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Equipment record not found")

    record_dict = row_to_dict(row)
    record_dict['active'] = bool(record_dict.get('active', 1))
    return EquipmentRecordRead(**record_dict)


@app.post("/equipment-records", response_model=EquipmentRecordRead, status_code=status.HTTP_201_CREATED)
def create_equipment_record(payload: EquipmentRecordCreate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    
    # Get business_id from the client being used (not from user context)
    # This allows super admins in "all businesses" mode to create equipment
    client_row = db.execute("SELECT id, business_id FROM clients WHERE id = ? AND deleted_at IS NULL", (payload.client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    business_id = client_row['business_id']
    if business_id is None:
        raise HTTPException(status_code=400, detail="Client has no business assigned")
    
    # For non-super admins, verify the client belongs to their business
    if not is_super_admin:
        user_business_id = get_business_id(current_user)
        if business_id != user_business_id:
            raise HTTPException(status_code=403, detail="Client does not belong to your business")
    
    # Verify site exists and belongs to the client and is not deleted
    site_row = db.execute("SELECT id, client_id FROM sites WHERE id = ? AND deleted_at IS NULL", (payload.site_id,)).fetchone()
    if site_row is None:
        raise HTTPException(status_code=404, detail="Site not found")
    if site_row['client_id'] != payload.client_id:
        raise HTTPException(status_code=400, detail="Site does not belong to the specified client")
    
    # Verify equipment type exists and belongs to business (or is for all businesses) and is not deleted
    # Equipment types with business_id = NULL are available to all businesses
    equipment_type_row = db.execute(
        "SELECT id FROM equipment_types WHERE id = ? AND (business_id = ? OR business_id IS NULL) AND deleted_at IS NULL", 
        (payload.equipment_type_id, business_id)
    ).fetchone()
    if equipment_type_row is None:
        raise HTTPException(status_code=404, detail="Equipment type not found")
    
    # Check for duplicate equipment name in the same site
    existing = db.execute(
        "SELECT id FROM equipment_record WHERE site_id = ? AND equipment_name = ?",
        (payload.site_id, payload.equipment_name)
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail=f"Equipment with name '{payload.equipment_name}' already exists in this site")
    
    try:
        cur = db.execute(
            "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, make, model, serial_number, anchor_date, due_date, interval_weeks, lead_weeks, active, notes, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (payload.client_id, payload.site_id, payload.equipment_type_id, payload.equipment_name, payload.make, payload.model, payload.serial_number, payload.anchor_date, payload.due_date, payload.interval_weeks, payload.lead_weeks, 1 if payload.active else 0, payload.notes, payload.timezone),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")

    return get_equipment_record(cur.lastrowid, current_user, db)


@app.put("/equipment-records/{equipment_record_id}", response_model=EquipmentRecordRead)
def update_equipment_record(equipment_record_id: int, payload: EquipmentRecordUpdate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Get current equipment record to check site_id, equipment_name, client_id, and get the client's business_id
    # Use the same pattern as get_equipment_record for consistency
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any equipment record (including deleted)
            current_record = db.execute(
                """SELECT er.site_id, er.equipment_name, er.client_id, c.business_id
                   FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   WHERE er.id = ?""",
                (equipment_record_id,)
            ).fetchone()
        else:
            # Super admin viewing specific business - exclude deleted records
            current_record = db.execute(
                """SELECT er.site_id, er.equipment_name, er.client_id, c.business_id
                   FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
                (equipment_record_id, business_id)
            ).fetchone()
    else:
        # Regular user - must filter by business_id and exclude deleted
        current_record = db.execute(
            """SELECT er.site_id, er.equipment_name, er.client_id, c.business_id
               FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
            (equipment_record_id, business_id)
        ).fetchone()
    
    if current_record is None:
        raise HTTPException(status_code=404, detail="Equipment record not found")
    
    # Get the actual business_id from the client (for equipment type validation)
    # This ensures we use the client's business_id, not just the user's context
    equipment_business_id = current_record['business_id']
    if equipment_business_id is None:
        raise HTTPException(status_code=400, detail="Equipment record's client has no business assigned")
    
    # Verify equipment type if being updated
    if payload.equipment_type_id is not None:
        if is_super_admin and business_id is None:
            # Super admin viewing all businesses - allow any equipment type
            equipment_type_row = db.execute("SELECT id FROM equipment_types WHERE id = ?", (payload.equipment_type_id,)).fetchone()
        else:
            # Regular user or super admin viewing specific business
            # Allow equipment types that belong to the business OR are global (business_id IS NULL)
            # Use the equipment's client's business_id for validation
            equipment_type_row = db.execute(
                "SELECT id FROM equipment_types WHERE id = ? AND (business_id = ? OR business_id IS NULL) AND deleted_at IS NULL",
                (payload.equipment_type_id, equipment_business_id)
            ).fetchone()
        if equipment_type_row is None:
            raise HTTPException(status_code=404, detail="Equipment type not found")

    # Verify site if being updated and is not deleted
    if payload.site_id is not None:
        site_row = db.execute("SELECT id, client_id FROM sites WHERE id = ? AND deleted_at IS NULL", (payload.site_id,)).fetchone()
        if site_row is None:
            raise HTTPException(status_code=404, detail="Site not found")
        if site_row['client_id'] != current_record['client_id']:
            raise HTTPException(status_code=400, detail="Site does not belong to the same client")
    
    # Check for duplicate equipment name in the same site (if name or site is being updated)
    site_id_to_check = payload.site_id if payload.site_id is not None else current_record['site_id']
    equipment_name_to_check = payload.equipment_name if payload.equipment_name is not None else current_record['equipment_name']
    
    if payload.equipment_name is not None or payload.site_id is not None:
        existing = db.execute(
            "SELECT id FROM equipment_record WHERE site_id = ? AND equipment_name = ? AND id != ?",
            (site_id_to_check, equipment_name_to_check, equipment_record_id)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Equipment with name '{equipment_name_to_check}' already exists in this site")

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
    if payload.make is not None:
        fields.append("make = ?")
        values.append(payload.make)
    if payload.model is not None:
        fields.append("model = ?")
        values.append(payload.model)
    if payload.serial_number is not None:
        fields.append("serial_number = ?")
        values.append(payload.serial_number)
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
        except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
            raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")

    return get_equipment_record(equipment_record_id, current_user, db)


@app.delete("/equipment-records/{equipment_record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_record(equipment_record_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Verify equipment record belongs to business through client and is not deleted
    if business_id is None:
        # Super admin viewing all businesses - allow deletion of any equipment record
        er = db.execute(
            """SELECT er.id FROM equipment_record er
               WHERE er.id = ? AND er.deleted_at IS NULL""",
            (equipment_record_id,)
        ).fetchone()
    else:
        # Filter by business_id
        er = db.execute(
            """SELECT er.id FROM equipment_record er
               JOIN clients c ON er.client_id = c.id
               WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
            (equipment_record_id, business_id)
        ).fetchone()
    
    if not er:
        raise HTTPException(status_code=404, detail="Equipment record not found")
    
    # Soft delete: mark as deleted
    username = current_user.get("username", "unknown")
    deleted_at = datetime.now().isoformat()
    db.execute(
        "UPDATE equipment_record SET deleted_at = ?, deleted_by = ? WHERE id = ?",
        (deleted_at, username, equipment_record_id)
    )
    db.commit()
    return

@app.post("/equipment-records/{equipment_record_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_equipment_record(equipment_record_id: int, current_user: dict = Depends(get_current_super_admin_user), db: sqlite3.Connection = Depends(get_db)):
    """Restore a deleted equipment record (super admin only)"""
    er = db.execute("SELECT id, deleted_at FROM equipment_record WHERE id = ?", (equipment_record_id,)).fetchone()
    if not er:
        raise HTTPException(status_code=404, detail="Equipment record not found")
    if not er.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Equipment record is not deleted")
    
    db.execute("UPDATE equipment_record SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (equipment_record_id,))
    db.commit()
    return


# ========== EQUIPMENT COMPLETIONS ==========

class EquipmentCompletionCreate(BaseModel):
    equipment_record_id: int
    due_date: str
    interval_weeks: Optional[int] = None
    completed_by_user: Optional[str] = None


class EquipmentCompletionRead(BaseModel):
    id: int
    equipment_record_id: int
    completed_at: str
    due_date: str  # Previous due date (the one that was completed)
    interval_weeks: Optional[int] = None
    completed_by_user: Optional[str] = None
    equipment_name: Optional[str] = None
    client_id: Optional[int] = None
    client_name: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    equipment_type_id: Optional[int] = None
    equipment_type_name: Optional[str] = None
    anchor_date: Optional[str] = None  # Previous anchor date from equipment_record


@app.post("/equipment-completions", response_model=EquipmentCompletionRead, status_code=status.HTTP_201_CREATED)
def create_equipment_completion(payload: EquipmentCompletionCreate, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Verify equipment record exists and belongs to business
    # Use the same pattern as get_equipment_record for consistency
    if is_super_admin:
        if business_id is None:
            # Super admin viewing all businesses - allow access to any equipment record (including deleted)
            equipment_row = db.execute(
                """SELECT er.id FROM equipment_record er
                   WHERE er.id = ?""",
                (payload.equipment_record_id,)
            ).fetchone()
        else:
            # Super admin viewing specific business - exclude deleted records
            equipment_row = db.execute(
                """SELECT er.id FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
                (payload.equipment_record_id, business_id)
            ).fetchone()
    else:
        # Regular user - must filter by business_id and exclude deleted
        equipment_row = db.execute(
            """SELECT er.id FROM equipment_record er
               LEFT JOIN clients c ON er.client_id = c.id
               WHERE er.id = ? AND c.business_id = ? AND er.deleted_at IS NULL""",
            (payload.equipment_record_id, business_id)
        ).fetchone()
    if equipment_row is None:
        raise HTTPException(status_code=404, detail="Equipment record not found")
    
    # Get username from current_user
    username = current_user.get("username", "unknown")
    
    cur = db.execute(
        "INSERT INTO equipment_completions (equipment_record_id, due_date, interval_weeks, completed_by_user) VALUES (?, ?, ?, ?)",
        (payload.equipment_record_id, payload.due_date, payload.interval_weeks, username)
    )
    db.commit()
    
    # Fetch the completion with joined equipment data
    row = db.execute("""
        SELECT ec.id, ec.equipment_record_id, ec.completed_at, ec.due_date, ec.interval_weeks, ec.completed_by_user,
               er.equipment_name, er.client_id, er.site_id, er.equipment_type_id, er.anchor_date,
               c.name as client_name,
               s.name as site_name,
               et.name as equipment_type_name
        FROM equipment_completions ec
        JOIN equipment_record er ON ec.equipment_record_id = er.id
        LEFT JOIN clients c ON er.client_id = c.id
        LEFT JOIN sites s ON er.site_id = s.id
        LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
        WHERE ec.id = ?
""", (cur.lastrowid,)).fetchone()
    
    return EquipmentCompletionRead(**row_to_dict(row))


@app.get("/equipment-completions", response_model=List[EquipmentCompletionRead])
def list_equipment_completions(
    equipment_record_id: Optional[int] = Query(None, description="Filter by equipment record"),
    business_id_filter: Optional[int] = Query(None, description="Filter by business ID (super admin only)"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    is_super_admin = current_user.get("is_super_admin")
    # Super admin can filter by any business, regular users are limited to their own
    if is_super_admin:
        if business_id_filter is not None:
            business_id = business_id_filter
        else:
            # Super admin viewing all businesses (business_id can be None)
            business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    query = """
        SELECT ec.id, ec.equipment_record_id, ec.completed_at, ec.due_date, ec.interval_weeks, ec.completed_by_user,
               er.equipment_name, er.client_id, er.site_id, er.equipment_type_id, er.anchor_date,
               c.name as client_name,
               s.name as site_name,
               et.name as equipment_type_name
        FROM equipment_completions ec
        JOIN equipment_record er ON ec.equipment_record_id = er.id
        LEFT JOIN clients c ON er.client_id = c.id
        LEFT JOIN sites s ON er.site_id = s.id
        LEFT JOIN equipment_types et ON er.equipment_type_id = et.id
    """
    params = []
    
    # Filter by business_id if specified (None means all businesses for super admin)
    if business_id is not None:
        query += " WHERE c.business_id = ?"
        params.append(business_id)
    else:
        # Super admin viewing all businesses - no business_id filter
        query += " WHERE 1=1"
    
    if equipment_record_id:
        # Verify equipment_record exists
        if business_id is not None:
            er_check = db.execute(
                """SELECT er.id FROM equipment_record er
                   LEFT JOIN clients c ON er.client_id = c.id
                   WHERE er.id = ? AND c.business_id = ?""",
                (equipment_record_id, business_id)
            ).fetchone()
        else:
            # Super admin viewing all businesses - allow any equipment record
            er_check = db.execute(
                """SELECT er.id FROM equipment_record er
                   WHERE er.id = ?""",
                (equipment_record_id,)
            ).fetchone()
        if not er_check:
            raise HTTPException(status_code=404, detail="Equipment record not found")
        query += " AND ec.equipment_record_id = ?"
        params.append(equipment_record_id)
    
    query += " ORDER BY ec.completed_at DESC"
    
    cur = db.execute(query, params)
    rows = cur.fetchall()
    return [EquipmentCompletionRead(**row_to_dict(row)) for row in rows]


@app.delete("/equipment-completions/{completion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_completion(completion_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    is_super_admin = current_user.get("is_super_admin")
    # For super admins, business_id can be None (viewing all businesses)
    if is_super_admin:
        business_id = current_user.get("business_id")
    else:
        business_id = get_business_id(current_user)
    
    # Verify completion belongs to business through equipment_record -> client
    if is_super_admin and business_id is None:
        # Super admin viewing all businesses - allow deletion of any completion
        completion = db.execute(
            """SELECT ec.id FROM equipment_completions ec
               WHERE ec.id = ?""",
            (completion_id,)
        ).fetchone()
    else:
        # Regular user or super admin viewing specific business
        completion = db.execute(
            """SELECT ec.id FROM equipment_completions ec
               JOIN equipment_record er ON ec.equipment_record_id = er.id
               LEFT JOIN clients c ON er.client_id = c.id
               WHERE ec.id = ? AND c.business_id = ?""",
        (completion_id, business_id)
    ).fetchone()
    if not completion:
        raise HTTPException(status_code=404, detail="Completion record not found")
    
    cur = db.execute("DELETE FROM equipment_completions WHERE id = ?", (completion_id,))
    db.commit()
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
        # Create equipment type for all businesses (business_id = NULL) - legacy endpoint
        cur = db.execute(
            "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?, ?)",
            (None, payload.name, payload.interval_weeks, payload.rrule, payload.default_lead_weeks, 1 if payload.active else 0),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        raise HTTPException(status_code=400, detail="Equipment type name must be unique for all businesses")

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
        except (sqlite3.IntegrityError, psycopg2.IntegrityError):
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
def seed_default_equipments(client_id: int, current_user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    """Seed default equipment types for all businesses (business_id = NULL). These are available to all businesses."""
    # Verify client exists
    client_row = db.execute("SELECT id, business_id FROM clients WHERE id = ? AND deleted_at IS NULL", (client_id,)).fetchone()
    if client_row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    
    client_dict = dict(client_row)
    business_id = client_dict.get("business_id")
    
    # Verify the client belongs to the current user's business (unless super admin)
    if not current_user.get("is_super_admin"):
        user_business_id = get_business_id(current_user)
        if business_id != user_business_id:
            raise HTTPException(status_code=403, detail="Client not found in your business")
    
    created = []
    for name, interval, rrule_str, lead_weeks in DEFAULT_EQUIPMENTS:
        # Check if equipment type already exists for all businesses (business_id IS NULL)
        existing = db.execute("SELECT id FROM equipment_types WHERE name = ? AND business_id IS NULL", (name,)).fetchone()
        if existing:
            continue
        
        # Create equipment type for all businesses (business_id = NULL)
        cur = db.execute(
            "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?, 1)",
            (None, name, interval, rrule_str, lead_weeks),
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
    return [NoteRead(**row_to_dict(row)) for row in rows]


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
    return NoteRead(**row_to_dict(row))


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
    return [AttachmentRead(**row_to_dict(row)) for row in rows]


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
    return AttachmentRead(**row_to_dict(row))


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
    return [ContactRollup(**row_to_dict(row)) for row in rows]


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
    return [ContactRollup(**row_to_dict(row)) for row in rows]


# ========== EXCEL IMPORT ==========

@app.post("/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    site_id: Optional[int] = Query(None, description="Optional: Import to specific site"),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import data from Excel file. 
    If site_id is provided: Only Equipment and Due Date columns are required.
    If site_id is not provided: Client, Site, Equipment, and Due Date columns are required.
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    # Get business_id from current user
    business_id = get_business_id(current_user)
    if business_id is None:
        raise HTTPException(status_code=400, detail="No business context available. Please select a business first.")
    
    # If site_id is provided, verify it exists and get client_id
    target_site_id = None
    target_client_id = None
    if site_id:
        site_row = db.execute(
            """SELECT s.id, s.client_id FROM sites s 
               JOIN clients c ON s.client_id = c.id 
               WHERE s.id = ? AND c.business_id = ?""",
            (site_id, business_id)
        ).fetchone()
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
        site_timezone_cache = {}  # site_id -> timezone (cache to avoid N+1 queries)
        equipment_type_cache = {}  # equipment_type_id -> {interval_weeks, default_lead_weeks} (cache to avoid N+1 queries)
        
        # Batch commits for better performance (commit every 50 rows or at the end)
        commit_batch_size = 50
        rows_since_commit = 0
        
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
                        # Check if client exists in this business
                        existing = db.execute("SELECT id FROM clients WHERE name = ? AND business_id = ?", (client_name, business_id)).fetchone()
                        if existing:
                            client_id = existing['id']
                        else:
                            # Create client with business_id
                            cur = db.execute(
                                "INSERT INTO clients (business_id, name, address) VALUES (?, ?, ?)",
                                (business_id, client_name, str(row[address_col]).strip() if address_col and pd.notna(row.get(address_col)) else None)
                            )
                            # Get ID from RETURNING clause (no commit needed yet)
                            client_id = cur.lastrowid
                            rows_since_commit += 1
                            # Commit in batches for better performance
                            if rows_since_commit >= commit_batch_size:
                                db.commit()
                                rows_since_commit = 0
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
                                "INSERT INTO sites (client_id, name, street, state, site_registration_license, timezone) VALUES (?, ?, ?, ?, ?, ?)",
                                (client_id, site_name, None, None, None, "America/Chicago")
                            )
                            # Get ID from RETURNING clause (no commit needed yet)
                            site_id = cur.lastrowid
                            rows_since_commit += 1
                            # Commit in batches for better performance
                            if rows_since_commit >= commit_batch_size:
                                db.commit()
                                rows_since_commit = 0
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
                        # Get ID from RETURNING clause (no commit needed yet)
                        equipment_type_id = cur.lastrowid
                        rows_since_commit += 1
                        # Commit in batches for better performance
                        if rows_since_commit >= commit_batch_size:
                            db.commit()
                            rows_since_commit = 0
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
                
                # Get default timezone from site if not provided (use cache to avoid N+1 queries)
                if not timezone:
                    if site_id not in site_timezone_cache:
                        site_row = db.execute("SELECT timezone FROM sites WHERE id = ?", (site_id,)).fetchone()
                        site_timezone_cache[site_id] = site_row['timezone'] if site_row and site_row['timezone'] else "America/Chicago"
                    timezone = site_timezone_cache[site_id]
                
                # Get default lead_weeks and interval_weeks from equipment_type (use cache to avoid N+1 queries)
                if equipment_type_id not in equipment_type_cache:
                    eq_type_row = db.execute("SELECT interval_weeks, default_lead_weeks FROM equipment_types WHERE id = ?", (equipment_type_id,)).fetchone()
                    equipment_type_cache[equipment_type_id] = {
                        'interval_weeks': eq_type_row['interval_weeks'] if eq_type_row and eq_type_row['interval_weeks'] else 52,
                        'default_lead_weeks': eq_type_row['default_lead_weeks'] if eq_type_row and eq_type_row['default_lead_weeks'] else 4
                    }
                
                eq_type_data = equipment_type_cache[equipment_type_id]
                if lead_weeks is None:
                    lead_weeks = eq_type_data['default_lead_weeks']
                interval_weeks = eq_type_data['interval_weeks']
                
                # Use equipment_identifier as equipment_name, or fallback to equipment_type_name
                equipment_name = equipment_identifier if equipment_identifier else equipment_type_name
                
                try:
                    db.execute(
                        "INSERT INTO equipment_record (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                        (client_id, site_id, equipment_type_id, equipment_name, anchor_date, due_date, interval_weeks, lead_weeks, timezone, notes)
                    )
                    db.commit()
                    stats["equipment_records_created"] += 1
                except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
                    error_str = str(e)
                    if "UNIQUE constraint" in error_str:
                        stats["duplicates_skipped"] += 1
                    else:
                        stats["errors"].append(f"Row {idx + 2}: {error_str}")
                except Exception as e:
                    stats["errors"].append(f"Row {idx + 2}: {str(e)}")
                
            except:
                continue
        
        # Final commit for any remaining uncommitted rows
        if rows_since_commit > 0:
            db.commit()
        
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
    business_id: Optional[int] = Form(None),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import equipment records from Excel file.
    Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date
    Optional column: Business (for super admins)
    - If client or site doesn't exist, the row is skipped (voided)
    - If equipment type doesn't exist, it will be created in equipment_types table
    - For super admins: can specify business_id or use business from Excel
    - For normal admins: uses their business, filters out rows with different businesses
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    is_super_admin = current_user.get("is_super_admin")
    
    # Determine business_id
    if is_super_admin:
        # Super admin can use provided business_id or get from Excel
        if business_id is None:
            # Will be determined from Excel file (Business column)
            business_id = None
    else:
        # Regular admin must use their business
        business_id = get_business_id(current_user)
        if business_id is None:
            raise HTTPException(status_code=400, detail="No business context available. Please select a business first.")
    
    try:
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names (case-insensitive, remove spaces)
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_').str.replace('-', '_')
        
        # Identify columns
        client_col = None
        site_col = None
        business_col = None  # Business column (for super admins)
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
            elif business_col is None and 'business' in col_lower:
                business_col = col
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
                # Determine business_id for this row
                row_business_id = business_id
                if is_super_admin:
                    # Super admin: use business from Excel if provided, otherwise use provided business_id
                    if business_col and business_col in row:
                        business_name = str(row[business_col]).strip()
                        if business_name and business_name.lower() not in ['nan', 'none', '']:
                            # Look up business by name
                            business_row = db.execute("SELECT id FROM businesses WHERE name = ?", (business_name,)).fetchone()
                            if business_row:
                                row_business_id = business_row['id']
                            else:
                                # Business doesn't exist - skip row (normal import doesn't create businesses)
                                stats["rows_skipped"] += 1
                                stats["errors"].append(f"Row {idx + 2}: Business '{business_name}' not found")
                                continue
                        elif business_id is None:
                            stats["rows_skipped"] += 1
                            stats["errors"].append(f"Row {idx + 2}: Business not specified")
                            continue
                    elif business_id is None:
                        stats["rows_skipped"] += 1
                        stats["errors"].append(f"Row {idx + 2}: Business not specified")
                        continue
                else:
                    # Regular admin: filter out rows that don't match their business
                    if business_col and business_col in row:
                        business_name = str(row[business_col]).strip()
                        if business_name and business_name.lower() not in ['nan', 'none', '']:
                            # Check if business matches
                            business_row = db.execute("SELECT id FROM businesses WHERE name = ? AND id = ?", (business_name, business_id)).fetchone()
                            if not business_row:
                                # Different business - skip this row
                                stats["rows_skipped"] += 1
                                continue
                
                # Get client name
                client_name = str(row[client_col]).strip()
                if not client_name or client_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing client name")
                    continue
                
                # Match client (must exist in this business, don't create)
                client_row = db.execute("SELECT id FROM clients WHERE name = ? AND business_id = ?", (client_name, row_business_id)).fetchone()
                if not client_row:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Client '{client_name}' not found in business")
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
                
                # Get or create equipment_type (in this business)
                equipment_type = db.execute("SELECT id, interval_weeks, default_lead_weeks FROM equipment_types WHERE name = ? AND business_id = ?", (equipment_type_name, row_business_id)).fetchone()
                if equipment_type:
                    equipment_type_id = equipment_type['id']
                    default_interval_weeks = equipment_type['interval_weeks'] or 52
                    default_lead_weeks = equipment_type['default_lead_weeks'] or 4
                else:
                    # Create new equipment_type with business_id
                    rrule_str = "FREQ=WEEKLY;INTERVAL=52"
                    cur = db.execute(
                        "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?, ?)",
                        (row_business_id, equipment_type_name, 52, rrule_str, 4)
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
                except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
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
    business_id: Optional[int] = Form(None),
    current_user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Import equipment records from Excel file (temporary data upload).
    Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date
    Optional column: Business (for super admins)
    - If client or site doesn't exist, they will be created automatically
    - If equipment type doesn't exist, it will be created in equipment_types table
    - For super admins: if business doesn't exist, it will be created
    - For normal admins: uses their business, filters out rows with different businesses
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel file (.xlsx or .xls)")
    
    is_super_admin = current_user.get("is_super_admin")
    
    # Determine business_id
    if is_super_admin:
        # Super admin can use provided business_id or get from Excel
        if business_id is None:
            # Will be determined from Excel file (Business column)
            business_id = None
    else:
        # Regular admin must use their business
        business_id = get_business_id(current_user)
        if business_id is None:
            raise HTTPException(status_code=400, detail="No business context available. Please select a business first.")
    
    try:
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names (case-insensitive, remove spaces)
        df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_').str.replace('-', '_')
        
        # Identify columns
        client_col = None
        site_col = None
        business_col = None  # Business column (for super admins)
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
            elif business_col is None and 'business' in col_lower:
                business_col = col
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
                # Determine business_id for this row
                row_business_id = business_id
                if is_super_admin:
                    # Super admin: use business from Excel if provided, otherwise use provided business_id
                    if business_col and business_col in row:
                        business_name = str(row[business_col]).strip()
                        if business_name and business_name.lower() not in ['nan', 'none', '']:
                            # Look up or create business by name
                            business_row = db.execute("SELECT id FROM businesses WHERE name = ?", (business_name,)).fetchone()
                            if business_row:
                                row_business_id = business_row['id']
                            else:
                                # Create business if it doesn't exist (temporary upload creates businesses)
                                cur = db.execute("INSERT INTO businesses (name) VALUES (?)", (business_name,))
                                db.commit()
                                row_business_id = cur.lastrowid
                        elif business_id is None:
                            stats["rows_skipped"] += 1
                            stats["errors"].append(f"Row {idx + 2}: Business not specified")
                            continue
                    elif business_id is None:
                        stats["rows_skipped"] += 1
                        stats["errors"].append(f"Row {idx + 2}: Business not specified")
                        continue
                else:
                    # Regular admin: filter out rows that don't match their business
                    if business_col and business_col in row:
                        business_name = str(row[business_col]).strip()
                        if business_name and business_name.lower() not in ['nan', 'none', '']:
                            # Check if business matches
                            business_row = db.execute("SELECT id FROM businesses WHERE name = ? AND id = ?", (business_name, business_id)).fetchone()
                            if not business_row:
                                # Different business - skip this row
                                stats["rows_skipped"] += 1
                                continue
                
                # Get client name
                client_name = str(row[client_col]).strip()
                if not client_name or client_name.lower() in ['nan', 'none', '']:
                    stats["rows_skipped"] += 1
                    stats["errors"].append(f"Row {idx + 2}: Missing client name")
                    continue
                
                # Get or create client (use row_business_id)
                client_key = (row_business_id, client_name)
                if client_key not in client_map:
                    existing = db.execute("SELECT id FROM clients WHERE name = ? AND business_id = ?", (client_name, row_business_id)).fetchone()
                    if existing:
                        client_id = existing['id']
                    else:
                        # Create client with business_id
                        cur = db.execute(
                            "INSERT INTO clients (business_id, name, address) VALUES (?, ?, ?)",
                            (row_business_id, client_name, None)
                        )
                        db.commit()
                        client_id = cur.lastrowid
                        stats["clients_created"] += 1
                    
                    client_map[client_key] = client_id
                
                client_id = client_map[client_key]
                
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
                            "INSERT INTO sites (client_id, name, street, state, site_registration_license, timezone) VALUES (?, ?, ?, ?, ?, ?)",
                            (client_id, site_name, None, None, None, "America/Chicago")
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
                
                # Get or create equipment_type (in this business)
                equipment_type = db.execute("SELECT id, interval_weeks, default_lead_weeks FROM equipment_types WHERE name = ? AND business_id = ?", (equipment_type_name, row_business_id)).fetchone()
                if equipment_type:
                    equipment_type_id = equipment_type['id']
                    default_interval_weeks = equipment_type['interval_weeks'] or 52
                    default_lead_weeks = equipment_type['default_lead_weeks'] or 4
                else:
                    # Create new equipment_type with business_id
                    rrule_str = "FREQ=WEEKLY;INTERVAL=52"
                    cur = db.execute(
                        "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks) VALUES (?, ?, ?, ?, ?)",
                        (row_business_id, equipment_type_name, 52, rrule_str, 4)
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
                except (sqlite3.IntegrityError, psycopg2.IntegrityError) as e:
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
                b.name as business_name,
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
            JOIN businesses b ON c.business_id = b.id
            WHERE er.active = 1
            ORDER BY b.name, c.name, s.name, er.anchor_date
        """)
        
        rows = cur.fetchall()
        
        # Create DataFrame
        data = []
        for row in rows:
            data.append({
                "Business": row['business_name'],
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


@app.get("/admin/export/equipment-info")
async def export_equipment_info(
    business_id_filter: Optional[int] = Query(None, description="Filter by business ID (super admin only)"),
    current_user: dict = Depends(get_current_admin_user),
    db: sqlite3.Connection = Depends(get_db)
):
    """
    Export equipment info with completion dates to Excel format.
    If an equipment is tested multiple times, all dates will have separate entries.
    Sorted by client name.
    """
    try:
        is_super_admin = current_user.get("is_super_admin")
        
        # Determine business_id to filter by
        if is_super_admin:
            if business_id_filter is not None:
                business_id = business_id_filter
            else:
                # Super admin viewing all businesses (business_id can be None)
                business_id = current_user.get("business_id")
        else:
            business_id = get_business_id(current_user)
        
        # Query equipment records with related data
        # Include business name when viewing all businesses (business_id is None)
        include_business_name = (is_super_admin and business_id is None)
        
        if include_business_name:
            query = """
                SELECT 
                    b.name as business_name,
                    c.name as client_name,
                    s.name as site_name,
                    s.street as site_street,
                    s.state as site_state,
                    s.site_registration_license as site_registration_license,
                    er.equipment_name,
                    et.name as equipment_type,
                    er.make,
                    er.model,
                    er.serial_number,
                    er.id as equipment_record_id
                FROM equipment_record er
                JOIN clients c ON er.client_id = c.id
                JOIN sites s ON er.site_id = s.id
                JOIN equipment_types et ON er.equipment_type_id = et.id
                JOIN businesses b ON c.business_id = b.id
                WHERE er.deleted_at IS NULL AND er.active = 1
            """
        else:
            query = """
                SELECT 
                    c.name as client_name,
                    s.name as site_name,
                    s.street as site_street,
                    s.state as site_state,
                    s.site_registration_license as site_registration_license,
                    er.equipment_name,
                    et.name as equipment_type,
                    er.make,
                    er.model,
                    er.serial_number,
                    er.id as equipment_record_id
                FROM equipment_record er
                JOIN clients c ON er.client_id = c.id
                JOIN sites s ON er.site_id = s.id
                JOIN equipment_types et ON er.equipment_type_id = et.id
                WHERE er.deleted_at IS NULL AND er.active = 1
            """
        params = []
        
        # Filter by business_id if specified
        if business_id is not None:
            query += " AND c.business_id = ?"
            params.append(business_id)
        
        query += " ORDER BY c.name, er.equipment_name"
        
        cur = db.execute(query, params)
        equipment_rows = cur.fetchall()
        
        # Query all completions for these equipment records
        equipment_ids = [row['equipment_record_id'] for row in equipment_rows]
        
        completions_data = {}
        if equipment_ids:
            placeholders = ','.join('?' * len(equipment_ids))
            completions_query = f"""
                SELECT 
                    equipment_record_id,
                    completed_at
                FROM equipment_completions
                WHERE equipment_record_id IN ({placeholders})
                ORDER BY completed_at
            """
            completions_rows = db.execute(completions_query, equipment_ids).fetchall()
            
            # Group completions by equipment_record_id
            for comp_row in completions_rows:
                eq_id = comp_row['equipment_record_id']
                if eq_id not in completions_data:
                    completions_data[eq_id] = []
                completions_data[eq_id].append(comp_row['completed_at'])
        
        # Build export data - one row per completion, or one row if no completions
        data = []
        for eq_row in equipment_rows:
            eq_id = eq_row['equipment_record_id']
            completions = completions_data.get(eq_id, [])
            
            if completions:
                # Create a row for each completion date
                for completed_at in completions:
                    row_data = {}
                    # Add business name column first only when viewing all businesses
                    if include_business_name:
                        row_data["Business Name"] = eq_row['business_name'] or ""
                    row_data.update({
                        "Client Name": eq_row['client_name'] or "",
                        "Site Name": eq_row['site_name'] or "",
                        "Street": eq_row['site_street'] or "",
                        "State": eq_row['site_state'] or "",
                        "Registration/License": eq_row['site_registration_license'] or "",
                        "Equipment Name": eq_row['equipment_name'] or "",
                        "Equipment Type": eq_row['equipment_type'] or "",
                        "Make": eq_row['make'] or "",
                        "Model": eq_row['model'] or "",
                        "Serial Number": eq_row['serial_number'] or "",
                        "Date of Completed Testing": completed_at
                    })
                    data.append(row_data)
            else:
                # Equipment with no completions - still include it with empty date
                row_data = {}
                # Add business name column first only when viewing all businesses
                if include_business_name:
                    row_data["Business Name"] = eq_row['business_name'] or ""
                row_data.update({
                    "Client Name": eq_row['client_name'] or "",
                    "Site Name": eq_row['site_name'] or "",
                    "Street": eq_row['site_street'] or "",
                    "State": eq_row['site_state'] or "",
                    "Registration/License": eq_row['site_registration_license'] or "",
                    "Equipment Name": eq_row['equipment_name'] or "",
                    "Equipment Type": eq_row['equipment_type'] or "",
                    "Make": eq_row['make'] or "",
                    "Model": eq_row['model'] or "",
                    "Serial Number": eq_row['serial_number'] or "",
                    "Date of Completed Testing": ""
                })
                data.append(row_data)
        
        # Create DataFrame
        if not data:
            # If no data, create empty DataFrame with correct columns
            columns = []
            if include_business_name:
                columns.append("Business Name")
            columns.extend([
                "Client Name",
                "Site Name",
                "Street",
                "State",
                "Registration/License",
                "Equipment Name",
                "Equipment Type",
                "Make",
                "Model",
                "Serial Number",
                "Date of Completed Testing"
            ])
            df = pd.DataFrame(columns=columns)
        else:
            df = pd.DataFrame(data)
            
            # Reorder columns to put Business Name first if it exists
            if include_business_name and "Business Name" in df.columns:
                cols = ["Business Name"] + [col for col in df.columns if col != "Business Name"]
                df = df[cols]
        
        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Equipment Info')
        
        output.seek(0)
        
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=equipment_info_export.xlsx"}
        )
    
    except Exception as e:
        import traceback
        error_detail = f"Error exporting equipment info: {str(e)}\n{traceback.format_exc()}"
        raise HTTPException(status_code=500, detail=error_detail)