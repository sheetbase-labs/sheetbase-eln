# Postgres with the role bootstrap baked in, for hosts that build from this
# repository instead of mounting docker/db/init (compose.deploy.yaml mounts it).
# Used by the PR preview sites (docs/operations/previews.md).
FROM postgres:18-alpine
COPY docker/db/init /docker-entrypoint-initdb.d
