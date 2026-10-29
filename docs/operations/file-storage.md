# File storage

Uploaded files (CSV, PDF, images, instrument exports) are stored behind one
interface, so the app does not care where the bytes are.

| `FILE_STORAGE_BACKEND` | Where files live                                              | Use it for                                                                                              |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `database` (default)   | Postgres, in `internal.file_blob_chunks`, one-megabyte pieces | Most sites. Nothing else to run; deploys never lose files; database backups include them.               |
| `s3`                   | Any S3-compatible service                                     | Larger sites, or when files should live apart from the database.                                        |
| `local`                | The app server's disk (`FILE_STORAGE_DIR`)                    | A single machine with its own persistent disk. Lost on hosts that replace the container on each deploy. |

Files are limited to 100 MiB each (`FILE_MAX_BYTES`).

## Using S3-compatible storage

Works with AWS S3, Cloudflare R2, Backblaze B2, Garage, SeaweedFS and others.
Create a private bucket and an access key limited to it, then set:

```
FILE_STORAGE_BACKEND=s3
FILE_STORAGE_S3_BUCKET=sheetbase-files
FILE_STORAGE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # not needed for AWS
FILE_STORAGE_S3_REGION=auto                                           # us-east-1 by default
FILE_STORAGE_S3_ACCESS_KEY_ID=...
FILE_STORAGE_S3_SECRET_ACCESS_KEY=...
FILE_STORAGE_S3_PREFIX=                                               # optional folder inside the bucket
```

Path-style addressing is on by default because every service supports it. Set
`FILE_STORAGE_S3_PATH_STYLE=false` only for a service that needs
`bucket.host` addresses.

## Switching backends without losing files

Changing `FILE_STORAGE_BACKEND` changes where new files go. Files stored
earlier stay readable where they are: reads try the configured backend first,
then the others that are available. Move them across when convenient:

```
pnpm storage:copy --from database --to s3 --dry-run   # what would be copied
pnpm storage:copy --from database --to s3             # copy, checking every file
pnpm storage:copy --from database --to s3 --delete-source   # then empty the old place
```

Each copy is checked against the checksum recorded when the file was
uploaded. A file that does not match is removed from the destination and
reported, and the command exits non-zero. The source is only emptied with
`--delete-source`, and only for files whose copy was verified. The command can
be run again at any time; files already copied are skipped.

The `storage_backend` shown on a file records where it was first stored. It is
part of signed evidence, so it is never rewritten when a file is moved.
