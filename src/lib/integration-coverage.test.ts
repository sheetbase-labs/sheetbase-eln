import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EXTERNAL_RPC_SCOPES, EXTERNAL_TABLE_ACCESS } from './external-token'
import {
  NOT_EXPOSED,
  NOT_EXPOSED_PATTERNS,
  notExposedReason,
} from './integration-exemptions'
import { PENDING_EXPOSURE } from './integration-pending'
import { LAB_RPCS, LAB_TABLES } from './lab-api-surface'

/**
 * Integration guard (Gareth, 2026-11-06): every feature must be reachable by
 * the assistant, MCP, the API and webhooks, not just the UI.
 *
 * This test covers the API/MCP/docs side: every table, view or function in
 * the `api` schema, from the first migration on (the whole app, not only what
 * was built after the guard), must be on the external allowlist or listed with
 * a reason in `integration-exemptions.ts`. MCP reads come from the same allowlist
 * (`sheetbase.canonical.read`) and MCP actions from `lab-api-surface.ts`.
 */
const DRIZZLE_DIR = join(process.cwd(), 'drizzle')

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter(
      (file) =>
        // The baseline and every numbered migration, then every
        // timestamp-named one (`20261106235405_name.sql`).
        /^\d{4}_.+\.sql$/.test(file) || /^\d{14}_.+\.sql$/.test(file),
    )
    .sort()
}

/** The `api` objects a migration history leaves in place. */
interface ApiObjects {
  tables: Set<string>
  functions: Set<string>
}

/** api.* names still present after all guarded migrations ran in order. */
function apiObjects(): ApiObjects {
  const tables = new Set<string>()
  const functions = new Set<string>()

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(DRIZZLE_DIR, file), 'utf8')

    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(table|view|function)\s+(?:if\s+not\s+exists\s+)?"?api"?\."?([a-z_0-9]+)"?/gi,
    )) {
      const set = match[1].toLowerCase() === 'function' ? functions : tables
      set.add(match[2])
    }

    for (const match of sql.matchAll(
      /drop\s+(table|view|function)\s+(?:if\s+exists\s+)?"?api"?\."?([a-z_0-9]+)"?/gi,
    )) {
      const set = match[1].toLowerCase() === 'function' ? functions : tables

      // A later CREATE in the same file wins over an earlier DROP.
      const created = new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?${match[1]}\\s+(?:if\\s+not\\s+exists\\s+)?"?api"?\\."?${match[2]}"?(?![a-z_0-9])`,
        'i',
      ).test(sql.slice(sql.toLowerCase().lastIndexOf(match[0].toLowerCase())))

      if (!created) set.delete(match[2])
    }
  }

  return { tables, functions }
}

describe('API integration guard', () => {
  const { tables, functions } = apiObjects()

  it('finds the migrations it is meant to guard', () => {
    expect(migrationFiles()).toContain('0000_baseline.sql')
    expect(migrationFiles().length).toBeGreaterThan(20)
    // The oldest part of the app is in scope too, not only newer features.
    expect(tables.has('calendar_bookings')).toBe(true)
    expect(functions.has('create_booking')).toBe(true)
    expect(tables.has('reagent_orders')).toBe(true)
    expect(functions.has('request_reagent_order')).toBe(true)
  })

  it('puts every table and view on the allowlist or gives a reason', () => {
    const missing = [...tables].filter(
      (name) =>
        !(name in EXTERNAL_TABLE_ACCESS) &&
        notExposedReason(name) === undefined,
    )

    expect(
      missing,
      `Tables that API tokens, MCP and the docs cannot reach. Add them to lab-api-surface.ts (LAB_TABLES) or give a reason in integration-exemptions.ts: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('puts every function on the allowlist or gives a reason', () => {
    const missing = [...functions].filter(
      (name) =>
        !(name in EXTERNAL_RPC_SCOPES) && notExposedReason(name) === undefined,
    )

    expect(
      missing,
      `Functions that API tokens, MCP and the docs cannot reach. Add them to lab-api-surface.ts (LAB_RPCS) or give a reason in integration-exemptions.ts: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('keeps the exemption list honest', () => {
    const everything = new Set([...tables, ...functions])

    for (const [name, reason] of Object.entries(NOT_EXPOSED)) {
      expect(
        everything.has(name),
        `${name} is exempt but no migration creates it`,
      ).toBe(true)
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(20)
      expect(
        name in EXTERNAL_TABLE_ACCESS || name in EXTERNAL_RPC_SCOPES,
        `${name} is both exempt and on the allowlist`,
      ).toBe(false)
    }
  })

  it('keeps the list of areas still being opened honest', () => {
    const everything = new Set([...tables, ...functions])

    for (const name of Object.keys(PENDING_EXPOSURE)) {
      expect(
        everything.has(name),
        `${name} is pending but no migration creates it`,
      ).toBe(true)
      expect(
        name in EXTERNAL_TABLE_ACCESS || name in EXTERNAL_RPC_SCOPES,
        `${name} is pending but is already on the allowlist: take it out of integration-pending.ts`,
      ).toBe(false)
      expect(name in NOT_EXPOSED, `${name} is pending and exempt`).toBe(false)
    }
  })

  it('keeps the exemption groups honest', () => {
    const everything = [...tables, ...functions]

    for (const { pattern, reason } of NOT_EXPOSED_PATTERNS) {
      const matched = everything.filter((name) => pattern.test(name))
      expect(matched.length, `${pattern} matches nothing`).toBeGreaterThan(0)
      expect(reason.length).toBeGreaterThan(20)

      for (const name of matched) {
        expect(
          name in EXTERNAL_TABLE_ACCESS || name in EXTERNAL_RPC_SCOPES,
          `${name} is in an exemption group and on the allowlist`,
        ).toBe(false)
      }
    }
  })

  it('documents every lab table and action in a page of docs/api', () => {
    // Any page: a feature documents its own in a page of its own.
    const dir = join(process.cwd(), 'docs/api')

    const doc = readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n')

    for (const name of [...Object.keys(LAB_TABLES), ...Object.keys(LAB_RPCS)]) {
      expect(doc, `${name} is missing from the pages in docs/api`).toContain(
        `\`${name}\``,
      )
    }
  })

  it('keeps lab tables and actions out of the exemption list', () => {
    for (const name of [...Object.keys(LAB_TABLES), ...Object.keys(LAB_RPCS)]) {
      expect(name in NOT_EXPOSED).toBe(false)
    }
  })
})
