# PostgREST with curl available for the container healthcheck.
# Base image is pinned in compose.yaml via the build arg.
ARG POSTGREST_VERSION=v14.5
FROM postgrest/postgrest:${POSTGREST_VERSION}

# The postgrest/postgrest image does not define a named "root" user, so use
# the numeric UID 0 for the privileged apt-get install step.
USER 0
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Return to the unprivileged postgrest runtime user (UID 1000).
USER 1000
