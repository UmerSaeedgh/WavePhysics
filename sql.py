from pathlib import Path
import os
import sqlite3
import datetime as dt
import hashlib
import secrets


DB_PATH = Path(os.getenv("DATABASE_PATH", "data/WaveClients.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def connect_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_schema(conn):
    conn.executescript(
        """
        -- Businesses (multi-tenant support)
        CREATE TABLE IF NOT EXISTS businesses (
          id           INTEGER PRIMARY KEY,
          name         TEXT NOT NULL UNIQUE,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Clients
        CREATE TABLE IF NOT EXISTS clients (
          id           INTEGER PRIMARY KEY,
          business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          name         TEXT NOT NULL,
          address      TEXT,
          billing_info TEXT,
          notes        TEXT,
          UNIQUE(business_id, name)
        );

        -- Sites
        CREATE TABLE IF NOT EXISTS sites (
          id         INTEGER PRIMARY KEY,
          client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          address    TEXT,
          timezone   TEXT NOT NULL DEFAULT 'America/Chicago',
          notes      TEXT,
          UNIQUE(client_id, name)
        );

        -- Contacts
        CREATE TABLE IF NOT EXISTS contacts (
          id          INTEGER PRIMARY KEY,
          first_name  TEXT NOT NULL,
          last_name   TEXT NOT NULL,
          email       TEXT,
          phone       TEXT
        );

        -- Contact links at Client or Site level, with roles
        CREATE TABLE IF NOT EXISTS contact_links (
          id          INTEGER PRIMARY KEY,
          contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          scope       TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
          scope_id    INTEGER NOT NULL,
          role        TEXT NOT NULL,
          is_primary  INTEGER NOT NULL DEFAULT 0,
          UNIQUE(contact_id, scope, scope_id, role)
        );

        -- Equipment types (recurrence templates)
        CREATE TABLE IF NOT EXISTS equipment_types (
          id                 INTEGER PRIMARY KEY,
          business_id        INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
          name               TEXT NOT NULL,
          interval_weeks     INTEGER NOT NULL,
          rrule              TEXT NOT NULL,
          default_lead_weeks INTEGER NOT NULL,
          active             INTEGER NOT NULL DEFAULT 1,
          UNIQUE(business_id, name)
        );

        -- Test types (recurrence templates) - Legacy table, kept for backward compatibility
        CREATE TABLE IF NOT EXISTS test_types (
          id                 INTEGER PRIMARY KEY,
          name               TEXT NOT NULL UNIQUE,
          interval_weeks     INTEGER NOT NULL,
          rrule              TEXT NOT NULL,
          default_lead_weeks INTEGER NOT NULL,
          active             INTEGER NOT NULL DEFAULT 1
        );

        -- Equipment records (equipment instances with scheduling info)
        CREATE TABLE IF NOT EXISTS equipment_record (
          id                 INTEGER PRIMARY KEY,
          client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          equipment_type_id  INTEGER NOT NULL REFERENCES equipment_types(id),
          equipment_name     TEXT NOT NULL,
          make_model_serial  TEXT,           -- Make/model/serial number (optional)
          anchor_date        TEXT NOT NULL,  -- YYYY-MM-DD
          due_date           TEXT,           -- YYYY-MM-DD (manual due date, optional)
          interval_weeks     INTEGER NOT NULL DEFAULT 52,
          lead_weeks         INTEGER,        -- optional override
          active             INTEGER NOT NULL DEFAULT 1,
          notes              TEXT,
          timezone           TEXT            -- optional override
        );

        -- Notes & attachments (optional)
        CREATE TABLE IF NOT EXISTS notes (
          id         INTEGER PRIMARY KEY,
          scope      TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
          scope_id   INTEGER NOT NULL,
          body       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS attachments (
          id          INTEGER PRIMARY KEY,
          scope       TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
          scope_id    INTEGER NOT NULL,
          filename    TEXT NOT NULL,
          url_or_path TEXT NOT NULL,
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Client Equipments (testing/equipment types per client)
        CREATE TABLE IF NOT EXISTS client_equipments (
          id                 INTEGER PRIMARY KEY,
          client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name               TEXT NOT NULL,
          interval_weeks     INTEGER NOT NULL DEFAULT 52,
          rrule              TEXT NOT NULL DEFAULT 'FREQ=WEEKLY;INTERVAL=52',
          default_lead_weeks INTEGER NOT NULL DEFAULT 4,
          active             INTEGER NOT NULL DEFAULT 1,
          is_custom          INTEGER NOT NULL DEFAULT 0,  -- 0 = default, 1 = custom
          UNIQUE(client_id, name)
        );

        -- Users
        CREATE TABLE IF NOT EXISTS users (
          id             INTEGER PRIMARY KEY,
          username       TEXT NOT NULL UNIQUE,
          password_hash  TEXT NOT NULL,
          is_admin       INTEGER NOT NULL DEFAULT 0,
          is_super_admin INTEGER NOT NULL DEFAULT 0,
          business_id    INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Auth Tokens (for session management)
        CREATE TABLE IF NOT EXISTS auth_tokens (
          token        TEXT PRIMARY KEY,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          username     TEXT NOT NULL,
          is_admin     INTEGER NOT NULL DEFAULT 0,
          is_super_admin INTEGER NOT NULL DEFAULT 0,
          business_id  INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
          expires_at   TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Equipment Completion Records (tracks when equipment is marked as done)
        CREATE TABLE IF NOT EXISTS equipment_completions (
          id                 INTEGER PRIMARY KEY,
          equipment_record_id INTEGER NOT NULL REFERENCES equipment_record(id) ON DELETE CASCADE,
          completed_at        TEXT NOT NULL DEFAULT (datetime('now')),
          due_date            TEXT NOT NULL,
          interval_weeks      INTEGER,
          completed_by_user   TEXT
        );
        """
    )
    
    # Migrate existing tables to add new columns if they don't exist
    try:
        conn.execute("ALTER TABLE clients ADD COLUMN address TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        conn.execute("ALTER TABLE clients ADD COLUMN billing_info TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    # Note: equipment_types table is created fresh, no migration needed since database will be recreated
    
    # Migrate equipment_completions table if it doesn't exist
    try:
        conn.execute("SELECT id FROM equipment_completions LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS equipment_completions (
                  id                 INTEGER PRIMARY KEY,
                  equipment_record_id INTEGER NOT NULL REFERENCES equipment_record(id) ON DELETE CASCADE,
                  completed_at        TEXT NOT NULL DEFAULT (datetime('now')),
                  due_date            TEXT NOT NULL,
                  interval_weeks      INTEGER,
                  completed_by_user   TEXT
                )
            """)
        except sqlite3.OperationalError:
            pass
    
    # Migration: Add businesses table and business_id columns
    try:
        conn.execute("SELECT id FROM businesses LIMIT 1")
    except sqlite3.OperationalError:
        # Create businesses table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS businesses (
              id           INTEGER PRIMARY KEY,
              name         TEXT NOT NULL UNIQUE,
              created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Create a default business for existing data
        conn.execute("INSERT INTO businesses (name) VALUES ('Default Business')")
        default_business_id = conn.lastrowid
        
        # Add business_id columns to existing tables
        for table, column in [
            ("clients", "business_id"),
            ("equipment_types", "business_id"),
            ("users", "business_id"),
            ("users", "is_super_admin"),
            ("auth_tokens", "business_id"),
            ("auth_tokens", "is_super_admin")
        ]:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} INTEGER")
                if column == "business_id" and table in ("clients", "equipment_types"):
                    # Set default business for existing records
                    conn.execute(f"UPDATE {table} SET business_id = ? WHERE business_id IS NULL", (default_business_id,))
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Update unique constraints for clients and equipment_types
        # Note: SQLite doesn't support dropping UNIQUE constraints easily, so we'll handle this in application logic
        conn.commit()
    
    # Migration: Update unique constraints if needed (for clients and equipment_types)
    # We'll rely on application-level checks since SQLite doesn't easily support constraint changes
    
    # Migration: Add soft delete columns (deleted_at, deleted_by) to relevant tables
    soft_delete_tables = ["clients", "sites", "equipment_record", "equipment_types"]
    for table in soft_delete_tables:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN deleted_at TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN deleted_by TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
    
    # Migration: Allow NULL business_id in equipment_types for "all businesses" support
    # SQLite doesn't support ALTER COLUMN, so we need to recreate the table if it has NOT NULL constraint
    try:
        # Check table schema to see if business_id allows NULL
        table_info = conn.execute("PRAGMA table_info(equipment_types)").fetchall()
        business_id_col = None
        for col in table_info:
            if col[1] == 'business_id':  # col[1] is the column name
                business_id_col = col
                break
        
        if business_id_col and business_id_col[3] == 1:  # col[3] is notnull (1 = NOT NULL, 0 = allows NULL)
            # Need to migrate - recreate table without NOT NULL constraint
            try:
                # Get all existing data
                existing_data = conn.execute("""
                    SELECT id, business_id, name, interval_weeks, rrule, default_lead_weeks, active, 
                           deleted_at, deleted_by
                    FROM equipment_types
                """).fetchall()
                
                # Create new table with NULL allowed
                conn.execute("DROP TABLE equipment_types")
                conn.execute("""
                    CREATE TABLE equipment_types (
                        id                 INTEGER PRIMARY KEY,
                        business_id        INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
                        name               TEXT NOT NULL,
                        interval_weeks     INTEGER NOT NULL,
                        rrule              TEXT NOT NULL,
                        default_lead_weeks INTEGER NOT NULL,
                        active             INTEGER NOT NULL DEFAULT 1,
                        deleted_at         TEXT,
                        deleted_by         TEXT,
                        UNIQUE(business_id, name)
                    )
                """)
                
                # Restore existing data
                for row in existing_data:
                    conn.execute("""
                        INSERT INTO equipment_types 
                        (id, business_id, name, interval_weeks, rrule, default_lead_weeks, active, deleted_at, deleted_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, row)
                
                conn.commit()
            except sqlite3.OperationalError as e:
                conn.rollback()
                print(f"Migration note for equipment_types: {e}")
    except sqlite3.OperationalError:
        # Table might not exist yet, which is fine
        pass
    
    # Migration: Consolidate duplicate default equipment types to "all businesses" (business_id = NULL)
    # This migrates default equipment types that were created per business to be "all businesses" types
    try:
        # List of default equipment type names that should be "all businesses" types
        default_type_names = [
            "RSO-Certificate of X-ray Registration",
            "RSO-Radioactive Material License",
            "Radiation Licensing & Program Setup",
            "Shielding Design & Public Exposure Surveys",
            "Patient Radiation Dose Evaluation & NM Misadministration",
            "General Radiation Safety Awareness Workshop",
            "Quarterly Audits",
            "SPECT Testing",
            "PET Testing",
            "Computed Tomography",
            "General Radiography",
            "Fluoroscopy",
            "Magnetic Resonance Imaging",
            "Mammography (MQSA)",
            "NM Audit",
            "ACR PET / Gamma camera ACR",
            "X-ray/CT physics testing"
        ]
        
        for type_name in default_type_names:
            # Find all equipment types with this name that have a business_id (duplicates per business)
            duplicates = conn.execute(
                "SELECT id, business_id FROM equipment_types WHERE name = ? AND business_id IS NOT NULL AND deleted_at IS NULL",
                (type_name,)
            ).fetchall()
            
            if duplicates:
                # Check if "all businesses" version already exists
                all_businesses_version = conn.execute(
                    "SELECT id FROM equipment_types WHERE name = ? AND business_id IS NULL AND deleted_at IS NULL",
                    (type_name,)
                ).fetchone()
                
                if not all_businesses_version:
                    # Get the first duplicate's details to create the "all businesses" version
                    first_dup = duplicates[0]
                    dup_details = conn.execute(
                        "SELECT interval_weeks, rrule, default_lead_weeks, active FROM equipment_types WHERE id = ?",
                        (first_dup['id'],)
                    ).fetchone()
                    
                    if dup_details:
                        # Create "all businesses" version
                        conn.execute(
                            "INSERT INTO equipment_types (business_id, name, interval_weeks, rrule, default_lead_weeks, active) VALUES (?, ?, ?, ?, ?, ?)",
                            (None, type_name, dup_details['interval_weeks'], dup_details['rrule'], dup_details['default_lead_weeks'], dup_details['active'])
                        )
                
                # Soft delete all business-specific duplicates (they'll be replaced by the "all businesses" version)
                for dup in duplicates:
                    conn.execute(
                        "UPDATE equipment_types SET deleted_at = datetime('now'), deleted_by = 'migration' WHERE id = ?",
                        (dup['id'],)
                    )
        
        conn.commit()
    except Exception as e:
        # If migration fails, rollback and continue
        try:
            conn.rollback()
        except:
            pass
        print(f"Migration note for consolidating default equipment types: {e}")
    
    # Migration: Add make_model_serial column to equipment_record table
    try:
        # Check if column exists
        columns = [row[1] for row in conn.execute("PRAGMA table_info(equipment_record)").fetchall()]
        if 'make_model_serial' not in columns:
            conn.execute("ALTER TABLE equipment_record ADD COLUMN make_model_serial TEXT")
            conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except:
            pass
        print(f"Migration note for adding make_model_serial column: {e}")
    
    conn.commit()