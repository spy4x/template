# Contributing

## Rules

- keep changes small
- prefer Deno stdlib
- money as ints, enums start at 1
- no secrets in repo

## Workflow

1. read README + docs, and the traps in [docs/handoff.md](docs/handoff.md)
2. open/update issues
3. branch from the latest `main` and implement in small PRs, one logical change each
4. code a future product could reuse goes to
   [spy4x/ts-libs](https://github.com/spy4x/ts-libs) or
   [spy4x/preact-components](https://github.com/spy4x/preact-components) first and is imported
   from there ([AGENTS.md](AGENTS.md))
5. run checks: `deno task check`
6. open a pull request: it merges after review, once the CI check is green (`main` is protected;
   the steps are in [docs/woodpecker-ci-setup.md](docs/woodpecker-ci-setup.md))
