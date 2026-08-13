-- ==============================================================================
-- AduanFlow Supabase PostgreSQL Database Schema
-- ==============================================================================
-- 
-- Instructions:
-- 1. Open your Supabase Project Dashboard.
-- 2. Navigate to the "SQL Editor" on the left sidebar.
-- 3. Create a new query, paste the contents of this file, and click "RUN".
-- 
-- This schema accurately matches the SQLModel schema defined in the codebase.
-- ==============================================================================

-- 1. Table: dispute_cases
CREATE TABLE IF NOT EXISTS dispute_cases (
    id VARCHAR NOT NULL,
    customer_name VARCHAR NOT NULL,
    customer_email VARCHAR NOT NULL,
    masked_account VARCHAR NOT NULL,
    masked_card VARCHAR,
    category VARCHAR NOT NULL,
    urgency VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    verification_result VARCHAR,
    amount DOUBLE PRECISION NOT NULL,
    assigned_to VARCHAR,
    received_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    due_date TIMESTAMP WITHOUT TIME ZONE,
    processing_time VARCHAR,
    email_subject VARCHAR,
    email_body VARCHAR,
    gmail_msg_id VARCHAR UNIQUE,
    nric_encrypted VARCHAR,
    account_number_encrypted VARCHAR,
    card_number_encrypted VARCHAR,
    dispute_amount_encrypted VARCHAR,
    ocr_results JSON,
    classification JSON,
    verification JSON,
    financial_resolution JSON,
    communication JSON,
    audit_log JSON,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_dispute_cases_customer_name ON dispute_cases (customer_name);
CREATE INDEX IF NOT EXISTS ix_dispute_cases_category ON dispute_cases (category);
CREATE INDEX IF NOT EXISTS ix_dispute_cases_status ON dispute_cases (status);

-- 2. Table: audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR NOT NULL,
    case_id VARCHAR NOT NULL,
    actor VARCHAR NOT NULL,
    action VARCHAR NOT NULL,
    detail VARCHAR,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_case_id ON audit_logs (case_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_actor ON audit_logs (actor);

-- 3. Table: copilot_conversations
CREATE TABLE IF NOT EXISTS copilot_conversations (
    id VARCHAR NOT NULL,
    title VARCHAR,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);

-- 4. Table: copilot_messages
CREATE TABLE IF NOT EXISTS copilot_messages (
    id VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    content TEXT NOT NULL,
    conversation_id VARCHAR NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_copilot_messages_conversation_id ON copilot_messages (conversation_id);

-- 5. Table: system_settings
CREATE TABLE IF NOT EXISTS system_settings (
    id VARCHAR NOT NULL,
    gmail_email VARCHAR,
    gmail_refresh_token_encrypted VARCHAR,
    is_gmail_connected BOOLEAN NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);

-- 6. Table: users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL NOT NULL,
    username VARCHAR UNIQUE NOT NULL,
    email VARCHAR NOT NULL,
    full_name VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    department VARCHAR NOT NULL,
    is_active BOOLEAN NOT NULL,
    hashed_password VARCHAR NOT NULL,
    email_enabled BOOLEAN NOT NULL,
    quiet_hours BOOLEAN NOT NULL,
    notif_case_assigned BOOLEAN NOT NULL,
    notif_status_changed BOOLEAN NOT NULL,
    notif_sla_breach BOOLEAN NOT NULL,
    notif_manual_review BOOLEAN NOT NULL,
    notif_weekly_digest BOOLEAN NOT NULL,
    sec_2fa BOOLEAN NOT NULL,
    totp_secret VARCHAR,
    sec_password_expiry BOOLEAN NOT NULL,
    password_changed_at TIMESTAMP WITHOUT TIME ZONE,
    sec_ip_allowlist BOOLEAN NOT NULL,
    sec_ip_ranges VARCHAR,
    sec_new_device_alert BOOLEAN NOT NULL,
    sec_session_timeout VARCHAR NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);

-- 7. Table: user_sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL NOT NULL,
    user_id INTEGER NOT NULL,
    session_token VARCHAR NOT NULL,
    browser VARCHAR NOT NULL,
    os VARCHAR NOT NULL,
    device_label VARCHAR NOT NULL,
    ip_address VARCHAR NOT NULL,
    location VARCHAR NOT NULL,
    is_active BOOLEAN NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_user_sessions_session_token ON user_sessions (session_token);

-- 8. Default Users Seed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (
  username,
  email, 
  full_name, 
  role, 
  department, 
  is_active, 
  hashed_password,
  email_enabled, quiet_hours, notif_case_assigned, notif_status_changed,
  notif_sla_breach, notif_manual_review, notif_weekly_digest,
  sec_2fa, totp_secret, sec_password_expiry, password_changed_at, sec_ip_allowlist, sec_ip_ranges, sec_new_device_alert,
  sec_session_timeout, created_at, updated_at
) VALUES 
(
  'admin',
  'admin@aduanflow.com', 
  'System Administrator', 
  'admin', 
  'Dispute Resolution Taskforce', 
  true, 
  encode(digest('admin123', 'sha256'), 'hex'), 
  true, false, true, true, true, false, true, false, NULL, false, NULL, false, NULL, true, '30', NOW(), NOW()
) ON CONFLICT (email) DO NOTHING;
