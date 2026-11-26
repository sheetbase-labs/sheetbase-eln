import type { core } from 'zod'

import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table or RPC by name; anything not listed is empty. */
export function context(
  tables: Record<string, core.util.JSONType>,
): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const path = urlOf(input).pathname

    return Response.json(tables[path.split('/').at(-1) ?? ''] ?? [])
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}
