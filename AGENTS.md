# AGENTS.md — template

Read `README.md` and `CONTRIBUTING.md` first. The global agent instructions own Git Flow, review
and cleanup; this file adds what is specific to this repo.

## Shared libraries

Before writing a component, helper or library here, search
[spy4x/ts-libs](https://github.com/spy4x/ts-libs) and
[spy4x/preact-components](https://github.com/spy4x/preact-components) for it. The global rule
["Shared libs before local code"](https://github.com/spy4x/dotfiles/blob/main/ai-harnesses/AGENTS.md)
says what belongs in each library; code only this repo needs stays here.

## Handoff

[docs/handoff.md](docs/handoff.md) holds the state of the migration, the decisions already made and
the traps in this codebase. Read its "Traps in this codebase" before changing the API or the tests.

## Financy

Financy is an older product and is rebuilt on this template only when the template is finished.
The template decides how Financy's code looks; Financy only says which features it needs. Do not
port Financy's structure into the template.
