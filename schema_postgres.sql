-- PostgreSQL Schema for Wave Physics Database
-- This schema matches the SQLite database structure

-- Enable foreign keys (PostgreSQL has them enabled by default, but good practice)
-- Note: PostgreSQL doesn't have a PRAGMA command like SQLite

-- Businesses (multi-tenant support)
CREATE TABLE IF NOT EXISTS businesses (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id           SERIAL PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  address      TEXT,
  billing_info TEXT,
  notes        TEXT,
  deleted_at   TIMESTAMP,
  deleted_by   TEXT,
  UNIQUE(business_id, name)
);

-- Sites
CREATE TABLE IF NOT EXISTS sites (
  id                      SERIAL PRIMARY KEY,
  client_id               INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  street                  TEXT,
  state                   TEXT,
  site_registration_license TEXT,
  timezone                TEXT NOT NULL DEFAULT 'America/Chicago',
  notes                   TEXT,
  deleted_at              TIMESTAMP,
  deleted_by              TEXT,
  UNIQUE(client_id, name)
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT,
  phone       TEXT
);

-- Contact links at Client or Site level, with roles
CREATE TABLE IF NOT EXISTS contact_links (
  id          SERIAL PRIMARY KEY,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
  scope_id    INTEGER NOT NULL,
  role        TEXT NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(contact_id, scope, scope_id, role)
);

-- Equipment types (recurrence templates)
CREATE TABLE IF NOT EXISTS equipment_types (
  id                 SERIAL PRIMARY KEY,
  business_id        INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  interval_weeks     INTEGER NOT NULL,
  rrule              TEXT NOT NULL,
  default_lead_weeks INTEGER NOT NULL,
  active             INTEGER NOT NULL DEFAULT 1,
  deleted_at         TIMESTAMP,
  deleted_by         TEXT,
  UNIQUE(business_id, name)
);

-- Test types (recurrence templates) - Legacy table, kept for backward compatibility
CREATE TABLE IF NOT EXISTS test_types (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  interval_weeks     INTEGER NOT NULL,
  rrule              TEXT NOT NULL,
  default_lead_weeks INTEGER NOT NULL,
  active             INTEGER NOT NULL DEFAULT 1
);

-- Equipment records (equipment instances with scheduling info)
CREATE TABLE IF NOT EXISTS equipment_record (
  id                 SERIAL PRIMARY KEY,
  client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  equipment_type_id  INTEGER NOT NULL REFERENCES equipment_types(id),
  equipment_name     TEXT NOT NULL,
  make               TEXT,           -- Make (optional)
  model              TEXT,           -- Model (optional)
  serial_number      TEXT,           -- Serial number (optional)
  anchor_date        DATE NOT NULL,  -- YYYY-MM-DD
  due_date           DATE,           -- YYYY-MM-DD (manual due date, optional)
  interval_weeks     INTEGER NOT NULL DEFAULT 52,
  lead_weeks         INTEGER,        -- optional override
  active             INTEGER NOT NULL DEFAULT 1,
  notes              TEXT,
  timezone           TEXT,           -- optional override
  deleted_at         TIMESTAMP,
  deleted_by         TEXT
);

-- Notes & attachments (optional)
CREATE TABLE IF NOT EXISTS notes (
  id         SERIAL PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
  scope_id   INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id          SERIAL PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('CLIENT','SITE')),
  scope_id    INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  url_or_path TEXT NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Client Equipments (testing/equipment types per client)
CREATE TABLE IF NOT EXISTS client_equipments (
  id                 SERIAL PRIMARY KEY,
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
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  business_id    INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Auth Tokens (for session management)
CREATE TABLE IF NOT EXISTS auth_tokens (
  token          TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username       TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  business_id    INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  expires_at     TIMESTAMP NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Equipment Completion Records (tracks when equipment is marked as done)
CREATE TABLE IF NOT EXISTS equipment_completions (
  id                 SERIAL PRIMARY KEY,
  equipment_record_id INTEGER NOT NULL REFERENCES equipment_record(id) ON DELETE CASCADE,
  completed_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date            DATE NOT NULL,
  interval_weeks      INTEGER,
  completed_by_user   TEXT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_business_id ON clients(business_id);
CREATE INDEX IF NOT EXISTS idx_sites_client_id ON sites(client_id);
CREATE INDEX IF NOT EXISTS idx_equipment_record_client_id ON equipment_record(client_id);
CREATE INDEX IF NOT EXISTS idx_equipment_record_site_id ON equipment_record(site_id);
CREATE INDEX IF NOT EXISTS idx_equipment_record_equipment_type_id ON equipment_record(equipment_type_id);
CREATE INDEX IF NOT EXISTS idx_contact_links_contact_id ON contact_links(contact_id);
CREATE INDEX IF NOT EXISTS idx_equipment_types_business_id ON equipment_types(business_id);
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_completions_equipment_record_id ON equipment_completions(equipment_record_id);

