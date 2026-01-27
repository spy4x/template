# GitHub Integration

## Flow
1. User creates repo + project + issue
2. Issue moved to **Ready for AI to work on** → webhook
3. Service runs opencode → opens PR → comments → moves to **Review**
4. User edits issue + moves back to Ready → rerun
5. User moves issue to **Done** → merge PR

## Required
- Webhook to `POST /api/github/webhook`
- Events: issues, issue_comment, projects_v2, projects_v2_item
- Secret: `GH_WEBHOOK_SECRET`
- Run worker: `deno task worker:github`

## Safety
- allowlist repos via `GH_ALLOWED_REPOS` or set `GH_ALLOW_ALL_REPOS=1`
- worker runs gh + opencode; sandbox host

## gh cli auth
- Service host must be logged in (`gh auth login`)
- Minimal scopes: repo, project, read:org (as needed)

## Env
- `GH_ALLOWED_REPOS` allowlist (csv)
- `GH_PROJECT_STATUS_*` status names
- `WORKSPACE_ROOT`
- `OPENCODE_CMD`, `OPENCODE_ARGS`

## Setup steps (user)
1. Create repo, project, issue
2. Add webhook to service
3. Move issue to **Ready for AI to work on**
