UPDATE user_keys
SET identification = lower(btrim(identification));

CREATE UNIQUE INDEX idx_user_keys_kind_identification
    ON user_keys (kind, identification);

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

CREATE FUNCTION assert_personal_group_membership(checked_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    personal_owner_user_id INT4;
    member_count INT4;
    owner_member_count INT4;
BEGIN
    SELECT owner_user_id
    INTO personal_owner_user_id
    FROM groups
    WHERE id = checked_group_id AND kind = 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*)::INT4,
        COUNT(*) FILTER (
            WHERE user_id = personal_owner_user_id AND role = 4
        )::INT4
    INTO member_count, owner_member_count
    FROM group_members
    WHERE group_id = checked_group_id;

    IF member_count <> 1 OR owner_member_count <> 1 THEN
        RAISE EXCEPTION 'personal group must have exactly one owner membership'
            USING ERRCODE = '23514', CONSTRAINT = 'personal_group_owner_membership_check';
    END IF;
END;
$$;

CREATE FUNCTION check_personal_group_membership_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM assert_personal_group_membership(OLD.group_id);
    ELSIF TG_TABLE_NAME = 'groups' THEN
        PERFORM assert_personal_group_membership(NEW.id);
        IF TG_OP = 'UPDATE' AND OLD.id <> NEW.id THEN
            PERFORM assert_personal_group_membership(OLD.id);
        END IF;
    ELSE
        PERFORM assert_personal_group_membership(NEW.group_id);
        IF TG_OP = 'UPDATE' AND OLD.group_id <> NEW.group_id THEN
            PERFORM assert_personal_group_membership(OLD.group_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER groups_personal_membership_check
AFTER INSERT OR UPDATE ON groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_personal_group_membership_trigger();

CREATE CONSTRAINT TRIGGER group_members_personal_membership_check
AFTER INSERT OR UPDATE OR DELETE ON group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_personal_group_membership_trigger();

CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_kind VARCHAR(64) NOT NULL,
    actor_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    request_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT audit_events_kind_check CHECK (length(btrim(event_kind)) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX idx_audit_events_group_kind ON audit_events (group_id, event_kind);
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
