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
  boolean,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

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
// Relations for drizzle query API (no migration impact).
// ---------------------------------------------------------------------------

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(workspaceMemberships),
  projects: many(projects),
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
