# PostgREST with curl available for the container healthcheck.
#
# The official postgrest/postgrest image is built FROM scratch — it has no
# shell, no package manager, and no curl. This multi-stage Dockerfile extracts
# the statically-linked postgrest binary from the official image and places it
# in a debian:bookworm-slim runtime that includes curl for healthchecks.
ARG POSTGREST_VERSION=v14.5

# Stage 1: extract the postgrest binary from the official shell-less image.
FROM postgrest/postgrest:${POSTGREST_VERSION} AS source

# Stage 2: debian slim runtime with curl for healthchecks.
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the statically-linked postgrest binary from the official image.
COPY --from=source /bin/postgrest /usr/local/bin/postgrest

# Create an unprivileged runtime user matching the official image's UID 1000.
RUN useradd --system --uid 1000 --no-create-home postgrest
USER postgrest

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/postgrest"]
