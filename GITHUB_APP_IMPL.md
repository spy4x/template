# GitHub App Implementation Guide

## Current State

✅ **Backend Infrastructure Complete** (PR #3)
- GitHub App JWT authentication (RS256)
- Installation token management with caching
- Encrypted token storage (AES-256-GCM)
- Database schema for installations, repos, tokens
- Security fixes applied

❌ **Frontend OAuth Flow Missing**
- No "Connect GitHub" button in UI
- No OAuth callback handling
- Manual DB insertion required to link users to installations

## What You Get After Setup

Once connected, users can:
- Trigger OpenCode bot on their repos via webhooks
- Bot gets repo-scoped access tokens automatically
- Tokens refresh transparently when expired
- Each user controls which repos to grant access

## Setup Options

### Option 1: Personal Access Token (Quick & Simple)

**Best for**: Single user, testing, or when you control all repos

1. Create token: https://github.com/settings/tokens/new
2. Grant scopes: `repo`, `workflow`
3. Add to `.env`:
   ```bash
   GH_TOKEN=ghp_your_token_here
   ```
4. Restart: `deno task compose up -d`
5. ✅ All repos accessible by this token now work

**Limitations**: Single token for all users, no per-user permissions

---

### Option 2: GitHub App (Recommended, Multi-User)

**Best for**: Multiple users, production, fine-grained permissions

#### Step 1: Create GitHub App

1. Go to: https://github.com/settings/apps/new

2. Fill in form:
   ```
   GitHub App name: YourApp OpenCode Bot
   Homepage URL: https://your-domain.com
   Callback URL: https://your-domain.com/api/github/oauth/callback
   Webhook URL: https://your-domain.com/api/github
   Webhook secret: <generate random string, save it>
   ```

3. **Repository Permissions**:
   - Contents: Read & write
   - Pull requests: Read & write  
   - Issues: Read & write
   - Workflows: Read & write
   - Metadata: Read-only (auto-granted)

4. **Subscribe to events**:
   - `push`
   - `pull_request`
   - `issues`
   - `installation`
   - `installation_repositories`

5. **Where can this GitHub App be installed?**
   - Select: "Any account"

6. Click **Create GitHub App**

7. Note the **App ID** (e.g., `123456`)

8. Scroll down → **Generate a private key** → Download `.pem` file

#### Step 2: Configure Environment

```bash
# Convert PEM to base64
cat github-app-private-key.pem | base64 -w 0

# Add to infra/envs/.env (on server) or infra/envs/.env.prod
GH_APP_ID=123456
GH_APP_PRIVATE_KEY=LS0tLS1CRUdJTi... # base64-encoded PEM
GH_WEBHOOK_SECRET=your_webhook_secret_from_step1
GH_WEBHOOK_ENFORCE=1  # Enable webhook signature verification
```

#### Step 3: Deploy & Run Migration

```bash
# Deploy updated .env
deno task deploy

# SSH to server
ssh your-server

# Run migration
cd /var/app
ENV=prod deno run -N -E -R=./libs/server/db/migrations libs/server/db/migrate.ts

# Restart services
deno run compose up -d --build
```

#### Step 4: Test Webhook

```bash
# Check logs
docker compose -f infra/compose/compose.shared.yml logs -f api

# Send test webhook from GitHub App settings page
# Should see: "GitHub webhook received" in logs
```

#### Step 5: Install App on Repos

1. Go to: `https://github.com/settings/apps/your-app-name/installations`
2. Click **Install App**
3. Select account (personal or org)
4. Choose:
   - All repositories, OR
   - Only select repositories
5. Click **Install**
6. You'll be redirected to: `https://your-domain.com/api/github/oauth/callback?installation_id=12345678&setup_action=install`

⚠️ **Manual Step Required** (until OAuth frontend is built):

Note the `installation_id` from the URL, then insert into DB:

```sql
-- Link installation to your user
INSERT INTO github_installations 
  (user_id, installation_id, account_login, account_type, repos_access, suspended)
VALUES 
  (1, 12345678, 'your-github-username', 1, 2, false);
  -- user_id: Your user ID from users table
  -- installation_id: From callback URL
  -- account_login: Your GitHub username
  -- account_type: 1=user, 2=organization
  -- repos_access: 1=all repos, 2=selected repos

-- Get installation internal ID
SELECT id FROM github_installations WHERE installation_id = 12345678;

-- Add repos (repeat for each repo)
INSERT INTO github_repos
  (installation_id, repo_id, repo_full_name, private, webhook_enabled)
VALUES
  (1, 987654321, 'your-username/your-repo', false, true);
  -- installation_id: Internal ID from query above (not GitHub's installation_id!)
  -- repo_id: GitHub repo ID (find in repo settings or API)
  -- repo_full_name: owner/repo format
  -- private: true/false
```

#### Step 6: Test Token Generation

```bash
# Test JWT generation
deno run -A --env-file=infra/envs/.env apps/api/services/github/tokens.integration.ts

# Should output:
# ✓ Algorithm: RS256
# ✓ Issuer: 123456
# ✓ Expires in: 10 minutes
```

---

## What's Missing: OAuth Frontend Flow

### User Experience We Want

1. User goes to `/profile` page
2. Clicks "Connect GitHub" button
3. Redirected to GitHub App installation page
4. Grants access to repos
5. Redirected back to app
6. **Installation automatically linked to user** ✅
7. User sees connected repos in UI
8. Can disconnect/modify repo access

### Implementation Tasks

#### 1. OAuth Callback Route
**File**: `apps/api/routes/github.ts`

```typescript
// Add route
app.get('/oauth/callback', async (c) => {
  const installationId = c.req.query('installation_id')
  const setupAction = c.req.query('setup_action') // 'install' or 'update'
  
  // Get user from session
  const user = c.get('user')
  if (!user) {
    return c.redirect('/sign-in?error=auth_required')
  }
  
  // Fetch installation details from GitHub API
  const jwt = await generateGitHubAppJWT()
  const installation = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
      }
    }
  ).then(r => r.json())
  
  // Fetch accessible repos
  const repos = await fetch(
    `https://api.github.com/installation/repositories`,
    {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
      }
    }
  ).then(r => r.json())
  
  // Store in DB
  await db.githubInstallation.upsert({
    userId: user.id,
    installationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type === 'User' ? 1 : 2,
    reposAccess: installation.repository_selection === 'all' ? 1 : 2,
  })
  
  // Store repos
  for (const repo of repos.repositories) {
    await db.githubRepo.upsert({
      installationId: installation.id,
      repoId: repo.id,
      repoFullName: repo.full_name,
      private: repo.private,
    })
  }
  
  // Redirect to profile with success message
  return c.redirect('/profile?github_connected=true')
})
```

#### 2. Webhook Handler for Installation Events
**File**: `apps/api/services/github/handler.ts`

Add handlers for:
- `installation.created` → Insert into DB
- `installation.deleted` → Mark as suspended
- `installation_repositories.added` → Add repos
- `installation_repositories.removed` → Remove repos

#### 3. Frontend UI Components
**File**: `apps/web/src/views/ProfileView.tsx`

```tsx
// Add to profile page
<section>
  <h2>GitHub Integration</h2>
  {!githubConnected ? (
    <button onClick={connectGitHub}>
      Connect GitHub
    </button>
  ) : (
    <>
      <p>Connected as: {githubAccount}</p>
      <ul>
        {connectedRepos.map(repo => (
          <li key={repo.id}>{repo.fullName}</li>
        ))}
      </ul>
      <button onClick={disconnectGitHub}>
        Disconnect GitHub
      </button>
    </>
  )}
</section>
```

#### 4. API Endpoints
**File**: `apps/api/routes/github.ts`

```typescript
// GET /api/github/installations - List user's installations
app.get('/installations', authRequired, async (c) => {
  const user = c.get('user')
  const installations = await db.githubInstallation.findByUserId(user.id)
  return c.json(installations)
})

// GET /api/github/repos - List accessible repos
app.get('/repos', authRequired, async (c) => {
  const user = c.get('user')
  const repos = await db.githubRepo.findByUserId(user.id)
  return c.json(repos)
})

// DELETE /api/github/installations/:id - Disconnect installation
app.delete('/installations/:id', authRequired, async (c) => {
  const user = c.get('user')
  const installationId = c.req.param('id')
  
  // Verify ownership
  const installation = await db.githubInstallation.findById(installationId)
  if (installation.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  
  // Mark as suspended (keep history)
  await db.githubInstallation.suspend(installationId)
  
  return c.json({ success: true })
})
```

#### 5. Database Methods
**File**: `apps/api/services/db.ts`

```typescript
githubInstallation = {
  findByUserId: async (userId: number) => { /* ... */ },
  upsert: async (data) => { /* ... */ },
  suspend: async (id: number) => { /* ... */ },
}

githubRepo = {
  findByUserId: async (userId: number) => { /* ... */ },
  upsert: async (data) => { /* ... */ },
}
```

#### 6. CQRS Events (Optional but Recommended)
**File**: `apps/api/cqrs/events.ts`

```typescript
export class GitHubInstallationConnected implements Event {
  constructor(public data: {
    userId: number
    installationId: number
    accountLogin: string
    repoCount: number
  }) {}
}

export class GitHubInstallationDisconnected implements Event {
  constructor(public data: {
    userId: number
    installationId: number
  }) {}
}
```

---

## Testing Checklist

### Backend (Already Done ✅)
- [x] JWT generation works
- [x] Token refresh works
- [x] Token caching works (5-min expiry buffer)
- [x] Encryption/decryption works
- [x] Database schema created
- [x] Security review passed

### Frontend (TODO ❌)
- [ ] User can click "Connect GitHub"
- [ ] OAuth flow redirects to GitHub
- [ ] Callback stores installation in DB
- [ ] User sees connected repos
- [ ] User can disconnect GitHub
- [ ] Webhook events update DB automatically

### Integration (TODO ❌)
- [ ] Bot can access user's repos via installation tokens
- [ ] Tokens refresh automatically when expired
- [ ] Suspended installations fallback to GH_TOKEN
- [ ] Multiple users can have separate installations

---

## Security Considerations

✅ **Already Implemented**:
- Tokens encrypted at rest (AES-256-GCM)
- Proper base64 encoding (no binary issues)
- Input validation on installation IDs
- Error message sanitization (no API leaks)
- DB FK constraints and indexes
- Webhook signature verification

⚠️ **TODO for OAuth Flow**:
- CSRF protection on OAuth callback (state parameter)
- Rate limiting on installation endpoints
- Audit log for installations (who connected when)
- User cannot access other users' installations

---

## Deployment Notes

### Environment Variables
```bash
# Required for GitHub App
GH_APP_ID=123456
GH_APP_PRIVATE_KEY=base64_encoded_pem
GH_WEBHOOK_SECRET=random_string

# Optional (fallback for non-installed repos)
GH_TOKEN=ghp_personal_access_token

# Existing (used for encryption)
AUTH_PEPPER=random_string  # Must not change after first use!
```

### Database Migration
```sql
-- Already created in PR #3:
-- - github_installations
-- - github_installation_tokens  
-- - github_repos
-- Modified: github_action_runs (added user_id, installation_id)
```

### Monitoring
```bash
# Watch for token refresh errors
docker compose logs -f api | grep "Failed to refresh installation token"

# Watch for webhook events
docker compose logs -f api | grep "GitHub webhook"

# Check token expiry
SELECT installation_id, expires_at, 
       EXTRACT(EPOCH FROM (expires_at - NOW()))/60 as minutes_until_expiry
FROM github_installation_tokens
WHERE expires_at < NOW() + INTERVAL '10 minutes';
```

---

## Next Steps

1. **Immediate** (to make it usable):
   - Implement OAuth callback route
   - Add "Connect GitHub" button to profile page
   - Test end-to-end flow

2. **Short-term** (polish):
   - Handle installation webhook events
   - Show connected repos in UI
   - Add disconnect functionality

3. **Long-term** (nice-to-have):
   - Repo selection UI (when user has many repos)
   - Installation health monitoring
   - Token usage analytics
   - Multi-installation support (user + orgs)

---

## Questions for Implementation

1. **Where should "Connect GitHub" button live?**
   - Profile page? ✅ (Recommended)
   - Dedicated "Integrations" page?
   - Both?

2. **What happens if user uninstalls app on GitHub?**
   - Webhook marks installation as suspended ✅ (Recommended)
   - User gets notification?
   - Fallback to GH_TOKEN silently?

3. **Should we support multiple installations per user?**
   - User can install on personal account + multiple orgs
   - Current schema supports this ✅
   - UI needs to show all installations

4. **Repo access verification:**
   - Re-fetch repos from GitHub on each request? (slow but accurate)
   - Cache in DB and sync via webhooks? ✅ (Recommended)
   - TTL-based cache invalidation? (30 min?)

---

## References

- [GitHub App Authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Installation Access Tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
- [Webhook Events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- PR #3: Backend implementation (this branch)
- `apps/api/services/github/tokens.README.md`: Detailed token management docs
