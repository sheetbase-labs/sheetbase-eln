# Pull request preview deployments

PR previews run on the existing Hostinger VPS and are separate from the
production Compose project. A preview is available at
`https://pr-<number>.sheetbase.co.uk` while its pull request is open. Opening,
reopening, or updating a PR deploys new immutable images; merging or closing it
removes the route, containers, Compose volumes, and preview data.

The preview workflow is AMP-compatible. It runs from the trusted workflow on
the base branch, checks out PR source only in the secret-free image build job,
and runs the preview controller from `origin/main` on the VPS. AMP does not
need VPS, Cloudflare, GHCR, OAuth, or production credentials.

## Isolation and limits

- Each PR uses the Docker Compose project `sheetbase-pr-<number>`.
- Postgres, PostgREST, and the app run in that project's private network.
- Only the app's PR-specific port `127.0.0.1:32000 + <number>` is published;
  production remains on `127.0.0.1:3000`.
- Preview traffic is routed by a trusted host router using an atomically
  updated route registry. Unknown hosts and unregistered PRs return 404.
- The registry allows at most 4 active previews and PR numbers 1–9999. The
  per-service limits keep the aggregate preview budget bounded on the shared
  VPS.
- Compose applies memory, CPU, and PID limits to every preview service.
- Cleanup uses `docker compose down --volumes --remove-orphans`, so preview
  database and object-storage volumes are removed with the project.
- Preview credentials must be disposable and must not have production database,
  object-storage, Cloudflare, or deployment-controller access.

The preview app uses the separate `SHEETBASE_ENV=preview` deployment contract
and runs in the explicitly seeded demo mode
`SHEETBASE_PREVIEW_DEMO=true`. The app resolves the fixed seeded fixture owner
without a browser session, and the seed service loads the fixture plus Virus
Stability demo data into that PR's disposable database. No GitHub OAuth client
or callback is needed, so concurrent previews do not share authentication
state. The local `development` environment and its auth behavior are unchanged.

This PR is independently runnable and does not depend on PR #1, which remains
an unmerged separate development-environment change. Preview demo auth is
implemented under the preview-only flag here; it is not enabled by ordinary
development configuration and deployment validation rejects it outside
`SHEETBASE_ENV=preview`.

## One-time VPS setup

Perform these steps manually on the VPS; the PR workflow does not create or
delete external infrastructure.

1. Create the controller directory and a separate trusted checkout so preview
   deploys never change the production checkout:

   ```bash
   sudo mkdir -p /opt/sheetbase-preview
   sudo chown deploy:deploy /opt/sheetbase-preview
   git clone <repository-url> /opt/sheetbase-preview/controller
   cd /opt/sheetbase-preview/controller
   corepack enable
   corepack prepare pnpm@11.9.0 --activate
   pnpm install --frozen-lockfile
   printf '[]\n' > /opt/sheetbase-preview/routes.json
   chmod 640 /opt/sheetbase-preview/routes.json
   ```

2. Create `/opt/sheetbase-preview/.env` as a root-owned or deploy-readable
   file. It is not committed and must contain only disposable preview values:

   ```dotenv
   POSTGRES_DB=sheetbase_preview
   POSTGRES_USER=sheetbase
   POSTGRES_PASSWORD=<unique-preview-password>
   POSTGREST_AUTHENTICATOR_PASSWORD=<unique-preview-password>
   MIGRATOR_PASSWORD=<unique-preview-password>
   FORMULA_WRITER_PASSWORD=<unique-preview-password>
   SHEETBASE_POSTGRES_IMAGE=postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
   BETTER_AUTH_SECRET=<32+-character-preview-secret>
   PGRST_JWT_SECRET=<32+-character-preview-secret>
   ```

   `SHEETBASE_POSTGRES_IMAGE` is optional when using the pinned default shown
   above, but any override must be an exact digest-approved PostgreSQL image.
   The preview controller validates the PostgreSQL, application, and PostgREST
   references before pulling or starting anything; it rejects tags without
   `@sha256:<64 hex characters>`.

3. Install the trusted router as a systemd service. It reads only the route
   registry and proxies to loopback ports; it does not access the Docker socket:

   ```ini
   # /etc/systemd/system/sheetbase-preview-router.service
   [Unit]
   Description=Sheetbase PR preview router
   After=network-online.target

   [Service]
   User=deploy
   Group=deploy
   WorkingDirectory=/opt/sheetbase-preview/controller
   Environment=PORT=31000
   Environment=HOST=127.0.0.1
   Environment=BASE_DOMAIN=sheetbase.co.uk
   Environment=ROUTES_FILE=/opt/sheetbase-preview/routes.json
   ExecStart=/usr/bin/node /opt/sheetbase-preview/controller/scripts/preview-router.mjs
   Restart=always
   NoNewPrivileges=true
   PrivateTmp=true
   ProtectHome=true
   ProtectSystem=strict
   ReadWritePaths=/opt/sheetbase-preview

   [Install]
   WantedBy=multi-user.target
   ```

   Start it with `sudo systemctl daemon-reload && sudo systemctl enable --now sheetbase-preview-router`.

4. Configure the existing Cloudflare Tunnel manually. Preserve the exact
   production ingress first, then add the wildcard preview ingress before the
   catch-all:

   ```yaml
   ingress:
     - hostname: app.sheetbase.co.uk
       service: http://127.0.0.1:3000
     - hostname: '*.sheetbase.co.uk'
       service: http://127.0.0.1:31000
     - service: http_status:404
   ```

   Create the wildcard DNS record/hostname route for `*.sheetbase.co.uk` in
   Cloudflare and restart/reload the tunnel. Confirm that the exact production
   route still precedes the wildcard. Do not commit the tunnel token or edit
   production's `app.sheetbase.co.uk` target as part of a PR deployment.

5. The preview demo is intentionally auth-free and needs no OAuth provider
   setup. Treat every preview URL as public: never seed real data, and keep the
   disposable `BETTER_AUTH_SECRET` and database credentials unique to previews.

## GitHub configuration

The workflow reuses the existing GitHub Actions/Tailscale foundation. In the
`preview` environment, configure or reuse the following non-AMP secrets:

- `VPS_SSH_PRIVATE_KEY` — deploy-user key restricted to the VPS;
- `VPS_TAILSCALE_IP` — the VPS Tailscale address; and
- `TAILSCALE_AUTH_KEY` — an ephemeral CI-node auth key.

`GITHUB_TOKEN` is supplied only to the trusted publish/deploy jobs for GHCR;
the PR-controlled build job has `contents: read` only and never logs into
GHCR. It is not stored in AMP or on the VPS. Production GitHub secrets are not
used by the preview app. Protect the `preview` environment with the same
repository policy used for deployment workflows, and restrict PR previews to
same-repository PRs as the workflow does; fork PRs do not receive a preview.

The VPS `/opt/sheetbase-preview/.env` is the secret source for the containers.
It is intentionally not a GitHub secret because it never needs to transit AMP
or workflow logs. Rotate it independently and keep it disposable.

## Local validation and operations

The implementation can be validated without Docker, Cloudflare, or VPS access:

```bash
pnpm test src/lib/preview-deployment.test.ts tests/config/compose.test.ts
pnpm typecheck
pnpm check
```

The first preview workflow run becomes available after this workflow is merged
to `main`; the build reads the PR merge ref, while trusted publishing and the
VPS controller are deliberately separated from that build. No external
resource is created or deleted by local validation.

After setup, a successful deploy prints the preview URL, Compose project, image
digest, and readiness evidence. For manual recovery, remove a route first by
running cleanup with the PR number, then inspect Docker with the exact project:

```bash
SHEETBASE_PREVIEW_NUMBER=123 \
SHEETBASE_PREVIEW_BASE_DOMAIN=sheetbase.co.uk \
pnpm preview:cleanup
docker compose --project-name sheetbase-pr-123 -f compose.preview.yaml ps
```

Do not run `docker compose down -v` against `sheetbase-deploy`; that is the
production project and is intentionally outside the preview cleanup path.
