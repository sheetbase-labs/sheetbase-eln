# Default prevents a Dockerfile lint warning when the file is inspected
# without build args. The CI workflow always passes an immutable
# @sha256 digest via --build-arg, overriding this mutable default.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN DATABASE_URL=postgresql://build:build@database.invalid/sheetbase \
    FORMULA_DATABASE_URL=postgresql://build:build@database.invalid/sheetbase \
    BETTER_AUTH_SECRET=build-only-placeholder-at-least-32-characters \
    PGRST_JWT_SECRET=build-only-placeholder-at-least-32-characters \
    pnpm build

ARG ARTIFACT_VERSION
ARG SOURCE_REVISION
ARG EXPECTED_MIGRATION

LABEL org.opencontainers.image.title="Sheetbase" \
      org.opencontainers.image.version="${ARTIFACT_VERSION}" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      uk.co.sheetbase.expected-migration="${EXPECTED_MIGRATION}"

ENV NODE_ENV=production \
    PORT=3000 \
    SHEETBASE_ARTIFACT_VERSION=${ARTIFACT_VERSION} \
    SHEETBASE_EXPECTED_MIGRATION=${EXPECTED_MIGRATION}

RUN mkdir -p /app/.storage/objects && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "scripts/serve-production.mjs"]
