import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import {
  ASSISTANT_COVERED,
  ASSISTANT_EXEMPT,
  ASSISTANT_GAPS,
} from './assistant-coverage'
import { EXTERNAL_RPC_SCOPES } from './external-token'
import { CORE_OPERATIONS } from './operations/registry'

/**
 * Assistant parity guard (Gareth, 2026-11-26). The API guard in
 * `integration-coverage.test.ts` only asks whether each database function is
 * open to tokens; it never asked whether the assistant can do the same, which
 * is how "add a reagent" shipped with no assistant card. This one takes every
 * write the API exposes and asks for an assistant tool, an exemption with a
 * reason, or a place on the shrinking gap list in `assistant-coverage.ts`.
 */
const writes = (): string[] => {
  const fromScopes = Object.entries(EXTERNAL_RPC_SCOPES)
    .filter(([, scopes]) => scopes.some((scope) => !scope.endsWith(':read')))
    .map(([name]) => name)

  const fromOperations = CORE_OPERATIONS.filter(
    (operation) => operation.kind === 'write',
  ).map((operation) => operation.name)

  return [...new Set([...fromScopes, ...fromOperations])].sort()
}

const declared = new Map(
  CORE_OPERATIONS.flatMap((operation) =>
    operation.assistant ? [[operation.name, operation.assistant.tool]] : [],
  ),
)

describe('assistant parity', () => {
  it('gives every write an assistant tool, a reason, or a place on the gap list', () => {
    const unaccounted = writes().filter(
      (name) =>
        !declared.has(name) &&
        !(name in ASSISTANT_COVERED) &&
        !(name in ASSISTANT_EXEMPT) &&
        !(name in ASSISTANT_GAPS),
    )

    expect(
      unaccounted,
      `Writes the app and API can do that the assistant cannot. Give each a confirm card in the same PR (declare it on the operation with \`assistant: { tool }\`, or name its tool in assistant-coverage.ts), or an exemption with a real reason: ${unaccounted.join(', ')}`,
    ).toEqual([])
  })

  it('names only tools the assistant is allowed to offer', () => {
    for (const [name, tool] of Object.entries(ASSISTANT_COVERED)) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, `${name} -> ${tool}`).toContain(tool)
    }
  })

  it('keeps the three lists honest', () => {
    const all = new Set(writes())

    for (const list of [ASSISTANT_COVERED, ASSISTANT_EXEMPT, ASSISTANT_GAPS]) {
      for (const name of Object.keys(list)) {
        expect(all.has(name), `${name} is not a write any more`).toBe(true)
        expect(
          declared.has(name),
          `${name} has a tool declared on its operation: take it out of assistant-coverage.ts`,
        ).toBe(false)
      }
    }

    for (const name of Object.keys(ASSISTANT_GAPS)) {
      expect(name in ASSISTANT_COVERED, `${name} is covered and a gap`).toBe(
        false,
      )
      expect(name in ASSISTANT_EXEMPT, `${name} is exempt and a gap`).toBe(
        false,
      )
    }

    for (const [name, reason] of Object.entries(ASSISTANT_EXEMPT)) {
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(30)
    }
  })

  it('has the writes that were missing when this guard was added', () => {
    expect(declared.get('create_model_record')).toBe('sheetbase.record.create')
    expect(ASSISTANT_COVERED.register_replacement_lot).toBe(
      'sheetbase.material.add_lot',
    )
  })
})
