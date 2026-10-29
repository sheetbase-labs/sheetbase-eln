import type {
  PickerOption,
  PickerSearchResult,
} from '#/components/v3/record-picker/entity-picker'
import { searchPickerRecords } from '#/components/v3/record-picker/record-picker-data'
import type {
  PickerItem,
  PickerKind,
} from '#/components/v3/record-picker/record-picker-data'
import { pickerStatus } from '#/components/v3/record-picker/record-picker-data'
import { searchSheetRecords } from '#/lib/sheet-record-search'
import type { SheetRecordSearchHit } from '#/lib/sheet-record-search'

/**
 * Option builders for `PickerSelect`: each turns the rows a screen already
 * loads into picker options, so every dropdown for the same kind of thing
 * reads the same (identifier, name, project, status) and filters the same way.
 */

interface ProjectRow {
  id: string
  title: string
  status?: string | null
  archived_at?: string | null
  display_id?: string | null
  stage?: string | null
  modality?: string | null
}

/** A project. `note` marks one that cannot be chosen, e.g. "Read-only". */
export function projectOption(
  p: ProjectRow,
  note?: string | null,
): PickerOption {
  const archived = Boolean(p.archived_at) || p.status === 'archived'
  return {
    id: p.id,
    identifier: p.display_id ?? undefined,
    label: p.title,
    status: archived ? { tone: 'stored', label: 'Archived' } : undefined,
    facets: {
      ...(p.stage ? { stage: p.stage } : null),
      ...(p.modality ? { modality: p.modality } : null),
    },
    disabled: Boolean(note),
    disabledReason: note ?? undefined,
  }
}

export function personOption(
  id: string,
  name: string,
  role?: string | null,
): PickerOption {
  return {
    id,
    label: name,
    detail: role ?? undefined,
    facets: role ? { role } : undefined,
  }
}

interface RecordRow {
  id: string
  identifier: string
  title: string
  status?: string | null
  project?: string | null
}

/** A numbered record: experiment, sample, protocol, instrument, material. */
export function recordOption(r: RecordRow): PickerOption {
  return {
    id: r.id,
    identifier: r.identifier,
    label: r.title,
    detail: r.project ?? undefined,
    status: r.status ? pickerStatus(r.status) : undefined,
    facets: r.project ? { project: r.project } : undefined,
  }
}

export function pickerItemOption(i: PickerItem): PickerOption {
  return {
    id: i.id,
    identifier: i.identifier,
    label: i.name,
    detail: i.project || undefined,
    status: i.status,
    facets: { type: i.kind, ...(i.project ? { project: i.project } : null) },
  }
}

/**
 * Server search over samples, materials, datasets and experiments. An empty
 * query lists the person's recent records. Bound to a list of kinds so a
 * dialog that needs an experiment never offers a sample.
 */
export function recordSearch(kinds: PickerKind[]) {
  return async (q: string): Promise<PickerSearchResult> => {
    const r = await searchPickerRecords({ q, kinds })
    return {
      options: r.items.map(pickerItemOption),
      recent: r.recent,
      total: r.total,
    }
  }
}

const sheetHitOption = (h: SheetRecordSearchHit): PickerOption => ({
  id: h.id,
  identifier: h.identifier,
  label: h.title,
  status: h.status ? pickerStatus(h.status) : undefined,
  disabled: h.archived,
  disabledReason: h.archived ? 'Archived' : undefined,
})

/**
 * Server search over the records of one model, built-in or workspace-defined,
 * including every subtype of it. This is what a reference field uses.
 */
export function modelRecordSearch(modelKey: string) {
  return async (q: string): Promise<PickerSearchResult> => {
    const hits = await searchSheetRecords({ modelKey, query: q, limit: 50 })
    return { options: hits.map(sheetHitOption), total: hits.length }
  }
}
