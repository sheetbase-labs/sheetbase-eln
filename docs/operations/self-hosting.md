# Running Sheetbase for your lab

A guide for the person who installs and looks after Sheetbase. It says what you
need, how to get a first person signed in, and where backups, upgrades and
restores are covered. Each step links to the page with the detail.

## What you run

Three services, all in containers:

| Service    | What it is                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------- |
| PostgreSQL | Version 18. Holds every record, file (by default) and the audit trail.                        |
| PostgREST  | Version 14.5. Serves the data API; Postgres row-level security decides what each person sees. |
| The app    | Node 26. The web app, file handling and scheduled jobs.                                       |

Only the app is reachable by people. Postgres and PostgREST stay on a private
network. `compose.deploy.yaml` describes exactly this; the end-to-end
walkthrough for one server is [VPS deployment](vps-deployment.md), and the
rules every deployment follows are in [Deployment](deployment.md).

You also need:

- a **public HTTPS address** for the app. Set it as `BETTER_AUTH_URL`;
- **one sign-in method**: GitHub OAuth, company single sign-on (OIDC), or
  emailed one-time links. See [Authentication](authentication.md) for the setup
  of each;
- optionally **SMTP** for emailed sign-in links and notifications, and an **S3
  bucket** for files and backups.

Emailed links can be the only method. They need `EMAIL_LOGIN_ENABLED=true`,
`SMTP_HOST`, and, when they are the only method, `EMAIL_LOGIN_ALLOWED_DOMAINS`
naming your lab's domain, because a new address can create an account only from
an allowed domain.

## Configure it

Every setting is an environment variable. [Configuration](configuration.md)
lists them all with what each does and its default. For a first install you
need the database passwords and URLs, `BETTER_AUTH_SECRET`,
`PGRST_JWT_SECRET`, `BETTER_AUTH_URL` and your sign-in method. Generate
secrets of 32 or more characters; never reuse the development values from
`.env.example`.

## Install

1. Build or pull the release image and start the stack with the deploy
   controller (`pnpm deploy:plan`, then `pnpm deploy:apply`). The controller
   starts Postgres, runs the migrations as a separate step, starts the app and
   checks `/api/health/ready`. See [Deployment](deployment.md).
2. Open the address you set. Sign in.

The image `Dockerfile.railway` is a simpler route for hosts that build from a
Dockerfile (it also works outside Railway). It builds from the public
repositories and applies migrations every time the container starts.

## First sign-in

A person who signs in for the first time gets a workspace of their own, and
they are its owner. If a lab has already claimed the person's email domain
(Settings → Members and roles → Let colleagues join), they join that lab
instead. So the usual order is: the person setting up signs in first, claims
the lab's email domain, then tells colleagues to sign in.

Invitations (Settings → Members) are emailed when `SMTP_HOST` is set, and the
link is shown once so you can send it yourself if the email fails. Without a mail
server you only get the link.

Roles decide what people can do: owners and administrators manage settings,
stewards also publish models and manage integrations, members do the scientific
work, and viewers can only read. Scientist, analyst and reviewer are labels
with the same rights as member today; who reviews a given record is chosen on
the record, not by role. Which roles get data access is set under
Settings → Access. The details are in
[Workspace roles](../subsystems/governance-roles.md) and
[Administration](../subsystems/administration.md).

## Regulated lab

Settings → General has one switch, **Regulated lab**. It is off for new
workspaces and on for every workspace that existed before it was added, so
nothing changes for an existing lab until an admin turns it off. It decides
three rules:

| Rule                | Regulated lab on                                                           | Regulated lab off                                                                |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Signing identity    | A different administrator has to verify a signer's identity.               | A signer can confirm their own identity ("Confirm it's me" under My signature). |
| Finishing work      | An experiment is finished through review by someone other than its author. | An author can Finish an experiment without review, and Reopen it later.          |
| Idle session length | 30 minutes.                                                                | 12 hours, a working day.                                                         |

Details worth knowing:

- With the switch off, a lab with one administrator can sign. The signing
  password is still set through the emailed one-use secret, and is asked for
  again at certification and at every signature.
- A finished experiment is closed to edits, with a "Finished" status, until
  someone reopens it.
- Turning the switch back on stops self-confirmed signers until a different
  administrator verifies them. A person who belongs to any regulated
  workspace keeps the 30 minute session everywhere.
- It is one switch for all three rules. There are no per-rule overrides yet.

## Signing

Signing a record asks the person to confirm who they are again with a signing
password. The setup, the step-up check and the evidence kept are in
[Authentication](authentication.md#signing-credential-routes). In a
regulated lab a signature's identity has to be verified by a different
administrator than the person signing, so a lab with a single administrator
should leave Regulated lab off.

## Files and backups

- **Files** live in Postgres by default, so a database backup includes them. To
  keep them in S3 (AWS S3, Cloudflare R2, Backblaze B2, Garage, SeaweedFS),
  see [File storage](file-storage.md); `pnpm storage:copy` moves files already
  stored.
- **Scheduled backups** are made per workspace under Settings → Backups and
  export, daily and kept for seven copies unless changed. By default they sit
  wherever files sit. Set the `SHEETBASE_BACKUP_S3_*` variables to write them
  to a separate bucket so they survive losing the database. See
  [Workspace export and backups](workspace-export-and-backups.md).
- **Whole-deployment recovery**, with `pg_dump`, is [Recovery](recovery.md).
- Settings → Diagnostics shows the state of the deployment and its go-live
  checks.

## Restore

Restore a workspace archive into an empty database at the same version with
`pnpm workspace:restore --file <archive>.zip` (add `--dry-run` first). See
[Restoring](workspace-export-and-backups.md#restoring). To recover a whole
deployment, follow [Recovery](recovery.md).

## Upgrade

Migrations are applied by the new release, and a backup comes first either
way. With `pnpm deploy:apply` a fresh full-database backup is required and a
failed backup stops the upgrade. The `Dockerfile.railway` image (and anything
that starts with `pnpm db:upgrade`) backs up every workspace before it migrates
and stops with nothing changed if a backup cannot be made; see
[Before an upgrade](workspace-export-and-backups.md#before-an-upgrade). Then
check `/api/health/ready` and Settings → Diagnostics.

## Read your data directly

- **SQL:** members whose role has data access can create a personal read-only
  login. Set `SHEETBASE_SQL_HOST` to a name they can reach. See
  [Data access](data-access.md).
- **API:** personal tokens and the external API are in
  [External API](../api/external-api.md).
- **Instruments and files:** the instrument agent and parsers are in
  [Integrations](../subsystems/integrations.md).
- **Metrics:** `/api/metrics` for Prometheus, behind a token. See
  [Observability](observability.md).

## Not covered yet

Truthful status screens (lists and labels that show what is really true) are
still changing and are not described here yet.
