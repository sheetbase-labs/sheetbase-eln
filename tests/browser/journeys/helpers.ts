import { config } from 'dotenv'
import { Client } from 'pg'
import { expect } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

import { signInAsDesignUser } from '../../visual/sign-in'

config({ path: ['.env.local', '.env'] })

/** Gareth owns the seeded design workspace the journeys run against. */
export const DESIGN_USER = '00000000-0000-4000-8000-000000000310'

/** A name no seeded row uses, so a journey finds exactly what it created. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

/**
 * Wait until React has attached to the server-rendered page. A fill or click
 * that lands before hydration is lost (the form resets, the click is inert),
 * so every journey navigates through `open` rather than `page.goto`.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('main *, [role="dialog"] *'))
        .slice(0, 200)
        .some((el) =>
          Object.keys(el).some((k) => k.startsWith('__reactProps')),
        ),
    undefined,
    { timeout: 30_000 },
  )
}

/** Navigate and wait for the page to be interactive. */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)
}

export async function signIn(page: Page): Promise<void> {
  await signInAsDesignUser(page, DESIGN_USER)
}

/** Create a project through the New project dialog and return its page URL. */
/** Split the focused pane to the right through its more-actions menu. */
export async function splitRight(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^More actions for/ })
    .first()
    .click()
  await page.getByRole('menuitem', { name: /^Split right/ }).click()
}

export async function createProject(
  page: Page,
  title: string,
): Promise<string> {
  await open(page, '/projects?new=true')
  await page
    .getByLabel(/^title|^name/i)
    .first()
    .fill(title)
  await page.getByRole('button', { name: /^create/i }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/)
  return new URL(page.url()).pathname
}

/** Create a blank draft experiment in a project and land on its page. */
export async function createExperiment(
  page: Page,
  projectPath: string,
  title: string,
): Promise<string> {
  const projectId = projectPath.split('/').pop() ?? ''
  await open(page, `/experiments/new?project=${projectId}`)
  await page.getByLabel(/^title/i).fill(title)
  await page.getByRole('button', { name: /create draft/i }).click()
  // Creating a draft is a server round trip that compiles its handlers on first
  // use under the dev server, so it can outlast the default 5s assertion.
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/, {
    timeout: 30_000,
  })
  return new URL(page.url()).pathname.split('/')[2] ?? ''
}

/**
 * Give a design protocol an effective version, which the seed leaves out (its
 * one frozen version is in review), so a journey can start an experiment from
 * it. Idempotent: an existing version is left alone.
 */
export async function ensureEffectiveProtocol(
  protocolRecordId: string,
): Promise<void> {
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(
      `insert into api.protocol_versions
         (id, workspace_id, protocol_record_id, version, status, reason,
          change_summary, effective_at, created_by_user_id, updated_by_user_id)
       select gen_random_uuid(), r.workspace_id, r.id, 1, 'effective',
              'Journey fixture', 'Journey fixture', now(), $2, $2
         from api.records r
        where r.id = $1
          and not exists (
            select 1 from api.protocol_versions v
             where v.protocol_record_id = r.id and v.status = 'effective')
        on conflict (protocol_record_id, version) do nothing`,
      [protocolRecordId, DESIGN_USER],
    )
  } finally {
    await client.end()
  }
}

/** A Button-styled link is announced as a button; a plain link as a link. */
export function action(page: Page, name: RegExp | string): Locator {
  return page
    .getByRole('link', { name })
    .or(page.getByRole('button', { name }))
    .first()
}

/** A database connection that bypasses row security, for fixtures only. */
export async function withAdminDb<T>(
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

export interface FixtureUser {
  id: string
  name: string
}

/** Create a signed-in-able account that belongs to no workspace yet. */
export async function createUser(name: string): Promise<FixtureUser> {
  const id = `journey-${Math.random().toString(36).slice(2, 10)}`
  await withAdminDb((db) =>
    db.query(
      `insert into internal."user"(id, name, email, "emailVerified")
       values ($1, $2, $1 || '@sheetbase.test', true)`,
      [id, name],
    ),
  )
  return { id, name }
}

/** An empty workspace with one owner, the state a founder signs up into. */
export async function createWorkspace(
  owner: FixtureUser,
  name: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID()
  await withAdminDb(async (db) => {
    await db.query(
      `insert into api.workspaces(id, slug, name) values ($1::uuid, $1::uuid::text, $2)`,
      [workspaceId, name],
    )
    await db.query(
      `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'owner')`,
      [workspaceId, owner.id],
    )
    await db.query(
      `insert into api.workspace_settings(workspace_id, timezone, created_by_user_id) values ($1, 'Europe/London', $2)`,
      [workspaceId, owner.id],
    )
  })
  return workspaceId
}

/** Sign a fixture user in as the browser's session. */
export async function signInAs(page: Page, user: FixtureUser): Promise<void> {
  await signInAsDesignUser(page, user.id)
}

/**
 * A published model in the design workspace whose one field is optional, so a
 * single promoted column can fill a dataset built on it. A model whose other
 * fields are required cannot take a promotion of one column.
 */
export async function createPublishedModel(name: string): Promise<void> {
  await withAdminDb(async (db) => {
    const key = `journey_${Math.random().toString(36).slice(2, 10)}`
    const definition = await db.query<{ id: string }>(
      `insert into api.dataset_schema_definitions(workspace_id, key, name, lifecycle)
       values ('00000000-0000-4000-8000-000000000300', $1, $2, 'active') returning id`,
      [key, name],
    )
    const version = await db.query<{ id: string }>(
      `insert into api.dataset_schema_versions(schema_id, "version", lifecycle)
       values ($1, 1, 'draft') returning id`,
      [definition.rows[0]?.id],
    )
    await db.query(
      `insert into api.dataset_schema_version_fields
         (schema_version_id, field_id, key, label, logical_type, display_order)
       values ($1, gen_random_uuid(), 'note', 'Note', 'text', 1)`,
      [version.rows[0]?.id],
    )
    await db.query(
      `update api.dataset_schema_versions set lifecycle = 'active' where id = $1`,
      [version.rows[0]?.id],
    )
  })
}
