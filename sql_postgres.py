import os
import types
import threading
from queue import Queue, Empty

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import sql
from psycopg2.pool import ThreadedConnectionPool


def get_db_connection_string():
    """Get PostgreSQL connection string from environment variables."""
    # Azure PostgreSQL connection string format:
    # postgresql://user:password@host:port/database
    # Or individual components:
    #
    # NOTE: We provide sensible defaults for your Azure server so the app
    # works out-of-the-box even if env vars are not set. You can still
    # override these with environment variables in production.
    db_host = os.getenv("DB_HOST", "wavephysics.postgres.database.azure.com")
    db_port = os.getenv("DB_PORT", "5432")
    db_name = os.getenv("DB_NAME", "postgres")
    db_user = os.getenv("DB_USER", "wavephysics")
    db_password = os.getenv("DB_PASSWORD", "Database123")
    
    # Check if full connection string is provided (takes precedence)
    conn_string = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_CONNECTION_STRING")
    if conn_string:
        return conn_string

    # Build connection string from components (using defaults if env vars missing)
    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


def _attach_sqlite_compatible_execute(conn):
    """
    Attach an .execute(...) method to the psycopg2 connection that mimics
    sqlite3.Connection.execute, so existing code using sqlite-style queries
    continues to work.

    - Accepts qmark-style placeholders (?) and converts them to %s
    - Returns a cursor so .fetchone() / .fetchall() chaining still works
    """

    # Cursor wrapper to support lastrowid attribute (psycopg2 cursors don't allow setting attributes)
    class CursorWrapper:
        def __init__(self, cursor):
            self._cursor = cursor
            self.lastrowid = None
        
        def __getattr__(self, name):
            # Delegate all other attributes/methods to the real cursor
            return getattr(self._cursor, name)
        
        def fetchone(self):
            return self._cursor.fetchone()
        
        def fetchall(self):
            return self._cursor.fetchall()
        
        def execute(self, *args, **kwargs):
            return self._cursor.execute(*args, **kwargs)

    def execute(self, query, params=None):
        # If using sqlite-style ? placeholders, convert them to %s
        if isinstance(query, str) and "?" in query and params is not None:
            # Simple replacement is enough because the number of ? must match
            # the number of params for both sqlite and psycopg2
            query = query.replace("?", "%s")

        real_cur = self.cursor()
        cur = CursorWrapper(real_cur)
        
        # For INSERT statements, add RETURNING id to get the inserted ID (for lastrowid compatibility)
        is_insert = query.strip().upper().startswith("INSERT")
        if is_insert and "RETURNING" not in query.upper():
            # Add RETURNING id to the INSERT statement
            query = query.rstrip(";").rstrip() + " RETURNING id"
        
        if params is not None:
            cur.execute(query, params)
        else:
            cur.execute(query)
        
        # Store the returned ID for lastrowid access (PostgreSQL compatibility)
        if is_insert:
            try:
                result = cur.fetchone()
                if result:
                    # Store the ID for lastrowid access
                    cur.lastrowid = result['id'] if isinstance(result, dict) else result[0]
                else:
                    cur.lastrowid = None
            except Exception:
                # If fetchone fails, set to None
                cur.lastrowid = None
        else:
            cur.lastrowid = None
            
        return cur

    # Wrap the connection in a lightweight proxy object that exposes
    # .execute(...) plus the underlying psycopg2 connection methods
    class SQLiteCompatConnection:
        def __init__(self, pg_conn):
            self._pg_conn = pg_conn

        def execute(self, query, params=None):
            return execute(self._pg_conn, query, params)

        # Delegate commonly used attributes/methods to the real connection
        def cursor(self, *args, **kwargs):
            return self._pg_conn.cursor(*args, **kwargs)

        def commit(self):
            return self._pg_conn.commit()

        def rollback(self):
            return self._pg_conn.rollback()

        def close(self):
            return self._pg_conn.close()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            self.close()

    return SQLiteCompatConnection(conn)


# Connection pool for better performance
_connection_pool = None
_pool_lock = threading.Lock()

def _get_connection_pool():
    """Get or create the connection pool (thread-safe singleton)."""
    global _connection_pool
    if _connection_pool is None:
        with _pool_lock:
            if _connection_pool is None:
                # Create a connection pool with 5-30 connections
                # This reuses connections instead of creating new ones for each request
                conn_string = get_db_connection_string()
                _connection_pool = ThreadedConnectionPool(
                    minconn=5,  # Minimum connections to keep open (increased for better performance)
                    maxconn=30,  # Maximum connections in pool (increased for concurrent requests)
                    dsn=conn_string,
                    cursor_factory=RealDictCursor,
                    sslmode="require",  # Azure PostgreSQL requires SSL
                    connect_timeout=10,  # Connection timeout in seconds
                    keepalives=1,  # Enable TCP keepalives
                    keepalives_idle=30,  # Seconds before sending keepalive
                    keepalives_interval=10,  # Seconds between keepalives
                    keepalives_count=5,  # Number of keepalives before considering connection dead
                )
    return _connection_pool

def connect_db():
    """Connect to PostgreSQL database using connection pool and return a sqlite-compatible connection."""
    pool = _get_connection_pool()
    conn = pool.getconn()  # Get connection from pool
    
    # Make the connection API look like sqlite3 where needed
    wrapped_conn = _attach_sqlite_compatible_execute(conn)
    
    # Override close() to return connection to pool instead of actually closing it
    original_close = wrapped_conn.close
    def return_to_pool():
        pool.putconn(conn)  # Return the underlying connection to pool
    
    wrapped_conn.close = return_to_pool
    return wrapped_conn


def init_schema(conn):
    """Initialize the database schema."""
    cursor = conn.cursor()
    
    # Read and execute the schema SQL
    schema_sql = """
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
      make               TEXT,
      model              TEXT,
      serial_number      TEXT,
      anchor_date        DATE NOT NULL,
      due_date           DATE,
      interval_weeks     INTEGER NOT NULL DEFAULT 52,
      lead_weeks         INTEGER,
      active             INTEGER NOT NULL DEFAULT 1,
      notes              TEXT,
      timezone           TEXT,
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
      is_custom          INTEGER NOT NULL DEFAULT 0,
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
    """
    
    cursor.execute(schema_sql)
    conn.commit()
    cursor.close()
    
    # Run migrations to ensure all columns exist
    _run_migrations(conn)


def _run_migrations(conn):
    """Run database migrations to add any missing columns."""
    cursor = conn.cursor()
    
    # Migration: Add businesses table and business_id columns if needed
    try:
        cursor.execute("SELECT id FROM businesses LIMIT 1")
    except psycopg2.errors.UndefinedTable:
        # Create businesses table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS businesses (
              id           SERIAL PRIMARY KEY,
              name         TEXT NOT NULL UNIQUE,
              created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Create a default business for existing data
        cursor.execute("INSERT INTO businesses (name) VALUES ('Default Business') RETURNING id")
        default_business_id = cursor.fetchone()['id']
        
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
                cursor.execute(
                    sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS {} INTEGER").format(
                        sql.Identifier(table),
                        sql.Identifier(column)
                    )
                )
                if column == "business_id" and table in ("clients", "equipment_types"):
                    # Set default business for existing records
                    cursor.execute(
                        sql.SQL("UPDATE {} SET {} = %s WHERE {} IS NULL").format(
                            sql.Identifier(table),
                            sql.Identifier(column),
                            sql.Identifier(column)
                        ),
                        (default_business_id,)
                    )
            except psycopg2.errors.DuplicateColumn:
                pass  # Column already exists
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"Migration note for businesses: {e}")
    
    # Migration: Add soft delete columns (deleted_at, deleted_by) to relevant tables
    soft_delete_tables = ["clients", "sites", "equipment_record", "equipment_types"]
    for table in soft_delete_tables:
        try:
            cursor.execute(
                sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP").format(
                    sql.Identifier(table)
                )
            )
        except Exception:
            pass
        
        try:
            cursor.execute(
                sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS deleted_by TEXT").format(
                    sql.Identifier(table)
                )
            )
        except Exception:
            pass
    
    conn.commit()
    cursor.close()

