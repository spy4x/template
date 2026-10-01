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
    name VARCHAR(100) NOT NULL,
    owner_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    authorization_revision BIGINT DEFAULT 1 NOT NULL,
    next_change_sequence BIGINT DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT groups_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT groups_authorization_revision_check CHECK (authorization_revision >= 1),
    CONSTRAINT groups_next_change_sequence_check CHECK (next_change_sequence >= 1)
);

CREATE INDEX idx_groups_updated_id_active
    ON groups (updated_at DESC, id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_groups_deleted_at ON groups (deleted_at) WHERE deleted_at IS NOT NULL;

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

CREATE TABLE user_totp (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ,
    last_accepted_step INT4,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    failed_attempts INT4 DEFAULT 0 NOT NULL,
    locked_until TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    CONSTRAINT user_totp_secret_check CHECK (length(secret) BETWEEN 1 AND 256),
    CONSTRAINT user_totp_last_accepted_step_check CHECK (last_accepted_step >= 0),
    CONSTRAINT user_totp_failed_attempts_check CHECK (failed_attempts >= 0)
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
CREATE UNIQUE INDEX idx_user_push_tokens_live_by_user_device
    ON user_push_tokens (user_id, device_id)
    WHERE deleted_at IS NULL;

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
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    actor_user_id INT4 REFERENCES users(id) ON DELETE RESTRICT,
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
    CONSTRAINT outbox_events_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT outbox_events_group_actor_check CHECK ((group_id IS NULL) = (actor_user_id IS NULL))
);

CREATE UNIQUE INDEX idx_outbox_events_aggregate_version_kind
    ON outbox_events (aggregate_type, aggregate_id, aggregate_version, event_kind);
CREATE INDEX idx_outbox_events_available
    ON outbox_events (available_at, created_at)
    WHERE processed_at IS NULL;

-- One row per command a client sent with an idempotency key (ADR 002, "Idempotency"). A retry
-- with the same key returns `result` instead of running the command again.
--
-- `status` is 1 while the first run is in flight and 2 once its result is stored. `updated_at`
-- is when the row was claimed or finished; a claim that stays at 1 past its lease belongs to a
-- run that died, and the next retry takes it over under a new `claim_token`; `complete` and
-- `release` change only the row whose token they hold. The token's default serves only the previous
-- API during a deploy (see migration 2026_10_03_0001). Rows older than seven days are removed by
-- the worker's sweep and are ignored by readers before that.
--
-- The key is scoped to the user, so one user cannot replay or block another user's key.
-- `request_hash` fingerprints the command's input: the same key with different input is refused
-- instead of answered with the first command's result.
CREATE TABLE idempotency_keys (
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(128) NOT NULL,
    command_name VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status INT2 NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
    PRIMARY KEY (user_id, key),
    CONSTRAINT idempotency_keys_key_check CHECK (length(key) BETWEEN 1 AND 128),
    CONSTRAINT idempotency_keys_status_check CHECK (status = ANY (ARRAY[1, 2])),
    CONSTRAINT idempotency_keys_done_has_result_check CHECK (status = 1 OR result IS NOT NULL)
);

COMMENT ON COLUMN idempotency_keys.status IS '1=started, 2=done';

CREATE INDEX idx_idempotency_keys_created ON idempotency_keys (created_at);

-- Notes: the reference aggregate (docs/aggregates.md). See migration 2026_10_02_0001_notes.sql.
CREATE TABLE notes (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    body TEXT DEFAULT '' NOT NULL,
    version INT4 DEFAULT 1 NOT NULL,
    change_sequence BIGINT NOT NULL,
    created_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ(3),
    CONSTRAINT notes_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT notes_body_check CHECK (length(body) <= 10000),
    CONSTRAINT notes_version_check CHECK (version >= 1),
    CONSTRAINT notes_change_sequence_check CHECK (change_sequence >= 1)
);

-- The list: a group's live notes, newest first, paged by (updated_at, id).
CREATE INDEX idx_notes_group_updated_id_active
    ON notes (group_id, updated_at DESC, id)
    WHERE deleted_at IS NULL;
-- A future pull by cursor: a group's notes changed after a sequence, deleted ones included.
CREATE INDEX idx_notes_group_change_sequence ON notes (group_id, change_sequence);
CREATE INDEX idx_notes_created_by ON notes (created_by_user_id);
CREATE INDEX idx_notes_updated_by ON notes (updated_by_user_id);

-- Per-user settings. See migration 2026_10_05_0001_user_settings.sql.
-- `version` grows by one with every change of the selection. It is not the sequence of a hint: the
-- selection's hint is sent by `GroupSelectedEvent`, from the handler.
CREATE TABLE user_settings (
    user_id INT4 PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    version INT4 DEFAULT 1 NOT NULL,
    updated_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_settings_version_check CHECK (version >= 1)
);

CREATE INDEX idx_user_settings_selected_group
    ON user_settings (selected_group_id)
    WHERE selected_group_id IS NOT NULL;

-- Password reset by e-mail. See migration 2026_10_06_0001_password_reset.sql.
CREATE TABLE password_reset_requests (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT password_reset_requests_email_check CHECK (length(email) BETWEEN 3 AND 254)
);

-- Development only: the worker copies every mail here with ENV=dev, for the e2e specs.
CREATE TABLE dev_mail (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX dev_mail_to_address_idx ON dev_mail (to_address, id);
