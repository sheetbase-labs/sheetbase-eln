import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EXTERNAL_RPC_SCOPES, EXTERNAL_TABLE_ACCESS } from './external-token'
import { NOT_EXPOSED } from './integration-exemptions'
import { LAB_RPCS, LAB_TABLES } from './lab-api-surface'

/**
 * Integration guard (Gareth, 2026-11-06): every feature must be reachable by
 * the assistant, MCP, the API and webhooks, not just the UI.
 *
 * This test covers the API/MCP/docs side: every table, view or function a
 * migration adds to the `api` schema from FIRST_GUARDED_MIGRATION on must be
 * on the external allowlist or listed with a reason in
 * `integration-exemptions.ts`. MCP reads come from the same allowlist
 * (`sheetbase.canonical.read`) and MCP actions from `lab-api-surface.ts`.
 */
const FIRST_GUARDED_MIGRATION = 57
const DRIZZLE_DIR = join(process.cwd(), 'drizzle')

function migrationFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter(
      (file) =>
        // Numbered migrations from the first guarded one, and every
        // timestamp-named one (`20261106235405_name.sql`), which all came later.
        (/^\d{4}_.+\.sql$/.test(file) &&
          Number(file.slice(0, 4)) >= FIRST_GUARDED_MIGRATION) ||
        /^\d{14}_.+\.sql$/.test(file),
    )
    .sort()
}

/** api.* names still present after all guarded migrations ran in order. */
function apiObjects(): { tables: Set<string>; functions: Set<string> } {
  const tables = new Set<string>()
  const functions = new Set<string>()
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(DRIZZLE_DIR, file), 'utf8')
    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(table|view|function)\s+(?:if\s+not\s+exists\s+)?api\.([a-z_0-9]+)/gi,
    )) {
      const set = match[1].toLowerCase() === 'function' ? functions : tables
      set.add(match[2])
    }
    for (const match of sql.matchAll(
      /drop\s+(table|view|function)\s+(?:if\s+exists\s+)?api\.([a-z_0-9]+)/gi,
    )) {
      const set = match[1].toLowerCase() === 'function' ? functions : tables
      // A later CREATE in the same file wins over an earlier DROP.
      const created = new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?${match[1]}\\s+(?:if\\s+not\\s+exists\\s+)?api\\.${match[2]}\\b`,
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
    expect(migrationFiles().length).toBeGreaterThan(20)
    expect(tables.has('reagent_orders')).toBe(true)
    expect(functions.has('request_reagent_order')).toBe(true)
  })

  it('puts every new table and view on the allowlist or gives a reason', () => {
    const missing = [...tables].filter(
      (name) => !(name in EXTERNAL_TABLE_ACCESS) && !(name in NOT_EXPOSED),
    )
    expect(
      missing,
      `Tables added since migration ${FIRST_GUARDED_MIGRATION} that API tokens, MCP and the docs cannot reach. Add them to lab-api-surface.ts (LAB_TABLES) or give a reason in integration-exemptions.ts: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('puts every new function on the allowlist or gives a reason', () => {
    const missing = [...functions].filter(
      (name) => !(name in EXTERNAL_RPC_SCOPES) && !(name in NOT_EXPOSED),
    )
    expect(
      missing,
      `Functions added since migration ${FIRST_GUARDED_MIGRATION} that API tokens, MCP and the docs cannot reach. Add them to lab-api-surface.ts (LAB_RPCS) or give a reason in integration-exemptions.ts: ${missing.join(', ')}`,
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

  it('documents every lab table and action in docs/api/lab-api.md', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/api/lab-api.md'), 'utf8')
    for (const name of [...Object.keys(LAB_TABLES), ...Object.keys(LAB_RPCS)]) {
      expect(doc, `${name} is missing from docs/api/lab-api.md`).toContain(
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
