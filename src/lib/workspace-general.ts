/**
 * SET-01.1 — workspace general settings.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

export interface WorkspaceGeneral {
  name: string | null
  site: string | null
  timezone: string
  dateFormat: string
  numberFormat: 'decimal' | 'scientific'
  publicationApprovalRequired: boolean
  /** SET-01.3 / EXP-05.5 — whether this workspace allows offline editing. */
  offlineEditingAllowed: boolean
  /** Changing a saved value needs a reason, kept in History. */
  requireChangeReason: boolean
  /** An approving signature locks the record; a change then needs an amendment. */
  lockOnSign: boolean
  /** Regulated-lab rules: a different admin verifies a signer, experiments
   * finish only through review, sessions idle out after 30 minutes. */
  regulatedLab: boolean
  /** SET-01.2 — identifier prefix per record kind. */
  idPrefixes: Record<string, string>
  /** When the first admin finished the short setup; null until then. */
  setupCompletedAt?: string | null
}

/** Record kinds whose identifier prefix the workspace can configure. */
export const ID_PREFIX_KINDS = [
  'experiment',
  'sample',
  'dataset',
  'protocol_template',
  'material',
  'report',
  'file',
  'notebook_template',
] as const

/** The prefix a record kind uses until the workspace sets its own
 * (api.next_record_identifier's built-in defaults) and its number width. */
export const DEFAULT_ID_PREFIXES: Record<
  (typeof ID_PREFIX_KINDS)[number],
  string
> = {
  experiment: 'EXP',
  sample: 'SMP',
  dataset: 'DS',
  protocol_template: 'PRT',
  material: 'MAT',
  report: 'RPT',
  file: 'FILE',
  notebook_template: 'TPL',
}

/** The identifier a kind's next record would get, e.g. "EXP-0001". */
export function exampleRecordId(
  kind: (typeof ID_PREFIX_KINDS)[number],
  prefix: string,
  next = 1,
): string {
  const width = kind === 'protocol_template' ? 3 : 4
  return `${prefix || DEFAULT_ID_PREFIXES[kind]}-${String(next).padStart(width, '0')}`
}

/** The number each record kind will use next, from the database's counters;
 * kinds never used yet start at 1. */
export async function fetchRecordIdCounters(
  workspaceId: string,
  client: DataClient = notebookDataClient,
): Promise<Record<string, number>> {
  const rows = await client.rpc<Array<{ kind: string; next_number: number }>>(
    'record_id_counters',
    { p_workspace_id: workspaceId },
  )
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.next_number)]))
}

interface WorkspaceSettingsWire {
  site: string | null
  timezone: string
  date_format: string
  number_format: string
  publication_approval_required: boolean
  allow_offline_editing: boolean
  require_change_reason: boolean
  lock_on_sign: boolean
  regulated_lab: boolean
  id_prefixes: Record<string, string> | null
  setup_completed_at?: string | null
  workspaces: { name: string } | null
}

export const workspaceGeneralQueryKey = ['workspace-general'] as const

export const DATE_FORMATS = [
  { value: 'd MMM yyyy', label: '25 Sep 2026' },
  { value: 'dd/MM/yyyy', label: '25/09/2026' },
  { value: 'yyyy-MM-dd', label: '2026-09-25' },
] as const

export const NUMBER_FORMATS = [
  { value: 'decimal', label: 'Decimal (1,234.5)' },
  { value: 'scientific', label: 'Scientific (1.23×10³)' },
] as const

export async function fetchWorkspaceGeneral(
  client: DataClient = notebookDataClient,
): Promise<WorkspaceGeneral | null> {
  const rows = await client.list<WorkspaceSettingsWire>(
    'workspace_settings',
    '?select=site,timezone,date_format,number_format,publication_approval_required,allow_offline_editing,require_change_reason,lock_on_sign,regulated_lab,id_prefixes,setup_completed_at,workspaces(name)&limit=1',
  )
  if (rows.length === 0) return null
  const row = rows[0]
  return {
    name: row.workspaces?.name ?? null,
    site: row.site,
    timezone: row.timezone,
    dateFormat: row.date_format,
    numberFormat: row.number_format === 'scientific' ? 'scientific' : 'decimal',
    publicationApprovalRequired: row.publication_approval_required,
    offlineEditingAllowed: row.allow_offline_editing,
    requireChangeReason: row.require_change_reason,
    lockOnSign: row.lock_on_sign,
    regulatedLab: row.regulated_lab,
    idPrefixes: row.id_prefixes ?? {},
    setupCompletedAt: row.setup_completed_at ?? null,
  }
}

export async function updateWorkspaceGeneral(
  workspaceId: string,
  input: WorkspaceGeneral,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_general', {
    p_workspace_id: workspaceId,
    p_site: input.site,
    p_timezone: input.timezone,
    p_date_format: input.dateFormat,
    p_number_format: input.numberFormat,
  })
}

export async function updateWorkspacePublicationPolicy(
  workspaceId: string,
  required: boolean,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_publication_policy', {
    p_workspace_id: workspaceId,
    p_required: required,
  })
}

/**
 * SET-01.3 / EXP-05.5 — allow or forbid offline editing on this workspace's
 * devices. When off, the notebook must not hold unsynced drafts: the offline
 * store still persists what it is given, so the caller gates its offline hold
 * on this value. Audited as an editing-rule change.
 */
export async function updateWorkspaceOfflineEditing(
  workspaceId: string,
  allowed: boolean,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_settings', {
    p_workspace_id: workspaceId,
    p_allow_offline_editing: allowed,
  })
}

/**
 * Whether a saved value needs a reason when it changes, and whether an
 * approving signature locks the record. Both are enforced by the database.
 */
export async function updateWorkspaceEditingRules(
  workspaceId: string,
  rules: { requireChangeReason: boolean; lockOnSign: boolean },
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_settings', {
    p_workspace_id: workspaceId,
    p_require_change_reason: rules.requireChangeReason,
    p_lock_on_sign: rules.lockOnSign,
  })
}

/** Turn the regulated-lab rules on or off for the whole workspace. */
export async function setRegulatedLab(
  workspaceId: string,
  regulated: boolean,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('set_regulated_lab', {
    p_workspace_id: workspaceId,
    p_regulated: regulated,
  })
}

/** SET-01.1 — rename the workspace (admin only). */
export async function updateWorkspaceName(
  workspaceId: string,
  name: string,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_name', {
    p_workspace_id: workspaceId,
    p_name: name,
  })
}

export async function updateWorkspaceIdPrefixes(
  workspaceId: string,
  prefixes: Record<string, string>,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_id_prefixes', {
    p_workspace_id: workspaceId,
    p_prefixes: prefixes,
  })
}
