# Moving a server from Postgres 16 to Postgres 18

The Compose file runs Postgres 18. A server or a development machine that ran this template on
Postgres 16 has to move its data once, with `deno task db:upgrade-18`. A machine that starts on
Postgres 18 needs nothing from this page.

## Why a deploy alone is not enough

Postgres 18 cannot open a version 16 data directory, and its image keeps data in a different
place (`/var/lib/postgresql`, with a folder named after the version inside). So the Postgres 18
container gets a host directory of its own, `.volumes/postgres18`, and the Postgres 16 data stays
where it was, in `.volumes/postgres`, untouched.

Left like that, the first deploy would start an empty Postgres 18, run the migrations on it and
serve an app with no users. `deno task compose` therefore refuses every command that can start the
database (`up`, `start`, `restart`, `run`, `create`) while `.volumes/postgres` exists and no
upgrade has finished:

```text
Refusing to start: ./.volumes/postgres holds a Postgres 16 database, and Postgres 18 keeps its
data in ./.volumes/postgres18. Starting now would serve an empty database. Nothing was changed.
```

**What you see when you deploy without upgrading:** `deno task deploy` copies the files and then
fails at "Starting the app" with that message. The containers that were running keep running:
Postgres 16, the old API and the old worker still serve the app. Nothing is lost and nothing is
empty; the deploy is simply not finished until the upgrade has run.

The check lives in `deno task compose` (`infra/scripts/postgres-data.ts`), which is what the
deploy and `deno task dev` run. `docker compose up` typed by hand goes around it and would start
the empty database: do not start this stack that way on a machine that still has
`.volumes/postgres`.

## The upgrade

It needs free disk space for one plain-text dump and one new data directory, each about the size
of the database. The app is down from the moment the API and the worker stop until they are back.
In the rehearsal (87 MB, 110,562 rows in 40 tables) that was 31 seconds; a dump and a restore
grow with the data, so expect roughly proportionally more.

1. On your machine, deploy this version. It stops at "Starting the app" as described above, with
   the new files on the server and the old containers still running.

   ```bash
   deno task deploy
   ```

2. On the server, in the app's directory (`PATH_ON_SERVER`), run the upgrade.

   ```bash
   deno task db:upgrade-18
   ```

3. Check it: the database answers as 18, every container is up, and you can sign in.

   ```bash
   deno task compose ps
   docker exec <PROJECT>-db psql -U <DB_USER> -d <DB_NAME> -Atc 'show server_version'
   ```

What the script does, in order (`infra/scripts/db-upgrade-18.ts`):

1. Builds the images while everything still runs.
2. Stops the API and the worker, so nothing writes any more.
3. Counts the rows of every table in every database and dumps the whole server with `pg_dumpall`
   into `.db-upgrade/postgres-16-<time>.sql`, readable by you only. If the count or the dump
   fails, or the dump is cut short, it starts the API and the worker again and stops: nothing
   else was changed.
4. Stops Postgres 16 and starts Postgres 18 on the new, empty `.volumes/postgres18`.
5. Restores the dump and counts the rows again. A table that is missing or extra, or a count that
   differs, fails the upgrade. So does any restore error other than the two a fresh server always
   gives (its own role and database exist already).
6. Writes `.volumes/postgres18/upgraded-from-16`. From here on `deno task compose` starts the
   database again.
7. Runs `compose up -d`: the `migrate` service applies the pending migrations, then the API, the
   worker and everything else start.

It ends with the number of rows and tables that matched and how long the apps were down. Run a
second time, it finds the marker, says "Already upgraded" and changes nothing.

The script never renames, writes or deletes `.volumes/postgres`.

## When it fails

- **Before Postgres 18 started** (the message ends "Nothing was changed"): the server is as it
  was, on Postgres 16, with the apps running. Fix the cause and run the upgrade again.
- **After Postgres 18 started** (the message says "The upgrade failed"): the database, the API and
  the worker are stopped, and `deno task compose up` is still refused, so the half-filled database
  is never served. Roll back as below to bring the app back, then find the cause.
- **"The data is on Postgres 18 … but the apps did not start"**: the move is done and marked; a
  migration or an app failed afterwards. Read its log (`deno task compose logs migrate`), fix it
  and run `deno task compose up -d`.

## Rolling back

Rolling back is starting Postgres 16 on the old directory again, which is what the previous
version's Compose file does. Everything written to Postgres 18 since the upgrade is lost: the old
directory holds the data as it was when the API and the worker stopped.

1. On your machine, deploy the last commit before this change. A deploy from an older commit
   replaces every newer file on the server, the Compose file included.

   ```bash
   git switch --detach <last commit that ran Postgres 16>
   deno task deploy
   git switch -
   ```

2. On the server, in the app's directory, move the Postgres 18 directory out of the way. It now
   misses everything written since the rollback, and its marker would let a later deploy start
   on it.

   ```bash
   sudo mv .volumes/postgres18 .volumes/postgres18-rolled-back-$(date +%F)
   ```

To upgrade again later, deploy this version and run `deno task db:upgrade-18` as above. If step 2
was skipped, the script refuses and says so.

In the rehearsal the rollback took 9 seconds, and Postgres 16 showed the same 110,562 rows it had
before the upgrade.

## Afterwards

The old data directory and the dump stay on the server until you remove them by hand. Keep them
until you trust the new database and a backup of it exists (`infra/scripts/db-backup-create.ts`).
Once `.volumes/postgres` is gone, rolling back is no longer possible.

```bash
sudo rm -r .volumes/postgres .db-upgrade
```

## On a development machine

`deno task dev` gives the same refusal when `.volumes/postgres` exists. To keep the data, run
`deno task db:upgrade-18` while the old containers are still running (if they are stopped, start
them from the last commit that ran Postgres 16). To start empty instead, delete
`.volumes/postgres`, run `deno task dev` and then `deno task db:seed`.
