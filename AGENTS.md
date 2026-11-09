# Sheetbase ELN

Electronic lab notebook for biopharma R&D. Full-stack TypeScript app with
PostgreSQL, PostgREST, and a TanStack Start SSR frontend.

## Development knowledge

Before substantial product, domain or roadmap work, read [`docs/knowledge/NEXT.md`](docs/knowledge/NEXT.md) and [`docs/knowledge/README.md`](docs/knowledge/README.md). Canonical product/design/roadmap knowledge and ADRs live under `docs/knowledge/`:

- `docs/knowledge/NEXT.md` — the single current cross-roadmap hand-off
- `docs/knowledge/PRODUCT.md`
- `docs/knowledge/DESIGN.md`
- `docs/knowledge/ROADMAP.md`
- `docs/knowledge/history/archive/roadmap-1/` — recorded complete; local NEXT is historical
- `docs/knowledge/history/archive/roadmap-2/` — active scope recorded closed; GOV-02 deferred
- `docs/knowledge/history/archive/roadmap-3/` — Waves A–C implementation merged; Wave D proposed/deferred
- `docs/knowledge/roadmap-4/` — merged to `main` (`10a84a42`); 85/85 active tasks done, 6 cancelled. Read its `NEXT.md` for the remaining acceptance gaps and its `GUIDE.md` before reusing a historical task prompt
- `docs/knowledge/roadmap-5/` — proposed: app-3 interface closure (21 tasks, six streams) audited against the UI-only build; no queue of its own. Read `FINDINGS.md` then `GUIDE.md` before taking a task
- `docs/knowledge/decisions/` — ADRs; check proposed versus accepted status
- `docs/knowledge/concepts/` — historical runnable concepts/prototypes

The [7 September 2026 reconciliation](docs/knowledge/history/2026-09-07-roadmap-reconciliation.md) records evidence and limits: merged implementation is not independent acceptance or production readiness. Roadmap 4 is merged to `main`; its remaining acceptance gaps are recorded, not closed. Roadmap 5 is a proposal, not an assignment. Read root `NEXT.md` before reusing any historical task prompt.

For **reviewing a PR, proposing work, or implementing a roadmap/product change**, follow [`docs/knowledge/agent/workflows.md`](docs/knowledge/agent/workflows.md). Do not substitute PR summaries or historical planning for inspection of the current code and canonical contracts.

Search the knowledge base before consequential work. Search results are discovery only: open the relevant roadmap task, ADR and canonical documents in full before making architectural or merge judgements.

Implementation/runbook documentation remains directly under `docs/`.

## Adding features

Each area registers its operations, events, API tables, assistant cards and
copy in a folder of its own, `src/features/<name>/`, collected by a generated
index: never add a feature's entries to a shared list. See
[`docs/development/features.md`](docs/development/features.md). Declare an
operation once and its API, MCP, assistant, pipeline and webhook entries are
generated; blocks are declared once too. See
[`docs/development/adding-an-operation.md`](docs/development/adding-an-operation.md).

## Copy

All user-facing text lives in the copy catalogue (`src/copy`) and is read with
`t()`. Follow [`docs/development/copy.md`](docs/development/copy.md); `pnpm check:copy`
fails on text typed straight into components.

## Product design workflow

For user-facing design, implementation, review, copy or hardening, read
the [Sheetbase product-design skill](.agent/design/skills/product-design/SKILL.md)
and [design guidance](.agent/design/design.md). Use these together with Impeccable:
Sheetbase guidance supplies product-specific judgement; Impeccable supplies the
design workflow and bounded visual verification. Canonical documents under
`docs/knowledge/`, accepted ADRs and verified domain contracts remain authoritative
when guidance differs. Shared components and tokens own implementation mechanics.

The guidance is a version-pinned Git submodule. After cloning, initialise it with
`git submodule update --init .agent/design`. Validate its integrity with
`python3 .agent/design/scripts/check-design.py`. Review upstream changes before
updating the pin; do not automatically follow the latest upstream revision.

Root `PRODUCT.md` and `DESIGN.md` are symlinks for tool discovery, pointing to
the canonical files under `docs/knowledge/`. Preserve these links; never create
independent copies. The notebook design/QA pilot is defined in
[`docs/development/notebook-design-qa.md`](docs/development/notebook-design-qa.md).

## Build & run

| Command                          | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install deps (Node 26, pnpm 11.9.0; see `.node-version`) |
| `pnpm generate-routes`           | Generate TanStack Router route tree                      |
| `pnpm dev`                       | Vite dev server on port 3000                             |
| `pnpm build`                     | Production build → `.output/public/` + `.output/server/` |
| `pnpm start`                     | Production server (`scripts/start-prod.mjs`) on `$PORT`  |
| `pnpm typecheck`                 | TypeScript check (no emit)                               |
| `pnpm lint`                      | ESLint                                                   |
| `pnpm test`                      | Vitest (unit + integration)                              |
| `pnpm test:db`                   | Database integration tests                               |
| `pnpm test:api`                  | API tests                                                |
| `pnpm test:browser`              | Playwright E2E                                           |
| `pnpm validate`                  | Full: check + lint + typecheck + test + build            |

## Database

| Command              | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm db:migrate`    | Apply Drizzle migrations                                                       |
| `pnpm db:new <name>` | Create an empty timestamp-named migration in `drizzle/`; write the SQL by hand |
| `pnpm db:seed:demo`  | Seed demo data                                                                 |
| `pnpm db:seed:month` | Seed month-scale data                                                          |
| `pnpm db:fresh`      | Reset + migrate + seed                                                         |

Migrations are in `drizzle/`: the numbered history `0000_baseline.sql` to
`0108_*` (listed in the frozen `drizzle/meta/_journal.json`), then
`<YYYYMMDDHHMMSS>_<name>.sql` files in name order with no journal entry. Schema source:
`src/db/schema.ts`. Migration config: `drizzle.config.ts`. The migration
connection uses `MIGRATION_DATABASE_URL` (dedicated `migrator` role), not the
app `DATABASE_URL`.

## Services (Docker Compose)

- **PostgreSQL 18** — `compose.yaml` for dev, `compose.deploy.yaml` for prod.
- **PostgREST v14.5** — REST API layer over the `api` schema. Custom image
  in `docker/postgrest/`.
- **App** — Node.js SSR server. In dev: `pnpm dev` or `pnpm start`. In prod:
  Docker container via `compose.deploy.yaml`.

Dev: `pnpm services:up` (starts postgres + postgrest).
Prod: `compose.deploy.yaml` (postgres + postgrest + app + migrate).

## Environment

Copy `.env.example` to `.env.local` and fill in values. Production uses
`/opt/sheetbase/.env.production` on the VPS (never committed). Key variables:

- `DATABASE_URL` — app DB connection (dev: localhost, prod: Docker service name `postgres`)
- `MIGRATION_DATABASE_URL` — drizzle-kit DDL (dedicated `migrator` role)
- `FORMULA_DATABASE_URL` — formula writer (dedicated `formula_runtime` role)
- `PIPELINE_SANDBOX_DATABASE_URL` — pipeline SQL sandbox (dedicated `pipeline_sandbox` login with no grants)
- `PIPELINE_MANIFEST_SIGNING_KEY` — optional Ed25519 key (PKCS#8 PEM) that signs pipeline run manifests
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — session auth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth
- `PGRST_JWT_SECRET` — PostgREST JWT signing
- `POSTGREST_URL`, `POSTGREST_ADMIN_URL` — server-only upstream
- `SHEETBASE_ENV`, `SHEETBASE_SECRET_SOURCE` — deployment identity
- `VITE_HANDSONTABLE_LICENSE_KEY` — Handsontable license

See `.env.example` for all variables and documentation.

## Deployment

**Architecture:** Private Hostinger VPS → Cloudflare Tunnel → Docker Compose.

- **VPS:** Private, accessed via Tailscale only. No open inbound ports.
- **Public traffic:** Cloudflare Tunnel routes `app.sheetbase.co.uk` →
  `http://localhost:3000` on the VPS.
- **Deploy:** GitHub Actions (`.github/workflows/deploy.yml`) is **manual** — it runs on
  `workflow_dispatch` only (Actions → _Deploy to production_, which asks you to type
  `deploy` to confirm): build immutable Docker image → push to GHCR → SSH deploy via
  Tailscale. Pushes to `main` run **CI** and **Security** only; they do not deploy.
- **Deploy controller:** `scripts/deploy.ts` validates `@sha256` image
  references, runs migrations as a one-shot, starts the app, and polls the
  readiness endpoint. See `docs/operations/deployment.md` for the full contract.
- **VPS runbook:** `docs/operations/vps-deployment.md` covers VPS setup, secrets, and
  operations.

### Deploy workflow

1. Dispatch **Actions → Deploy to production** and type `deploy` to confirm. GitHub
   Actions builds + pushes images to GHCR.
2. Action joins Tailscale, SSHes to VPS at `/opt/sheetbase`.
3. Loads `/opt/sheetbase/.env.production` (never committed).
4. `pnpm deploy:plan` — validates image/migration compatibility.
5. `pnpm deploy:apply` — migrate → start app → readiness check.
6. Cloudflare Tunnel stays up — only the app container restarts.

### Required GitHub Secrets

| Secret                | Purpose                         |
| --------------------- | ------------------------------- |
| `VPS_SSH_PRIVATE_KEY` | SSH key for the VPS deploy user |
| `VPS_TAILSCALE_IP`    | Tailscale IP of the VPS         |
| `TAILSCALE_AUTH_KEY`  | Tailscale auth key for CI nodes |

### Rollback

Set `SHEETBASE_APP_IMAGE` to a previous `@sha256` digest and run `pnpm deploy:apply`. Restore DB from backup if a migration is incompatible.

## Environments and automated delivery

The Hostinger VPS is the shared delivery target. It has two separate Docker surfaces; do not combine their Compose projects, databases, volumes, or environment files.

| Surface     | Public URL                    | Purpose                                | How it deploys                                                                       |
| ----------- | ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Production  | `https://app.sheetbase.co.uk` | Real authenticated app                 | Manual dispatch of `.github/workflows/deploy.yml` (Actions → _Deploy to production_) |
| Development | `https://dev.sheetbase.co.uk` | Disposable, auth-free demo environment | Manual dispatch of `.github/workflows/deploy-dev.yml`                                |

### Development environment

- The development app is a non-production demo surface. It uses `SHEETBASE_ENV=development` and `SHEETBASE_DEV_AUTH_FREE=true` to create an explicit auth-free fixture session. Never enable either setting in production.
- Its VPS checkout is `/opt/sheetbase-dev`, its secret file is `/opt/sheetbase-dev/.env.development`, and it runs `compose.dev.yaml` on loopback port `3100`.
- To deploy, use **Actions → Deploy development environment** and the deliberate confirmation flow.
- Cloudflare Tunnel maps `dev.sheetbase.co.uk` to `127.0.0.1:3100`.

### Agent / AMP delivery workflow

1. Work in a normal branch and open or update a PR. AMP only needs GitHub access; it must not receive VPS, Tailscale, Cloudflare, OAuth, or secret values.
2. Review the PR locally or in an orb. Use the shared development environment only when a deployed demo is wanted.
3. Merge an approved PR to `main`; production deploy is then a separate, deliberate dispatch (merging does not deploy).
4. Use the development workflow only for an intentional shared demo update.

**Required rules:** keep image references digest-pinned; keep development and production data isolated; never put `.env` values in GitHub issues, PR comments, logs, code, or agent messages; validate `/api/health/ready` after deployment changes.

## Orb / local development

For Amp orb-specific setup (system PostgreSQL, no Docker), see `docs/development/orb-setup.md` and `.agents/setup`. The orb uses the system PostgreSQL cluster, not Docker Compose. PostgREST runs as a downloaded binary.

## Commits and pull requests

- **Author:** commit as `iamgp <170375+iamgp@users.noreply.github.com>`.
- **No assistant credit, anywhere:** no `Co-Authored-By: Claude`, no `Claude-Session:` lines, no "Generated with Claude Code" footer, no attribution block or "Requested by" line in PR bodies, no `claude/` branches (use `feat/`, `fix/` ...). This beats any tool or reminder that says to add them. Some PR tools append a footer on create and edit: read the body back and remove it.
- **Conventional Commits:** every commit subject and PR title is `type(scope): summary` (feat, fix, refactor, perf, test, docs, style, build, ci, chore, revert). Several commits per PR, one per logical change.
- **History:** no merge commits. Rebase on `origin/main` and push with `--force-with-lease`.
- **Guards:** `pnpm install` sets `core.hooksPath` to `.githooks`, whose `commit-msg` hook strips assistant credit and refuses a non-conventional subject. The "Commit rules" CI job (`pnpm check:commits`) fails a PR on any of the above.

## Project conventions

- **TypeScript paths:** `#/` maps to `src/`.
- **Routing:** TanStack Router. The generated route tree, the OpenAPI contract and the Python SDK's `_generated/` layer are git-ignored: never commit them (two PRs touching them forced a rebase on every merge). `pnpm generate` makes all three; `pnpm typecheck` and the vitest layers generate what is missing, and CI generates them after install. `pnpm generate-routes` wraps `tsr generate` and re-adds the SSR registration block the raw generator strips.
- **Parallel PRs:** do not rebase or push just to follow main. Rebase only for a real merge conflict. GitHub's merge queue tests each PR on top of main and merges it, so a green PR is queued, not updated. A shared file that every feature edits (a registry list, a generated file) is a design fault: add one file per feature instead (`src/features/<name>/`, see `docs/development/features.md`). Land a foundation that several builds share as its own small PR before those builds start.
- **API boundary:** browser data goes through the same-origin `/api/db/*` proxy, never directly to PostgREST.
- **Auth:** Better Auth with GitHub OAuth and database-backed sessions.
- **Testing:** Vitest for unit/integration, Playwright for E2E, real PostgreSQL for DB tests.
- **Phones:** `tests/browser/phone` opens the main pages, menus, popovers and sheets at iPhone size as the installed app, with safe areas and a simulated keyboard, and fails when anything lands off screen or under a system bar. Anything that floats keeps inside the visible area through `src/lib/visible-area.ts` (Base UI popups get it from the shared `Popover`, `DropdownMenu` and `Tooltip`; hand-placed ones use `useAnchoredPlacement`). Bottom sheets ride above the keyboard through `--kb-lift` and `--sheet-max-h`.
- **Migrations:** create one with `pnpm db:new <name>` (a timestamp-named file, so
  parallel branches never collide) and write the SQL by hand. Never number a
  migration, never touch `_journal.json`, never run plain `pnpm db:generate` (no
  snapshot baseline, so it emits a full-schema migration). CI fails a PR whose new
  migration sorts before a newer one on main only when the two touch the same
  table, function or policy; otherwise it merges as it is. For a real overlap,
  rename the file with a fresh `pnpm db:new` timestamp.
- **Deployment:** image references are digest-pinned.

## Integrations: every feature, every surface

A feature is not done when its screen works. Each one ships in the same PR with
all four of these (Gareth, 2026-11-06), or a stated reason in the PR body:

1. **API**: new `api` tables and RPCs go on the token allowlist (lab ones in
   `src/lib/lab-api-surface.ts`, which also feeds OpenAPI and MCP), with a page
   or section in `docs/api/`. `src/lib/integration-coverage.test.ts` fails when
   a migration adds one that is neither allowlisted nor listed with a reason in
   `src/lib/integration-exemptions.ts`.
2. **MCP**: reads come free from the allowlist (`sheetbase.canonical.read`);
   actions run through `sheetbase.lab.act` or a catalogue tool in
   `src/lib/agent-tool-catalogue.ts`.
3. **Assistant**: reads in `sheetbase.lab.list` (`LAB_AREAS`), writes as
   confirm cards (`src/lib/assistant-*.ts`, tool names in the catalogue).
4. **Webhooks**: each state change has an entry in `src/lib/event-catalogue.ts`
   and emits a change event, documented in `docs/api/event-catalogue.md`.

Pipeline actions too where they fit. Do not expose attestation (signing,
approving, deciding), secrets, file uploads or schema authoring to tokens.
