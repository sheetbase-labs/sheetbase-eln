import { describe, expect, it } from 'vitest'
import { en } from './en'
import { HOUSE_RULES, brokenRules, catalogueLeaves } from './house-rules'
import pending from './house-rules-pending.json'

/**
 * Messages written before the rules were checked. The list only shrinks: a
 * new message must follow the rules, and a message that now follows them
 * leaves the list.
 */
const known: Readonly<Record<string, readonly string[]>> = pending

const leaves = catalogueLeaves(en)

describe('the copy house rules', () => {
  it('holds every new message to the rules', () => {
    const problems = leaves.flatMap(({ key, text }) =>
      brokenRules(text)
        .filter((rule) => !known[key]?.includes(rule.id))
        .map((rule) => `${key}: “${text}”\n    ${rule.id}: ${rule.fix}`),
    )

    expect(problems, `\n${problems.join('\n')}\n`).toEqual([])
  })

  it('drops a message from the pending list once it follows the rules', () => {
    const byKey = new Map(leaves.map((leaf) => [leaf.key, leaf.text]))

    const stale = Object.entries(known).flatMap(([key, ids]) => {
      const text = byKey.get(key)

      if (text === undefined) return [`${key}: no longer in the catalogue`]

      const still = new Set(brokenRules(text).map((rule) => rule.id))

      return ids.filter((id) => !still.has(id)).map((id) => `${key}: ${id}`)
    })

    expect(
      stale,
      `\nRemove these from src/copy/house-rules-pending.json (they follow the rules now):\n${stale.join('\n')}\n`,
    ).toEqual([])
  })

  it('names a fix for every rule', () => {
    for (const rule of HOUSE_RULES) expect(rule.fix, rule.id).not.toBe('')
  })
})
