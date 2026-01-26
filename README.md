# Tampines Hackathon Tool

Tool/server that connects to other repos. Triggered by GitHub Issues/Projects actions. Uses existing Deno-first monorepo infra. Decisions tracked in GitHub issues.

## Goals
- ship a demoable MVP in 48h
- keep structure, security, auditability
- avoid hard-lock tech choices when uncertain

## Scope (MVP)
- tool/server API for multi-repo orchestration
- issue/project event triggers
- API + persistent storage
- tests + CI placeholder
- schedule/automation placeholder

## Detected tech stack (team decision)
- Runtime: Deno
- API: Hono
- Web: Preact + Vite + Tailwind
- Data: Postgres, Valkey
- Infra: compose + deploy scripts
- GitHub integration: gh cli (preferred)

## Repo map
- `apps/api`: REST + WS-ready API
- `apps/web`: minimal web shell (optional)
- `libs/*`: shared libs
- `infra/*`: env, compose, deploy
- `docs/*`: plan, architecture, handoff

## How to run (dev)
```sh
deno task dev
```
Open: https://app.localhost

## Worker
```sh
deno task worker:github
```

## Security note
Never commit secrets. Use env files or secret stores.

## Acceptance checklist
- README updated with goals + scope
- architecture overview present (high-level)
- issue templates + initial issues present
- 48h milestone plan present
- CI/test/schedule placeholders present
- handoff note + open decisions listed

## Docs
- `docs/architecture-overview.md`
- `docs/milestones-48h.md`
- `docs/initial-issues/*.md`
- `docs/ci-placeholder.md`
- `docs/schedule-placeholder.md`
- `docs/handoff.md`
- `docs/integration-github.md`
