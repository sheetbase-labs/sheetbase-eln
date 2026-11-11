import { parseCsv } from '#/lib/plate-designer'
import { t } from '#/copy'

import type { ProjectDetailsInput } from './project-data'

type Option = { id: string; label: string }

/** One line of a project import, ready to create or refused with a reason. */
export type ProjectImportRow = {
  /** The line in the file, counting the header as line 1. */
  line: number
  title: string
  input: ProjectDetailsInput | null
  /** Why the line cannot be imported; null when it can. */
  problem: string | null
}

const COLUMN_NAMES = {
  name: 'title',
  title: 'title',
  project: 'title',
  client: 'client',
  modality: 'modality',
  stage: 'stage',
  lead: 'lead',
  started: 'started',
  'start date': 'started',
  agreement: 'agreement',
} as const

type ColumnKey = (typeof COLUMN_NAMES)[keyof typeof COLUMN_NAMES]

/** What a project import read: its lines, or that no Name column was found. */
export type ProjectImportResult = {
  rows: ProjectImportRow[]
  missingName: boolean
}

function columnKey(name: string): ColumnKey | undefined {
  const key = name.trim().toLowerCase()

  return Object.entries(COLUMN_NAMES).find(([k]) => k === key)?.[1]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** A client matches by its code, its name or the whole "CODE · Name" label. */
function findOption(options: readonly Option[], text: string): Option | null {
  return (
    options.find(
      (o) =>
        same(o.label, text) ||
        o.label.split(' · ').some((part) => same(part, text)),
    ) ?? null
  )
}

/**
 * Reads a CSV of projects. The first line names the columns (Name is the only
 * one required); clients and leads are matched to the ones the workspace has,
 * and a line that cannot be matched says so instead of being guessed at.
 */
export function parseProjectImport(
  text: string,
  clients: readonly Option[],
  members: readonly Option[],
): ProjectImportResult {
  const parsed = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  const header = (parsed[0] ?? []).map(columnKey)

  if (!header.includes('title')) return { rows: [], missingName: true }

  const rows = parsed.slice(1).map((cells, index): ProjectImportRow => {
    const get = (key: ColumnKey): string => {
      const at = header.indexOf(key)

      return at === -1 ? '' : (cells[at] ?? '').trim()
    }

    const title = get('title')
    const line = index + 2
    const client = get('client')
    const lead = get('lead')
    const started = get('started')
    const clientOption = client ? findOption(clients, client) : null
    const leadOption = lead ? findOption(members, lead) : null

    const problem = !title
      ? t('projects.projectImport.problems.noName')
      : client && !clientOption
        ? t('projects.projectImport.problems.client', { client })
        : lead && !leadOption
          ? t('projects.projectImport.problems.lead', { lead })
          : started && !DATE.test(started)
            ? t('projects.projectImport.problems.date', { started })
            : null

    return {
      line,
      title,
      problem,
      input: problem
        ? null
        : {
            title,
            clientId: clientOption?.id ?? null,
            modality: get('modality') || null,
            stage: get('stage') || null,
            leadUserId: leadOption?.id ?? null,
            defaultReviewerUserId: null,
            agreementReference: get('agreement') || null,
            startedOn: started || null,
          },
    }
  })

  return { rows, missingName: false }
}
