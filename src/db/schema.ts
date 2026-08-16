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
    suspendedAt: timestamp('suspended_at', {
      withTimezone: true,
      mode: 'date',
    }),
    ...timestamps,
  },
  (table) => [
    unique('uq_workspace_memberships_workspace_user').on(
      table.workspaceId,
      table.userId,
    ),
    check(
      'chk_workspace_memberships_role',
      sql`${table.role} IN ('owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer')`,
    ),
    index('idx_workspace_memberships_user_id').on(table.userId),
    index('idx_workspace_memberships_suspended_at').on(table.suspendedAt),
  ],
)

// ---------------------------------------------------------------------------
// ADMIN-001 — workspace invitations, settings, and project access.
// ---------------------------------------------------------------------------

export const workspaceInvitations = api.table(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_workspace_invitations_status',
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      'chk_workspace_invitations_role',
      sql`${table.role} IN ('owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer')`,
    ),
    check(
      'chk_workspace_invitations_email',
      sql`${table.email} ~ '^[^@]+@[^@]+\\.[^@]+$'`,
    ),
    index('idx_workspace_invitations_workspace').on(table.workspaceId),
    index('idx_workspace_invitations_email').on(table.email),
    index('idx_workspace_invitations_status').on(table.status),
  ],
)

export const workspaceSettings = api.table(
  'workspace_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    registrationMode: text('registration_mode').notNull().default('open'),
    reviewWorkflowEnabled: boolean('review_workflow_enabled')
      .notNull()
      .default(false),
    reviewWorkflowConfig: jsonb('review_workflow_config')
      .notNull()
      .default(sql`'{}'`),
    signaturePolicy: jsonb('signature_policy')
      .notNull()
      .default(sql`'{}'`),
    auditRetentionDays: integer('audit_retention_days').notNull().default(2555),
    integrationSettings: jsonb('integration_settings')
      .notNull()
      .default(sql`'{}'`),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_workspace_settings_registration_mode',
      sql`${table.registrationMode} IN ('open', 'invitation_only')`,
    ),
    check(
      'chk_workspace_settings_audit_retention_days',
      sql`${table.auditRetentionDays} > 0`,
    ),
  ],
)

export const projectAccess = api.table(
  'project_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessLevel: text('access_level').notNull().default('viewer'),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    unique('uq_project_access_workspace_project_user').on(
      table.workspaceId,
      table.projectId,
      table.userId,
    ),
    check(
      'chk_project_access_access_level',
      sql`${table.accessLevel} IN ('owner', 'editor', 'viewer')`,
    ),
    index('idx_project_access_workspace').on(table.workspaceId),
    index('idx_project_access_project').on(table.projectId),
    index('idx_project_access_user').on(table.userId),
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
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    // Administrator-defined model fields. `properties` remains the legacy
    // registry/system payload and is deliberately not repurposed.
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    // SIGN-002: a record is locked when an approve-for-record signature is
    // recorded against its approved revision. While locked, ordinary CRUD on
    // the record's scientific evidence (blocks, links, scientific rows,
    // formulas, metadata) is rejected; a new draft begins only through the
    // api.create_amendment RPC, which unlocks the record and records an
    // 'amend' revision. Set/cleared by SECURITY DEFINER functions bypassing
    // RLS; the consistency check ties the two columns together.
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    // Forward reference to revisions (defined below); the FK constraint is
    // declared in the migration SQL. Omitting .references() here mirrors
    // revisions.supersededByRevisionId and avoids a circular type-inference
    // cycle between records and revisions.
    lockedByRevisionId: uuid('locked_by_revision_id'),
    sourceNotebookTemplateVersionId: uuid(
      'source_notebook_template_version_id',
    ),
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
    // SIGN-002: lock columns are set/cleared together.
    check(
      'chk_records_locked_consistency',
      sql`(${table.lockedAt} IS NULL) = (${table.lockedByRevisionId} IS NULL)`,
    ),
    unique('uq_records_project_identifier').on(
      table.projectId,
      table.identifier,
    ),
    check(
      'chk_records_kind',
      sql`${table.kind} IN ('experiment', 'protocol_template', 'report', 'sample', 'reagent', 'file', 'notebook_template', 'study')`,
    ),
    index('idx_records_workspace_id').on(table.workspaceId),
    index('idx_records_project_id').on(table.projectId),
    index('idx_records_folder_id').on(table.folderId),
    index('idx_records_kind').on(table.kind),
    index('idx_records_status').on(table.status),
    // Partial index of locked records — small, hot lookup for the lock guard.
    index('idx_records_locked')
      .on(table.lockedAt)
      .where(sql`${table.lockedAt} IS NOT NULL`),
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
      sql`${table.reason} IN ('submit', 'sign', 'manual', 'validate', 'amend')`,
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
    check(
      'chk_review_submissions_state',
      sql`${table.state} IN ('submitted', 'returned', 'rejected', 'approved', 'withdrawn')`,
    ),
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
 * review_decisions (REV-007) is the append-only audit log of every
 * request-changes / reject / approve / withdraw decision on a review
 * submission. Each row pins the revision integrity digest the actor was
 * acting on, the actor, session and role, and an optional note. Writes go
 * only through the four SECURITY DEFINER transition RPCs; request roles get
 * SELECT and EXECUTE and nothing else, so the transition logic and
 * permission boundary live in one place. The submission's new state is set
 * by the same RPC; no direct UPDATE grant on `review_submissions` exists.
 */
export const reviewDecisions = api.table(
  'review_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => reviewSubmissions.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    // request_changes | reject | approve | withdraw
    decision: text('decision').notNull(),
    note: text('note'),
    revisionIntegrityDigest: text('revision_integrity_digest').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    actorSessionId: text('actor_session_id').notNull(),
    actorRole: text('actor_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_review_decisions_decision',
      sql`${table.decision} IN ('request_changes', 'reject', 'approve', 'withdraw')`,
    ),
    check(
      'chk_review_decisions_note',
      sql`${table.note} IS NULL OR length(${table.note}) BETWEEN 1 AND 8000`,
    ),
    check(
      'chk_review_decisions_digest',
      sql`${table.revisionIntegrityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    index('idx_review_decisions_submission').on(
      table.submissionId,
      table.createdAt,
    ),
    index('idx_review_decisions_workspace_created').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('idx_review_decisions_record').on(table.recordId, table.createdAt),
  ],
)

/**
 * signatures (SIGN-001) are immutable, workspace-scoped electronic
 * signatures that record a signer's post-approval attestation against a
 * frozen revision. Each row pins the signer identity, the stated signature
 * meaning, the assurance level, the revision integrity digest the signer was
 * looking at, and the authentication evidence (session id, role, auth method,
 * confirmation phrase). Writes go only through the `sign_revision` SECURITY
 * DEFINER RPC; request roles get SELECT and EXECUTE and nothing else, and an
 * immutability trigger prevents UPDATE/DELETE by application roles.
 *
 * The assurance level is a stated property of the evidence, not a compliance
 * certification — no 21 CFR Part 11 / EU Annex 11 claim is made or implied.
 * The initial assurance level is 'standard', verified by the authenticated
 * session plus a typed confirmation that matches the signer's recorded name.
 */
export const signatures = api.table(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => reviewSubmissions.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    // approve-for-record | witness
    signatureMeaning: text('signature_meaning').notNull(),
    assuranceLevel: text('assurance_level').notNull().default('standard'),
    revisionIntegrityDigest: text('revision_integrity_digest').notNull(),
    signerUserId: text('signer_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    signerSessionId: text('signer_session_id').notNull(),
    signerRole: text('signer_role').notNull(),
    authMethod: text('auth_method').notNull(),
    confirmationPhrase: text('confirmation_phrase').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_signatures_meaning',
      sql`${table.signatureMeaning} IN ('approve-for-record', 'witness')`,
    ),
    check(
      'chk_signatures_assurance_level',
      sql`${table.assuranceLevel} IN ('standard')`,
    ),
    check(
      'chk_signatures_auth_method',
      sql`${table.authMethod} IN ('session+name-confirmation')`,
    ),
    check(
      'chk_signatures_digest',
      sql`${table.revisionIntegrityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_signatures_confirmation_phrase',
      sql`length(${table.confirmationPhrase}) BETWEEN 1 AND 200`,
    ),
    unique('uq_signatures_submission_signer').on(
      table.submissionId,
      table.signerUserId,
    ),
    index('idx_signatures_submission').on(table.submissionId, table.signedAt),
    index('idx_signatures_workspace_signed').on(
      table.workspaceId,
      table.signedAt,
    ),
    index('idx_signatures_record').on(table.recordId, table.signedAt),
    index('idx_signatures_revision').on(table.revisionId),
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
 * System-owned model registry. Request roles may select these rows but all
 * writes are migration-owned; capabilities are descriptive, never SQL.
 */
export const modelKinds = api.table('model_kinds', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  identityTable: text('identity_table').notNull(),
  customFieldStrategy: text('custom_field_strategy').notNull(),
  capabilities: jsonb('capabilities')
    .notNull()
    .default(sql`'{}'::jsonb`),
  recordKind: text('record_kind'),
})

export const modelBaseFields = api.table(
  'model_base_fields',
  {
    modelKey: text('model_key')
      .notNull()
      .references(() => modelKinds.key, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    presentation: jsonb('presentation')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [primaryKey({ columns: [table.modelKey, table.fieldKey] })],
)

/**
 * Workspace model-field definitions. The physical `kind` column is retained
 * to preserve IDs/data and now stores a model_kinds.key (model key). Values
 * live in each model host's custom_fields JSON object, not records.properties.
 */
export const recordFieldDefinitions = api.table(
  'record_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Compatibility name: this is the model key.
    kind: text('kind')
      .notNull()
      .references(() => modelKinds.key, { onDelete: 'restrict' }),
    // Stable slug; the key in the model host's custom_fields object. Immutable
    // once active rows reference it; rename the label, not the field_name.
    fieldName: text('field_name').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull(),
    // Reuses the scientific_columns type vocabulary (decision 0019).
    logicalType: text('logical_type').notNull(),
    nullable: boolean('nullable').notNull().default(true),
    defaultValue: jsonb('default_value'),
    // Canonical semantic metadata. Legacy unit/validation columns remain
    // readable for API compatibility and are projected when these are null.
    quantity: jsonb('quantity'),
    cardinality: text('cardinality').notNull().default('one'),
    categorySource: jsonb('category_source'),
    relationship: jsonb('relationship'),
    unit: jsonb('unit'),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'`),
    lifecycle: text('lifecycle').notNull().default('draft'),
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
      'chk_record_field_definitions_type',
      sql`${table.logicalType} IN ('text','integer','decimal','boolean','date','timestamp','category','reference')`,
    ),
    check(
      'chk_record_field_definitions_lifecycle',
      sql`${table.lifecycle} IN ('draft','backfilling','active','retired')`,
    ),
    check(
      'chk_record_field_definitions_cardinality',
      sql`${table.cardinality} IN ('one', 'many')`,
    ),
    index('idx_record_field_definitions_workspace_kind').on(
      table.workspaceId,
      table.kind,
    ),
  ],
)

export const modelFieldOptions = api.table(
  'model_field_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => recordFieldDefinitions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    displayOrder: integer('display_order').notNull(),
    lifecycle: text('lifecycle').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    unique('uq_model_field_options_definition_key').on(
      table.definitionId,
      table.key,
    ),
    check(
      'chk_model_field_options_lifecycle',
      sql`${table.lifecycle} IN ('active','retired')`,
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

// ---------------------------------------------------------------------------
// OPS-002: Freezer & Storage Map. A workspace-scoped physical storage
// hierarchy (site > room > unit > shelf > rack > box > position) with capacity
// and environment metadata, plus an append-only movement log. Samples occupy
// positions; the controlled move RPCs enforce single-occupancy and
// traceability transactionally (migration 0048). RLS gives workspace members
// read/write on the hierarchy levels and read-only on positions/movements; the
// SECURITY INVOKER RPCs are the only writers for occupancy, position status
// and movements.
// ---------------------------------------------------------------------------

export const storageSites = api.table(
  'storage_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    temperatureMinC: numeric('temperature_min_c'),
    temperatureMaxC: numeric('temperature_max_c'),
    // 0 = unlimited.
    capacity: integer('capacity').notNull().default(0),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_sites_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_storage_sites_code',
      sql`length(btrim(${table.code})) BETWEEN 1 AND 64`,
    ),
    check('chk_storage_sites_capacity', sql`${table.capacity} >= 0`),
    check(
      'chk_storage_sites_temp_range',
      sql`${table.temperatureMinC} IS NULL OR ${table.temperatureMaxC} IS NULL OR ${table.temperatureMinC} <= ${table.temperatureMaxC}`,
    ),
    uniqueIndex('uq_storage_sites_workspace_code').on(
      table.workspaceId,
      table.code,
    ),
    index('idx_storage_sites_workspace').on(table.workspaceId),
  ],
)

export const storageRooms = api.table(
  'storage_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => storageSites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    temperatureMinC: numeric('temperature_min_c'),
    temperatureMaxC: numeric('temperature_max_c'),
    capacity: integer('capacity').notNull().default(0),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_rooms_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_storage_rooms_code',
      sql`length(btrim(${table.code})) BETWEEN 1 AND 64`,
    ),
    check('chk_storage_rooms_capacity', sql`${table.capacity} >= 0`),
    check(
      'chk_storage_rooms_temp_range',
      sql`${table.temperatureMinC} IS NULL OR ${table.temperatureMaxC} IS NULL OR ${table.temperatureMinC} <= ${table.temperatureMaxC}`,
    ),
    uniqueIndex('uq_storage_rooms_workspace_site_code').on(
      table.workspaceId,
      table.siteId,
      table.code,
    ),
    index('idx_storage_rooms_workspace').on(table.workspaceId),
    index('idx_storage_rooms_site').on(table.siteId),
  ],
)

export const storageUnits = api.table(
  'storage_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => storageRooms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    // freezer | fridge | cryo | incubator | ambient | dewar | cabinet
    unitType: text('unit_type').notNull().default('freezer'),
    temperatureMinC: numeric('temperature_min_c'),
    temperatureMaxC: numeric('temperature_max_c'),
    capacity: integer('capacity').notNull().default(0),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_units_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_storage_units_code',
      sql`length(btrim(${table.code})) BETWEEN 1 AND 64`,
    ),
    check(
      'chk_storage_units_type',
      sql`${table.unitType} IN ('freezer','fridge','cryo','incubator','ambient','dewar','cabinet')`,
    ),
    check('chk_storage_units_capacity', sql`${table.capacity} >= 0`),
    check(
      'chk_storage_units_temp_range',
      sql`${table.temperatureMinC} IS NULL OR ${table.temperatureMaxC} IS NULL OR ${table.temperatureMinC} <= ${table.temperatureMaxC}`,
    ),
    uniqueIndex('uq_storage_units_workspace_room_code').on(
      table.workspaceId,
      table.roomId,
      table.code,
    ),
    index('idx_storage_units_workspace').on(table.workspaceId),
    index('idx_storage_units_room').on(table.roomId),
  ],
)

export const storageShelves = api.table(
  'storage_shelves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => storageUnits.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(1),
    capacity: integer('capacity').notNull().default(0),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_shelves_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check('chk_storage_shelves_capacity', sql`${table.capacity} >= 0`),
    check('chk_storage_shelves_position', sql`${table.position} > 0`),
    index('idx_storage_shelves_workspace').on(table.workspaceId),
    index('idx_storage_shelves_unit').on(table.unitId, table.position),
  ],
)

export const storageRacks = api.table(
  'storage_racks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    shelfId: uuid('shelf_id')
      .notNull()
      .references(() => storageShelves.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(1),
    capacity: integer('capacity').notNull().default(0),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_racks_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check('chk_storage_racks_capacity', sql`${table.capacity} >= 0`),
    check('chk_storage_racks_position', sql`${table.position} > 0`),
    index('idx_storage_racks_workspace').on(table.workspaceId),
    index('idx_storage_racks_shelf').on(table.shelfId, table.position),
  ],
)

export const storageBoxes = api.table(
  'storage_boxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    rackId: uuid('rack_id')
      .notNull()
      .references(() => storageRacks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    rows: integer('rows').notNull(),
    cols: integer('cols').notNull(),
    capacity: integer('capacity').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_storage_boxes_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_storage_boxes_code',
      sql`length(btrim(${table.code})) BETWEEN 1 AND 64`,
    ),
    check('chk_storage_boxes_rows', sql`${table.rows} BETWEEN 1 AND 26`),
    check('chk_storage_boxes_cols', sql`${table.cols} BETWEEN 1 AND 26`),
    check(
      'chk_storage_boxes_capacity',
      sql`${table.capacity} = ${table.rows} * ${table.cols}`,
    ),
    uniqueIndex('uq_storage_boxes_workspace_rack_code').on(
      table.workspaceId,
      table.rackId,
      table.code,
    ),
    index('idx_storage_boxes_workspace').on(table.workspaceId),
    index('idx_storage_boxes_rack').on(table.rackId),
  ],
)

export const storagePositions = api.table(
  'storage_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    boxId: uuid('box_id')
      .notNull()
      .references(() => storageBoxes.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    colIndex: integer('col_index').notNull(),
    label: text('label').notNull(),
    // available | occupied | quarantined | missing
    status: text('status').notNull().default('available'),
    occupiedRecordId: uuid('occupied_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (table) => [
    check('chk_storage_positions_row', sql`${table.rowIndex} >= 0`),
    check('chk_storage_positions_col', sql`${table.colIndex} >= 0`),
    check(
      'chk_storage_positions_label',
      sql`length(btrim(${table.label})) BETWEEN 1 AND 8`,
    ),
    check(
      'chk_storage_positions_status',
      sql`${table.status} IN ('available','occupied','quarantined','missing')`,
    ),
    check(
      'chk_storage_positions_occupancy',
      sql`(${table.status} = 'occupied') = (${table.occupiedRecordId} IS NOT NULL)`,
    ),
    uniqueIndex('uq_storage_positions_box_row_col').on(
      table.boxId,
      table.rowIndex,
      table.colIndex,
    ),
    uniqueIndex('uq_storage_positions_occupied_record')
      .on(table.occupiedRecordId)
      .where(sql`${table.occupiedRecordId} IS NOT NULL`),
    index('idx_storage_positions_workspace').on(table.workspaceId),
    index('idx_storage_positions_box').on(
      table.boxId,
      table.rowIndex,
      table.colIndex,
    ),
  ],
)

export const storageMovements = api.table(
  'storage_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    // place | move | remove
    operation: text('operation').notNull(),
    fromPositionId: uuid('from_position_id').references(
      () => storagePositions.id,
      {
        onDelete: 'set null',
      },
    ),
    toPositionId: uuid('to_position_id').references(() => storagePositions.id, {
      onDelete: 'set null',
    }),
    fromPath: text('from_path'),
    toPath: text('to_path'),
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
      'chk_storage_movements_operation',
      sql`${table.operation} IN ('place','move','remove')`,
    ),
    check(
      'chk_storage_movements_positions',
      sql`${table.fromPositionId} IS NOT NULL OR ${table.toPositionId} IS NOT NULL`,
    ),
    index('idx_storage_movements_record_created').on(
      table.recordId,
      table.createdAt,
    ),
    index('idx_storage_movements_workspace_created').on(
      table.workspaceId,
      table.createdAt,
    ),
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
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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

// CORE-02: canonical Dataset Schema identity is separate from the legacy
// revision-row registry above. Versions carry immutable FieldDefinition
// metadata; existing scientific tables remain a compatibility source.
export const datasetSchemaDefinitions = api.table(
  'dataset_schema_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    lifecycle: text('lifecycle').notNull().default('draft'),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_dataset_schema_definitions_workspace_key').on(
      table.workspaceId,
      table.key,
    ),
    check(
      'chk_dataset_schema_definitions_key',
      sql`${table.key} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
    check(
      'chk_dataset_schema_definitions_lifecycle',
      sql`${table.lifecycle} IN ('draft','active','retired')`,
    ),
    index('idx_dataset_schema_definitions_workspace').on(table.workspaceId),
  ],
)

export const datasetSchemaVersions = api.table(
  'dataset_schema_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => datasetSchemaDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    lifecycle: text('lifecycle').notNull().default('draft'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    publishedAt: timestamp('published_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_dataset_schema_versions_schema_version').on(
      table.schemaId,
      table.version,
    ),
    check('chk_dataset_schema_versions_version', sql`${table.version} > 0`),
    check('chk_dataset_schema_versions_revision', sql`${table.revision} > 0`),
    check(
      'chk_dataset_schema_versions_lifecycle',
      sql`${table.lifecycle} IN ('draft','active','retired')`,
    ),
    index('idx_dataset_schema_versions_schema').on(table.schemaId),
  ],
)

export const datasetSchemaVersionFields = api.table(
  'dataset_schema_version_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaVersionId: uuid('schema_version_id')
      .notNull()
      .references(() => datasetSchemaVersions.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    logicalType: text('logical_type').notNull(),
    nullable: boolean('nullable').notNull().default(true),
    defaultValue: jsonb('default_value'),
    quantity: jsonb('quantity'),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'::jsonb`),
    category: jsonb('category'),
    relationship: jsonb('relationship'),
    cardinality: text('cardinality').notNull().default('one'),
    lifecycle: text('lifecycle').notNull().default('active'),
    displayOrder: integer('display_order').notNull(),
  },
  (table) => [
    unique('uq_dataset_schema_version_fields_version_key').on(
      table.schemaVersionId,
      table.key,
    ),
    unique('uq_dataset_schema_version_fields_version_field').on(
      table.schemaVersionId,
      table.fieldId,
    ),
    check(
      'chk_dataset_schema_version_fields_type',
      sql`${table.logicalType} IN ('text','integer','decimal','boolean','date','timestamp','category','reference')`,
    ),
    check(
      'chk_dataset_schema_version_fields_cardinality',
      sql`${table.cardinality} IN ('one','many')`,
    ),
    check(
      'chk_dataset_schema_version_fields_lifecycle',
      sql`${table.lifecycle} IN ('active','retired')`,
    ),
    index('idx_dataset_schema_version_fields_version').on(
      table.schemaVersionId,
    ),
  ],
)

export const configurationChangeLog = api.table(
  'configuration_change_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestDigest: text('request_digest').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_configuration_change_log_actor_key').on(
      table.workspaceId,
      table.actorUserId,
      table.kind,
      table.idempotencyKey,
    ),
    check(
      'chk_configuration_change_log_kind',
      sql`${table.kind} IN ('model_field_evolution','dataset_schema_evolution','local_field_promotion','calculation_promotion')`,
    ),
    check(
      'chk_configuration_change_log_idempotency_key',
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 128`,
    ),
  ],
)

// CORE-03: reusable Sheet configuration is a workspace-owned identity with
// explicit immutable versions. Working/local values belong to future Sheet
// Instances and must never be stored in either of these tables.
export const sheetDefinitions = api.table(
  'sheet_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    lifecycle: text('lifecycle').notNull().default('active'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_sheet_definitions_workspace_key').on(
      table.workspaceId,
      table.key,
    ),
    check(
      'chk_sheet_definitions_key',
      sql`${table.key} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
    check(
      'chk_sheet_definitions_lifecycle',
      sql`${table.lifecycle} IN ('active','retired')`,
    ),
    check('chk_sheet_definitions_revision', sql`${table.revision} > 0`),
    index('idx_sheet_definitions_workspace').on(table.workspaceId),
  ],
)

export const sheetDefinitionVersions = api.table(
  'sheet_definition_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => sheetDefinitions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    lifecycle: text('lifecycle').notNull().default('draft'),
    configurationFormatVersion: integer('configuration_format_version')
      .notNull()
      .default(1),
    configuration: jsonb('configuration').notNull(),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', {
      withTimezone: true,
      mode: 'date',
    }),
    publishedByUserId: text('published_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    retiredAt: timestamp('retired_at', {
      withTimezone: true,
      mode: 'date',
    }),
    retiredByUserId: text('retired_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_sheet_definition_versions_definition_version').on(
      table.definitionId,
      table.version,
    ),
    check('chk_sheet_definition_versions_version', sql`${table.version} > 0`),
    check(
      'chk_sheet_definition_versions_lifecycle',
      sql`${table.lifecycle} IN ('draft','published','retired')`,
    ),
    check(
      'chk_sheet_definition_versions_format',
      sql`${table.configurationFormatVersion} = 1`,
    ),
    check('chk_sheet_definition_versions_revision', sql`${table.revision} > 0`),
    index('idx_sheet_definition_versions_definition').on(table.definitionId),
  ],
)

export const notebookTemplates = api.table(
  'notebook_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    lifecycle: text('lifecycle').notNull().default('active'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_notebook_templates_workspace_key').on(
      table.workspaceId,
      table.key,
    ),
    check(
      'chk_notebook_templates_key',
      sql`${table.key} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
    check(
      'chk_notebook_templates_lifecycle',
      sql`${table.lifecycle} IN ('active','retired')`,
    ),
    check('chk_notebook_templates_revision', sql`${table.revision} > 0`),
    index('idx_notebook_templates_workspace').on(table.workspaceId),
  ],
)

export const notebookTemplateVersions = api.table(
  'notebook_template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => notebookTemplates.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    lifecycle: text('lifecycle').notNull().default('draft'),
    configurationFormatVersion: integer('configuration_format_version')
      .notNull()
      .default(1),
    configuration: jsonb('configuration').notNull(),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', {
      withTimezone: true,
      mode: 'date',
    }),
    publishedByUserId: text('published_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    retiredAt: timestamp('retired_at', {
      withTimezone: true,
      mode: 'date',
    }),
    retiredByUserId: text('retired_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    unique('uq_notebook_template_versions_template_version').on(
      table.templateId,
      table.version,
    ),
    check('chk_notebook_template_versions_version', sql`${table.version} > 0`),
    check(
      'chk_notebook_template_versions_lifecycle',
      sql`${table.lifecycle} IN ('draft','published','retired')`,
    ),
    check(
      'chk_notebook_template_versions_format',
      sql`${table.configurationFormatVersion} = 1`,
    ),
    check(
      'chk_notebook_template_versions_revision',
      sql`${table.revision} > 0`,
    ),
    index('idx_notebook_template_versions_template').on(table.templateId),
  ],
)

export const notebookTemplateInstantiations = api.table(
  'notebook_template_instantiations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => notebookTemplateVersions.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_notebook_template_instantiations_actor_key').on(
      table.workspaceId,
      table.actorUserId,
      table.idempotencyKey,
    ),
    check(
      'chk_notebook_template_instantiations_key',
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 128`,
    ),
  ],
)

export const notebookTemplateUpgrades = api.table(
  'notebook_template_upgrades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => notebookTemplateVersions.id, { onDelete: 'restrict' }),
    targetVersionId: uuid('target_version_id')
      .notNull()
      .references(() => notebookTemplateVersions.id, { onDelete: 'restrict' }),
    decisions: jsonb('decisions').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
)

export const revisionSheetEvidence = api.table(
  'revision_sheet_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'restrict' }),
    blockId: uuid('block_id').notNull(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => sheetInstances.id, { onDelete: 'restrict' }),
    sourceDefinitionVersionId: uuid('source_definition_version_id').references(
      () => sheetDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    instanceRevision: bigint('instance_revision', { mode: 'bigint' }).notNull(),
    instanceState: jsonb('instance_state').notNull(),
    datasetVersions: jsonb('dataset_versions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_revision_sheet_evidence_revision_block').on(
      table.revisionId,
      table.blockId,
    ),
  ],
)

// CORE-03.3: a working Sheet is deliberately separate from a reusable
// Definition.  All mutable working configuration is contained in `state`;
// the optional source is an immutable Definition Version, never a writable
// Definition pointer.
export const sheetInstances = api.table(
  'sheet_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'restrict',
    }),
    notebookRecordId: uuid('notebook_record_id').references(() => records.id, {
      onDelete: 'restrict',
    }),
    sourceDefinitionVersionId: uuid('source_definition_version_id').references(
      () => sheetDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    name: text('name').notNull(),
    description: text('description'),
    lifecycle: text('lifecycle').notNull().default('active'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    state: jsonb('state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    duplicatedFromInstanceId: uuid('duplicated_from_instance_id').references(
      (): AnyPgColumn => sheetInstances.id,
      { onDelete: 'restrict' },
    ),
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
      'chk_sheet_instances_lifecycle',
      sql`${table.lifecycle} IN ('active','archived')`,
    ),
    check(
      'chk_sheet_instances_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_sheet_instances_description',
      sql`${table.description} IS NULL OR length(${table.description}) <= 2000`,
    ),
    check('chk_sheet_instances_revision', sql`${table.revision} > 0`),
    index('idx_sheet_instances_workspace').on(table.workspaceId),
    index('idx_sheet_instances_source_version').on(
      table.sourceDefinitionVersionId,
    ),
  ],
)

export const sheetInstanceLocalMutations = api.table(
  'sheet_instance_local_mutations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => sheetInstances.id, { onDelete: 'restrict' }),
    retryToken: uuid('retry_token').notNull(),
    requestDigest: text('request_digest').notNull(),
    resultRevision: bigint('result_revision', { mode: 'bigint' }).notNull(),
    result: jsonb('result').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    operation: text('operation').notNull(),
    affected: jsonb('affected').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('sheet_instance_local_mutations_instance_id_retry_token_unique').on(
      table.instanceId,
      table.retryToken,
    ),
    check(
      'sheet_instance_local_mutations_request_digest_check',
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'sheet_instance_local_mutations_result_revision_check',
      sql`${table.resultRevision} > 0`,
    ),
    check(
      'sheet_instance_local_mutations_operation_check',
      sql`${table.operation} = 'local_mutation'`,
    ),
    index('idx_sheet_instance_local_mutations_instance').on(
      table.instanceId,
      table.createdAt,
    ),
  ],
)

export const sheetInstanceCalculationMutations = api.table(
  'sheet_instance_calculation_mutations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => sheetInstances.id, { onDelete: 'restrict' }),
    retryToken: uuid('retry_token').notNull(),
    requestDigest: text('request_digest').notNull(),
    operation: text('operation').notNull(),
    resultRevision: bigint('result_revision', { mode: 'bigint' }).notNull(),
    result: jsonb('result').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_sheet_calculation_mutation_retry').on(
      table.instanceId,
      table.retryToken,
    ),
    check(
      'chk_sheet_calculation_mutation_digest',
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'chk_sheet_calculation_mutation_operation',
      sql`${table.operation} IN ('definition_mutation','recalculate')`,
    ),
    check(
      'chk_sheet_calculation_mutation_revision',
      sql`${table.resultRevision} > 0`,
    ),
    index('idx_sheet_calculation_mutations_instance').on(
      table.instanceId,
      table.createdAt,
    ),
  ],
)

export const sheetInstanceDefinitionUpgrades = api.table(
  'sheet_instance_definition_upgrades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => sheetInstances.id, { onDelete: 'restrict' }),
    sourceDefinitionVersionId: uuid('source_definition_version_id')
      .notNull()
      .references(() => sheetDefinitionVersions.id, { onDelete: 'restrict' }),
    targetDefinitionVersionId: uuid('target_definition_version_id')
      .notNull()
      .references(() => sheetDefinitionVersions.id, { onDelete: 'restrict' }),
    sourceInstanceRevision: bigint('source_instance_revision', {
      mode: 'bigint',
    }).notNull(),
    resultingInstanceRevision: bigint('resulting_instance_revision', {
      mode: 'bigint',
    }).notNull(),
    decisionManifest: jsonb('decision_manifest').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    upgradedAt: timestamp('upgraded_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_sheet_instance_definition_upgrade_revisions',
      sql`${table.sourceInstanceRevision} > 0 AND ${table.resultingInstanceRevision} = ${table.sourceInstanceRevision} + 1`,
    ),
    check(
      'chk_sheet_instance_definition_upgrade_versions',
      sql`${table.sourceDefinitionVersionId} <> ${table.targetDefinitionVersionId}`,
    ),
    unique('uq_sheet_instance_definition_upgrade_revision').on(
      table.instanceId,
      table.resultingInstanceRevision,
    ),
    index('idx_sheet_instance_definition_upgrades_instance').on(
      table.instanceId,
      table.upgradedAt,
    ),
  ],
)

export const sheetInstanceCalculationResults = internal.table(
  'sheet_instance_calculation_results',
  {
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => sheetInstances.id, { onDelete: 'restrict' }),
    calculationId: uuid('calculation_id').notNull(),
    rowKey: text('row_key').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull(),
    definitionVersionId: uuid('definition_version_id').references(
      () => sheetDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    instanceRevision: bigint('instance_revision', { mode: 'bigint' }).notNull(),
    expression: jsonb('expression').notNull(),
    dependencies: jsonb('dependencies').notNull(),
    outputField: jsonb('output_field').notNull(),
    sourceRevisions: jsonb('source_revisions').notNull(),
    dependencyProvenance: jsonb('dependency_provenance').notNull(),
    resultKind: text('result_kind').notNull(),
    value: jsonb('value'),
    errorCode: text('error_code'),
    diagnostic: text('diagnostic'),
    engineVersion: text('engine_version').notNull(),
    functionProfile: text('function_profile').notNull(),
    calculatedAt: timestamp('calculated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.instanceId, table.calculationId, table.rowKey],
    }),
    check(
      'chk_sheet_calculation_result_row_key',
      sql`${table.rowKey} ~ '^sb-row-v1:[0-9a-f]{64}$' OR ${table.rowKey} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      'chk_sheet_calculation_result_scope',
      sql`${table.scope} IN ('definition','instance')`,
    ),
    check(
      'chk_sheet_calculation_result_kind',
      sql`${table.resultKind} IN ('value','error')`,
    ),
    check(
      'chk_sheet_calculation_result_profile',
      sql`${table.engineVersion} = '3.3.0' AND ${table.functionProfile} = 'scientific-core-v2'`,
    ),
    index('idx_sheet_calculation_results_instance').on(table.instanceId),
  ],
)

export const datasets = api.table(
  'datasets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    primaryProjectId: uuid('primary_project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    schemaVersionId: uuid('schema_version_id')
      .notNull()
      .references(() => datasetSchemaVersions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    lifecycle: text('lifecycle').notNull().default('active'),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_datasets_lifecycle',
      sql`${table.lifecycle} IN ('active','archived')`,
    ),
    check('chk_datasets_revision', sql`${table.revision} > 0`),
    index('idx_datasets_workspace').on(table.workspaceId),
    index('idx_datasets_schema_version').on(table.schemaVersionId),
  ],
)

export const datasetRows = api.table(
  'dataset_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    ...timestamps,
  },
  (table) => [
    check('chk_dataset_rows_revision', sql`${table.revision} > 0`),
    index('idx_dataset_rows_dataset').on(table.datasetId),
    index('idx_dataset_rows_workspace').on(table.workspaceId),
  ],
)

export const datasetRowValues = api.table(
  'dataset_row_values',
  {
    rowId: uuid('row_id')
      .notNull()
      .references(() => datasetRows.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    textValue: text('text_value'),
    integerValue: bigint('integer_value', { mode: 'bigint' }),
    numericValue: numeric('numeric_value'),
    booleanValue: boolean('boolean_value'),
    dateValue: date('date_value'),
    timestampValue: timestamp('timestamp_value', {
      withTimezone: true,
      mode: 'date',
    }),
    categoryOptionId: uuid('category_option_id'),
    referenceId: uuid('reference_id'),
  },
  (table) => [
    primaryKey({ columns: [table.rowId, table.fieldId, table.ordinal] }),
    check('chk_dataset_row_values_ordinal', sql`${table.ordinal} >= 0`),
    index('idx_dataset_row_values_field_numeric').on(
      table.fieldId,
      table.numericValue,
    ),
    index('idx_dataset_row_values_field_reference').on(
      table.fieldId,
      table.referenceId,
    ),
    index('idx_dataset_row_values_field_category').on(
      table.fieldId,
      table.categoryOptionId,
    ),
    index('idx_dataset_row_values_field_date').on(
      table.fieldId,
      table.dateValue,
    ),
    index('idx_dataset_row_values_field_timestamp').on(
      table.fieldId,
      table.timestampValue,
    ),
  ],
)

/**
 * Durable receipts for canonical Dataset bulk commits. The unique actor/key
 * pair makes a retried spreadsheet paste return its original result instead
 * of creating another set of rows.
 */
export const datasetBulkCommits = api.table(
  'dataset_bulk_commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    requestDigest: text('request_digest').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_dataset_bulk_commits_actor_idempotency').on(
      table.workspaceId,
      table.actorUserId,
      table.idempotencyKey,
    ),
    check(
      'chk_dataset_bulk_commits_idempotency_key',
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 128`,
    ),
    check(
      'chk_dataset_bulk_commits_request_digest',
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    index('idx_dataset_bulk_commits_dataset').on(table.datasetId),
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
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
      sql`${table.syntaxProfile} = 'sheetbase-hf-en-us-v1' AND ${table.functionProfile} = 'scientific-core-v2' AND ${table.literalProfile} = 'sheetbase-literal-v1' AND ${table.engineVersion} = '3.3.0'`,
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
      sql`${table.engineVersion} = '3.3.0' AND ${table.profileFingerprint} = 'fnv1a32-dcfa915f'`,
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
      sql`${table.entityType} IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation', 'record_field_definition', 'model_field_option', 'file', 'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship', 'sample_event', 'comment', 'review_submission', 'signature', 'storage_site', 'storage_room', 'storage_unit', 'storage_shelf', 'storage_rack', 'storage_box', 'storage_position', 'storage_movement', 'plate_design', 'plate_well', 'plate_layout_template', 'calendar_resource', 'calendar_booking', 'calendar_booking_participant', 'calendar_booking_sample', 'study_workstream', 'study_task', 'study_task_dependency', 'study_task_assignment', 'study_task_resource', 'study_deliverable', 'study_project', 'study_experiment', 'study_plan_snapshot', 'instrument', 'instrument_run', 'instrument_run_stage', 'instrument_observation', 'instrument_plate_snapshot', 'instrument_qc_check', 'instrument_raw_file', 'instrument_run_link', 'report_definition', 'report_section', 'report_generation', 'workspace_invitation', 'workspace_settings', 'project_access')`,
    ),
    check(
      'chk_change_events_operation',
      sql`${table.operation} IN ('create', 'update', 'move', 'delete', 'archive', 'restore', 'link', 'unlink', 'quarantine', 'resolve', 'reopen', 'lock', 'amend', 'suspend', 'revoke')`,
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
  lockedBy: one(revisions, {
    fields: [records.lockedByRevisionId],
    references: [revisions.id],
    relationName: 'record_locked_by_revision',
  }),
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

// OPS-002 storage hierarchy relations.
export const storageSitesRelations = relations(
  storageSites,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageSites.workspaceId],
      references: [workspaces.id],
    }),
    rooms: many(storageRooms),
  }),
)

export const storageRoomsRelations = relations(
  storageRooms,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageRooms.workspaceId],
      references: [workspaces.id],
    }),
    site: one(storageSites, {
      fields: [storageRooms.siteId],
      references: [storageSites.id],
    }),
    units: many(storageUnits),
  }),
)

export const storageUnitsRelations = relations(
  storageUnits,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageUnits.workspaceId],
      references: [workspaces.id],
    }),
    room: one(storageRooms, {
      fields: [storageUnits.roomId],
      references: [storageRooms.id],
    }),
    shelves: many(storageShelves),
  }),
)

export const storageShelvesRelations = relations(
  storageShelves,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageShelves.workspaceId],
      references: [workspaces.id],
    }),
    unit: one(storageUnits, {
      fields: [storageShelves.unitId],
      references: [storageUnits.id],
    }),
    racks: many(storageRacks),
  }),
)

export const storageRacksRelations = relations(
  storageRacks,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageRacks.workspaceId],
      references: [workspaces.id],
    }),
    shelf: one(storageShelves, {
      fields: [storageRacks.shelfId],
      references: [storageShelves.id],
    }),
    boxes: many(storageBoxes),
  }),
)

export const storageBoxesRelations = relations(
  storageBoxes,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [storageBoxes.workspaceId],
      references: [workspaces.id],
    }),
    rack: one(storageRacks, {
      fields: [storageBoxes.rackId],
      references: [storageRacks.id],
    }),
    positions: many(storagePositions),
  }),
)

export const storagePositionsRelations = relations(
  storagePositions,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [storagePositions.workspaceId],
      references: [workspaces.id],
    }),
    box: one(storageBoxes, {
      fields: [storagePositions.boxId],
      references: [storageBoxes.id],
    }),
    occupiedRecord: one(records, {
      fields: [storagePositions.occupiedRecordId],
      references: [records.id],
      relationName: 'position_occupied_record',
    }),
  }),
)

export const storageMovementsRelations = relations(
  storageMovements,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [storageMovements.workspaceId],
      references: [workspaces.id],
    }),
    record: one(records, {
      fields: [storageMovements.recordId],
      references: [records.id],
    }),
    fromPosition: one(storagePositions, {
      fields: [storageMovements.fromPositionId],
      references: [storagePositions.id],
      relationName: 'movement_from_position',
    }),
    toPosition: one(storagePositions, {
      fields: [storageMovements.toPositionId],
      references: [storagePositions.id],
      relationName: 'movement_to_position',
    }),
  }),
)

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
  lockedRecords: many(records, {
    relationName: 'record_locked_by_revision',
  }),
}))

export const reviewSubmissionsRelations = relations(
  reviewSubmissions,
  ({ one, many }) => ({
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
    decisions: many(reviewDecisions),
    signatures: many(signatures),
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

export const reviewDecisionsRelations = relations(
  reviewDecisions,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [reviewDecisions.workspaceId],
      references: [workspaces.id],
    }),
    submission: one(reviewSubmissions, {
      fields: [reviewDecisions.submissionId],
      references: [reviewSubmissions.id],
    }),
    revision: one(revisions, {
      fields: [reviewDecisions.revisionId],
      references: [revisions.id],
    }),
    record: one(records, {
      fields: [reviewDecisions.recordId],
      references: [records.id],
    }),
  }),
)

export const signaturesRelations = relations(signatures, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [signatures.workspaceId],
    references: [workspaces.id],
  }),
  submission: one(reviewSubmissions, {
    fields: [signatures.submissionId],
    references: [reviewSubmissions.id],
  }),
  revision: one(revisions, {
    fields: [signatures.revisionId],
    references: [revisions.id],
  }),
  record: one(records, {
    fields: [signatures.recordId],
    references: [records.id],
  }),
}))

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

// ANALYSIS-001: saved analysis views from the Analysis Studio. Each view
// stores a reproducible ChartSpec (decision 0029) plus the source revisions
// captured at save time so a later reader can detect a stale source. The
// owner is the user who created it; version bumps on every update. RLS lets
// workspace members read shared analysis evidence while only the owner can
// mutate their own views.
export const analysisViews = api.table(
  'analysis_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Bumped by the bump_analysis_view_version trigger on every UPDATE.
    version: integer('version').notNull().default(1),
    spec: jsonb('spec').notNull(),
    sourceRevisions: jsonb('source_revisions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    exportSettings: jsonb('export_settings'),
    ...timestamps,
  },
  (table) => [
    unique('uq_analysis_views_workspace_owner_name').on(
      table.workspaceId,
      table.ownerUserId,
      table.name,
    ),
    check('chk_analysis_views_version', sql`${table.version} > 0`),
    index('idx_analysis_views_workspace').on(table.workspaceId),
    index('idx_analysis_views_owner').on(table.workspaceId, table.ownerUserId),
  ],
)

export const analysisViewsRelations = relations(analysisViews, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [analysisViews.workspaceId],
    references: [workspaces.id],
  }),
  owner: one(user, {
    fields: [analysisViews.ownerUserId],
    references: [user.id],
  }),
}))

// OPS-003: Plate Designer — standalone plate designs, well assignments, and
// reusable layout templates. The Plate Designer UI performs auto-fill,
// randomisation, replicate patterning and CSV import in local state with an
// undo stack, then persists the final layout through the save_plate_design
// RPC (migration 0049). RLS is the access-control boundary; the controlled
// RPCs are the only writers for plate_wells and the only path to bump
// metadata_version, so concurrent saves are rejected with SB001.
export const plateDesigns = api.table(
  'plate_designs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    format: text('format').notNull().default('96_well'),
    rows: integer('rows').notNull(),
    cols: integer('cols').notNull(),
    validation: jsonb('validation')
      .notNull()
      .default(sql`'{}'`),
    status: text('status').notNull().default('draft'),
    metadataVersion: integer('metadata_version').notNull().default(1),
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
      'chk_plate_designs_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check('chk_plate_designs_format', sql`${table.format} IN ('96_well')`),
    check(
      'chk_plate_designs_rows',
      sql`${table.rows} > 0 AND ${table.rows} <= 26`,
    ),
    check(
      'chk_plate_designs_cols',
      sql`${table.cols} > 0 AND ${table.cols} <= 26`,
    ),
    check(
      'chk_plate_designs_status',
      sql`${table.status} IN ('draft','finalized','archived')`,
    ),
    check('chk_plate_designs_version', sql`${table.metadataVersion} > 0`),
    index('idx_plate_designs_workspace').on(table.workspaceId),
    index('idx_plate_designs_project').on(table.projectId),
    index('idx_plate_designs_workspace_status').on(
      table.workspaceId,
      table.status,
    ),
  ],
)

export const plateWells = api.table(
  'plate_wells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    designId: uuid('design_id')
      .notNull()
      .references(() => plateDesigns.id, { onDelete: 'cascade' }),
    wellCode: text('well_code').notNull(),
    rowIndex: integer('row_index').notNull(),
    colIndex: integer('col_index').notNull(),
    role: text('role').notNull(),
    sampleRecordId: uuid('sample_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    sampleIdentifier: text('sample_identifier'),
    sampleTitle: text('sample_title'),
    replicate: integer('replicate'),
    volumeValue: numeric('volume_value'),
    volumeUnit: text('volume_unit'),
    concentrationValue: numeric('concentration_value'),
    concentrationUnit: text('concentration_unit'),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_plate_wells_design_well').on(
      table.designId,
      table.wellCode,
    ),
    check(
      'chk_plate_wells_role',
      sql`${table.role} IN ('sample','positive_control','negative_control','blank','empty')`,
    ),
    check('chk_plate_wells_row', sql`${table.rowIndex} >= 0`),
    check('chk_plate_wells_col', sql`${table.colIndex} >= 0`),
    check(
      'chk_plate_wells_replicate',
      sql`${table.replicate} IS NULL OR ${table.replicate} > 0`,
    ),
    check(
      'chk_plate_wells_volume',
      sql`${table.volumeValue} IS NULL OR ${table.volumeValue} > 0`,
    ),
    check(
      'chk_plate_wells_concentration',
      sql`${table.concentrationValue} IS NULL OR ${table.concentrationValue} >= 0`,
    ),
    index('idx_plate_wells_workspace').on(table.workspaceId),
    index('idx_plate_wells_design').on(
      table.designId,
      table.rowIndex,
      table.colIndex,
    ),
  ],
)

export const plateLayoutTemplates = api.table(
  'plate_layout_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    format: text('format').notNull().default('96_well'),
    rows: integer('rows').notNull(),
    cols: integer('cols').notNull(),
    layout: jsonb('layout')
      .notNull()
      .default(sql`'{}'`),
    status: text('status').notNull().default('active'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_plate_layout_templates_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_plate_layout_templates_format',
      sql`${table.format} IN ('96_well')`,
    ),
    check(
      'chk_plate_layout_templates_rows',
      sql`${table.rows} > 0 AND ${table.rows} <= 26`,
    ),
    check(
      'chk_plate_layout_templates_cols',
      sql`${table.cols} > 0 AND ${table.cols} <= 26`,
    ),
    check(
      'chk_plate_layout_templates_status',
      sql`${table.status} IN ('active','archived')`,
    ),
    index('idx_plate_layout_templates_workspace').on(table.workspaceId),
  ],
)

export const plateDesignsRelations = relations(
  plateDesigns,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [plateDesigns.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [plateDesigns.projectId],
      references: [projects.id],
    }),
    wells: many(plateWells),
  }),
)

export const plateWellsRelations = relations(plateWells, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [plateWells.workspaceId],
    references: [workspaces.id],
  }),
  design: one(plateDesigns, {
    fields: [plateWells.designId],
    references: [plateDesigns.id],
  }),
  sampleRecord: one(records, {
    fields: [plateWells.sampleRecordId],
    references: [records.id],
    relationName: 'plate_well_sample',
  }),
}))

export const plateLayoutTemplatesRelations = relations(
  plateLayoutTemplates,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [plateLayoutTemplates.workspaceId],
      references: [workspaces.id],
    }),
  }),
)

// ---------------------------------------------------------------------------
// api — Lab Calendar (OPS-004). Bookable resources, time-range bookings,
// participants and required samples. Timestamps are timestamptz (UTC-stored,
// zone-aware); the booking's `timezone` column fixes the display/DST
// boundary. Controlled RPCs (migration 0050) are the only writers for
// bookings/participants/samples and enforce transactional overlap detection.
// ---------------------------------------------------------------------------

export const calendarResources = api.table(
  'calendar_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    resourceType: text('resource_type').notNull().default('instrument'),
    location: text('location'),
    capacity: integer('capacity').notNull().default(1),
    timezone: text('timezone').notNull().default('UTC'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'`),
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
      'chk_calendar_resources_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_calendar_resources_code',
      sql`length(btrim(${table.code})) BETWEEN 1 AND 100`,
    ),
    check(
      'chk_calendar_resources_type',
      sql`${table.resourceType} IN ('instrument','room','equipment')`,
    ),
    check('chk_calendar_resources_capacity', sql`${table.capacity} > 0`),
    check(
      'chk_calendar_resources_status',
      sql`${table.status} IN ('active','inactive')`,
    ),
    uniqueIndex('uq_calendar_resources_workspace_code').on(
      table.workspaceId,
      table.code,
    ),
    index('idx_calendar_resources_workspace').on(table.workspaceId),
    index('idx_calendar_resources_workspace_type').on(
      table.workspaceId,
      table.resourceType,
    ),
    index('idx_calendar_resources_project').on(table.projectId),
  ],
)

export const calendarBookings = api.table(
  'calendar_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => calendarResources.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    status: text('status').notNull().default('tentative'),
    allDay: boolean('all_day').notNull().default(false),
    startsAt: timestamp('starts_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    endsAt: timestamp('ends_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    location: text('location'),
    color: text('color'),
    notes: text('notes'),
    linkedExperimentRecordId: uuid('linked_experiment_record_id'),
    linkedExperimentIdentifier: text('linked_experiment_identifier'),
    linkedExperimentTitle: text('linked_experiment_title'),
    metadataVersion: integer('metadata_version').notNull().default(1),
    cancelledAt: timestamp('cancelled_at', {
      withTimezone: true,
      mode: 'date',
    }),
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
      'chk_calendar_bookings_title',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_calendar_bookings_status',
      sql`${table.status} IN ('tentative','confirmed','cancelled')`,
    ),
    check(
      'chk_calendar_bookings_range',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check('chk_calendar_bookings_version', sql`${table.metadataVersion} > 0`),
    check(
      'chk_calendar_bookings_cancel',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} IS NOT NULL)`,
    ),
    index('idx_calendar_bookings_workspace').on(table.workspaceId),
    index('idx_calendar_bookings_resource').on(table.resourceId),
    index('idx_calendar_bookings_project').on(table.projectId),
    index('idx_calendar_bookings_resource_starts').on(
      table.resourceId,
      table.startsAt,
    ),
  ],
)

export const calendarBookingParticipants = api.table(
  'calendar_booking_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => calendarBookings.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    displayName: text('display_name'),
    role: text('role').notNull().default('participant'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_calendar_booking_participants_role',
      sql`${table.role} IN ('owner','participant')`,
    ),
    check(
      'chk_calendar_booking_participants_identity',
      sql`${table.userId} IS NOT NULL OR ${table.displayName} IS NOT NULL`,
    ),
    uniqueIndex('uq_calendar_booking_participants_booking_user')
      .on(table.bookingId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index('idx_calendar_booking_participants_workspace').on(table.workspaceId),
    index('idx_calendar_booking_participants_booking').on(table.bookingId),
  ],
)

export const calendarBookingSamples = api.table(
  'calendar_booking_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => calendarBookings.id, { onDelete: 'cascade' }),
    sampleRecordId: uuid('sample_record_id'),
    sampleIdentifier: text('sample_identifier'),
    sampleTitle: text('sample_title'),
    quantityValue: numeric('quantity_value'),
    quantityUnit: text('quantity_unit'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_calendar_booking_samples_quantity',
      sql`${table.quantityValue} IS NULL OR ${table.quantityValue} > 0`,
    ),
    index('idx_calendar_booking_samples_workspace').on(table.workspaceId),
    index('idx_calendar_booking_samples_booking').on(table.bookingId),
  ],
)

export const calendarResourcesRelations = relations(
  calendarResources,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [calendarResources.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [calendarResources.projectId],
      references: [projects.id],
    }),
    bookings: many(calendarBookings),
  }),
)

export const calendarBookingsRelations = relations(
  calendarBookings,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [calendarBookings.workspaceId],
      references: [workspaces.id],
    }),
    resource: one(calendarResources, {
      fields: [calendarBookings.resourceId],
      references: [calendarResources.id],
    }),
    project: one(projects, {
      fields: [calendarBookings.projectId],
      references: [projects.id],
    }),
    participants: many(calendarBookingParticipants),
    samples: many(calendarBookingSamples),
  }),
)

export const calendarBookingParticipantsRelations = relations(
  calendarBookingParticipants,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [calendarBookingParticipants.workspaceId],
      references: [workspaces.id],
    }),
    booking: one(calendarBookings, {
      fields: [calendarBookingParticipants.bookingId],
      references: [calendarBookings.id],
    }),
  }),
)

export const calendarBookingSamplesRelations = relations(
  calendarBookingSamples,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [calendarBookingSamples.workspaceId],
      references: [workspaces.id],
    }),
    booking: one(calendarBookings, {
      fields: [calendarBookingSamples.bookingId],
      references: [calendarBookings.id],
    }),
  }),
)

// ---------------------------------------------------------------------------
// api — Study Planner (OPS-005). Workstreams (swimlanes), tasks and
// milestones, dependencies (directed edges with circular-dependency
// detection), assignments, resource bookings (with overbooking detection)
// and deliverables. Timestamps are timestamptz (UTC-stored, zone-aware); the
// task's `timezone` column fixes the display/DST boundary. Controlled RPCs
// (migration 0051) are the only writers for tasks/dependencies/assignments/
// resources so circular-dependency and overbooking checks are always enforced.
// ---------------------------------------------------------------------------

export const studies = api.table(
  'studies',
  {
    recordId: uuid('record_id')
      .primaryKey()
      .references(() => records.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    summary: text('summary'),
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    planVersion: integer('plan_version').notNull().default(1),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_studies_date_range',
      sql`${table.endsOn} IS NULL OR ${table.startsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
    check('chk_studies_plan_version', sql`${table.planVersion} > 0`),
    index('idx_studies_workspace').on(table.workspaceId),
  ],
)

export const studyProjects = api.table(
  'study_projects',
  {
    studyRecordId: uuid('study_record_id')
      .notNull()
      .references(() => studies.recordId, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull().default('participating'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.studyRecordId, table.projectId] }),
    check(
      'chk_study_projects_relationship',
      sql`${table.relationship} IN ('home','participating')`,
    ),
    index('idx_study_projects_project').on(table.projectId),
  ],
)

export const studyExperiments = api.table(
  'study_experiments',
  {
    studyRecordId: uuid('study_record_id')
      .notNull()
      .references(() => studies.recordId, { onDelete: 'cascade' }),
    experimentRecordId: uuid('experiment_record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    relationship: text('relationship').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.studyRecordId, table.experimentRecordId] }),
    check(
      'chk_study_experiments_relationship',
      sql`${table.relationship} IN ('member','primary','control')`,
    ),
    index('idx_study_experiments_experiment').on(table.experimentRecordId),
  ],
)

export const studyPlanSnapshots = api.table(
  'study_plan_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studyRecordId: uuid('study_record_id')
      .notNull()
      .references(() => studies.recordId, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planVersion: integer('plan_version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    checksum: text('checksum').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique('uq_study_plan_snapshots_version').on(
      table.studyRecordId,
      table.planVersion,
    ),
    check('chk_study_plan_snapshots_version', sql`${table.planVersion} > 0`),
    check(
      'chk_study_plan_snapshots_checksum',
      sql`${table.checksum} ~ '^[0-9a-f]{64}$'`,
    ),
    index('idx_study_plan_snapshots_workspace').on(table.workspaceId),
  ],
)

export const studyWorkstreams = api.table(
  'study_workstreams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    studyRecordId: uuid('study_record_id').references(() => studies.recordId, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    color: text('color'),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('active'),
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
      'chk_study_workstreams_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_study_workstreams_status',
      sql`${table.status} IN ('active','archived')`,
    ),
    check('chk_study_workstreams_position', sql`${table.position} >= 0`),
    index('idx_study_workstreams_workspace').on(table.workspaceId),
    index('idx_study_workstreams_project').on(table.projectId),
    index('idx_study_workstreams_study').on(table.studyRecordId),
    index('idx_study_workstreams_workspace_position').on(
      table.workspaceId,
      table.position,
    ),
  ],
)

export const studyTasks = api.table(
  'study_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workstreamId: uuid('workstream_id').references(() => studyWorkstreams.id, {
      onDelete: 'set null',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    studyRecordId: uuid('study_record_id').references(() => studies.recordId, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    taskType: text('task_type').notNull().default('task'),
    status: text('status').notNull().default('not_started'),
    priority: text('priority').notNull().default('medium'),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    timezone: text('timezone').notNull().default('UTC'),
    position: integer('position').notNull().default(0),
    color: text('color'),
    progressPercent: integer('progress_percent').notNull().default(0),
    linkedExperimentRecordId: uuid('linked_experiment_record_id'),
    linkedExperimentIdentifier: text('linked_experiment_identifier'),
    linkedExperimentTitle: text('linked_experiment_title'),
    linkedProtocolRecordId: uuid('linked_protocol_record_id'),
    linkedProtocolIdentifier: text('linked_protocol_identifier'),
    approvalRequired: boolean('approval_required').notNull().default(false),
    approvalStatus: text('approval_status').notNull().default('not_required'),
    tags: text('tags')
      .notNull()
      .default(sql`'{}'`),
    metadataVersion: integer('metadata_version').notNull().default(1),
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
      'chk_study_tasks_title',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_study_tasks_type',
      sql`${table.taskType} IN ('task','milestone')`,
    ),
    check(
      'chk_study_tasks_status',
      sql`${table.status} IN ('not_started','in_progress','review','completed','blocked','cancelled')`,
    ),
    check(
      'chk_study_tasks_priority',
      sql`${table.priority} IN ('low','medium','high','critical')`,
    ),
    check(
      'chk_study_tasks_approval',
      sql`${table.approvalStatus} IN ('not_required','pending','approved','rejected')`,
    ),
    check('chk_study_tasks_version', sql`${table.metadataVersion} > 0`),
    check(
      'chk_study_tasks_progress',
      sql`${table.progressPercent} BETWEEN 0 AND 100`,
    ),
    check('chk_study_tasks_position', sql`${table.position} >= 0`),
    index('idx_study_tasks_workspace').on(table.workspaceId),
    index('idx_study_tasks_workstream').on(table.workstreamId),
    index('idx_study_tasks_project').on(table.projectId),
    index('idx_study_tasks_study').on(table.studyRecordId),
    index('idx_study_tasks_workspace_position').on(
      table.workspaceId,
      table.position,
    ),
  ],
)

export const studyTaskDependencies = api.table(
  'study_task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    predecessorId: uuid('predecessor_id')
      .notNull()
      .references(() => studyTasks.id, { onDelete: 'cascade' }),
    successorId: uuid('successor_id')
      .notNull()
      .references(() => studyTasks.id, { onDelete: 'cascade' }),
    dependencyType: text('dependency_type')
      .notNull()
      .default('finish_to_start'),
    lagDays: integer('lag_days').notNull().default(0),
    isExternal: boolean('is_external').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_study_task_deps_type',
      sql`${table.dependencyType} IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish')`,
    ),
    check(
      'chk_study_task_deps_self',
      sql`${table.predecessorId} <> ${table.successorId}`,
    ),
    uniqueIndex('uq_study_task_deps_edge').on(
      table.predecessorId,
      table.successorId,
      table.dependencyType,
    ),
    index('idx_study_task_deps_workspace').on(table.workspaceId),
    index('idx_study_task_deps_predecessor').on(table.predecessorId),
    index('idx_study_task_deps_successor').on(table.successorId),
  ],
)

export const studyTaskAssignments = api.table(
  'study_task_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => studyTasks.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    displayName: text('display_name'),
    role: text('role').notNull().default('assignee'),
    effortPercent: integer('effort_percent').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_study_task_assignments_role',
      sql`${table.role} IN ('assignee','reviewer','observer')`,
    ),
    check(
      'chk_study_task_assignments_identity',
      sql`${table.userId} IS NOT NULL OR ${table.displayName} IS NOT NULL`,
    ),
    check(
      'chk_study_task_assignments_effort',
      sql`${table.effortPercent} BETWEEN 0 AND 100`,
    ),
    uniqueIndex('uq_study_task_assignments_task_user')
      .on(table.taskId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index('idx_study_task_assignments_workspace').on(table.workspaceId),
    index('idx_study_task_assignments_task').on(table.taskId),
  ],
)

export const studyTaskResources = api.table(
  'study_task_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => studyTasks.id, { onDelete: 'cascade' }),
    calendarResourceId: uuid('calendar_resource_id')
      .notNull()
      .references(() => calendarResources.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    endsAt: timestamp('ends_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_study_task_resources_range',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    index('idx_study_task_resources_workspace').on(table.workspaceId),
    index('idx_study_task_resources_task').on(table.taskId),
    index('idx_study_task_resources_resource').on(
      table.calendarResourceId,
      table.startsAt,
      table.endsAt,
    ),
  ],
)

export const studyDeliverables = api.table(
  'study_deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => studyTasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planned'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    linkedRecordId: uuid('linked_record_id'),
    linkedRecordIdentifier: text('linked_record_identifier'),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_study_deliverables_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_study_deliverables_status',
      sql`${table.status} IN ('planned','in_progress','delivered','overdue')`,
    ),
    index('idx_study_deliverables_workspace').on(table.workspaceId),
    index('idx_study_deliverables_task').on(table.taskId),
  ],
)

export const instruments = api.table(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    instrumentType: text('instrument_type').notNull().default('qpcr'),
    model: text('model'),
    serialNumber: text('serial_number'),
    vendor: text('vendor'),
    connectionStatus: text('connection_status')
      .notNull()
      .default('disconnected'),
    lastConnectedAt: timestamp('last_connected_at', {
      withTimezone: true,
      mode: 'date',
    }),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    position: integer('position').notNull().default(0),
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
      'chk_instruments_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_instruments_type',
      sql`${table.instrumentType} IN ('qpcr','sequencer','spectrophotometer','other')`,
    ),
    check(
      'chk_instruments_connection',
      sql`${table.connectionStatus} IN ('connected','disconnected','error')`,
    ),
    check('chk_instruments_position', sql`${table.position} >= 0`),
    index('idx_instruments_workspace').on(table.workspaceId),
    index('idx_instruments_workspace_position').on(
      table.workspaceId,
      table.position,
    ),
  ],
)

export const instrumentRuns = api.table(
  'instrument_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    runIdentifier: text('run_identifier').notNull(),
    protocolName: text('protocol_name'),
    status: text('status').notNull().default('queued'),
    progressPercent: integer('progress_percent').notNull().default(0),
    plateFormat: text('plate_format').notNull().default('96'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    estimatedDurationSeconds: integer('estimated_duration_seconds'),
    elapsedSeconds: integer('elapsed_seconds'),
    operator: text('operator'),
    errorMessage: text('error_message'),
    metadataVersion: integer('metadata_version').notNull().default(1),
    queuePosition: integer('queue_position').notNull().default(0),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    customFields: jsonb('custom_fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
      'chk_instrument_runs_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_instrument_runs_status',
      sql`${table.status} IN ('queued','running','completed','failed','cancelled')`,
    ),
    check(
      'chk_instrument_runs_progress',
      sql`${table.progressPercent} BETWEEN 0 AND 100`,
    ),
    check(
      'chk_instrument_runs_plate_format',
      sql`${table.plateFormat} IN ('6','24','48','96','384')`,
    ),
    check('chk_instrument_runs_version', sql`${table.metadataVersion} > 0`),
    check('chk_instrument_runs_queue', sql`${table.queuePosition} >= 0`),
    uniqueIndex('uq_instrument_runs_workspace_identifier').on(
      table.workspaceId,
      table.runIdentifier,
    ),
    index('idx_instrument_runs_workspace').on(table.workspaceId),
    index('idx_instrument_runs_instrument').on(table.instrumentId),
    index('idx_instrument_runs_workspace_status').on(
      table.workspaceId,
      table.status,
    ),
    index('idx_instrument_runs_workspace_queue').on(
      table.workspaceId,
      table.queuePosition,
    ),
  ],
)

export const instrumentRunStages = api.table(
  'instrument_run_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    stageType: text('stage_type').notNull().default('cycling'),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('pending'),
    cycleCount: integer('cycle_count'),
    currentCycle: integer('current_cycle').notNull().default(0),
    targetTemperature: numeric('target_temperature', {
      precision: 6,
      scale: 2,
    }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    durationSeconds: integer('duration_seconds'),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => [
    check(
      'chk_instrument_run_stages_name',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_instrument_run_stages_type',
      sql`${table.stageType} IN ('hold','cycling','melt','image','custom')`,
    ),
    check(
      'chk_instrument_run_stages_status',
      sql`${table.status} IN ('pending','running','completed','skipped','failed')`,
    ),
    check('chk_instrument_run_stages_position', sql`${table.position} >= 0`),
    check(
      'chk_instrument_run_stages_current_cycle',
      sql`${table.currentCycle} >= 0`,
    ),
    index('idx_instrument_run_stages_workspace').on(table.workspaceId),
    index('idx_instrument_run_stages_run').on(table.runId),
    index('idx_instrument_run_stages_run_position').on(
      table.runId,
      table.position,
    ),
  ],
)

export const instrumentObservations = api.table(
  'instrument_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => instrumentRunStages.id, {
      onDelete: 'set null',
    }),
    sourceId: text('source_id').notNull(),
    observationType: text('observation_type').notNull(),
    sourceTimestamp: timestamp('source_timestamp', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    ingestionStatus: text('ingestion_status').notNull().default('received'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorDetail: text('error_detail'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_instrument_observations_type',
      sql`${table.observationType} IN ('telemetry','stage_start','stage_complete','run_start','run_complete','run_fail','plate_snapshot','qc_result','status_change','heartbeat')`,
    ),
    check(
      'chk_instrument_observations_ingestion',
      sql`${table.ingestionStatus} IN ('received','processed','failed','duplicate')`,
    ),
    uniqueIndex('uq_instrument_observations_run_source').on(
      table.runId,
      table.sourceId,
    ),
    index('idx_instrument_observations_workspace').on(table.workspaceId),
    index('idx_instrument_observations_run').on(table.runId),
    index('idx_instrument_observations_run_timestamp').on(
      table.runId,
      table.sourceTimestamp,
    ),
    index('idx_instrument_observations_run_type').on(
      table.runId,
      table.observationType,
    ),
    index('idx_instrument_observations_ingestion').on(table.ingestionStatus),
  ],
)

export const instrumentPlateSnapshots = api.table(
  'instrument_plate_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    observationId: uuid('observation_id').references(
      () => instrumentObservations.id,
      { onDelete: 'set null' },
    ),
    plateFormat: text('plate_format').notNull().default('96'),
    wells: jsonb('wells')
      .notNull()
      .default(sql`'{}'::jsonb`),
    capturedAt: timestamp('captured_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    cycleNumber: integer('cycle_number'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_instrument_plate_snapshots_format',
      sql`${table.plateFormat} IN ('6','24','48','96','384')`,
    ),
    index('idx_instrument_plate_snapshots_workspace').on(table.workspaceId),
    index('idx_instrument_plate_snapshots_run').on(table.runId),
    index('idx_instrument_plate_snapshots_run_captured').on(
      table.runId,
      table.capturedAt,
    ),
  ],
)

export const instrumentQcChecks = api.table(
  'instrument_qc_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    checkName: text('check_name').notNull(),
    checkType: text('check_type').notNull().default('info'),
    message: text('message'),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_instrument_qc_checks_name',
      sql`length(btrim(${table.checkName})) BETWEEN 1 AND 200`,
    ),
    check(
      'chk_instrument_qc_checks_type',
      sql`${table.checkType} IN ('pass','warning','fail','info')`,
    ),
    index('idx_instrument_qc_checks_workspace').on(table.workspaceId),
    index('idx_instrument_qc_checks_run').on(table.runId),
    index('idx_instrument_qc_checks_run_type').on(table.runId, table.checkType),
  ],
)

export const instrumentRawFiles = api.table(
  'instrument_raw_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => fileObjects.id, {
      onDelete: 'set null',
    }),
    filename: text('filename').notNull(),
    mediaType: text('media_type'),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
    storageKey: text('storage_key'),
    checksum: text('checksum'),
    ingestionStatus: text('ingestion_status').notNull().default('pending'),
    errorDetail: text('error_detail'),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_instrument_raw_files_filename',
      sql`length(btrim(${table.filename})) BETWEEN 1 AND 500`,
    ),
    check(
      'chk_instrument_raw_files_ingestion',
      sql`${table.ingestionStatus} IN ('pending','complete','partial','failed')`,
    ),
    index('idx_instrument_raw_files_workspace').on(table.workspaceId),
    index('idx_instrument_raw_files_run').on(table.runId),
  ],
)

export const instrumentRunLinks = api.table(
  'instrument_run_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => instrumentRuns.id, { onDelete: 'cascade' }),
    linkedRecordId: uuid('linked_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    linkedRecordIdentifier: text('linked_record_identifier'),
    linkedRecordTitle: text('linked_record_title'),
    linkType: text('link_type').notNull().default('experiment'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_instrument_run_links_type',
      sql`${table.linkType} IN ('experiment','sample','protocol','file')`,
    ),
    index('idx_instrument_run_links_workspace').on(table.workspaceId),
    index('idx_instrument_run_links_run').on(table.runId),
    index('idx_instrument_run_links_record').on(table.linkedRecordId),
  ],
)

export const studyWorkstreamsRelations = relations(
  studyWorkstreams,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [studyWorkstreams.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [studyWorkstreams.projectId],
      references: [projects.id],
    }),
    tasks: many(studyTasks),
  }),
)

export const studyTasksRelations = relations(studyTasks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [studyTasks.workspaceId],
    references: [workspaces.id],
  }),
  workstream: one(studyWorkstreams, {
    fields: [studyTasks.workstreamId],
    references: [studyWorkstreams.id],
  }),
  project: one(projects, {
    fields: [studyTasks.projectId],
    references: [projects.id],
  }),
  assignments: many(studyTaskAssignments),
  resources: many(studyTaskResources),
  deliverables: many(studyDeliverables),
  dependenciesAsPredecessor: many(studyTaskDependencies, {
    relationName: 'study_task_predecessor',
  }),
  dependenciesAsSuccessor: many(studyTaskDependencies, {
    relationName: 'study_task_successor',
  }),
}))

export const studyTaskDependenciesRelations = relations(
  studyTaskDependencies,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [studyTaskDependencies.workspaceId],
      references: [workspaces.id],
    }),
    predecessor: one(studyTasks, {
      fields: [studyTaskDependencies.predecessorId],
      references: [studyTasks.id],
      relationName: 'study_task_predecessor',
    }),
    successor: one(studyTasks, {
      fields: [studyTaskDependencies.successorId],
      references: [studyTasks.id],
      relationName: 'study_task_successor',
    }),
  }),
)

export const studyTaskAssignmentsRelations = relations(
  studyTaskAssignments,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [studyTaskAssignments.workspaceId],
      references: [workspaces.id],
    }),
    task: one(studyTasks, {
      fields: [studyTaskAssignments.taskId],
      references: [studyTasks.id],
    }),
  }),
)

export const studyTaskResourcesRelations = relations(
  studyTaskResources,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [studyTaskResources.workspaceId],
      references: [workspaces.id],
    }),
    task: one(studyTasks, {
      fields: [studyTaskResources.taskId],
      references: [studyTasks.id],
    }),
    calendarResource: one(calendarResources, {
      fields: [studyTaskResources.calendarResourceId],
      references: [calendarResources.id],
    }),
  }),
)

export const studyDeliverablesRelations = relations(
  studyDeliverables,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [studyDeliverables.workspaceId],
      references: [workspaces.id],
    }),
    task: one(studyTasks, {
      fields: [studyDeliverables.taskId],
      references: [studyTasks.id],
    }),
  }),
)

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [instruments.workspaceId],
    references: [workspaces.id],
  }),
  runs: many(instrumentRuns),
}))

export const instrumentRunsRelations = relations(
  instrumentRuns,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [instrumentRuns.workspaceId],
      references: [workspaces.id],
    }),
    instrument: one(instruments, {
      fields: [instrumentRuns.instrumentId],
      references: [instruments.id],
    }),
    project: one(projects, {
      fields: [instrumentRuns.projectId],
      references: [projects.id],
    }),
    stages: many(instrumentRunStages),
    observations: many(instrumentObservations),
    plateSnapshots: many(instrumentPlateSnapshots),
    qcChecks: many(instrumentQcChecks),
    rawFiles: many(instrumentRawFiles),
    runLinks: many(instrumentRunLinks),
  }),
)

export const instrumentRunStagesRelations = relations(
  instrumentRunStages,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [instrumentRunStages.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentRunStages.runId],
      references: [instrumentRuns.id],
    }),
    observations: many(instrumentObservations),
  }),
)

export const instrumentObservationsRelations = relations(
  instrumentObservations,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [instrumentObservations.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentObservations.runId],
      references: [instrumentRuns.id],
    }),
    stage: one(instrumentRunStages, {
      fields: [instrumentObservations.stageId],
      references: [instrumentRunStages.id],
    }),
  }),
)

export const instrumentPlateSnapshotsRelations = relations(
  instrumentPlateSnapshots,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [instrumentPlateSnapshots.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentPlateSnapshots.runId],
      references: [instrumentRuns.id],
    }),
    observation: one(instrumentObservations, {
      fields: [instrumentPlateSnapshots.observationId],
      references: [instrumentObservations.id],
    }),
  }),
)

export const instrumentQcChecksRelations = relations(
  instrumentQcChecks,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [instrumentQcChecks.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentQcChecks.runId],
      references: [instrumentRuns.id],
    }),
  }),
)

export const instrumentRawFilesRelations = relations(
  instrumentRawFiles,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [instrumentRawFiles.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentRawFiles.runId],
      references: [instrumentRuns.id],
    }),
    fileObject: one(fileObjects, {
      fields: [instrumentRawFiles.fileId],
      references: [fileObjects.id],
    }),
  }),
)

export const instrumentRunLinksRelations = relations(
  instrumentRunLinks,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [instrumentRunLinks.workspaceId],
      references: [workspaces.id],
    }),
    run: one(instrumentRuns, {
      fields: [instrumentRunLinks.runId],
      references: [instrumentRuns.id],
    }),
    linkedRecord: one(records, {
      fields: [instrumentRunLinks.linkedRecordId],
      references: [records.id],
    }),
  }),
)

// ---------------------------------------------------------------------------
// OPS-007 — Report Builder
//
// report_definitions: the report document. report_sections: ordered sections
// bound to frozen revision evidence (REV-003/REV-005/REV-008). The
// canonical_snapshot captured at bind time lives in frozenPayload so preview
// and export never silently substitute live data. report_generations records
// generation inputs, version, actor and output checksum for deterministic
// regeneration. Templates (SCI-006) and review submissions (REV-002) are
// reused by reference.
// ---------------------------------------------------------------------------

export const reportDefinitions = api.table(
  'report_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    recordId: uuid('record_id')
      .notNull()
      .unique()
      .references(() => records.id, { onDelete: 'cascade' }),
    templateRecordId: uuid('template_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    reviewSubmissionId: uuid('review_submission_id').references(
      () => reviewSubmissions.id,
      { onDelete: 'set null' },
    ),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    documentIdentifier: text('document_identifier').notNull(),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    lastSavedAt: timestamp('last_saved_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_report_definitions_title',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 300`,
    ),
    check(
      'chk_report_definitions_status',
      sql`${table.status} IN ('draft','in_review','approved','published','archived')`,
    ),
    check('chk_report_definitions_version', sql`${table.version} > 0`),
    uniqueIndex('uq_report_definitions_workspace_identifier').on(
      table.workspaceId,
      table.documentIdentifier,
    ),
    index('idx_report_definitions_workspace').on(table.workspaceId),
    index('idx_report_definitions_workspace_status').on(
      table.workspaceId,
      table.status,
    ),
    index('idx_report_definitions_project').on(table.projectId),
    index('idx_report_definitions_record').on(table.recordId),
  ],
)

export const reportSections = api.table(
  'report_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reportDefinitions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    description: text('description'),
    sectionType: text('section_type').notNull().default('text'),
    sourceType: text('source_type').notNull().default('free_text'),
    sourceRevisionId: uuid('source_revision_id').references(
      () => revisions.id,
      {
        onDelete: 'restrict',
      },
    ),
    sourceRef: jsonb('source_ref')
      .notNull()
      .default(sql`'{}'::jsonb`),
    frozenPayload: jsonb('frozen_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    validationStatus: text('validation_status').notNull().default('pending'),
    validationDetail: jsonb('validation_detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'chk_report_sections_title',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 300`,
    ),
    check('chk_report_sections_position', sql`${table.position} >= 0`),
    check(
      'chk_report_sections_section_type',
      sql`${table.sectionType} IN ('text','table','chart','file','record_metadata','composite')`,
    ),
    check(
      'chk_report_sections_source_type',
      sql`${table.sourceType} IN ('free_text','revision_block','chart_block','table_block','file_object','record_metadata')`,
    ),
    check(
      'chk_report_sections_validation_status',
      sql`${table.validationStatus} IN ('pending','valid','missing_source','stale','locked')`,
    ),
    index('idx_report_sections_workspace').on(table.workspaceId),
    index('idx_report_sections_report').on(table.reportId),
    index('idx_report_sections_report_position').on(
      table.reportId,
      table.position,
    ),
    index('idx_report_sections_revision').on(table.sourceRevisionId),
  ],
)

export const reportGenerations = api.table(
  'report_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reportDefinitions.id, { onDelete: 'cascade' }),
    reportVersion: integer('report_version').notNull(),
    generationInputs: jsonb('generation_inputs').notNull(),
    outputFormat: text('output_format').notNull().default('html'),
    outputChecksum: text('output_checksum').notNull(),
    outputSizeBytes: bigint('output_size_bytes', { mode: 'number' })
      .notNull()
      .default(0),
    outputHtml: text('output_html'),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    generatedAt: timestamp('generated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_report_generations_format',
      sql`${table.outputFormat} IN ('html','pdf')`,
    ),
    check(
      'chk_report_generations_checksum',
      sql`${table.outputChecksum} ~ '^[0-9a-f]{64}$'`,
    ),
    check('chk_report_generations_version', sql`${table.reportVersion} > 0`),
    check('chk_report_generations_size', sql`${table.outputSizeBytes} >= 0`),
    index('idx_report_generations_workspace').on(table.workspaceId),
    index('idx_report_generations_report').on(table.reportId),
    index('idx_report_generations_report_version').on(
      table.reportId,
      table.reportVersion,
    ),
    index('idx_report_generations_checksum').on(table.outputChecksum),
  ],
)

export const reportDefinitionsRelations = relations(
  reportDefinitions,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [reportDefinitions.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [reportDefinitions.projectId],
      references: [projects.id],
    }),
    record: one(records, {
      fields: [reportDefinitions.recordId],
      references: [records.id],
    }),
    templateRecord: one(records, {
      fields: [reportDefinitions.templateRecordId],
      references: [records.id],
    }),
    reviewSubmission: one(reviewSubmissions, {
      fields: [reportDefinitions.reviewSubmissionId],
      references: [reviewSubmissions.id],
    }),
    sections: many(reportSections),
    generations: many(reportGenerations),
  }),
)

export const reportSectionsRelations = relations(reportSections, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [reportSections.workspaceId],
    references: [workspaces.id],
  }),
  report: one(reportDefinitions, {
    fields: [reportSections.reportId],
    references: [reportDefinitions.id],
  }),
  sourceRevision: one(revisions, {
    fields: [reportSections.sourceRevisionId],
    references: [revisions.id],
  }),
}))

export const reportGenerationsRelations = relations(
  reportGenerations,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [reportGenerations.workspaceId],
      references: [workspaces.id],
    }),
    report: one(reportDefinitions, {
      fields: [reportGenerations.reportId],
      references: [reportDefinitions.id],
    }),
    actor: one(user, {
      fields: [reportGenerations.actorUserId],
      references: [user.id],
    }),
  }),
)

// ---------------------------------------------------------------------------
// ADMIN-001 relations.
// ---------------------------------------------------------------------------

export const workspaceInvitationsRelations = relations(
  workspaceInvitations,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceInvitations.workspaceId],
      references: [workspaces.id],
    }),
    createdBy: one(user, {
      fields: [workspaceInvitations.createdByUserId],
      references: [user.id],
    }),
    acceptedBy: one(user, {
      fields: [workspaceInvitations.acceptedByUserId],
      references: [user.id],
    }),
  }),
)

export const workspaceSettingsRelations = relations(
  workspaceSettings,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceSettings.workspaceId],
      references: [workspaces.id],
    }),
    createdBy: one(user, {
      fields: [workspaceSettings.createdByUserId],
      references: [user.id],
    }),
  }),
)

export const projectAccessRelations = relations(projectAccess, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [projectAccess.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [projectAccess.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [projectAccess.userId],
    references: [user.id],
  }),
  grantedBy: one(user, {
    fields: [projectAccess.grantedByUserId],
    references: [user.id],
  }),
}))
