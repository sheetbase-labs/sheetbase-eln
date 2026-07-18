# PostgREST with curl available for the container healthcheck.
# Base image is pinned in compose.yaml via the build arg.
ARG POSTGREST_VERSION=v14.5
FROM postgrest/postgrest:${POSTGREST_VERSION}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER 1000
