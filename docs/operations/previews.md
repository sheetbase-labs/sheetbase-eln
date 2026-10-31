# PR preview sites

A preview is a running copy of a pull request with its own database and demo
data. It is off by default: nothing is created unless someone asks.

## Asking for one

Add the **preview** label to the pull request. The workflow
(`.github/workflows/preview.yml`) creates the site and comments its address on
the pull request. Every later push to the branch redeploys it. Removing the
label, or closing or merging the pull request, deletes the site and its
database.

To reset the demo data, add the **reseed** label (to reseed again, remove the label and add it again).

## How it works

`scripts/preview.mjs` is the only Railway-specific part. `up` duplicates the
production environment in the Railway project (app, PostgREST and a fresh
Postgres, both stock images) as `pr-<number>`, points the app's build at the PR
branch, gives it a public address and starts it with `scripts/preview-start.mjs`.
That script creates the database roles, migrates and seeds the design demo data
into the empty database, then serves.
The same container image runs anywhere else, so moving previews to another host
means replacing `preview.mjs` and nothing in the app.

Previews run the auth-free demo mode like production's demo: public and fake
data only. Never put real data in one.

## Running it by hand

```
RAILWAY_API_TOKEN=... node scripts/preview.mjs up <pr> <branch>
node scripts/preview.mjs reseed <pr>
node scripts/preview.mjs down <pr>
```

The workflow needs a repository secret `RAILWAY_API_TOKEN`.
