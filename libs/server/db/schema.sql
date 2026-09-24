-- =============================================================================
-- Template Database Schema
-- =============================================================================
-- Auth + web push core
-- Enums start at 1
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS plpgsql;

CREATE TABLE migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Sign-in tables: AUTH_POSTGRES_SCHEMA of @spy4x/server 1.0.0 (auth/postgres).
CREATE TABLE auth_users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- One row per proven address: the user who owns it. The primary key is the one-owner rule.
CREATE TABLE auth_email_owners (
  email text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  CONSTRAINT auth_email_owners_email_user_key UNIQUE (email, user_id)
);

CREATE INDEX auth_email_owners_user_id_idx ON auth_email_owners (user_id);

CREATE TABLE auth_keys (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  method text NOT NULL,
  subject text NOT NULL,
  email text,
  secret text,
  proven_at timestamptz,
  -- The address, only while the key is proven. Referenced below, so a proven key's address is
  -- always owned by the key's own user.
  proven_email text GENERATED ALWAYS AS (CASE WHEN proven_at IS NULL THEN NULL ELSE email END) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_keys_method_subject_key UNIQUE (method, subject),
  CONSTRAINT auth_keys_id_user_key UNIQUE (id, user_id),
  CONSTRAINT auth_keys_proven_email_owner_fkey FOREIGN KEY (proven_email, user_id)
    REFERENCES auth_email_owners (email, user_id),
  CONSTRAINT auth_keys_method_check CHECK (length(method) BETWEEN 1 AND 64),
  CONSTRAINT auth_keys_subject_check CHECK (length(subject) BETWEEN 1 AND 255),
  CONSTRAINT auth_keys_email_check CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  CONSTRAINT auth_keys_secret_check CHECK (length(secret) BETWEEN 1 AND 1024),
  CONSTRAINT auth_keys_proven_email_check CHECK (proven_at IS NULL OR email IS NOT NULL)
);

CREATE INDEX auth_keys_user_id_idx ON auth_keys (user_id);
CREATE INDEX auth_keys_email_idx ON auth_keys (email) WHERE email IS NOT NULL;

-- Status: 1 = active, 2 = expired, 3 = signed out. Second factor: 1 = not required, 2 = pending,
-- 3 = completed. The values of SessionStatus and SecondFactorStatus in @spy4x/server/sign-in.
CREATE TABLE auth_sessions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  key_id integer NOT NULL,
  token_hash text NOT NULL,
  status smallint NOT NULL,
  second_factor smallint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_key_fkey FOREIGN KEY (key_id, user_id)
    REFERENCES auth_keys (id, user_id) ON DELETE CASCADE,
  CONSTRAINT auth_sessions_status_check CHECK (status IN (1, 2, 3)),
  CONSTRAINT auth_sessions_second_factor_check CHECK (second_factor IN (1, 2, 3))
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_key_id_idx ON auth_sessions (key_id);
CREATE INDEX auth_sessions_active_expires_at_idx ON auth_sessions (expires_at) WHERE status = 1;

-- Guess-counted challenges. Expired rows are harmless and may be deleted at any time:
-- DELETE FROM auth_challenges WHERE expires_at <= now()
CREATE TABLE auth_challenges (
  purpose text NOT NULL,
  subject text NOT NULL,
  secret_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (purpose, subject),
  CONSTRAINT auth_challenges_purpose_check CHECK (length(purpose) BETWEEN 1 AND 64),
  CONSTRAINT auth_challenges_subject_check CHECK (length(subject) BETWEEN 1 AND 255),
  CONSTRAINT auth_challenges_secret_hash_check CHECK (length(secret_hash) BETWEEN 1 AND 1024),
  CONSTRAINT auth_challenges_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX auth_challenges_expires_at_idx ON auth_challenges (expires_at);

CREATE TABLE users (
    id INT4 PRIMARY KEY,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    role INT2 DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    mfa INT2 DEFAULT 1 NOT NULL,
    CONSTRAINT users_role_check CHECK (role >= 1 AND role <= 4),
    CONSTRAINT users_mfa_check CHECK (mfa = ANY (ARRAY[1, 2, 3])),
    CONSTRAINT users_id_auth_users_fkey FOREIGN KEY (id) REFERENCES auth_users (id)
        ON DELETE CASCADE
);

COMMENT ON COLUMN users.role IS '1=viewer, 2=operator, 3=supervisor, 4=administrator';
COMMENT ON COLUMN users.mfa IS '1=not_configured, 2=confuration_not_finished, 3=configured';

CREATE TABLE groups (
    id UUID PRIMARY KEY,
    kind INT2 NOT NULL,
    name VARCHAR(100) NOT NULL,
    owner_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    authorization_revision BIGINT DEFAULT 1 NOT NULL,
    next_change_sequence BIGINT DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT groups_kind_check CHECK (kind = ANY (ARRAY[1, 2])),
    CONSTRAINT groups_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT groups_authorization_revision_check CHECK (authorization_revision >= 1),
    CONSTRAINT groups_next_change_sequence_check CHECK (next_change_sequence >= 1)
);

COMMENT ON COLUMN groups.kind IS '1=personal, 2=shared';

CREATE UNIQUE INDEX idx_groups_one_active_personal_per_user
    ON groups (owner_user_id)
    WHERE kind = 1 AND deleted_at IS NULL;
CREATE INDEX idx_groups_kind_created_id ON groups (kind, created_at, id);
CREATE INDEX idx_groups_updated_id_active
    ON groups (updated_at DESC, id)
    WHERE deleted_at IS NULL;

CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    added_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);

COMMENT ON COLUMN group_members.role IS '1=viewer, 2=editor, 3=admin, 4=owner';

CREATE INDEX idx_group_members_user_group_role
    ON group_members (user_id, group_id) INCLUDE (role);
CREATE INDEX idx_group_members_group_role ON group_members (group_id, role);

-- The personal-group invariant (exactly one member, the owner, with role 4) is
-- enforced by the repository inside the creating transaction, not by triggers.
-- idx_groups_one_active_personal_per_user still guarantees at most one active
-- personal group per user declaratively.

CREATE TABLE user_totp (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ,
    last_accepted_step INT4,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_totp_secret_check CHECK (length(secret) BETWEEN 1 AND 256),
    CONSTRAINT user_totp_last_accepted_step_check CHECK (last_accepted_step >= 0)
);

CREATE TABLE user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT4 REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(256) NOT NULL,
    endpoint VARCHAR(256) NOT NULL,
    auth VARCHAR(256) NOT NULL,
    p256dh VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_user_push_tokens_by_deleted_at ON user_push_tokens (deleted_at);
CREATE INDEX idx_user_push_tokens_by_user_id_deleted_at ON user_push_tokens (user_id, deleted_at);
CREATE INDEX idx_user_push_tokens_by_device_user ON user_push_tokens (device_id, user_id);

CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_kind VARCHAR(64) NOT NULL,
    actor_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    request_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT audit_events_kind_check CHECK (length(btrim(event_kind)) BETWEEN 1 AND 64)
);

-- Deliberately not unique: an audit log must be able to record the same kind of
-- event for a group more than once.
CREATE INDEX idx_audit_events_group_kind_created
    ON audit_events (group_id, event_kind, created_at DESC);
CREATE INDEX idx_audit_events_actor_created
    ON audit_events (actor_user_id, created_at DESC, id DESC);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_kind VARCHAR(64) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    actor_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attempt_count INT4 DEFAULT 0 NOT NULL,
    available_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    claimed_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    last_error_code VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT outbox_events_kind_check CHECK (length(btrim(event_kind)) BETWEEN 1 AND 64),
    CONSTRAINT outbox_events_aggregate_type_check CHECK (
        length(btrim(aggregate_type)) BETWEEN 1 AND 64
    ),
    CONSTRAINT outbox_events_aggregate_version_check CHECK (aggregate_version >= 1),
    CONSTRAINT outbox_events_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX idx_outbox_events_aggregate_version_kind
    ON outbox_events (aggregate_type, aggregate_id, aggregate_version, event_kind);
CREATE INDEX idx_outbox_events_available
    ON outbox_events (available_at, created_at)
    WHERE processed_at IS NULL;
