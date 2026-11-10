/**
 * What a plugin screen can do in the app: the same lab actions the assistant,
 * the API and agents have (`LAB_RPCS`), run as the person using the screen.
 * There is no separate list for plugins, so an action added for the API is
 * there for plugins the moment it exists.
 *
 * Pure: shared by the screen host (to ask the person) and the server (to check
 * again before anything runs).
 */
import { z } from 'zod'

import { isWriteScope, LAB_RPCS } from '../lab-api-surface'
import type { LabRpc } from '../lab-api-surface'
import { argumentSchema, summariseArguments } from '../mcp/lab'

export interface AppActionCheck {
  action: string
  rpc: LabRpc
  args: z.output<ReturnType<typeof argumentSchema>>
  /** True when the action changes something, so the person is asked first. */
  writes: boolean
  /** One plain line for the person: what the action is and with what. */
  summary: string
}

export type AppActionResult =
  ({ ok: true } & AppActionCheck) | { ok: false; message: string }

export function checkAppAction(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Host messages supply raw action names; the string/own-catalogue schema below rejects non-text and inherited or unknown actions before lookup.
  action: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Host arguments are untrusted and immediately decoded with the selected RPC's authoritative argumentSchema; invalid arguments never reach a call.
  input: unknown,
): AppActionResult {
  const name = z
    .string()
    .refine((value) => Object.hasOwn(LAB_RPCS, value))
    .safeParse(action)

  if (!name.success)
    return { ok: false, message: 'That is not an action Sheetbase offers.' }
  const rpc = LAB_RPCS[name.data]
  const parsed = argumentSchema(rpc).safeParse(input ?? {})

  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first.path.join('.') || 'arguments'

    return {
      ok: false,
      message: `Invalid arguments for ${name.data}: ${where}: ${first.message}.`,
    }
  }

  return {
    ok: true,
    action: name.data,
    rpc,
    args: parsed.data,
    writes: isWriteScope(rpc.scope),
    summary: `${rpc.summary}${summariseArguments(parsed.data)}`.slice(0, 500),
  }
}
