CREATE TABLE github_webhook_events (
    id SERIAL PRIMARY KEY,
    delivery_id VARCHAR(64) NOT NULL,
    event VARCHAR(50) NOT NULL,
    action VARCHAR(50),
    repo_full_name VARCHAR(200),
    payload JSONB NOT NULL,
    status INT2 DEFAULT 1 NOT NULL,
    error TEXT,
    received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT github_webhook_events_status_check CHECK (status = ANY (ARRAY[1, 2, 3, 4]))
);

CREATE UNIQUE INDEX idx_github_webhook_events_delivery_id ON github_webhook_events (delivery_id);
CREATE INDEX idx_github_webhook_events_event ON github_webhook_events (event);
CREATE INDEX idx_github_webhook_events_repo ON github_webhook_events (repo_full_name);
CREATE INDEX idx_github_webhook_events_status ON github_webhook_events (status);

CREATE TABLE github_action_runs (
    id SERIAL PRIMARY KEY,
    webhook_event_id INT4 REFERENCES github_webhook_events(id) ON DELETE SET NULL,
    action_kind INT2 NOT NULL,
    command VARCHAR(200),
    args JSONB,
    status INT2 DEFAULT 1 NOT NULL,
    stdout TEXT,
    stderr TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT github_action_runs_kind_check CHECK (action_kind = ANY (ARRAY[1, 2])),
    CONSTRAINT github_action_runs_status_check CHECK (status = ANY (ARRAY[1, 2, 3, 4]))
);

CREATE INDEX idx_github_action_runs_event_id ON github_action_runs (webhook_event_id);
CREATE INDEX idx_github_action_runs_status ON github_action_runs (status);
