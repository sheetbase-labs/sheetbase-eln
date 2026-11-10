import { z } from 'zod'

import { DataClientError } from '#/lib/data-client'
import type { Tone } from '#/components/ui/status'
import { changeSetFromVersions } from '#/lib/notebook-template-change-set'
import type { TemplateChangeSetEntry } from '#/lib/notebook-template-change-set'
import { formatInstant } from '#/lib/display-time-zone'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import {
  diffTemplatePlacements,
  summariseTemplateChanges,
} from '#/components/templates/template-structure'
import type { SheetVersionLookup } from '#/components/templates/template-structure'
import { t } from '#/copy'

/** The Versions tab's search: which version and comparison it opens. */
export const versionsSearch = z.object({
  v: z.string().optional().catch(undefined),
  compare: z.string().optional().catch(undefined),
  state: z.literal('denied').optional().catch(undefined),
})

export const TAG_LABEL: Record<TemplateChangeSetEntry['tag'], string> = {
  added: t('library.templates.versions.added'),
  removed: t('library.templates.versions.removed'),
  changed: t('library.templates.versions.changed'),
}

export const TAG_TONE: Record<TemplateChangeSetEntry['tag'], Tone> = {
  added: 'ok',
  removed: 'bad',
  changed: 'review',
}

/** The server refuses a publish when the draft revision moved (SB001); the
 * screen must show that refusal as a reload, not as a generic failure. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught publish/retire failure is untyped by definition; the DataClient error code and the message are both checked here.
export function isStaleRevisionError(error: unknown): boolean {
  if (error instanceof DataClientError && error.code === 'SB001') return true

  return error instanceof Error && /stale .*revision/i.test(error.message)
}

/** "09:50" in the workspace's display zone. */
export function formatClock(iso: string): string {
  return formatInstant(iso, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed template action is a caught throw; its own message selects the words the screen shows.
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('certification')) {
    return t('library.templates.versions.youHaventCertifiedYourElectronic')
  }

  if (message.includes('unsigned records')) {
    return t('library.templates.versions.unsignedRecordsAreStillOn')
  }

  if (message.includes('reason'))
    return t('library.templates.versions.giveAReasonForThe')

  return message
}

export interface StalePublish {
  versionId: string
  version: number
  attemptedRevision: number
}

/** One version's recorded differences from the one before it. */
export interface ChangeGroup {
  version: NotebookTemplateVersion
  previous: NotebookTemplateVersion | undefined
  entries: TemplateChangeSetEntry[]
  changes: ReturnType<typeof diffTemplatePlacements>
}

/**
 * The change sets between the compared versions: from the comparison's low
 * version (or the one before the selected version) up to its high version.
 */
export function buildChangeGroups({
  rows,
  selected,
  compareVersion,
  versionsById,
}: {
  rows: NotebookTemplateVersion[]
  selected: NotebookTemplateVersion | undefined
  compareVersion: NotebookTemplateVersion | undefined
  versionsById: SheetVersionLookup
}): ChangeGroup[] {
  const ordered = [...rows].sort((a, b) => a.version - b.version)

  const previousOf = (version: NotebookTemplateVersion) =>
    ordered.filter((row) => row.version < version.version).at(-1)

  if (!selected) return []

  const low = compareVersion
    ? Math.min(compareVersion.version, selected.version)
    : (previousOf(selected)?.version ?? 0)

  const high = compareVersion
    ? Math.max(compareVersion.version, selected.version)
    : selected.version

  return ordered
    .filter((row) => row.version > low && row.version <= high)
    .map((row) => ({
      version: row,
      previous: previousOf(row),
      entries: changeSetFromVersions(
        previousOf(row)?.configuration,
        row.configuration,
      ),
      changes: diffTemplatePlacements(
        previousOf(row)?.configuration.placements ?? null,
        row.configuration.placements,
        versionsById,
      ),
    }))
}

/** Each version's one-line change summary, keyed by version id. */
export function buildChangeText({
  rows,
  versionsById,
}: {
  rows: NotebookTemplateVersion[]
  versionsById: SheetVersionLookup
}) {
  const ordered = [...rows].sort((a, b) => a.version - b.version)
  const map = new Map<string, string>()

  ordered.forEach((row, index) => {
    const previous = ordered.find((_, i) => i === index - 1)
    map.set(
      row.id,
      summariseTemplateChanges(
        diffTemplatePlacements(
          previous?.configuration.placements ?? null,
          row.configuration.placements,
          versionsById,
        ),
        row.reason,
        !previous,
        row.configuration.placements.length,
      ),
    )
  })

  return map
}

/** How many notebooks sit on each template version. */
export function buildRecordsByVersion(
  users: Array<{ source_notebook_template_version_id?: string | null }>,
) {
  const map = new Map<string, number>()

  for (const r of users) {
    const key = r.source_notebook_template_version_id ?? ''
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return map
}

/** The change list's heading: a comparison, a change since, or the first version. */
export function changesTitleOf({
  compareVersion,
  firstChange,
  selected,
}: {
  compareVersion: NotebookTemplateVersion | undefined
  firstChange: ChangeGroup | undefined
  selected: NotebookTemplateVersion
}): string {
  if (compareVersion) {
    return t('library.templates.versions.changesFromVToV', {
      low: Math.min(compareVersion.version, selected.version),
      high: Math.max(compareVersion.version, selected.version),
    })
  }

  if (firstChange?.previous) {
    return t('library.templates.versions.changesSinceV', {
      version: firstChange.previous.version,
    })
  }

  return t('library.templates.versions.firstVersion')
}
