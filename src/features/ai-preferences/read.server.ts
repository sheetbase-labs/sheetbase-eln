/** The assistant's read of what it remembers: the lab's preferences and the person's own. */
import { z } from 'zod'

import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'

import { AI_PREFERENCES_READ_TOOL } from './feature'
import { listAiPreferences } from './preferences.server'

const schema = z.strictObject({})

export function aiPreferencesReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      AI_PREFERENCES_READ_TOOL,
      'List what is saved about how this lab and this person like things done: preferences for plate layouts, naming, controls and the like. Each has an id to propose changing or forgetting it.',
      schema,
    ),
  ]
}

export function isAiPreferencesReadTool(name: string): boolean {
  return name === AI_PREFERENCES_READ_TOOL
}

export async function runAiPreferencesReadTool(
  _name: string,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  try {
    const items = await listAiPreferences(context.client)

    return {
      text: JSON.stringify({
        items,
        returned: items.length,
        page: '/settings/account/ai-preferences',
      }),
      isError: false,
    }
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : 'Could not read that.',
      isError: true,
    }
  }
}
