from pathlib import Path
import sqlite3
import datetime as dt

DB_PATH = Path("WaveClients.db")

def connect_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_schema(conn):
    conn.executescript(
        """
        -- Clients
        CREATE TABLE IF NOT EXISTS clients (
          id           INTEGER PRIMARY KEY,
          name         TEXT NOT NULL UNIQUE,
          address      TEXT,
          billing_info TEXT,
          notes        TEXT
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

        -- Test types (recurrence templates)
        CREATE TABLE IF NOT EXISTS test_types (
          id                 INTEGER PRIMARY KEY,
          name               TEXT NOT NULL UNIQUE,
          interval_weeks     INTEGER NOT NULL,
          rrule              TEXT NOT NULL,
          default_lead_weeks INTEGER NOT NULL,
          active             INTEGER NOT NULL DEFAULT 1
        );

        -- Schedules (recurring)
        CREATE TABLE IF NOT EXISTS schedules (
          id                   INTEGER PRIMARY KEY,
          site_id              INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          test_type_id         INTEGER NOT NULL REFERENCES test_types(id),
          anchor_date          TEXT NOT NULL,  -- YYYY-MM-DD
          due_date             TEXT,           -- YYYY-MM-DD (manual due date, optional)
          lead_weeks           INTEGER,        -- optional override
          timezone             TEXT,           -- optional override
          equipment_identifier TEXT,           -- optional equipment identifier
          notes                TEXT,
          last_generated_until TEXT,           -- last due date generated (YYYY-MM-DD)
          completed            INTEGER NOT NULL DEFAULT 0,  -- 0 = active, 1 = completed
          completed_at         TEXT            -- YYYY-MM-DD HH:MM:SS timestamp when completed
          -- Note: UNIQUE constraint moved to index on (site_id, equipment_id, anchor_date)
        );

        -- Work orders (occurrences)
        CREATE TABLE IF NOT EXISTS work_orders (
          id           INTEGER PRIMARY KEY,
          schedule_id  INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
          due_date     TEXT NOT NULL,          -- YYYY-MM-DD
          planned_date TEXT,
          done_date    TEXT,
          status       TEXT NOT NULL CHECK (status IN ('PLANNED','DUE','DONE')) DEFAULT 'PLANNED',
          invoice_ref  TEXT,
          notes        TEXT,
          UNIQUE(schedule_id, due_date)
        );

        -- Notes & attachments (optional)
        CREATE TABLE IF NOT EXISTS notes (
          id         INTEGER PRIMARY KEY,
          scope      TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE','WORK_ORDER')),
          scope_id   INTEGER NOT NULL,
          body       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS attachments (
          id          INTEGER PRIMARY KEY,
          scope       TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE','WORK_ORDER')),
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
    
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN equipment_identifier TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN due_date TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN completed INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        conn.execute("ALTER TABLE schedules ADD COLUMN completed_at TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    # Migrate schedules from test_type_id to equipment_id
    try:
        # Check if equipment_id column exists
        conn.execute("SELECT equipment_id FROM schedules LIMIT 1")
    except sqlite3.OperationalError:
        # Add equipment_id column
        try:
            conn.execute("ALTER TABLE schedules ADD COLUMN equipment_id INTEGER REFERENCES client_equipments(id)")
        except sqlite3.OperationalError:
            pass
        
        # Update existing schedules: copy test_type_id to equipment_id for migration
        try:
            conn.execute("UPDATE schedules SET equipment_id = test_type_id WHERE equipment_id IS NULL")
        except sqlite3.OperationalError:
            pass
    
    # Drop old UNIQUE constraint on (site_id, test_type_id, anchor_date) if it exists
    # SQLite doesn't support dropping constraints directly, but we can recreate the table
    # For now, we'll rely on the index constraint and handle conflicts in application logic
    
    # Create unique index on (site_id, equipment_id, anchor_date) if it doesn't exist
    # This is the correct constraint since equipment_id is client-specific
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_site_equipment_date ON schedules(site_id, equipment_id, anchor_date)")
    except sqlite3.OperationalError:
        pass
    
    # Drop the old index if it exists (from the table-level UNIQUE constraint)
    try:
        conn.execute("DROP INDEX IF EXISTS sqlite_autoindex_schedules_1")
    except sqlite3.OperationalError:
        pass
    
    conn.commit()