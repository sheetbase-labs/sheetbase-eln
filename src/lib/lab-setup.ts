/**
 * The first admin's short setup: the lab's name, its time zone and which
 * starter measurement tables to keep. `api.complete_workspace_setup` does the
 * work and marks the workspace set up; the starter tables are real, editable
 * tables a scientist can import into straight away.
 */
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'

export const STARTER_TABLE_KEYS = [
  'plate_reader',
  'qpcr',
  'chromatography',
  'cell_counts',
  'general',
] as const
export type StarterTableKey = (typeof STARTER_TABLE_KEYS)[number]

export function starterTableLabel(key: StarterTableKey): string {
  return t(`settings.labSetup.${key}`)
}

export async function completeWorkspaceSetup(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    timeZone: string
    starterKeys: readonly StarterTableKey[]
  },
): Promise<{ installed: string[] }> {
  return client.rpc('complete_workspace_setup', {
    p_workspace_id: input.workspaceId,
    p_name: input.name.trim(),
    p_timezone: input.timeZone,
    p_starter_keys: [...input.starterKeys],
  })
}

/** Adds any starter tables the workspace doesn't have yet. */
export async function installStarterTables(
  client: DataClient,
  workspaceId: string,
  keys: readonly StarterTableKey[] = STARTER_TABLE_KEYS,
): Promise<string[]> {
  return client.rpc('install_starter_structures', {
    p_workspace_id: workspaceId,
    p_keys: [...keys],
  })
}

/** The zone the browser is in, when the database knows it; else London. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'
  } catch {
    return 'Europe/London'
  }
}

/** Every zone to offer, with the person's own and the workspace's first. */
export function timeZoneChoices(first: readonly string[]): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    all = ['Europe/London', 'UTC']
  }
  return [...new Set([...first, ...all])]
}

const dismissedKey = (workspaceId: string) =>
  `sheetbase.lab-setup.skipped.${workspaceId}`

export function setupWasSkipped(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(workspaceId)) === '1'
  } catch {
    return false
  }
}

export function rememberSetupSkipped(workspaceId: string): void {
  try {
    window.localStorage.setItem(dismissedKey(workspaceId), '1')
  } catch {
    // The dialog still closes for this visit.
  }
}
