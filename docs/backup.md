# Backup and restore

## Taking one

```bash
vercel env pull .env.local     # so MONGODB_URI points at production
npm run backup                 # writes ./backups/<timestamp>/
```

It prints what it copied. Read that before trusting it — a backup with a
collection missing or a count of zero is worth knowing about now rather than
on the day it is needed:

```
  database:  vdm
  taken at:  2026-08-24T19:31:23.073Z
  documents: 3
    menucourses: 1
    reservations: 2
```

**What comes out is unencrypted and holds guest names, room numbers and contact
details.** It belongs wherever you would be willing to keep the reservation book
itself. `backups/` is git-ignored so a wide `git add` cannot commit one, but
nothing stops it being copied somewhere careless.

## Putting one back

```bash
npm run restore -- ./backups/2026-08-24T19-31-23-073Z
```

`MONGODB_URI` decides where it lands, so **check it first**. The script prints
the target host — with the credentials masked — and the mode, before writing
anything.

It **refuses by default if the target already holds data.** That refusal is the
whole safety design here. The expensive mistake is not a bad backup; it is a
good backup restored over a live database that did not need restoring.
`--replace` is how you say you meant it:

```bash
npm run restore -- ./backups/<stamp> --replace
```

`--replace` deletes the documents in the collections the backup contains, then
writes them. A collection the backup does **not** mention is left alone: a
backup is a record of what existed, not a statement about what should not.

## What is and is not verified

**Verified, in `lib/backup.mongo.test.ts`,** against a real MongoDB: the round
trip works, types survive it, the refusal fires, `--replace` replaces rather
than merges, an unmentioned collection is untouched, and a backup from a future
format is rejected.

The types are the part worth caring about. An `_id` is an ObjectId and a
`createdAt` is a Date; a backup written with plain `JSON.stringify` turns both
into strings, and the restored database then *looks* right, loads in the app,
and fails every query that matches on an id. That is a failure you would
discover on the day you were restoring from backup. Documents are written as
canonical Extended JSON so it cannot happen.

The scripts themselves were run end to end against a throwaway server: backup
wrote the files, a restore into the populated database was refused, a restore
into an empty one succeeded, and the restored documents were confirmed
identical — same ObjectIds, same Dates, findable by their original `_id`.

**Not verified: a restore of real production data.** Everything above used
synthetic data on a local server. The drill below is the thing that has not
been done, and it is the only one that proves the backup you actually hold is
good.

## The drill — not yet done

Deferred deliberately until the restaurant closes for the season and the app is
not in use. Until then there is no safe moment to point a restore anywhere near
production.

1. `npm run backup` against production.
2. Read the manifest. Do the counts look like a season's trading?
3. Create a scratch database on the same cluster — `vdm_restore_test`.
4. Point `MONGODB_URI` at the scratch database and
   `npm run restore -- ./backups/<stamp>`. It must not need `--replace`; if it
   does, the target was not empty and is the wrong target.
5. Run the app against the scratch database. Open a booking, the menu editor and
   the service board. Check a dish photograph loads — those are the largest
   documents and the most likely to have been truncated.
6. Compare a handful of reservation numbers and totals against production.
7. Drop the scratch database.

Write down how long steps 1 and 4 took. "Can we restore?" and "can we restore
before service tonight?" are different questions, and only the second one
matters when it is being asked.

## What this does not cover

- **No schedule.** Backups are taken when somebody runs the command. If this
  becomes a product, that is the first thing to fix — Atlas's own scheduled
  snapshots are the obvious answer and need no code.
- **No encryption at rest**, beyond wherever the file is put.
- **No point-in-time recovery.** A backup is a copy of one moment; anything
  after it is gone. Atlas offers continuous backup on paid tiers.
- **Indexes are not backed up.** They are declared in the Mongoose models and
  rebuilt on connect, so a restored database gets them from the app rather than
  from the file. `lib/models/indexes.mongo.test.ts` is what keeps that true.
