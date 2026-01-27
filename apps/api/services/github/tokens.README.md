# GitHub App Token Management

Service for managing GitHub App authentication and installation access tokens.

## Overview

GitHub Apps use JWT authentication to obtain installation tokens. These tokens:
- Expire after 1 hour
- Are cached in the database (encrypted)
- Are automatically refreshed when needed
- Provide repository-scoped access

## Configuration

Add to your `.env` file:

```bash
# GitHub App credentials (optional, for GitHub App authentication)
GH_APP_ID=123456
GH_APP_PRIVATE_KEY=LS0tLS1CRUdJTi...  # base64-encoded PEM private key

# Fallback token (optional, used when no installation found)
GH_TOKEN=ghp_xxxxx
```

**Note**: `GH_APP_PRIVATE_KEY` should be the entire PEM private key file, base64-encoded:

```bash
cat github-app-private-key.pem | base64 -w 0
```

## Functions

### `generateGitHubAppJWT(): Promise<string>`

Generates a JWT for GitHub App authentication.

- Signs with RSA private key (RS256)
- Valid for 10 minutes
- Used to authenticate as the GitHub App

**Example:**
```typescript
import { generateGitHubAppJWT } from "@api/services/github/tokens.ts"

const jwt = await generateGitHubAppJWT()
// Use jwt to call GitHub API as the app
```

### `refreshInstallationToken(installationId: number): Promise<string>`

Fetches a new installation access token from GitHub API.

- Calls `POST /app/installations/{id}/access_tokens`
- Encrypts and stores token in database
- Returns plaintext token

**Example:**
```typescript
import { refreshInstallationToken } from "@api/services/github/tokens.ts"

const token = await refreshInstallationToken(12345678)
// token is valid for 1 hour
```

### `getInstallationToken(repoFullName: string): Promise<string>`

Gets installation token for a repository. Smart caching:

- Returns cached token if expires in > 5 minutes
- Refreshes token if expired or expiring soon
- Falls back to `GH_TOKEN` env var if no installation

**Example:**
```typescript
import { getInstallationToken } from "@api/services/github/tokens.ts"

const token = await getInstallationToken("owner/repo")
// Use token to access repository
```

## Database Schema

### `github_installations`

Tracks GitHub App installations:

```sql
CREATE TABLE github_installations (
    id SERIAL PRIMARY KEY,
    user_id INT4 NOT NULL REFERENCES users(id),
    installation_id BIGINT NOT NULL,
    account_login VARCHAR(100) NOT NULL,
    account_type INT2 NOT NULL,  -- 1=user, 2=organization
    repos_access INT2 NOT NULL,  -- 1=all, 2=selected
    suspended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### `github_installation_tokens`

Stores encrypted installation tokens:

```sql
CREATE TABLE github_installation_tokens (
    id SERIAL PRIMARY KEY,
    installation_id INT4 NOT NULL REFERENCES github_installations(id),
    token TEXT NOT NULL,  -- encrypted
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### `github_repos`

Maps repositories to installations:

```sql
CREATE TABLE github_repos (
    id SERIAL PRIMARY KEY,
    installation_id INT4 NOT NULL REFERENCES github_installations(id),
    repo_id BIGINT NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    private BOOLEAN DEFAULT FALSE,
    webhook_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

## Security

- Tokens are encrypted using AES-256-GCM before storage
- Encryption key derived from `AUTH_PEPPER` environment variable
- Private key for JWT signing stored as base64-encoded PEM
- All token operations use HTTPS to GitHub API

## Error Handling

The service throws errors in these cases:

- **Missing credentials**: GitHub App ID or private key not configured
- **Installation not found**: Repository not associated with any installation
- **API errors**: GitHub API returns non-200 response
- **Decryption failures**: Corrupted or tampered token data

## Testing

Run integration tests (requires environment setup):

```bash
deno run --allow-env --allow-net apps/api/services/github/tokens.integration.ts
```

## Flow Diagram

```
┌─────────────────────────────────────────────┐
│ getInstallationToken("owner/repo")          │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │ Find repo in DB    │
         └────────┬───────────┘
                  │
        ┌─────────▼─────────┐
        │ Installation?     │
        └───┬───────────┬───┘
            │           │
       No   │           │ Yes
            │           │
            ▼           ▼
    ┌───────────┐  ┌──────────────┐
    │ GH_TOKEN  │  │ Check cache  │
    └───────────┘  └──────┬───────┘
                          │
                 ┌────────▼────────┐
                 │ Expired?        │
                 └───┬─────────┬───┘
                     │         │
                 Yes │         │ No
                     │         │
                     ▼         ▼
            ┌────────────┐  ┌──────────┐
            │ Refresh    │  │ Decrypt  │
            │ from API   │  │ & Return │
            └──────┬─────┘  └──────────┘
                   │
                   ▼
            ┌──────────────┐
            │ Encrypt &    │
            │ Store in DB  │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ Return token │
            └──────────────┘
```

## GitHub API Reference

- [Creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps)
- [Authenticating as a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
- [Generating installation access tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
