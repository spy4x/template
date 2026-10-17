---
name: recapture-shots
description: Re-capture the product screenshots, both the public website's (apps/mpa/static/shots and og cards, by apps/mpa/screenshots/capture.ts) and the README's (docs/screenshots, by docs/screenshots/record.ts). Use after a change that alters how a photographed screen looks in a significant way, and ask the owner when unsure.
---

# Re-capture the product screenshots

Two sets of pictures show the product, and both are re-captured together:

- The public website (`apps/mpa`): made by `apps/mpa/screenshots/capture.ts`, committed under
  `apps/mpa/static/shots/` and `apps/mpa/static/og/`.
- The README: the stills, the sign-up GIF and the GitHub social preview, made by
  `docs/screenshots/record.ts` and committed under `docs/screenshots/`.

`AGENTS.md`, "Product screenshots", says when to run this. This skill says how.

## 1. Decide whether to run

`AGENTS.md`, "Product screenshots", says when. The website's photographed screens are listed in
`apps/mpa/screenshots/README.md`, "What it does"; the README's are named in `record.ts`'s header.

## 2. Prepare

1. Work in a worktree on `main` with the change merged (Git Flow in the global rules), branch
   `docs/recapture-shots`.
2. Check the tools: `command -v cwebp magick tar ffmpeg`.
3. Add `admin` to `COMPOSE_PROFILES` in `infra/envs/.env`, then from the worktree root run
   `deno task proxy:start` and `deno task dev`. Both start detached Docker containers. Wait until
   `http://app.localhost` and `http://admin.localhost` answer.

## 3. Capture

From `apps/mpa`, through the harness's background runner (a foreground call stops at ten minutes):

```bash
systemd-run --user --scope --quiet -p TasksMax=4000 -p MemoryMax=8G timeout 900 deno task screenshots
```

A failing screen is listed at the end and the run exits 1; fix the cause and run again, at most
three times. The script deletes its four demo accounts at the end, also when it fails.

Then, from the worktree root, record the README pictures the same way:

```bash
BASE_URL=http://app.localhost systemd-run --user --scope --quiet -p TasksMax=4000 -p MemoryMax=8G timeout 900 deno run -A docs/screenshots/record.ts
```

It signs a demo user up, so it needs a database where that user does not exist yet.

## 4. Look, then ship

1. Open every changed `.webp`, `og/*.png` and `docs/screenshots/*.png` with the Read tool, and a few
   frames of the GIF (`ffmpeg -i sign-up-flow.gif -vf select='not(mod(n,20))' -vsync vfr f%02d.png`
   in a scratch folder). Check each against the screen it shows: right data, nothing cut off,
   both themes, no spinner or toast caught mid-flight.
2. Update the README's alt text to describe the new pictures, and drop "An older version" from it.
3. Check the budgets the website's README names: 90 KB for the notes hero at 1280, 70 KB for the
   rest, under 2.5 MB for the folder (`du -sb apps/mpa/static/shots`).
4. Stop what you started: `deno task compose down` and `deno task proxy:stop`, unless the stack was
   already running before you began. Then run the orphan sweep.
5. Open a PR with the before and after of the main pictures. A design reviewer checks it, as for
   any visible change; merge and deploy as `AGENTS.md` says.
