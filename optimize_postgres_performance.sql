-- Performance optimization indexes for PostgreSQL
-- Run this script to add missing indexes that will significantly improve query performance

-- Critical indexes for equipment_record queries (most frequently accessed)
CREATE INDEX IF NOT EXISTS idx_equipment_record_due_date ON equipment_record(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_record_active ON equipment_record(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_equipment_record_deleted_at ON equipment_record(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_record_business_active ON equipment_record(client_id, active, deleted_at) WHERE deleted_at IS NULL;

-- Composite index for common query pattern: business_id + active + deleted_at
CREATE INDEX IF NOT EXISTS idx_equipment_record_business_active_deleted ON equipment_record(client_id, active, deleted_at);

-- Index for upcoming/overdue queries (filters by due_date and active)
CREATE INDEX IF NOT EXISTS idx_equipment_record_due_date_active ON equipment_record(due_date, active) WHERE active = 1 AND deleted_at IS NULL AND due_date IS NOT NULL;

-- Indexes for soft-deleted records filtering
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_business_deleted ON clients(business_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_deleted_at ON sites(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_client_deleted ON sites(client_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_types_deleted_at ON equipment_types(deleted_at) WHERE deleted_at IS NULL;

-- Critical index for authentication (runs on every request)
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at) WHERE expires_at > CURRENT_TIMESTAMP;

-- Index for contact_links queries
CREATE INDEX IF NOT EXISTS idx_contact_links_scope_scope_id ON contact_links(scope, scope_id);

-- Index for notes and attachments
CREATE INDEX IF NOT EXISTS idx_notes_scope_scope_id ON notes(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_attachments_scope_scope_id ON attachments(scope, scope_id);

-- Index for equipment_completions queries
CREATE INDEX IF NOT EXISTS idx_equipment_completions_due_date ON equipment_completions(due_date);

-- Analyze tables to update statistics for query planner
ANALYZE equipment_record;
ANALYZE clients;
ANALYZE sites;
ANALYZE equipment_types;
ANALYZE auth_tokens;
ANALYZE contact_links;
ANALYZE notes;
ANALYZE attachments;

