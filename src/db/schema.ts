/**
 * Database schema. Two schemas:
 *
 * - internal: Better Auth identity tables (user/session/account/verification)
 *   using Better Auth's supported column conventions. PostgREST never sees
 *   this schema.
 * - api: the PostgREST-exposed domain surface (workspaces, memberships,
 *   projects). Grants and RLS are managed in migrations; RLS arrives with
 *   AUTH-004.
 */
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const internal = pgSchema('internal')
const api = pgSchema('api')

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
}

// ---------------------------------------------------------------------------
// internal — Better Auth core tables.
//
// Column names follow Better Auth's core schema (quoted camelCase). That is a
// deliberate exception to the snake_case convention in docs/conventions.md:
// these tables belong to Better Auth, not to Sheetbase domain naming.
// ---------------------------------------------------------------------------

export const user = internal.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

export const session = internal.table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('idx_session_user_id').on(table.userId)],
)

export const account = internal.table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_account_provider_account').on(table.providerId, table.accountId),
    index('idx_account_user_id').on(table.userId),
  ],
)

export const verification = internal.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

/** Immutable, versioned workflow definitions used by submitted reviews. */
export const reviewWorkflowDefinitions = internal.table(
  'review_workflow_definitions',
  {
    definitionKey: text('definition_key').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.definitionKey, table.version] }),
    check(
      'chk_review_workflow_definition_key',
      sql`${table.definitionKey} ~ '^[a-z0-9][a-z0-9_-]{0,127}$'`,
    ),
    check('chk_review_workflow_definition_version', sql`${table.version} > 0`),
    check(
      'chk_review_workflow_definition_shape',
      sql`jsonb_typeof(${table.definition}) = 'object' AND jsonb_typeof(${table.definition}->'steps') = 'array'`,
    ),
  ],
)

/**
 * Immutable, versioned reviewer check definitions (REV-005). Each definition
 * describes a configurable set of checklist items and data-integrity checks.
 * Like workflow definitions, versions are append-only so a historical check
 * result always references the exact definition that produced it.
 */
export const reviewCheckDefinitions = internal.table(
  'review_check_definitions',
  {
    definitionKey: text('definition_key').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.definitionKey, table.version] }),
    check(
      'chk_review_check_definition_key',
      sql`${table.definitionKey} ~ '^[a-z0-9][a-z0-9_-]{0,127}$'`,
    ),
    check('chk_review_check_definition_version', sql`${table.version} > 0`),
    check(
      'chk_review_check_definition_shape',
      sql`jsonb_typeof(${table.definition}) = 'object' AND jsonb_typeof(${table.definition}->'checks') = 'array'`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// internal — API-005 scoped external API credentials. Never exposed to
// PostgREST's api schema. Secrets are hashed (SHA-256, salted with the
// credential id); the full secret is shown to the user only once at
// creation. Exchange happens server-side (src/lib/api-credentials.ts).
// ---------------------------------------------------------------------------

export const apiCredentials = internal.table(
  'api_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    displayPrefix: text('display_prefix').notNull().unique(),
    secretHash: text('secret_hash').notNull(),
    name: text('name').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_api_credentials_workspace_id').on(table.workspaceId),
    index('idx_api_credentials_secret_hash').on(table.secretHash),
  ],
)

// ---------------------------------------------------------------------------
// api — PostgREST-exposed domain tables.
// ---------------------------------------------------------------------------

export const workspaces = api.table(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps,
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    check(
      'chk_workspaces_status',
      sql`${table.status} IN ('active', 'suspended', 'archived')`,
    ),
  ],
)

export const workspaceMemberships = api.table(
  'workspace_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Better Auth owns user identity; membership references it cross-schema.
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('uq_workspace_memberships_workspace_user').on(
      table.workspaceId,
      table.userId,
    ),
    check(
      'chk_workspace_memberships_role',
      sql`${table.role} IN ('owner', 'member')`,
    ),
    index('idx_workspace_memberships_user_id').on(table.userId),
  ],
)

export const projects = api.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Stable public identifier, unique within the workspace. Immutable; the
    // display title changes freely.
    key: text('key').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps,
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('uq_projects_workspace_key').on(table.workspaceId, table.key),
    check(
      'chk_projects_status',
      sql`${table.status} IN ('active', 'archived')`,
    ),
    index('idx_projects_workspace_id').on(table.workspaceId),
  ],
)

// ---------------------------------------------------------------------------
// api — notebook domain (ELN-002). Decision record 0015 fixes the vocabulary:
// workspace > project > folder > record > block, with record_link and
// revision as first-class tables. "Notebook" is not a separate table; a
// record's notebook is its ordered set of blocks.
// ---------------------------------------------------------------------------

/**
 * Folders organise a project's records. Optional: a record's folder_id may
 * be null (record lives at the project root). Folders nest via parent_id.
 * Stable public id F-YYYY-NNNN, unique within the project.
 */
export const folders = api.table(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    // Stable public identifier, unique within the project. Immutable.
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    ...timestamps,
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('uq_folders_project_identifier').on(
      table.projectId,
      table.identifier,
    ),
    index('idx_folders_project_id').on(table.projectId),
    index('idx_folders_parent_id').on(table.parentId),
  ],
)

/**
 * Records are the polymorphic notebook-backed records (experiment,
 * protocol_template, report, ...). The notebook *is* the record's ordered
 * blocks. kind drives the identifier prefix, status vocabulary and header
 * layout; the block document, links and revisions are shared.
 *
 * Optimistic concurrency is split: structure_version bumps on
 * insert/move/delete of a block; block content edits bump the block's own
 * version (see `blocks`). Soft deletion uses archived_at (reversible) and
 * deleted_at (tombstone with retention window).
 */
export const records = api.table(
  'records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    folderId: uuid('folder_id').references(() => folders.id, {
      onDelete: 'set null',
    }),
    // experiment | protocol_template | report | ... Widen the check to add
    // kinds; do not fork the table.
    kind: text('kind').notNull(),
    // Stable public identifier, unique within the project. Immutable.
    // Prefix is kind-scoped (EXP-, PRT-, RPT-). Assigned by RPC.
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    // Free-form status string; the UI maps it to a StatusBadge domain
    // vocabulary (UI-005). Validated at the application boundary, not by a
    // DB check, so new kinds can introduce their own vocabulary without a
    // migration.
    status: text('status').notNull().default('draft'),
    // SCI-001: configurable typed properties for registry-style record kinds
    // (sample, reagent, protocol_template). A flat JSONB object keyed by
    // field_name; validated at the application boundary against the
    // workspace's active record_field_definitions for the record's kind.
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'`),
    // Typed tags array; UI renders as badges.
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Bumped on any structural change (insert/move/delete of a block).
    // Autosave/content edits do NOT bump this.
    structureVersion: integer('structure_version').notNull().default(1),
    // Bumped on metadata changes (title/status/tags/folder). The audit
    // trail (LIVE-001) is the history; this column guards against
    // simultaneous metadata edits.
    metadataVersion: integer('metadata_version').notNull().default(1),
    calculationInputRevision: bigint('calculation_input_revision', {
      mode: 'bigint',
    })
      .notNull()
      .default(sql`0`),
    ...timestamps,
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    // Actor attribution. Cross-schema FK to Better Auth's user table.
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'records_calculation_input_revision_check',
      sql`${table.calculationInputRevision} >= 0`,
    ),
    unique('uq_records_project_identifier').on(
      table.projectId,
      table.identifier,
    ),
    check(
      'chk_records_kind',
      sql`${table.kind} IN ('experiment', 'protocol_template', 'report', 'sample', 'reagent', 'file', 'notebook_template')`,
    ),
    index('idx_records_workspace_id').on(table.workspaceId),
    index('idx_records_project_id').on(table.projectId),
    index('idx_records_folder_id').on(table.folderId),
    index('idx_records_kind').on(table.kind),
    index('idx_records_status').on(table.status),
  ],
)

/**
 * Blocks are the ordered, typed content units of a record's notebook.
 * Prose headings and lists live inside rich_text documents. `order` is a real so
 * fractional indexing supports insert/move without rewriting every block.
 * `version` is the optimistic-concurrency version for content edits; the
 * record's structure_version moves on insert/move/delete.
 *
 * payload is JSONB validated at the application boundary by
 * (type, payload_schema_version). Unsupported future types are preserved
 * as readable placeholders and never silently rewritten.
 */
export const blocks = api.table(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    // Rich_text, checklist, linked_record, callout, table, chart, plate_map,
    // file, metric, procedure_step, ...
    type: text('type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'`),
    payloadSchemaVersion: integer('payload_schema_version')
      .notNull()
      .default(1),
    // Fractional indexing: insert at position N gets an order value between
    // its neighbours. Moves update only the moved block plus, rarely, a
    // rebalance when precision runs out.
    order: real('order').notNull(),
    // Optimistic concurrency for content edits.
    version: integer('version').notNull().default(1),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_blocks_type',
      sql`${table.type} IN ('rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet', 'chart', 'plate_map', 'file', 'metric', 'procedure_step', 'protocol_reference', 'materials')`,
    ),
    index('idx_blocks_record_id').on(table.recordId),
    // (record_id, order) is the hot loading path for notebook render.
    index('idx_blocks_record_order').on(table.recordId, table.order),
  ],
)

/**
 * record_links are outgoing typed links from a record to another record (or
 * to a structured object by stable id). Separate from blocks because links
 * also drive inspector counts, lineage and review. target_record_id is
 * nullable so the link can render honestly (RecordLink UI-005) when the
 * target is missing, soft-deleted or permission-restricted.
 */
export const recordLinks = api.table(
  'record_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    // Null when the target never existed, was hard-purged, or is not a
    // notebook-backed record (e.g. a reagents registry entry referenced by
    // stable id). Preserved so the link can render honestly.
    targetRecordId: uuid('target_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    // Preserved so a soft-deleted or permission-restricted target still has
    // a label and a kind for the UI.
    targetKind: text('target_kind').notNull(),
    targetIdentifier: text('target_identifier').notNull(),
    linkType: text('link_type').notNull(),
    // SCI-006: optional structured metadata for links. Template-instantiation
    // links carry { template_revision_id } so the source version is durable.
    linkMetadata: jsonb('link_metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'chk_record_links_link_type',
      sql`${table.linkType} IN ('sample', 'protocol', 'dataset', 'reagent', 'analysis', 'file', 'general', 'template')`,
    ),
    // No duplicate (source, target_identifier, link_type). target_identifier
    // is used (not target_record_id) so a link to a missing target is still
    // deduplicated.
    unique('uq_record_links_source_target_type').on(
      table.sourceRecordId,
      table.targetIdentifier,
      table.linkType,
    ),
    index('idx_record_links_source_record_id').on(table.sourceRecordId),
    index('idx_record_links_target_record_id').on(table.targetRecordId),
    index('idx_record_links_link_type').on(table.linkType),
  ],
)

/**
 * file_objects holds the universal storage-boundary metadata for a `file`
 * record (SCI-003, decision 0028). 1:1 with a file record: the record carries
 * identity, ownership, links, events and audit; this table carries the storage
 * key, checksum, media type, size and lifecycle state. The bytes live behind
 * the object-storage boundary and are never proxied through /api/db.
 *
 * `display_name` is untrusted client metadata, never used as the storage key.
 * `status` is the honest lifecycle state: active | quarantined | deleted |
 * missing. `version` guards optimistic lifecycle transitions.
 */
export const fileObjects = api.table(
  'file_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .unique()
      .references(() => records.id, { onDelete: 'cascade' }),
    // Server-generated, unique, independent of the user filename.
    storageKey: text('storage_key').notNull().unique(),
    // Untrusted client filename; display only.
    displayName: text('display_name').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
    checksum: text('checksum'),
    checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
    status: text('status').notNull().default('active'),
    statusReason: text('status_reason'),
    storageBackend: text('storage_backend').notNull().default('local'),
    quarantinedAt: timestamp('quarantined_at', {
      withTimezone: true,
      mode: 'date',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    version: integer('version').notNull().default(1),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_file_objects_status',
      sql`${table.status} IN ('active', 'quarantined', 'deleted', 'missing')`,
    ),
    check(
      'chk_file_objects_byte_size',
      sql`${table.byteSize} BETWEEN 0 AND 104857600`,
    ),
    check(
      'chk_file_objects_media_type',
      sql`${table.mediaType} IN ('text/csv', 'text/plain', 'application/json', 'application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream')`,
    ),
    check(
      'chk_file_objects_storage_backend',
      sql`${table.storageBackend} IN ('local', 's3')`,
    ),
    check(
      'chk_file_objects_checksum_algorithm',
      sql`${table.checksumAlgorithm} = 'sha256'`,
    ),
    check(
      'chk_file_objects_deleted_consistency',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} IS NOT NULL)`,
    ),
    check(
      'chk_file_objects_quarantined_consistency',
      sql`(${table.status} = 'quarantined') = (${table.quarantinedAt} IS NOT NULL)`,
    ),
    index('idx_file_objects_workspace').on(table.workspaceId),
    index('idx_file_objects_record').on(table.recordId),
  ],
)

/**
 * revisions are immutable snapshots taken at submit, sign or an explicit
 * "save version" action. The live records/blocks rows continue to evolve;
 * the revision is the authority for review (Phase 6). Never deleted with
 * the record (audit-safe).
 */
export const revisions = api.table(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Populated by the controlled submission RPC. The database insert trigger
    // also derives it for legacy migrator/seed revisions created before
    // REV-002; request roles no longer have direct INSERT permission.
    workspaceId: uuid('workspace_id')
      .notNull()
      .default(sql`NULL`)
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    // The structure_version and metadata_version captured at snapshot time,
    // so a reader can correlate the revision with the live row's history.
    structureVersion: integer('structure_version').notNull(),
    metadataVersion: integer('metadata_version').notNull(),
    metadataSnapshot: jsonb('metadata_snapshot').notNull(),
    blockSnapshot: jsonb('block_snapshot').notNull(),
    canonicalSnapshot: jsonb('canonical_snapshot')
      .notNull()
      .default(sql`NULL`),
    integrityAlgorithm: text('integrity_algorithm').notNull().default('sha256'),
    integrityDigest: text('integrity_digest')
      .notNull()
      .default(sql`NULL`),
    // submit | sign | manual
    reason: text('reason').notNull(),
    // Set when a later revision supersedes this one; the row is kept.
    supersededByRevisionId: uuid('superseded_by_revision_id'),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [
    check(
      'chk_revisions_reason',
      sql`${table.reason} IN ('submit', 'sign', 'manual', 'validate')`,
    ),
    check(
      'chk_revisions_integrity_algorithm',
      sql`${table.integrityAlgorithm} = 'sha256'`,
    ),
    check(
      'chk_revisions_integrity_digest',
      sql`${table.integrityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    index('idx_revisions_workspace_id').on(table.workspaceId),
    index('idx_revisions_record_id').on(table.recordId),
    index('idx_revisions_created_at').on(table.createdAt),
  ],
)

/**
 * A review submission binds one immutable revision to the versioned workflow
 * and first-step reviewers selected at submit time. REV-002 exposes it as a
 * read-only REST resource; later review tickets add controlled transitions.
 */
export const reviewSubmissions = api.table(
  'review_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .unique()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    state: text('state').notNull().default('submitted'),
    workflowDefinitionKey: text('workflow_definition_key').notNull(),
    workflowDefinitionVersion: integer('workflow_definition_version').notNull(),
    assignedReviewerUserIds: text('assigned_reviewer_user_ids')
      .array()
      .notNull(),
    submittedByUserId: text('submitted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    submittedSessionId: text('submitted_session_id').notNull(),
    submittedRole: text('submitted_role').notNull(),
    submittedAt: timestamp('submitted_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (table) => [
    check('chk_review_submissions_state', sql`${table.state} = 'submitted'`),
    check(
      'chk_review_submissions_workflow_key',
      sql`${table.workflowDefinitionKey} ~ '^[a-z0-9][a-z0-9_-]{0,127}$'`,
    ),
    check(
      'chk_review_submissions_workflow_version',
      sql`${table.workflowDefinitionVersion} > 0`,
    ),
    check(
      'chk_review_submissions_reviewers',
      sql`cardinality(${table.assignedReviewerUserIds}) > 0`,
    ),
    check(
      'chk_review_submissions_idempotency_key',
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 128`,
    ),
    unique('uq_review_submissions_actor_idempotency').on(
      table.workspaceId,
      table.submittedByUserId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.workflowDefinitionKey, table.workflowDefinitionVersion],
      foreignColumns: [
        reviewWorkflowDefinitions.definitionKey,
        reviewWorkflowDefinitions.version,
      ],
      name: 'review_submissions_workflow_definition_fk',
    }).onDelete('restrict'),
    index('idx_review_submissions_workspace_state').on(
      table.workspaceId,
      table.state,
      table.submittedAt,
    ),
    index('idx_review_submissions_record').on(
      table.recordId,
      table.submittedAt,
    ),
  ],
)

/**
 * Immutable reviewer check results (REV-005). Each row records the outcome of
 * running a versioned check definition against a frozen revision's canonical
 * snapshot. The inputs (the snapshot) and the check definition are pinned by
 * their SHA-256 digests so live data changes can never rewrite historical
 * evidence. Like revisions, results are write-once — the immutability trigger
 * prevents updates and deletes by application roles.
 */
export const reviewCheckResults = api.table(
  'review_check_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    checkDefinitionKey: text('check_definition_key').notNull(),
    checkDefinitionVersion: integer('check_definition_version').notNull(),
    revisionIntegrityDigest: text('revision_integrity_digest').notNull(),
    checkDefinitionDigest: text('check_definition_digest').notNull(),
    inputDigest: text('input_digest').notNull(),
    overallStatus: text('overall_status').notNull(),
    passCount: integer('pass_count').notNull().default(0),
    blockingFailureCount: integer('blocking_failure_count')
      .notNull()
      .default(0),
    warningFailureCount: integer('warning_failure_count').notNull().default(0),
    infoFailureCount: integer('info_failure_count').notNull().default(0),
    results: jsonb('results').notNull(),
    runByUserId: text('run_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    runSessionId: text('run_session_id').notNull(),
    runRole: text('run_role').notNull(),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_review_check_results_status',
      sql`${table.overallStatus} IN ('pass', 'warning', 'fail')`,
    ),
    check(
      'chk_review_check_results_definition_key',
      sql`${table.checkDefinitionKey} ~ '^[a-z0-9][a-z0-9_-]{0,127}$'`,
    ),
    check(
      'chk_review_check_results_definition_version',
      sql`${table.checkDefinitionVersion} > 0`,
    ),
    check(
      'chk_review_check_results_revision_digest',
      sql`${table.revisionIntegrityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_review_check_results_definition_digest',
      sql`${table.checkDefinitionDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_review_check_results_input_digest',
      sql`${table.inputDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_review_check_results_idempotency_key',
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 128`,
    ),
    check(
      'chk_review_check_results_counts',
      sql`${table.passCount} >= 0 AND ${table.blockingFailureCount} >= 0 AND ${table.warningFailureCount} >= 0 AND ${table.infoFailureCount} >= 0`,
    ),
    check(
      'chk_review_check_results_results_shape',
      sql`jsonb_typeof(${table.results}) = 'array'`,
    ),
    unique('uq_review_check_results_actor_idempotency').on(
      table.workspaceId,
      table.runByUserId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.checkDefinitionKey, table.checkDefinitionVersion],
      foreignColumns: [
        reviewCheckDefinitions.definitionKey,
        reviewCheckDefinitions.version,
      ],
      name: 'review_check_results_definition_fk',
    }).onDelete('restrict'),
    index('idx_review_check_results_revision').on(table.revisionId),
    index('idx_review_check_results_workspace_status').on(
      table.workspaceId,
      table.overallStatus,
      table.runAt,
    ),
    index('idx_review_check_results_record').on(table.recordId, table.runAt),
  ],
)

/**
 * comments (REV-004) are anchored review discussions on an immutable
 * submitted revision. The anchor is `revision_id` plus a stable `target`
 * descriptor referencing an entity by its snapshot identity (block id, table
 * id / row / column, or a deterministic diff change id between two immutable
 * revisions). Because both sides of the anchor are frozen, later draft edits
 * can never silently move a comment to unrelated content.
 *
 * Threading uses `rootId` (self for a top-level comment) and `parentId` (the
 * direct parent for a reply; null for top-level). Resolution is a
 * thread-level state stored on the root; replies are always 'open' and
 * inherit the thread state for display.
 *
 * Author attribution is honest about departed users: `authorUserId` is ON
 * DELETE SET NULL and the UI renders "Deleted user" when it is null. Writes
 * go only through SECURITY DEFINER RPCs (create/reply/resolve/reopen), so
 * target validation, workspace membership and mention checks are enforced in
 * one place; request roles get SELECT plus EXECUTE on the RPCs and nothing
 * else.
 */
export const comments = api.table(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    // Self for a top-level comment; the thread root for replies.
    rootId: uuid('root_id')
      .notNull()
      .references((): AnyPgColumn => comments.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'restrict',
    }),
    // revision | block | table_region | diff
    targetKind: text('target_kind').notNull(),
    target: jsonb('target')
      .notNull()
      .default(sql`'{}'`),
    body: text('body').notNull(),
    mentions: text('mentions')
      .array()
      .notNull()
      .default(sql`'{}'`),
    // open | resolved (thread-level state on the root).
    state: text('state').notNull().default('open'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    authorUserId: text('author_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_comments_target_kind',
      sql`${table.targetKind} IN ('revision', 'block', 'table_region', 'diff')`,
    ),
    check('chk_comments_state', sql`${table.state} IN ('open', 'resolved')`),
    check('chk_comments_body', sql`length(${table.body}) BETWEEN 1 AND 8000`),
    check(
      'chk_comments_resolved_consistency',
      sql`(${table.state} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
    ),
    check(
      'chk_comments_root_parent',
      sql`(${table.parentId} IS NULL) = (${table.rootId} = ${table.id})`,
    ),
    index('idx_comments_workspace_revision').on(
      table.workspaceId,
      table.revisionId,
      table.createdAt,
    ),
    index('idx_comments_root').on(
      table.workspaceId,
      table.rootId,
      table.createdAt,
    ),
    index('idx_comments_record').on(table.workspaceId, table.recordId),
  ],
)

/**
 * Normalized retention references for every physical file object captured in
 * an immutable revision envelope. This internal table pins the exact storage
 * identity, checksum and size so later draft uploads cannot replace evidence.
 */
export const revisionFileObjects = internal.table(
  'revision_file_objects',
  {
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    fileObjectId: uuid('file_object_id')
      .notNull()
      .references(() => fileObjects.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    fileRecordId: uuid('file_record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull(),
    storageBackend: text('storage_backend').notNull(),
    checksumAlgorithm: text('checksum_algorithm').notNull(),
    checksum: text('checksum').notNull(),
    byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.fileObjectId] }),
    unique('uq_revision_file_objects_storage_key').on(
      table.revisionId,
      table.storageKey,
    ),
    check(
      'chk_revision_file_objects_checksum_algorithm',
      sql`${table.checksumAlgorithm} = 'sha256'`,
    ),
    check(
      'chk_revision_file_objects_checksum',
      sql`${table.checksum} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_revision_file_objects_byte_size',
      sql`${table.byteSize} BETWEEN 0 AND 104857600`,
    ),
    index('idx_revision_file_objects_file_object').on(table.fileObjectId),
    index('idx_revision_file_objects_file_record').on(table.fileRecordId),
  ],
)

/**
 * record_field_definitions (SCI-001) define the configurable, typed property
 * schema for a record kind within a workspace. The values live in
 * records.properties as a flat JSONB object keyed by field_name. Reuses the
 * Phase 4 scientific type vocabulary (decision 0019) for logical_type, unit
 * and validation. Workspace-owned and admin-managed (owner-only writes via
 * RLS); all members read. Retiring a field does not delete historical values.
 */
export const recordFieldDefinitions = api.table(
  'record_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // sample | reagent | protocol_template | future kinds. The record kind
    // whose properties this definition describes.
    kind: text('kind').notNull(),
    // Stable slug; the key in records.properties. Immutable once active rows
    // reference it (guarded by trigger); rename the label, not the field_name.
    fieldName: text('field_name').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull(),
    // Reuses the scientific_columns type vocabulary (decision 0019).
    logicalType: text('logical_type').notNull(),
    nullable: boolean('nullable').notNull().default(true),
    defaultValue: jsonb('default_value'),
    unit: jsonb('unit'),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'`),
    lifecycle: text('lifecycle').notNull().default('active'),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('uq_record_field_definitions_workspace_kind_field').on(
      table.workspaceId,
      table.kind,
      table.fieldName,
    ),
    check(
      'chk_record_field_definitions_kind',
      sql`${table.kind} IN ('sample', 'reagent', 'protocol_template', 'notebook_template')`,
    ),
    check(
      'chk_record_field_definitions_type',
      sql`${table.logicalType} IN ('text','integer','decimal','boolean','date','timestamp','category')`,
    ),
    check(
      'chk_record_field_definitions_lifecycle',
      sql`${table.lifecycle} IN ('active', 'retired')`,
    ),
    index('idx_record_field_definitions_workspace_kind').on(
      table.workspaceId,
      table.kind,
    ),
  ],
)

/**
 * sample_events (REG-002) is the append-only chain-of-custody and quantity
 * event log for sample records. Every controlled receive/consume/transfer
 * appends one row with actor attribution; the authoritative quantity and
 * storage location stay in `records.properties`. RLS gives workspace members
 * read access and lets the SECURITY INVOKER RPCs insert (with
 * actor = current_user_id), but no role can UPDATE or DELETE — the history is
 * durable. `quantity_delta`, `quantity_before` and `quantity_after` are either
 * all present (quantity-bearing operations) or all absent (transfer/edit/
 * archive/restore), and `quantity_after = quantity_before + quantity_delta`
 * with no negative result.
 */
export const sampleEvents = api.table(
  'sample_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    // create | receive | consume | transfer | edit | archive | restore
    operation: text('operation').notNull(),
    // Signed: receive > 0, consume < 0, null for non-quantity operations.
    quantityDelta: numeric('quantity_delta'),
    quantityBefore: numeric('quantity_before'),
    quantityAfter: numeric('quantity_after'),
    quantityUnit: text('quantity_unit'),
    fromLocation: text('from_location'),
    toLocation: text('to_location'),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_sample_events_operation',
      sql`${table.operation} IN ('create','receive','consume','transfer','edit','archive','restore')`,
    ),
    check(
      'chk_sample_events_quantity_presence',
      sql`(${table.quantityDelta} IS NOT NULL) = (${table.quantityBefore} IS NOT NULL) AND (${table.quantityDelta} IS NOT NULL) = (${table.quantityAfter} IS NOT NULL)`,
    ),
    check(
      'chk_sample_events_quantity_arithmetic',
      sql`${table.quantityDelta} IS NULL OR (${table.quantityAfter} = (${table.quantityBefore} + ${table.quantityDelta}) AND ${table.quantityAfter} >= 0)`,
    ),
    check(
      'chk_sample_events_receive_delta',
      sql`${table.operation} <> 'receive' OR ${table.quantityDelta} > 0`,
    ),
    check(
      'chk_sample_events_consume_delta',
      sql`${table.operation} <> 'consume' OR ${table.quantityDelta} < 0`,
    ),
    check(
      'chk_sample_events_transfer_locations',
      sql`${table.operation} <> 'transfer' OR (${table.fromLocation} IS NOT NULL AND ${table.toLocation} IS NOT NULL AND ${table.fromLocation} <> ${table.toLocation})`,
    ),
    index('idx_sample_events_record_created').on(
      table.recordId,
      table.createdAt,
    ),
    index('idx_sample_events_workspace_created').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('idx_sample_events_operation').on(table.operation),
  ],
)

// SCI-010: workspace-level dataset schema registry (decision 0034). A stable,
// versioned, permission-managed metadata layer over the per-sheet physical
// tables. Cross-sheet queries join on dataset_schema_field_id, not physical
// column names.
export const datasetSchemas = api.table(
  'dataset_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Stable, immutable, workspace-unique slug. The cross-sheet schema identity.
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    // Immutable once published; starts at 1. Each revision is a separate row.
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull().default('draft'),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_dataset_schemas_workspace_slug_revision').on(
      table.workspaceId,
      table.slug,
      table.revision,
    ),
    check(
      'chk_dataset_schemas_slug',
      sql`${table.slug} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
    check(
      'chk_dataset_schemas_status',
      sql`${table.status} IN ('draft', 'published', 'retired')`,
    ),
    check('chk_dataset_schemas_revision', sql`${table.revision} > 0`),
    index('idx_dataset_schemas_workspace_slug').on(
      table.workspaceId,
      table.slug,
    ),
  ],
)

export const datasetSchemaFields = api.table(
  'dataset_schema_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => datasetSchemas.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Stable, immutable within (schema_id, slug). The cross-sheet join key.
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull(),
    // Reuses the scientific_columns type vocabulary (decision 0019).
    logicalType: text('logical_type').notNull(),
    nullable: boolean('nullable').notNull().default(true),
    defaultValue: jsonb('default_value'),
    unit: jsonb('unit'),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'`),
    lifecycle: text('lifecycle').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    unique('uq_dataset_schema_fields_schema_slug').on(
      table.schemaId,
      table.slug,
    ),
    check(
      'chk_dataset_schema_fields_slug',
      sql`${table.slug} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
    check(
      'chk_dataset_schema_fields_type',
      sql`${table.logicalType} IN ('text','integer','decimal','boolean','date','timestamp','category','reference')`,
    ),
    check(
      'chk_dataset_schema_fields_lifecycle',
      sql`${table.lifecycle} IN ('active', 'retired')`,
    ),
    index('idx_dataset_schema_fields_schema').on(table.schemaId),
    index('idx_dataset_schema_fields_workspace').on(table.workspaceId),
  ],
)

// SCI-011: typed, directed relationships between dataset schemas (decision
// 0035). Slug-level (not revision-level): source/target point to the latest
// published revision and are repointed on publish. Soft-deleted via lifecycle.
export const datasetSchemaRelationships = api.table(
  'dataset_schema_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceSchemaId: uuid('source_schema_id')
      .notNull()
      .references(() => datasetSchemas.id, { onDelete: 'cascade' }),
    targetSchemaId: uuid('target_schema_id')
      .notNull()
      .references(() => datasetSchemas.id, { onDelete: 'cascade' }),
    relationshipType: text('relationship_type').notNull(),
    label: text('label').notNull().default(''),
    cardinality: text('cardinality').notNull().default('one_to_many'),
    sourceFieldId: uuid('source_field_id').references(
      () => datasetSchemaFields.id,
      {
        onDelete: 'set null',
      },
    ),
    targetFieldId: uuid('target_field_id').references(
      () => datasetSchemaFields.id,
      {
        onDelete: 'set null',
      },
    ),
    lifecycle: text('lifecycle').notNull().default('active'),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_dataset_schema_relationships_type',
      sql`${table.relationshipType} IN ('references','derives_from','composed_of')`,
    ),
    check(
      'chk_dataset_schema_relationships_cardinality',
      sql`${table.cardinality} IN ('one_to_one','one_to_many','many_to_many')`,
    ),
    check(
      'chk_dataset_schema_relationships_lifecycle',
      sql`${table.lifecycle} IN ('active','inactive')`,
    ),
    check(
      'no_self_reference',
      sql`${table.sourceSchemaId} <> ${table.targetSchemaId}`,
    ),
    uniqueIndex('uq_dataset_schema_relationships_active')
      .on(table.sourceSchemaId, table.targetSchemaId, table.relationshipType)
      .where(sql`${table.lifecycle} = 'active'`),
    index('idx_dataset_schema_relationships_workspace').on(table.workspaceId),
    index('idx_dataset_schema_relationships_source').on(table.sourceSchemaId),
    index('idx_dataset_schema_relationships_target').on(table.targetSchemaId),
  ],
)

export const scientificTables = api.table(
  'scientific_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    blockId: uuid('block_id')
      .notNull()
      .unique()
      .references(() => blocks.id, { onDelete: 'restrict' }),
    resourceName: text('resource_name').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    displaySettings: jsonb('display_settings')
      .notNull()
      .default(sql`'{}'`),
    lifecycle: text('lifecycle').notNull().default('active'),
    schemaVersion: integer('schema_version').notNull().default(1),
    // SCI-010: nullable binding to the dataset schema registry. null = legacy
    // unbound sheet (migration 0013 behaviour preserved).
    datasetSchemaId: uuid('dataset_schema_id').references(
      () => datasetSchemas.id,
      {
        onDelete: 'set null',
      },
    ),
    datasetSchemaRevision: integer('dataset_schema_revision'),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdByCredentialId: uuid('created_by_credential_id').references(
      () => apiCredentials.id,
      { onDelete: 'set null' },
    ),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByCredentialId: uuid('updated_by_credential_id').references(
      () => apiCredentials.id,
      { onDelete: 'set null' },
    ),
  },
  (table) => [
    check(
      'chk_scientific_tables_resource_name',
      sql`${table.resourceName} ~ '^sheet_[a-z2-7]{26}$'`,
    ),
    check(
      'chk_scientific_tables_lifecycle',
      sql`${table.lifecycle} IN ('active', 'retired')`,
    ),
    check(
      'chk_scientific_tables_schema_version',
      sql`${table.schemaVersion} > 0`,
    ),
    index('idx_scientific_tables_workspace').on(table.workspaceId),
    index('idx_scientific_tables_record').on(table.recordId),
  ],
)

export const scientificColumns = api.table(
  'scientific_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => scientificTables.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fieldName: text('field_name').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull(),
    logicalType: text('logical_type').notNull(),
    nullable: boolean('nullable').notNull().default(true),
    defaultValue: jsonb('default_value'),
    unit: jsonb('unit'),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'`),
    width: integer('width'),
    lifecycle: text('lifecycle').notNull().default('active'),
    // SCI-010: link to the stable dataset schema field identity. null = local
    // ad-hoc column with no cross-sheet identity.
    datasetSchemaFieldId: uuid('dataset_schema_field_id').references(
      () => datasetSchemaFields.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdByCredentialId: uuid('created_by_credential_id').references(
      () => apiCredentials.id,
      { onDelete: 'set null' },
    ),
  },
  (table) => [
    unique('uq_scientific_columns_table_field').on(
      table.tableId,
      table.fieldName,
    ),
    unique('uq_scientific_columns_table_order').on(
      table.tableId,
      table.displayOrder,
    ),
    check(
      'chk_scientific_columns_field_name',
      sql`${table.fieldName} ~ '^col_[a-z2-7]{26}$'`,
    ),
    check(
      'chk_scientific_columns_type',
      sql`${table.logicalType} IN ('text','integer','decimal','boolean','date','timestamp','category','reference')`,
    ),
    check(
      'chk_scientific_columns_lifecycle',
      sql`${table.lifecycle} IN ('active', 'retired')`,
    ),
    index('idx_scientific_columns_table').on(table.tableId),
    index('idx_scientific_columns_workspace').on(table.workspaceId),
  ],
)

export const scientificCategoryOptions = api.table(
  'scientific_category_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    columnId: uuid('column_id')
      .notNull()
      .references(() => scientificColumns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    displayOrder: integer('display_order').notNull(),
    lifecycle: text('lifecycle').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    unique('uq_scientific_category_options_order').on(
      table.columnId,
      table.displayOrder,
    ),
    check(
      'chk_scientific_category_options_lifecycle',
      sql`${table.lifecycle} IN ('active', 'retired')`,
    ),
    index('idx_scientific_category_options_column').on(table.columnId),
    index('idx_scientific_category_options_workspace').on(table.workspaceId),
  ],
)

export const scientificTransfers = api.table(
  'scientific_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    tableId: uuid('table_id')
      .notNull()
      .references(() => scientificTables.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    format: text('format').notNull(),
    fileName: text('file_name'),
    fileSize: bigint('file_size', { mode: 'number' }),
    fileSha256: text('file_sha256'),
    rowCount: integer('row_count').notNull(),
    duplicateStrategy: text('duplicate_strategy'),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'`),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorCredentialId: uuid('actor_credential_id').references(
      () => apiCredentials.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'scientific_transfer_operation_check',
      sql`${table.operation} IN ('import','export')`,
    ),
    check(
      'scientific_transfer_format_check',
      sql`${table.format} IN ('csv','csv+metadata')`,
    ),
    index('idx_scientific_transfers_table').on(table.tableId, table.createdAt),
  ],
)

export const formulaDefinitions = api.table(
  'formula_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    recordId: uuid('record_id').notNull(),
    targetTableId: uuid('target_table_id').notNull(),
    targetRowId: uuid('target_row_id').notNull(),
    targetColumnId: uuid('target_column_id').notNull(),
    sourceExpression: text('source_expression').notNull(),
    template: jsonb('template').notNull(),
    bindings: jsonb('bindings').notNull(),
    engineExpression: text('engine_expression').notNull(),
    syntaxProfile: text('syntax_profile').notNull(),
    functionProfile: text('function_profile').notNull(),
    literalProfile: text('literal_profile').notNull(),
    engineVersion: text('engine_version').notNull(),
    status: text('status').notNull().default('supported'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.recordId],
      foreignColumns: [records.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.targetTableId],
      foreignColumns: [scientificTables.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.targetColumnId],
      foreignColumns: [scientificColumns.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [user.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.updatedByUserId],
      foreignColumns: [user.id],
    }).onDelete('restrict'),
    check(
      'formula_definitions_source_expression_check',
      sql`length(${table.sourceExpression}) BETWEEN 1 AND 8192`,
    ),
    check(
      'formula_definitions_template_check',
      sql`jsonb_typeof(${table.template}) = 'object'`,
    ),
    check(
      'formula_definitions_bindings_check',
      sql`jsonb_typeof(${table.bindings}) = 'array'`,
    ),
    check('formula_definitions_version_check', sql`${table.version} > 0`),
    check(
      'chk_formula_status',
      sql`${table.status} IN ('supported', 'unsupported')`,
    ),
    check(
      'chk_formula_profiles',
      sql`${table.syntaxProfile} = 'sheetbase-hf-en-us-v1' AND ${table.functionProfile} = 'scientific-core-v1' AND ${table.literalProfile} = 'sheetbase-literal-v1' AND ${table.engineVersion} = '3.3.0'`,
    ),
    unique('uq_formula_stable_target').on(
      table.targetTableId,
      table.targetRowId,
      table.targetColumnId,
    ),
    index('idx_formula_record').on(table.recordId),
    index('idx_formula_workspace').on(table.workspaceId),
  ],
)

export const formulaDependencies = api.table(
  'formula_dependencies',
  {
    formulaId: uuid('formula_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    recordId: uuid('record_id').notNull(),
    sourceTableId: uuid('source_table_id').notNull(),
    sourceRowId: uuid('source_row_id').notNull(),
    sourceColumnId: uuid('source_column_id').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.formulaId,
        table.sourceTableId,
        table.sourceRowId,
        table.sourceColumnId,
      ],
    }),
    foreignKey({
      columns: [table.formulaId],
      foreignColumns: [formulaDefinitions.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.recordId],
      foreignColumns: [records.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceTableId],
      foreignColumns: [scientificTables.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.sourceColumnId],
      foreignColumns: [scientificColumns.id],
    }).onDelete('restrict'),
    index('idx_formula_dependency_source').on(
      table.sourceTableId,
      table.sourceRowId,
      table.sourceColumnId,
    ),
  ],
)

export const formulaResultCache = internal.table(
  'formula_result_cache',
  {
    formulaId: uuid('formula_id')
      .primaryKey()
      .references(() => formulaDefinitions.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    formulaVersion: bigint('formula_version', { mode: 'bigint' }).notNull(),
    inputRevision: bigint('input_revision', { mode: 'bigint' }).notNull(),
    schemaVersions: jsonb('schema_versions').notNull(),
    status: text('status').notNull(),
    resultKind: text('result_kind').notNull(),
    value: jsonb('value'),
    errorCode: text('error_code'),
    diagnostic: text('diagnostic'),
    engineVersion: text('engine_version').notNull(),
    profileFingerprint: text('profile_fingerprint').notNull(),
    runtimeFingerprint: text('runtime_fingerprint').notNull(),
    calculatedAt: timestamp('calculated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('formula_result_version_check', sql`${table.formulaVersion} > 0`),
    check('formula_result_revision_check', sql`${table.inputRevision} >= 0`),
    check(
      'formula_result_schema_versions_check',
      sql`jsonb_typeof(${table.schemaVersions}) = 'object'`,
    ),
    check(
      'formula_result_status_check',
      sql`${table.status} IN ('completed', 'failed', 'unavailable')`,
    ),
    check(
      'formula_result_kind_check',
      sql`${table.resultKind} IN ('value', 'error', 'none')`,
    ),
    check(
      'formula_result_profile_check',
      sql`${table.engineVersion} = '3.3.0' AND ${table.profileFingerprint} = 'fnv1a32-0c96cef0'`,
    ),
    index('idx_formula_result_record').on(table.recordId),
  ],
)

// ---------------------------------------------------------------------------
// api — durable workspace change events (LIVE-001). Append-only,
// workspace-scoped history of every durable mutation to the notebook and
// project domain. Populated exclusively by SECURITY DEFINER triggers on the
// domain tables (internal schema), so every mutation — RPC or direct
// PostgREST CRUD — emits transactionally, and request roles can neither
// write nor forge events directly (no INSERT/UPDATE/DELETE grants; RLS
// members-read-only). Decision record 0016.
//
// `sequence` is a per-workspace, gapless, monotonic bigint assigned from
// api.workspace_change_seq. The pair (workspace_id, sequence) is the stable
// replay cursor for LIVE-002 SSE reconnection. `payload` is a lightweight
// summary (changed fields, new order, bumped version) — never the full
// source of truth; clients refetch the entity after seeing an event.
// ---------------------------------------------------------------------------

/**
 * Per-workspace monotonic counter backing change_events.sequence. Written
 * only by the SECURITY DEFINER emit helper under a row lock; no request-role
 * grants. One row per workspace, created on first mutation.
 */
export const workspaceChangeSeq = api.table(
  'workspace_change_seq',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Per-workspace monotonic counter, incremented under a row lock by the
    // SECURITY DEFINER emit helper. Not a global serial — one independent
    // counter per workspace.
    lastSeq: bigint('last_seq', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    ...timestamps,
  },
  (table) => [
    index('idx_workspace_change_seq_workspace_id').on(table.workspaceId),
  ],
)

/**
 * Append-only durable change event. RLS: workspace members can read; no
 * request role can write. `operation` is the semantic operation
 * (create|update|move|delete|archive|restore|link|unlink), derived from
 * OLD/NEW comparison in the trigger. `record_id` and `project_id` are
 * nullable scoping hints so LIVE-003 can invalidate only the affected
 * collections. `client_id` lets a client reconcile its own echoed events.
 */
export const changeEvents = api.table(
  'change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Per-workspace gapless sequence. (workspace_id, sequence) is unique and
    // is the SSE replay cursor.
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    // project | folder | record | block | record_link
    entityType: text('entity_type').notNull(),
    entityUuid: uuid('entity_uuid').notNull(),
    // create | update | move | delete | archive | restore | link | unlink
    operation: text('operation').notNull(),
    // Record identity when the event is about a block or link; null for
    // project/folder events. Lets LIVE-003 invalidate record-scoped caches.
    recordId: uuid('record_id'),
    // Project context for record/block/link/folder events; for project
    // events this equals entity_uuid.
    projectId: uuid('project_id'),
    // Actor attribution (Better Auth user id). Nullable for bootstrap paths
    // that run without request claims; LIVE-001 emits only when an actor is
    // present, so seed/migration events are skipped.
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorCredentialId: uuid('actor_credential_id').references(
      () => apiCredentials.id,
      { onDelete: 'set null' },
    ),
    // Stable client identity for self-reconciliation (LIVE-003). Populated
    // from the `client_id` JWT claim; null until the client sends one.
    clientId: text('client_id'),
    // Lightweight summary (e.g. {blockId, type, order, structureVersion}).
    // Never the full source of truth; clients refetch after seeing an event.
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_change_events_workspace_sequence').on(
      table.workspaceId,
      table.sequence,
    ),
    check(
      'chk_change_events_entity_type',
      sql`${table.entityType} IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation', 'record_field_definition', 'file', 'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship', 'sample_event', 'comment')`,
    ),
    check(
      'chk_change_events_operation',
      sql`${table.operation} IN ('create', 'update', 'move', 'delete', 'archive', 'restore', 'link', 'unlink', 'quarantine', 'resolve', 'reopen')`,
    ),
    // Hot replay path: WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence.
    index('idx_change_events_workspace_sequence').on(
      table.workspaceId,
      table.sequence,
    ),
    // Record-scoped invalidation: WHERE workspace_id = $1 AND record_id = $2.
    index('idx_change_events_workspace_record').on(
      table.workspaceId,
      table.recordId,
    ),
    // Retention/cleanup boundary.
    index('idx_change_events_created_at').on(table.createdAt),
  ],
)

/**
 * reagent_movements (REG-003) — the auditable inventory ledger for reagents.
 * One row per receive/consume/quarantine/restore movement, written exclusively
 * by the `record_reagent_movement` SECURITY DEFINER RPC (no direct INSERT
 * grant to request roles). Snapshots supplier/catalog_no/lot/expiry at
 * movement time so the historical identity used by experiments is preserved
 * when the reagent record's properties are later updated.
 *
 * `quantity_delta` is signed: positive for receive, negative for consume, zero
 * for quarantine/restore. `resulting_quantity` is the absolute stock after the
 * movement. Low-stock and expiry attention are derived by the application from
 * configured thresholds; they are never stored as a status here.
 */
export const reagentMovements = api.table(
  'reagent_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reagentRecordId: uuid('reagent_record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    quantityDelta: decimal('quantity_delta', {
      precision: 18,
      scale: 6,
    }).notNull(),
    resultingQuantity: decimal('resulting_quantity', {
      precision: 18,
      scale: 6,
    }).notNull(),
    unit: text('unit'),
    supplier: text('supplier'),
    catalogNo: text('catalog_no'),
    lot: text('lot'),
    expiry: date('expiry'),
    reason: text('reason'),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_reagent_movements_operation',
      sql`${table.operation} IN ('receive','consume','quarantine','restore')`,
    ),
    check(
      'chk_reagent_movements_quantity_delta',
      sql`(${table.operation} = 'receive' AND ${table.quantityDelta} > 0) OR (${table.operation} = 'consume' AND ${table.quantityDelta} < 0) OR (${table.operation} IN ('quarantine','restore') AND ${table.quantityDelta} = 0)`,
    ),
    check(
      'chk_reagent_movements_resulting_quantity',
      sql`${table.resultingQuantity} >= 0`,
    ),
    index('idx_reagent_movements_workspace').on(table.workspaceId),
    index('idx_reagent_movements_reagent_created').on(
      table.reagentRecordId,
      table.createdAt,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Relations for drizzle query API (no migration impact).
// ---------------------------------------------------------------------------

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(workspaceMemberships),
  projects: many(projects),
  revisions: many(revisions),
  reviewSubmissions: many(reviewSubmissions),
  comments: many(comments),
}))

export const workspaceMembershipsRelations = relations(
  workspaceMemberships,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMemberships.workspaceId],
      references: [workspaces.id],
    }),
  }),
)

export const projectsRelations = relations(projects, ({ many }) => ({
  folders: many(folders),
  records: many(records),
}))

export const foldersRelations = relations(folders, ({ one, many }) => ({
  project: one(projects, {
    fields: [folders.projectId],
    references: [projects.id],
  }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: 'folder_parent',
  }),
  children: many(folders, { relationName: 'folder_parent' }),
  records: many(records),
}))

export const recordsRelations = relations(records, ({ one, many }) => ({
  project: one(projects, {
    fields: [records.projectId],
    references: [projects.id],
  }),
  folder: one(folders, {
    fields: [records.folderId],
    references: [folders.id],
  }),
  blocks: many(blocks),
  outgoingLinks: many(recordLinks, { relationName: 'record_outgoing_links' }),
  incomingLinks: many(recordLinks, { relationName: 'record_incoming_links' }),
  revisions: many(revisions),
  reagentMovements: many(reagentMovements),
  reviewSubmissions: many(reviewSubmissions),
  sampleEvents: many(sampleEvents),
  comments: many(comments),
}))

export const blocksRelations = relations(blocks, ({ one }) => ({
  record: one(records, {
    fields: [blocks.recordId],
    references: [records.id],
  }),
}))

export const sampleEventsRelations = relations(sampleEvents, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [sampleEvents.workspaceId],
    references: [workspaces.id],
  }),
  record: one(records, {
    fields: [sampleEvents.recordId],
    references: [records.id],
  }),
}))

export const scientificTablesRelations = relations(
  scientificTables,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [scientificTables.workspaceId],
      references: [workspaces.id],
    }),
    record: one(records, {
      fields: [scientificTables.recordId],
      references: [records.id],
    }),
    block: one(blocks, {
      fields: [scientificTables.blockId],
      references: [blocks.id],
    }),
    datasetSchema: one(datasetSchemas, {
      fields: [scientificTables.datasetSchemaId],
      references: [datasetSchemas.id],
    }),
    columns: many(scientificColumns),
  }),
)

export const scientificColumnsRelations = relations(
  scientificColumns,
  ({ one, many }) => ({
    table: one(scientificTables, {
      fields: [scientificColumns.tableId],
      references: [scientificTables.id],
    }),
    datasetSchemaField: one(datasetSchemaFields, {
      fields: [scientificColumns.datasetSchemaFieldId],
      references: [datasetSchemaFields.id],
    }),
    options: many(scientificCategoryOptions),
  }),
)

export const datasetSchemasRelations = relations(
  datasetSchemas,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [datasetSchemas.workspaceId],
      references: [workspaces.id],
    }),
    fields: many(datasetSchemaFields),
  }),
)

export const datasetSchemaFieldsRelations = relations(
  datasetSchemaFields,
  ({ one }) => ({
    schema: one(datasetSchemas, {
      fields: [datasetSchemaFields.schemaId],
      references: [datasetSchemas.id],
    }),
  }),
)

export const scientificCategoryOptionsRelations = relations(
  scientificCategoryOptions,
  ({ one }) => ({
    column: one(scientificColumns, {
      fields: [scientificCategoryOptions.columnId],
      references: [scientificColumns.id],
    }),
  }),
)

export const recordLinksRelations = relations(recordLinks, ({ one }) => ({
  source: one(records, {
    fields: [recordLinks.sourceRecordId],
    references: [records.id],
    relationName: 'record_outgoing_links',
  }),
  target: one(records, {
    fields: [recordLinks.targetRecordId],
    references: [records.id],
    relationName: 'record_incoming_links',
  }),
}))

export const revisionsRelations = relations(revisions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [revisions.workspaceId],
    references: [workspaces.id],
  }),
  record: one(records, {
    fields: [revisions.recordId],
    references: [records.id],
  }),
  supersededBy: one(revisions, {
    fields: [revisions.supersededByRevisionId],
    references: [revisions.id],
    relationName: 'revision_superseded_by',
  }),
  comments: many(comments),
}))

export const reviewSubmissionsRelations = relations(
  reviewSubmissions,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [reviewSubmissions.workspaceId],
      references: [workspaces.id],
    }),
    record: one(records, {
      fields: [reviewSubmissions.recordId],
      references: [records.id],
    }),
    revision: one(revisions, {
      fields: [reviewSubmissions.revisionId],
      references: [revisions.id],
    }),
  }),
)

export const reviewCheckResultsRelations = relations(
  reviewCheckResults,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [reviewCheckResults.workspaceId],
      references: [workspaces.id],
    }),
    record: one(records, {
      fields: [reviewCheckResults.recordId],
      references: [records.id],
    }),
    revision: one(revisions, {
      fields: [reviewCheckResults.revisionId],
      references: [revisions.id],
    }),
  }),
)

export const commentsRelations = relations(comments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [comments.workspaceId],
    references: [workspaces.id],
  }),
  revision: one(revisions, {
    fields: [comments.revisionId],
    references: [revisions.id],
  }),
  record: one(records, {
    fields: [comments.recordId],
    references: [records.id],
  }),
  root: one(comments, {
    fields: [comments.rootId],
    references: [comments.id],
    relationName: 'comment_thread_root',
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'comment_parent',
  }),
}))
