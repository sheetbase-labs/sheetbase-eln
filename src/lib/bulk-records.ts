/**
 * Bulk actions on records picked in a list: archive, move, assign, set a field.
 *
 * Each action goes through the same per-record function the record's own page
 * uses, so access rules, locks, the audit trail and the "someone else edited
 * this" check all apply to every record, one at a time. A record that cannot
 * take the action is reported by its identifier with the reason; the others
 * still go through, because there is no honest way to roll back half a batch
 * that the audit trail has already recorded.
 */
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { updateRecordModelFieldValues } from '#/lib/model-fields'
import { placeSample } from '#/lib/sample-placement'
import { t } from '#/copy'

/** The most records one bulk action takes, so a stray select-all stays sane. */
export const BULK_LIMIT = 200

/** What an action needs to know about a record, read fresh from the server. */
export interface BulkTarget {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  projectId: string | null
  metadataVersion: number
  archived: boolean
  locked: boolean
  hasLocation: boolean
}

export interface BulkFailure {
  id: string
  identifier: string
  message: string
}

export interface BulkOutcome {
  /** Ids of the records the action went through for. */
  doneIds: string[]
  /** Identifiers of the same records, for the message. */
  done: string[]
  failed: BulkFailure[]
}

interface TargetWire {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  project_id: string | null
  metadata_version: number
  archived_at: string | null
  locked_at: string | null
  properties: Record<string, unknown> | null
}

/**
 * The current state of the picked records. The list's rows may be a moment
 * stale, and the version check on every action needs the version as it is now.
 */
export async function fetchBulkTargets(
  client: DataClient,
  ids: readonly string[],
): Promise<BulkTarget[]> {
  const rows: TargetWire[] = []

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    rows.push(
      ...(await client.list<TargetWire>(
        'records',
        `?id=in.(${chunk.join(',')})&deleted_at=is.null&select=id,kind,identifier,title,status,project_id,metadata_version,archived_at,locked_at,properties`,
      )),
    )
  }

  const order = new Map(ids.map((id, index) => [id, index]))

  return rows
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      identifier: row.identifier,
      title: row.title,
      status: row.status,
      projectId: row.project_id,
      metadataVersion: row.metadata_version,
      archived: row.archived_at !== null,
      locked: row.locked_at !== null,
      hasLocation: Boolean(
        typeof row.properties?.storageLocation === 'string' &&
        row.properties.storageLocation.trim(),
      ),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

/** The sentence a person reads for a refused record. */
export function describeBulkError(error: unknown): string {
  if (error instanceof DataClientError) {
    switch (error.code) {
      case 'SB001':
        return t('library.bulk.errors.changed')
      case 'SB004':
        return t('library.bulk.errors.archived')
      case 'SB011':
        return t('library.bulk.errors.locked')
      case 'SB109':
        return t('library.bulk.errors.draftOnly')
      case '42501':
        return t('library.bulk.errors.noAccess')
      case '22023':
        return error.message
      default:
        return error.message || t('library.bulk.errors.generic')
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : t('library.bulk.errors.generic')
}

/** Run `act` for every target, four at a time, and sort the results. */
export async function runBulk(
  targets: readonly BulkTarget[],
  act: (target: BulkTarget) => Promise<unknown>,
  skip?: (target: BulkTarget) => string | null,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { doneIds: [], done: [], failed: [] }
  let next = 0

  const worker = async () => {
    while (next < targets.length) {
      const target = targets[next++]
      const reason = skip?.(target) ?? null

      if (reason) {
        outcome.failed.push({
          id: target.id,
          identifier: target.identifier,
          message: reason,
        })
        continue
      }

      try {
        await act(target)
        outcome.doneIds.push(target.id)
        outcome.done.push(target.identifier)
      } catch (error) {
        outcome.failed.push({
          id: target.id,
          identifier: target.identifier,
          message: describeBulkError(error),
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker))

  return outcome
}

const alreadyArchived = (target: BulkTarget) =>
  target.archived ? t('library.bulk.errors.alreadyArchived') : null

const isArchived = (target: BulkTarget) =>
  target.archived ? t('library.bulk.errors.archived') : null

export function bulkArchive(
  client: DataClient,
  targets: readonly BulkTarget[],
  notes?: string,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      target.kind === 'sample'
        ? client.rpc('archive_sample', {
            p_record_id: target.id,
            p_expected_metadata_version: target.metadataVersion,
            p_notes: notes ?? null,
          })
        : client.rpc('archive_record', {
            p_record_id: target.id,
            p_expected_metadata_version: target.metadataVersion,
          }),
    alreadyArchived,
  )
}

const notArchived = (target: BulkTarget) =>
  target.archived ? null : t('library.bulk.errors.notArchived')

/** Bring archived records back, each through the RPC its own page uses. */
export function bulkRestore(
  client: DataClient,
  targets: readonly BulkTarget[],
  notes?: string,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      target.kind === 'sample'
        ? client.rpc('restore_sample', {
            p_record_id: target.id,
            p_expected_metadata_version: target.metadataVersion,
            p_notes: notes ?? null,
          })
        : client.rpc('restore_record', {
            p_record_id: target.id,
            p_expected_metadata_version: target.metadataVersion,
          }),
    notArchived,
  )
}

/** Move experiments to another project (the server allows drafts only). */
export function bulkMoveToProject(
  client: DataClient,
  targets: readonly BulkTarget[],
  projectId: string,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      client.rpc('move_record_to_project', {
        p_record_id: target.id,
        p_project_id: projectId,
        p_expected_metadata_version: target.metadataVersion,
      }),
    (target) =>
      target.projectId === projectId
        ? t('library.bulk.errors.alreadyThere')
        : isArchived(target),
  )
}

/** Put samples in one storage place, typed or a box's name. */
export function bulkMoveToLocation(
  client: DataClient,
  targets: readonly BulkTarget[],
  location: string,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      placeSample(client, {
        recordId: target.id,
        choice: { kind: 'text', text: location },
        hasLocation: target.hasLocation,
        expectedMetadataVersion: target.metadataVersion,
      }),
    isArchived,
  )
}

/** Assign records to a person, or clear the assignee with `null`. */
export function bulkAssign(
  client: DataClient,
  targets: readonly BulkTarget[],
  userId: string | null,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      client.rpc('assign_record', {
        p_record_id: target.id,
        p_expected_metadata_version: target.metadataVersion,
        p_assignee_user_id: userId,
      }),
    isArchived,
  )
}

/** Set one field of the records' model to the same value on every record. */
export function bulkSetField(
  client: DataClient,
  targets: readonly BulkTarget[],
  fieldName: string,
  value: unknown,
): Promise<BulkOutcome> {
  return runBulk(
    targets,
    (target) =>
      updateRecordModelFieldValues(client, target.id, target.metadataVersion, {
        [fieldName]: value,
      }),
    (target) =>
      target.archived
        ? t('library.bulk.errors.archived')
        : target.locked
          ? t('library.bulk.errors.locked')
          : null,
  )
}

/** What a printed label needs of a record, read fresh for the print. */
export interface BulkLabelRecord {
  id: string
  kind: string
  identifier: string
  title: string
  metadataVersion: number
  createdAt: string
  properties: Record<string, unknown> | null
  customFields: Record<string, unknown> | null
}

interface LabelWire {
  id: string
  kind: string
  identifier: string
  title: string
  metadata_version: number
  created_at: string
  properties: Record<string, unknown> | null
  custom_fields: Record<string, unknown> | null
}

export async function fetchBulkLabelRecords(
  client: DataClient,
  ids: readonly string[],
): Promise<BulkLabelRecord[]> {
  const rows: LabelWire[] = []

  for (let i = 0; i < ids.length; i += 50) {
    rows.push(
      ...(await client.list<LabelWire>(
        'records',
        `?id=in.(${ids.slice(i, i + 50).join(',')})&deleted_at=is.null&select=id,kind,identifier,title,metadata_version,created_at,properties,custom_fields`,
      )),
    )
  }

  const order = new Map(ids.map((id, index) => [id, index]))

  return rows
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      identifier: row.identifier,
      title: row.title,
      metadataVersion: row.metadata_version,
      createdAt: row.created_at,
      properties: row.properties,
      customFields: row.custom_fields,
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}
