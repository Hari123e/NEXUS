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

-- ==========================================
-- 8. CONVERSATIONS
-- ==========================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    type VARCHAR(20) NOT NULL DEFAULT 'direct'
        CHECK (type IN ('direct', 'group')),

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    direct_user_low UUID REFERENCES users(id) ON DELETE CASCADE,
    direct_user_high UUID REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,

    CHECK (
        (
            type = 'direct'
            AND direct_user_low IS NOT NULL
            AND direct_user_high IS NOT NULL
            AND direct_user_low < direct_user_high
        )
        OR
        (
            type = 'group'
            AND direct_user_low IS NULL
            AND direct_user_high IS NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_direct_conversation
ON conversations (direct_user_low, direct_user_high)
WHERE type = 'direct';


-- ==========================================
-- 9. CONVERSATION MEMBERS
-- ==========================================

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,

    role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),

    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_index
ON conversation_members (user_id);

-- Add role to existing databases safely
ALTER TABLE conversation_members
ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member'
CHECK (role IN ('owner', 'admin', 'member'));

-- Group-specific information
CREATE TABLE IF NOT EXISTS group_details (
    conversation_id UUID PRIMARY KEY
        REFERENCES conversations(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(250) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ==========================================
-- 10. MESSAGES
-- ==========================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,

    sender_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    body TEXT NOT NULL
        CHECK (char_length(body) BETWEEN 1 AND 4000),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS messages_conversation_time_index
ON messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_sender_index
ON messages (sender_id);
