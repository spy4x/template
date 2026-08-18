# Summary for Continuing Work on the Template

## Goal

Create a clean template inside this repo under `/template` using the same top-level structure as the original. Keep infra/auth/api/ws/db; remove business logic. The user wants the template in `/template` (not moving it yet).

**Requirements:**
- Keep Docker Compose, vertical scaling, Woodpecker CI
- Same DB/auth stack
- Groups needed, audit trails optional (we chose no audit table)
- Remove Telegram entirely
- Keep web push infra
- Remove currency/exchange-rate infra
- Minimal web shell (auth shell only)

## What Was Done

### 1) Initial Copy

Copied specified folders/files into `/template` using rsync (dist removed):
- `/apps`, `/docs`, `/e2e`, `/infra`, `/libs`
- `.dockerignore`, `.gitignore`, `deno.jsonc`, `Dockerfile.base`, `playwright.config.ts`

### 2) Removed Business Logic

- `/template/apps/api/cqrs`, `/handlers`, `/services/telegram`, `/workers` removed
- `/template/apps/api/routes/telegram.ts`, `/routes/currencies.ts`, `/routes/gateway.ts` removed
- `/template/apps/api/services/exchange-rate-provider.ts` and `/services/currency.ts` removed
- Websocket route/service removed (domain-specific)
- e2e folder removed
- `/docs/features` removed; business docs removed:
  - `docs/2.features.md`
  - `docs/telegram-bot.md`
  - `docs/offline-first-with-dexie.md`

### 3) Web App Minimal Shell

- Removed `/template/apps/spa/src/components`, `/routes`, `/state`, `/services`, `/assets`
- Rewrote `apps/spa/src/app.tsx` to simple placeholder
- Rewrote `apps/spa/src/app.css` to minimal styles

### 4) Shared Libs Cleaned

- Removed `/template/libs/shared/helpers`, `/constants`, `/testing`, `/rpc`, `/local-storage`, `/cqrs`
- Replaced `/template/libs/shared/types/+index.ts` with only auth types + base models (no domain: no currency, groups, transactions)
- Removed leftover `libs/shared/types/currency.ts` and `validate.test.ts`
- Kept `libs/shared/cache` (copied back after accidental deletion)
- Fixed `KeyValueService.connect` typo in `libs/server/kv/+index.ts` (was `connet`)

### 5) DB Schema and Migrations

- Replaced `/template/libs/server/db/schema.sql` with auth + user_push_tokens only
- Wiped migrations and added `libs/server/db/migrations/2026_01_26_0001_init.sql` (auth + push token tables)
- Updated `apps/api/services/db.ts` to only include user, userKey, userSession, userPushToken methods
- Removed sync logic and domain models

### 6) API App Changes

- `apps/api/index.ts` now only health + `/auth` + `/push` routes. Removed telegram/exchange stuff from health response
- `apps/api/routes/auth.ts`: removed telegram connect/disconnect routes
- `apps/api/services/auth/+index.ts`: removed telegram methods + event bus references
- `apps/api/services/config.ts`: removed Telegram config fields
- Removed CQRS buses (`services/commandBus.ts`, `queryBus.ts`, `eventBus.ts`)

### 7) Web Push Kept

- Restored `apps/api/services/webPush.ts`, `apps/api/routes/pushNotification.ts`, `infra/scripts/vapid-keys-create.ts`, `infra/configs/vapid.json`
- `apps/api/index.ts` includes pushNotificationRoute

### 8) Docs Rewritten to Generic Template

- Replaced docs/1,3,4,5,6,7 with short generic content (template focused)
- Updated `docs/woodpecker-ci-setup.md` to generic names
- Removed business docs

### 9) Rename "Financy" References

- Updated `Dockerfile.base`, `apps/api/dockerfile`, `apps/spa/dockerfile.*`, `infra/compose/compose.shared.yml` base image to `app/deno-base`
- Updated `apps/spa/index.html` title + manifest
- Updated `playwright.config.ts` header text
- Updated db connection name to `app-backend`

### 10) Env Files

- Removed `/template/infra/envs/.env` and `.env.prod` to avoid secrets
- Cleaned `.env.example` values (dev@example.com, app names, removed telegram/exchange configs)

## Current State

Template is a clean infra/auth skeleton with web push and minimal web shell. Telegram + exchange-rate removed. CQRS and business domain code removed. DB schema/migrations now only include auth + push tokens.

## Files Modified / Created

### Key Modified Files

- `template/apps/api/index.ts`
- `template/apps/api/routes/auth.ts`
- `template/apps/api/services/auth/+index.ts`
- `template/apps/api/services/config.ts`
- `template/apps/api/services/cache.ts`
- `template/apps/api/services/db.ts`
- `template/apps/spa/src/app.tsx`
- `template/apps/spa/src/app.css`
- `template/docs/1.principles.md`
- `template/docs/3.architecture.md`
- `template/docs/4.tech-stack.md`
- `template/docs/5.deployment.md`
- `template/docs/6.infrastructure.md`
- `template/docs/7.recommendations-expanded.md`
- `template/docs/woodpecker-ci-setup.md`
- `template/infra/envs/.env.example`
- `template/Dockerfile.base`
- `template/apps/api/dockerfile`
- `template/apps/spa/dockerfile.dev`, `dockerfile.prod`
- `template/infra/compose/compose.shared.yml`
- `template/libs/server/db/+index.ts`
- `template/playwright.config.ts`
- `template/apps/spa/index.html`
- `template/apps/spa/public/manifest.json`
- `template/libs/server/kv/+index.ts` (connect name fixed)

### New Files

- `template/libs/server/db/schema.sql` (auth only)
- `template/libs/server/db/migrations/2026_01_26_0001_init.sql`
- `template/libs/shared/types/+index.ts` (auth-only)

### Removed

- `template/apps/api/cqrs`, `handlers`, `services/telegram`, `workers`
- `template/apps/api/routes/telegram.ts`, `currencies.ts`, `gateway.ts`
- `template/apps/api/services/exchange-rate-provider.ts`, `currency.ts`
- `template/apps/api/services/websockets.ts`, `routes/websockets.ts`
- `template/apps/spa/src/components`, `routes`, `state`, `services`, `assets`
- `template/e2e`
- `template/docs/features`, `docs/2.features.md`, `docs/telegram-bot.md`, `docs/offline-first-with-dexie.md`
- `template/libs/shared/helpers`, `constants`, `testing`, `rpc`, `local-storage`, `cqrs`
- `template/libs/shared/types/currency.ts`, `validate.test.ts`
- `template/infra/envs/.env`, `.env.prod`
- Initial migrations replaced

## Known Follow-up Checks

- Run rg scan for stray domain references (now minimal)
- Consider adding a placeholder web auth UI if desired (currently empty shell)
- Confirm any compile errors from removed types. Ensure `apps/api/services/webPush.ts` still compiles with reduced types

## User Preferences to Remember

- Keep template in `/template`
- Keep infra stack (docker compose, woodpecker, vertical scaling)
- Same auth/db stack
- Groups needed
- No audit trail table
- No currency/exchange-rate infra
- Remove Telegram entirely
- Keep web push
- Minimal web shell, no business UI
- "Don't rethink structure" — only clean business logic
