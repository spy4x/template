-- =============================================================================
-- GitHub App OAuth Integration
-- =============================================================================
-- Installation tracking, token management, repo access control
-- =============================================================================

CREATE TABLE github_installations (
    id SERIAL PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    account_login VARCHAR(100) NOT NULL,
    account_type INT2 NOT NULL,
    repos_access INT2 NOT NULL,
    suspended BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT github_installations_account_type_check CHECK (account_type = ANY (ARRAY[1, 2])),
    CONSTRAINT github_installations_repos_access_check CHECK (repos_access = ANY (ARRAY[1, 2]))
);

COMMENT ON COLUMN github_installations.account_type IS '1=user, 2=organization';
COMMENT ON COLUMN github_installations.repos_access IS '1=all, 2=selected';

CREATE UNIQUE INDEX idx_github_installations_installation_id ON github_installations (installation_id);
CREATE INDEX idx_github_installations_user_id ON github_installations (user_id);
CREATE INDEX idx_github_installations_account_login ON github_installations (account_login);
CREATE INDEX idx_github_installations_suspended ON github_installations (suspended) WHERE suspended = TRUE;

CREATE TABLE github_installation_tokens (
    id SERIAL PRIMARY KEY,
    installation_id INT4 NOT NULL REFERENCES github_installations(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX idx_github_installation_tokens_installation_id ON github_installation_tokens (installation_id);
CREATE INDEX idx_github_installation_tokens_expires_at ON github_installation_tokens (expires_at);

CREATE TABLE github_repos (
    id SERIAL PRIMARY KEY,
    installation_id INT4 NOT NULL REFERENCES github_installations(id) ON DELETE CASCADE,
    repo_id BIGINT NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    private BOOLEAN DEFAULT FALSE NOT NULL,
    webhook_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX idx_github_repos_repo_id ON github_repos (repo_id);
CREATE INDEX idx_github_repos_installation_id ON github_repos (installation_id);
CREATE INDEX idx_github_repos_full_name ON github_repos (repo_full_name);
CREATE INDEX idx_github_repos_webhook_enabled ON github_repos (webhook_enabled) WHERE webhook_enabled = TRUE;

-- Add OAuth columns to existing github_action_runs table
ALTER TABLE github_action_runs
    ADD COLUMN user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN installation_id INT4 REFERENCES github_installations(id) ON DELETE SET NULL;

CREATE INDEX idx_github_action_runs_user_id ON github_action_runs (user_id);
CREATE INDEX idx_github_action_runs_installation_id ON github_action_runs (installation_id);
