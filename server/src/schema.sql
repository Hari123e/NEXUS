-- ==========================================
-- NEXUS DATABASE SCHEMA
-- Version 1.0
-- ==========================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    username VARCHAR(30) NOT NULL,
    password_hash TEXT NOT NULL,

    role VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (role IN ('user', 'super_admin')),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Usernames are case-insensitive and unique.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
ON users (LOWER(username));


-- 2. INVITATIONS
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    token_hash BYTEA NOT NULL UNIQUE,

    created_by UUID REFERENCES users(id)
        ON DELETE SET NULL,

    max_uses INTEGER NOT NULL DEFAULT 1
        CHECK (max_uses > 0),

    uses INTEGER NOT NULL DEFAULT 0
        CHECK (uses >= 0 AND uses <= max_uses),

    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invitations_expiry_index
ON invitations (expires_at);


-- 3. DEVICES
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,

    device_name VARCHAR(100) NOT NULL,

    identity_key BYTEA NOT NULL,
    signing_key BYTEA NOT NULL,

    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            verification_status IN (
                'pending',
                'verified',
                'revoked'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS devices_user_index
ON devices (user_id);


-- 4. SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,

    device_id UUID REFERENCES devices(id)
        ON DELETE SET NULL,

    token_hash BYTEA NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_index
ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expiry_index
ON sessions (expires_at);


-- 5. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    actor_user_id UUID REFERENCES users(id)
        ON DELETE SET NULL,

    target_user_id UUID REFERENCES users(id)
        ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,

    details JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_index
ON audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_index
ON audit_logs (created_at);

-- ==========================================
-- 6. CONTACT REQUESTS
-- ==========================================

CREATE TABLE IF NOT EXISTS contact_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    recipient_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'accepted',
                'rejected',
                'cancelled'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS contact_requests_recipient_index
ON contact_requests (recipient_id, status);

CREATE INDEX IF NOT EXISTS contact_requests_sender_index
ON contact_requests (sender_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_contact_request
ON contact_requests (
    LEAST(sender_id, recipient_id),
    GREATEST(sender_id, recipient_id)
)
WHERE status = 'pending';


-- ==========================================
-- 7. ACCEPTED CONTACTS
-- ==========================================

CREATE TABLE IF NOT EXISTS contacts (
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    contact_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, contact_user_id),

    CHECK (user_id <> contact_user_id)
);

CREATE INDEX IF NOT EXISTS contacts_contact_user_index
ON contacts (contact_user_id);


-- ==========================================
-- END OF NEXUS SCHEMA
-- ==========================================
