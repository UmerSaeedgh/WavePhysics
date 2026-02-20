"""
Script to apply performance optimization indexes to Azure PostgreSQL database.
Run this to significantly improve query performance.
"""
import psycopg2
from psycopg2.extras import RealDictCursor

# Azure PostgreSQL connection details
DB_HOST = "wavephysics.postgres.database.azure.com"
DB_PORT = 5432
DB_USER = "wavephysics"
DB_PASSWORD = "Database123"
DB_NAME = "postgres"

def apply_indexes():
    """Apply performance optimization indexes."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        cursor_factory=RealDictCursor,
        sslmode='require'
    )
    
    cursor = conn.cursor()
    
    print("Applying performance optimization indexes...")
    print("=" * 60)
    
    indexes = [
        ("idx_equipment_record_due_date", "equipment_record(due_date) WHERE due_date IS NOT NULL"),
        ("idx_equipment_record_active", "equipment_record(active) WHERE active = 1"),
        ("idx_equipment_record_deleted_at", "equipment_record(deleted_at) WHERE deleted_at IS NULL"),
        ("idx_equipment_record_business_active", "equipment_record(client_id, active, deleted_at) WHERE deleted_at IS NULL"),
        ("idx_equipment_record_business_active_deleted", "equipment_record(client_id, active, deleted_at)"),
        ("idx_equipment_record_due_date_active", "equipment_record(due_date, active) WHERE active = 1 AND deleted_at IS NULL AND due_date IS NOT NULL"),
        ("idx_clients_deleted_at", "clients(deleted_at) WHERE deleted_at IS NULL"),
        ("idx_clients_business_deleted", "clients(business_id, deleted_at) WHERE deleted_at IS NULL"),
        ("idx_sites_deleted_at", "sites(deleted_at) WHERE deleted_at IS NULL"),
        ("idx_sites_client_deleted", "sites(client_id, deleted_at) WHERE deleted_at IS NULL"),
        ("idx_equipment_types_deleted_at", "equipment_types(deleted_at) WHERE deleted_at IS NULL"),
        ("idx_auth_tokens_token", "auth_tokens(token)"),
        # Note: Partial index on expires_at can't use CURRENT_TIMESTAMP, so we'll create a regular index
        ("idx_auth_tokens_expires_at", "auth_tokens(expires_at)"),
        ("idx_contact_links_scope_scope_id", "contact_links(scope, scope_id)"),
        ("idx_notes_scope_scope_id", "notes(scope, scope_id)"),
        ("idx_attachments_scope_scope_id", "attachments(scope, scope_id)"),
        ("idx_equipment_completions_due_date", "equipment_completions(due_date)"),
    ]
    
    created = 0
    skipped = 0
    
    for index_name, index_def in indexes:
        try:
            cursor.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {index_def}")
            print(f"[OK] Created index: {index_name}")
            created += 1
        except Exception as e:
            conn.rollback()  # Rollback on error
            print(f"[SKIP] Index {index_name}: {e}")
            skipped += 1
    
    # Commit all successful index creations
    conn.commit()
    
    # Analyze tables to update statistics
    print("\nUpdating table statistics...")
    tables = ["equipment_record", "clients", "sites", "equipment_types", "auth_tokens", 
              "contact_links", "notes", "attachments", "equipment_completions"]
    
    for table in tables:
        try:
            cursor.execute(f"ANALYZE {table}")
            print(f"[OK] Analyzed: {table}")
        except Exception as e:
            print(f"[SKIP] Analyze {table}: {e}")
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print("\n" + "=" * 60)
    print(f"Performance optimization complete!")
    print(f"Created: {created} indexes")
    print(f"Skipped: {skipped} indexes")
    print("=" * 60)

if __name__ == "__main__":
    apply_indexes()

