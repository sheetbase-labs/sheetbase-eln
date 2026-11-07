# PostgreSQL 18 with pgvector, for search by meaning.
#
# Same base as the stock postgres:18-alpine image, so an existing data volume
# (and its text-sorting rules) carries straight over. Only the extension files
# are added; nothing is created in a database until the migrations run.
#
# vector.control is marked trusted so the migration role, which owns the
# database but is not a superuser, can CREATE EXTENSION without help.
FROM postgres:18-alpine

ARG PGVECTOR_VERSION=0.8.1

RUN apk add --no-cache --virtual .pgvector-build git build-base postgresql-dev \
 && git clone --branch "v${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector \
 && make OPTFLAGS="" with_llvm=no \
 && make install with_llvm=no \
 && echo "trusted = true" >> "$(pg_config --sharedir)/extension/vector.control" \
 && cd / \
 && rm -rf /tmp/pgvector \
 && apk del .pgvector-build
