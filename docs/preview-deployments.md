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
and therefore requires GitHub OAuth credentials. Configure a dedicated preview OAuth client
or another provider callback strategy appropriate for the preview hostnames;
never reuse production-only secrets. The local `development` environment and
its auth-free behavior are unchanged.

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
   BETTER_AUTH_SECRET=<32+-character-preview-secret>
   PGRST_JWT_SECRET=<32+-character-preview-secret>
   GITHUB_CLIENT_ID=<dedicated-preview-oauth-client>
   GITHUB_CLIENT_SECRET=<dedicated-preview-oauth-secret>
   ```

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

5. Configure the OAuth callback strategy for preview hosts. GitHub OAuth
   callback URLs are provider configuration, not repository configuration; use
   a dedicated preview app and confirm whether the provider permits the
   wildcard callback policy you intend. If it does not, use a controlled
   callback relay or register the exact active preview callback. Do not point a
   preview at a production callback without validating cookie and redirect
   isolation.

## GitHub configuration

The workflow reuses the existing GitHub Actions/Tailscale foundation. In the
`preview` environment, configure or reuse the following non-AMP secrets:

- `VPS_SSH_PRIVATE_KEY` — deploy-user key restricted to the VPS;
- `VPS_TAILSCALE_IP` — the VPS Tailscale address; and
- `TAILSCALE_AUTH_KEY` — an ephemeral CI-node auth key.

`GITHUB_TOKEN` is supplied by Actions for GHCR package read/write during the
workflow and is not stored in AMP or on the VPS. Production GitHub secrets are
not used by the preview app. Protect the `preview` environment with the same
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
