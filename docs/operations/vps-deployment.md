# VPS deployment runbook

This runbook covers the Hostinger VPS deployment for Sheetbase ELN. The VPS is
private, accessed only through Tailscale, with public traffic served through a
Cloudflare Tunnel.

## Architecture

```
Internet → Cloudflare Tunnel → localhost:3000 (VPS)
                                 ↓
                            Docker Compose
                          ┌──────────────┐
                          │  app (Node)  │
                          └──────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
              ┌─────▼─────┐ ┌───▼──────┐ ┌───▼──────┐
              │ PostgREST │ │ Postgres │ │ (migrate │
              │   v14.5   │ │   18     │ │  one-shot)│
              └───────────┘ └──────────┘ └──────────┘
```

- **No inbound ports** are open on the VPS. All access is via Tailscale.
- **Cloudflare Tunnel** proxies `app.sheetbase.co.uk` → `http://localhost:3000`.
- **Docker Compose** (`compose.deploy.yaml`) runs PostgreSQL, PostgREST, and the
  app as containers on a private Docker network.
- **GitHub Actions** (`.github/workflows/deploy.yml`) builds immutable images,
  pushes them to GHCR, and deploys via SSH over Tailscale.

## VPS prerequisites

### 1. Install Docker and Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy
```

Log out and back in for the group change to take effect.

### 2. Install Node.js 26 and pnpm

The deploy controller (`deploy.ts`) runs on the VPS and needs Node.js and pnpm.

```bash
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install --global pnpm@11.9.0
```

### 3. Install and authenticate Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Record the VPS's Tailscale IP (`tailscale ip -4`). This is the address GitHub
Actions uses for SSH.

### 4. Create the deploy user and SSH key

```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy
```

Generate an SSH key pair for the deploy user and add the private key to GitHub
Secrets as `VPS_SSH_PRIVATE_KEY`. Add the public key to
`/home/deploy/.ssh/authorized_keys`.

### 5. Clone the repository

```bash
sudo mkdir -p /opt/sheetbase
sudo chown deploy:deploy /opt/sheetbase
cd /opt/sheetbase
git clone https://github.com/phlohouse/sheetbase-eln.git .
git checkout main
```

### 6. Install cloudflared

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
  https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 7. Configure the Cloudflare Tunnel

Create a systemd service for the tunnel so it survives reboots:

```bash
sudo tee /etc/systemd/system/cloudflared.service > /dev/null << 'UNIT'
[Unit]
Description=Cloudflare Tunnel for app.sheetbase.co.uk
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/opt/sheetbase/.cloudflared-env
ExecStart=/usr/bin/cloudflared tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Store the tunnel token securely.
echo "TUNNEL_TOKEN=<your-cloudflare-tunnel-token>" | sudo tee /opt/sheetbase/.cloudflared-env
sudo chmod 600 /opt/sheetbase/.cloudflared-env
sudo chown root:root /opt/sheetbase/.cloudflared-env

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
```

Verify: `curl -sS -o /dev/null -w '%{http_code}' https://app.sheetbase.co.uk/`
(should return 307 redirect to sign-in once the app is running).

## Production secrets

Create `/opt/sheetbase/.env.production` (never committed):

```dotenv
# ── Database ──────────────────────────────────────────────────────────────
POSTGRES_DB=sheetbase
POSTGRES_USER=sheetbase
POSTGRES_PASSWORD=<generate a strong password>
POSTGREST_AUTHENTICATOR_PASSWORD=<generate a strong password>
MIGRATOR_PASSWORD=<generate a strong password>
FORMULA_WRITER_PASSWORD=<generate a strong password>

# Connection strings use the Docker service name "postgres", not localhost.
DATABASE_URL=postgresql://sheetbase:<POSTGRES_PASSWORD>@postgres:5432/sheetbase
MIGRATION_DATABASE_URL=postgresql://migrator:<MIGRATOR_PASSWORD>@postgres:5432/sheetbase
FORMULA_DATABASE_URL=postgresql://formula_runtime:<FORMULA_WRITER_PASSWORD>@postgres:5432/sheetbase
PGRST_DB_URI=postgresql://authenticator:<POSTGREST_AUTHENTICATOR_PASSWORD>@postgres:5432/sheetbase

# ── Auth ──────────────────────────────────────────────────────────────────
BETTER_AUTH_SECRET=<generate 32+ random characters>
BETTER_AUTH_URL=https://app.sheetbase.co.uk

# ── GitHub OAuth (production app) ─────────────────────────────────────────
GITHUB_CLIENT_ID=<from GitHub OAuth app settings>
GITHUB_CLIENT_SECRET=<from GitHub OAuth app settings>
# Or company OIDC instead of GitHub (all three, see authentication.md):
# OIDC_ISSUER_URL=
# OIDC_CLIENT_ID=
# OIDC_CLIENT_SECRET=

# ── PostgREST JWT ─────────────────────────────────────────────────────────
PGRST_JWT_SECRET=<generate 32+ random characters>

# ── Deployment identity ───────────────────────────────────────────────────
SHEETBASE_ENV=production
SHEETBASE_SECRET_SOURCE=secret-manager

# Readiness endpoint — must match BETTER_AUTH_URL origin.
SHEETBASE_READINESS_URL=https://app.sheetbase.co.uk/api/health/ready

# ── Object storage ────────────────────────────────────────────────────────
FILE_STORAGE_BACKEND=local
```

Generate strong passwords:

```bash
openssl rand -base64 32   # for POSTGRES_PASSWORD, auth secrets, JWT secrets
```

### GitHub OAuth app for production

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Application name: `Sheetbase (production)`.
3. Homepage URL: `https://app.sheetbase.co.uk`.
4. Authorization callback URL: `https://app.sheetbase.co.uk/api/auth/callback/github`.
5. Copy Client ID and generate Client Secret into `.env.production`.

## GitHub Secrets

Set these in the repository settings (Settings → Secrets and variables → Actions):

| Secret                | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `VPS_SSH_PRIVATE_KEY` | SSH private key for the `deploy` user on the VPS      |
| `VPS_TAILSCALE_IP`    | Tailscale IP of the VPS (e.g. `100.x.y.z`)            |
| `TAILSCALE_AUTH_KEY`  | Tailscale auth key for ephemeral GitHub Actions nodes |

`GITHUB_TOKEN` is automatically available for GHCR authentication — no
additional secret needed unless using a PAT.

## Deployment flow

### Automatic (push to main, when GitHub Actions is available)

1. Push to `main` triggers `.github/workflows/deploy.yml`.
2. The `build` job builds the app and PostgREST Docker images, pushes them to
   GHCR with `@sha256` digests.
3. The `deploy` job joins the VPS's Tailscale network, SSHes into the VPS,
   pulls the latest code, loads `.env.production`, and runs:
   - `pnpm deploy:plan` — validates image/migration compatibility.
   - `pnpm deploy:apply` — runs migrations, starts the app, polls readiness.
4. The Cloudflare Tunnel stays up throughout — only the app container restarts.

### Local release (no GitHub Actions required)

When the GitHub account cannot run Actions jobs (hosted-runner billing/limit
blocks), release from the VPS itself with the same gate and controller:

```bash
cd /opt/sheetbase
git fetch origin main
set -a; . ./.env.production; set +a
RELEASE_SHA=<full-40-hex-commit-sha> pnpm release:local
```

This runs the enforced gate (typecheck, lint, unit tests, db tests against a
disposable container, build, production dependency audit), builds the
immutable app + PostgREST images locally (no registry), then
`deploy:plan` → `deploy:apply` with the identical readiness proof. Full
contract in `docs/operations/deployment.md` → "Releasing without GitHub Actions".

### Manual

Trigger via GitHub Actions UI (Workflow dispatch). Type `deploy` in the
confirmation field.

### First-time deployment

Before the first automated deploy, bootstrap the VPS manually:

```bash
ssh deploy@<VPS_TAILSCALE_IP>
cd /opt/sheetbase
git pull origin main
pnpm install --frozen-lockfile

set -a
. /opt/sheetbase/.env.production
set +a

# Build the PostgREST image locally (first time only).
docker build --build-arg POSTGREST_VERSION=v14.5 \
  -t sheetbase/postgrest:v14.5 docker/postgrest

# Build the app image locally.
export SHEETBASE_NODE_IMAGE=node:26-alpine
export SHEETBASE_ARTIFACT_VERSION=initial
export SHEETBASE_ARTIFACT_TAG=sheetbase-eln:initial
pnpm artifact:build

# Set image references (use local tags for first deploy).
export SHEETBASE_APP_IMAGE=sheetbase-eln:initial
export SHEETBASE_POSTGREST_IMAGE=sheetbase/postgrest:v14.5
export SHEETBASE_ARTIFACT_DIGEST="$(docker inspect --format '{{.Id}}' sheetbase-eln:initial)"

pnpm deploy:plan
pnpm deploy:apply
```

After the first deploy, subsequent deploys are automatic via GitHub Actions and
use immutable `@sha256` image references from GHCR.

> **Note:** The first deploy uses local image tags without `@sha256` digests.
> The `deploy.ts` controller validates `@sha256` references, so you may need to
> bypass the controller for the initial bootstrap by running `docker compose -f
compose.deploy.yaml up -d --wait` directly, then switch to the CI-driven flow
> for all subsequent deploys.

## Rollback

1. Find the previous image digest in GHCR or GitHub Actions run history.
2. SSH into the VPS.
3. Set `SHEETBASE_APP_IMAGE` to the previous `@sha256` reference.
4. Run `pnpm deploy:apply`.
5. If a migration is incompatible, a forward-fix migration or database
   restore applies — see `docs/operations/deployment.md` (rollback strategy) and
   `docs/operations/recovery.md` (restore procedure).

## Database backups

Use the backup runner, which produces one timestamped backup set (database
dump, object-storage archive, manifest with checksums), enforces retention
and emits JSON success/failure events suitable for cron log capture:

```bash
# crontab -e
0 3 * * * cd /opt/sheetbase && set -a && . ./.env.production && set +a \
  && pnpm backup:run >> /opt/sheetbase/backups/backup.log 2>&1
```

Also run `pnpm backup:run` before every deployment. Full policy (what,
frequency, retention, encryption, failure visibility) and the mandatory
restore drill live in [`docs/operations/recovery.md`](recovery.md). Backups without
proven restore are treated as nonexistent.

## Logs and debugging

```bash
# App logs
docker compose -f compose.deploy.yaml logs -f app

# PostgREST logs
docker compose -f compose.deploy.yaml logs -f postgrest

# PostgreSQL logs
docker compose -f compose.deploy.yaml logs -f postgres

# Cloudflared logs
sudo journalctl -u cloudflared -f

# Readiness check
curl -sS https://app.sheetbase.co.uk/api/health/ready | jq .
```

## Retired PR preview infrastructure

PR-specific preview hosts (`pr-<number>.sheetbase.co.uk`) are no longer
deployed. After this change is on `main`, remove leftover preview resources
without touching production or development:

1. Stop and disable the preview router:
   `sudo systemctl disable --now sheetbase-preview-router`.
2. Remove leftover Compose projects named `sheetbase-pr-*` with
   `docker compose down --volumes --remove-orphans`.
3. Delete `/opt/sheetbase-preview` and the GitHub Actions `preview`
   environment, including `PREVIEW_COMMENT_TOKEN`.
4. Remove the Cloudflare Tunnel wildcard ingress for `*.sheetbase.co.uk`
   while keeping `app.sheetbase.co.uk` → `127.0.0.1:3000` and
   `dev.sheetbase.co.uk` → `127.0.0.1:3100`.

## Secret rotation

See `docs/operations/deployment.md` → "Secret management and rotation" for the full
rotation procedure. Summary:

- **Database passwords:** create replacement → update `.env.production` →
  `pnpm deploy:apply` → verify → revoke old.
- **OAuth credentials:** create new OAuth app or rotate secret → update
  `.env.production` → restart app.
- **Signing secrets** (`BETTER_AUTH_SECRET`, `PGRST_JWT_SECRET`): coordinate a
  single app + PostgREST rollout — existing sessions/tokens are invalidated.
- Rotate immediately after suspected exposure. Otherwise review every 90 days
  (OAuth/DB) or 180 days (signing secrets).
