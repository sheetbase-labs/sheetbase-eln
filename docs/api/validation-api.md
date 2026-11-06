# Validation runs

Regulated labs can run installation (IQ) and operation (OQ) checks against their
own install and keep the evidence. This page is the API for reading the result.
For what the checks do and how to use the pack, see
[`../operations/validation-pack.md`](../operations/validation-pack.md).

These are checks on this install, plus a trace from requirements to the
automated tests that cover them. They are not a statement that Sheetbase or your
lab complies with any regulation.

## Reading runs

`GET /api/db/validation_runs` (scope `admin:read`). Newest first with
`order=finished_at.desc`. A run can never be edited or deleted.

| Column                        | Meaning                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `status`                      | `passed` when no check failed (skipped checks do not fail a run)                                                        |
| `passed`, `failed`, `skipped` | Counts                                                                                                                  |
| `results`                     | Every check: `id`, `kind` (`iq` or `oq`), `title`, `method`, `expected`, `requirements`, `status`, `detail`, `evidence` |
| `app_version`, `migration`    | What was running, and the newest database change applied                                                                |
| `run_by_user_id`              | Who started it                                                                                                          |
| `started_at`, `finished_at`   | When                                                                                                                    |

## Starting a run, and the pack

Both need a signed-in person who manages the audit settings, in a workspace with
Regulated lab on. They are not available to API credentials.

| Request                    | Result                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `POST /api/validation/run` | Runs the checks and returns the recorded run                       |
| `GET /api/validation/pack` | A signed zip: protocol, trace, recent runs, offline verify scripts |

A finished run sends the webhook event `validation.run_completed`
([`event-catalogue.md`](event-catalogue.md)).
