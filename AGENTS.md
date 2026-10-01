# AGENTS.md — template

Read `README.md` and `CONTRIBUTING.md` first. The global agent instructions own Git Flow, review
and cleanup; this file adds what is specific to this repo.

## Shared libraries

Before writing a component, helper or library here, search
[spy4x/ts-libs](https://github.com/spy4x/ts-libs) and
[spy4x/preact-components](https://github.com/spy4x/preact-components) for it. The global rule
["Shared libs before local code"][shared-libs] says what belongs in each library; code only this
repo needs stays here.

[shared-libs]: https://github.com/spy4x/dotfiles/blob/main/ai-harnesses/AGENTS.md

## Three layers of UI

Every piece of UI has one home:

| Layer               | Home                                               | Examples                                                       |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| Generic primitives  | `spy4x/preact-components` (JSR)                    | `Button`, `Field`, `Card`, `EnhancedForm`, `AuthForm`, `Shell` |
| Product screens     | `libs/ui` (workspace member, alias `@ui/`)         | `AuthScreen`, `ProfileScreen`, `AppFrame`, `PublicFrame`       |
| State and transport | each app (`apps/spa/src/views`, `apps/mpa/routes`) | stores, `fetch`, WebSocket, the router, Fresh handlers         |

Anything a future product could use goes to preact-components first. `libs/ui` keeps only what
names this template's features. An app's view is wiring: it holds state, calls the API and passes
both to a screen.

Every `libs/ui` component follows this contract. A part marked **open** is not met yet; its issue
says what is missing. Do not copy the gap into a new screen.

- **Pure.** Props in, callbacks out. No store, no `fetch`, no router, no `window`, `document` or
  `location` at render, no import from an app. Output is the same under Fresh server rendering and
  in the browser. Links take an optional `navigate` port instead of a router.
  `tests/ui-boundary.test.ts` walks `libs/ui` and runs preact-components' rule
  (`@spy4x/preact-system/boundary`) over every module, with this repository's app aliases.
- **Works without JavaScript.** Every action is a real `<form method="post" action="…">` or
  `<a href="…">`, with field `name`s matching the API schema of the same action. Form actions are
  listed in `FORM_ACTIONS` (`libs/ui/progressive.tsx`). With its callback, the app takes the submit
  over; without it, the browser posts. Push registration needs the browser's push manager, so it is
  the one action without a native form. The mode switch of `AuthForm` is a link (`modeHrefs`).
- **Built on preact-components' `EnhancedForm`.** Every form here is `ScreenForm`
  (`libs/ui/progressive.tsx`): `EnhancedForm` with its status taken from the screen's `pending`
  prop, so a pending form is disabled and refuses a second submit.
- **State comes in as props:** `value`, `errors`, `pending`, `items`, `cursor`. Error and pending
  display is part of the component, so both apps show the same messages.
- **Accessible by construction.** Every control has a label. Error text is tied to its field with
  `aria-describedby`. Focus moves to the first error, and to the next control after a step change.
  A message the API ties to no field stays under its form.
- **`data-e2e` hooks stay**, so one e2e page object covers both apps.
- **Tested.** Each component has a server-render test that finds a working form or link for every
  action (`libs/ui/screens.test.tsx`), and an interaction test that types, submits with and without
  the app's callback and checks where focus goes, in a happy-dom page
  (`libs/ui/interactions.test.tsx`).

## Adding a feature

A new product aggregate copies the notes aggregate, file by file:
[docs/aggregates.md](docs/aggregates.md) lists every file in order. Do not invent a second shape.

## Handoff

[docs/handoff.md](docs/handoff.md) holds the state of the migration, the decisions already made and
the traps in this codebase. Read its "Traps in this codebase" before changing the API or the tests.

## Financy

Financy is an older product and is rebuilt on this template only when the template is finished.
The template decides how Financy's code looks; Financy only says which features it needs. Do not
port Financy's structure into the template.
