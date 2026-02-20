"""
Script to initialize Azure PostgreSQL database with schema.
This script connects to the Azure PostgreSQL server and creates all tables.
"""
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import sql
import sys
import os

# Fix Windows console encoding
if sys.platform == 'win32':
    os.system('chcp 65001 >nul 2>&1')  # Set UTF-8 encoding

# Azure PostgreSQL connection details
DB_HOST = "wavephysics.postgres.database.azure.com"
DB_PORT = 5432
DB_USER = "wavephysics"
DB_PASSWORD = "Database123"
DB_NAME = "postgres"  # Default database, or specify a custom database name

def connect_to_server():
    """Connect to the PostgreSQL server (using default postgres database)."""
    try:
        # Try with require SSL first (Azure PostgreSQL standard)
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            cursor_factory=RealDictCursor,
            sslmode='require',  # Azure PostgreSQL requires SSL
            connect_timeout=10
        )
        print(f"[OK] Connected to Azure PostgreSQL server: {DB_HOST}")
        return conn
    except psycopg2.OperationalError as e:
        if "timeout" in str(e).lower() or "connection" in str(e).lower():
            print(f"[ERROR] Connection timeout to database: {e}")
            print("\n" + "=" * 60)
            print("TROUBLESHOOTING: Connection Timeout")
            print("=" * 60)
            print("This usually means your IP address is not allowed in Azure firewall rules.")
            print("\nTo fix this:")
            print("1. Go to Azure Portal -> Your PostgreSQL server -> Connection security")
            print("2. Add your current IP address to the firewall rules")
            print("3. Or enable 'Allow access to Azure services' (less secure)")
            print("4. Save the firewall rules")
            print("\nAlternatively, you can add your IP using Azure CLI:")
            print("  az postgres server firewall-rule create \\")
            print(f"    --resource-group fastapi-wave \\")
            print(f"    --server wavephysics \\")
            print(f"    --name AllowMyIP \\")
            print(f"    --start-ip-address YOUR_IP \\")
            print(f"    --end-ip-address YOUR_IP")
        else:
            print(f"[ERROR] Error connecting to database: {e}")
        sys.exit(1)
    except psycopg2.Error as e:
        print(f"[ERROR] Error connecting to database: {e}")
        print("\nTroubleshooting tips:")
        print("1. Check if your IP address is allowed in Azure PostgreSQL firewall rules")
        print("2. Verify the server is running and accessible")
        print("3. Check if SSL is properly configured")
        sys.exit(1)

def create_database_if_not_exists(conn, db_name):
    """Create a database if it doesn't exist."""
    # Connect to postgres database to create new database
    conn.rollback()  # End any transaction
    conn.autocommit = True  # Required for CREATE DATABASE
    
    cursor = conn.cursor()
    try:
        # Check if database exists
        cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (db_name,)
        )
        exists = cursor.fetchone()
        
        if not exists:
            cursor.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name))
            )
            print(f"[OK] Created database: {db_name}")
        else:
            print(f"[OK] Database already exists: {db_name}")
    except psycopg2.Error as e:
        print(f"[ERROR] Error creating database: {e}")
    finally:
        cursor.close()
        conn.autocommit = False

def init_schema(conn):
    """Initialize the database schema."""
    cursor = conn.cursor()
    
    try:
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
        print("[OK] Schema created successfully")
        
        # Verify tables were created
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        """)
        tables = cursor.fetchall()
        print(f"\n[OK] Created {len(tables)} tables:")
        for table in tables:
            print(f"  - {table['table_name']}")
        
    except psycopg2.Error as e:
        conn.rollback()
        print(f"[ERROR] Error creating schema: {e}")
        raise
    finally:
        cursor.close()

def main():
    """Main function to initialize the database."""
    print("=" * 60)
    print("Azure PostgreSQL Database Initialization")
    print("=" * 60)
    print(f"Server: {DB_HOST}")
    print(f"Database: {DB_NAME}")
    print("=" * 60)
    
    # Connect to the database
    conn = connect_to_server()
    
    try:
        # Initialize schema
        init_schema(conn)
        print("\n" + "=" * 60)
        print("[OK] Database initialization completed successfully!")
        print("=" * 60)
    except Exception as e:
        print(f"\n[ERROR] Error during initialization: {e}")
        sys.exit(1)
    finally:
        conn.close()
        print("[OK] Connection closed")

if __name__ == "__main__":
    main()

