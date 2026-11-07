# Open tables

## What it is for

Open tables write the workspace's data as Parquet files with open table
metadata, on the file store the install already uses. An analyst opens them in
DuckDB, Polars or Spark and joins them with other data, without a Sheetbase
export and without asking for database access.

What is written: every model view (including measurement tables), and every
dataset version as its own snapshot, so a query can ask for the data as it was
at a version.

## Setting it up

Settings > Open data > Open tables (needs integrations access and data access).

1. Switch **Write open tables** on. The tables hold what **you** can see (see
   below), so you need data access.
2. Wait for the first pass; the status table fills in. Passes run in the
   background, a few minutes after data changes, never during a request.
3. Create a **table login** and copy its password. The settings page shows the
   DuckDB, Polars and Spark snippets with your connection details filled in.

Needs `SHEETBASE_SQL_HOST` (and port/database if they differ from the
defaults), the same setting SQL logins use, so the analyst's machine can reach
the catalogue. Files are served by the app itself at `/api/lake/files/…`, so
nothing is Railway-only: with S3 or MinIO configured as the file store the
Parquet files live there, otherwise in Postgres like other files.

## Format choice

DuckLake rather than Iceberg. Iceberg needs a REST catalogue service next to
the database; DuckLake keeps its catalogue in plain Postgres tables, which an
install already has. DuckDB reads DuckLake natively, and the Parquet files are
ordinary Parquet, so Polars and Spark read them directly. Moving to Iceberg
later only means rewriting the metadata; the data files stay.

## Who sees what

Open tables are a data steward feature. They are off until someone with data
access (the Data steward role by default, configurable under Settings, plus
owners and admins) switches them on, and only people with data access can make
logins, see the connection snippets or read the tables through the API.

Parquet files carry no row-level security, so there is one set of files per
workspace, not one per member. The export runs as the person who turned open
tables on, through the reporting views and the row-level rules that person is
subject to, and a table login reads all of it. A login stops working when its
owner loses data access or is suspended: the app refuses its file requests at
once, and the background pass revokes the login and its database role within a
minute. A person who needs a narrower view should use a SQL login on the
reporting views instead, which keeps each person's own row rules.

Logins read the catalogue through a read-only database user, and the files
through a bearer token. Revoking a login stops both immediately.

## Limits

A table is capped at 2,000,000 rows per pass. Dataset versions are written 25
per pass, newest first, so a large backlog fills over several passes.
