/**
 * Where a work item is acted on.
 *
 * Every Inbox item opens the place its action is done: a review opens the
 * review page for the exact revision, an approval waiting for a signature opens
 * that review with the signing meaning chosen, access and agent items open the
 * screen that decides them, and a sample or instrument opens its own page.
 * The Inbox list, its inspector and the keyboard Open shortcut all read this
 * one function, so they cannot send a person to different places.
 */
import type { WorkItem } from './data'

export type WorkItemLink =
  | { to: '/inbox' }
  | {
      to: '/review/$revisionId'
      params: { revisionId: string }
      search?: { signatureMeaning: 'witnessed' | 'reviewed-and-approved' }
    }
  | { to: '/records/$recordId'; params: { recordId: string } }
  | { to: '/projects/$projectId'; params: { projectId: string } }
  | { to: '/samples/$sampleId'; params: { sampleId: string } }
  | { to: '/instruments/$instrumentId'; params: { instrumentId: string } }
  | { to: '/settings/access' }
  | { to: '/settings/members' }
  | { to: '/settings/signatures' }
  | {
      to: '/pipelines/agents'
      search: { view: 'proposals'; proposal?: string }
    }
  | {
      to: '/settings/integrations/$connectorId'
      params: { connectorId: string }
    }
  | {
      to: '/settings/instruments'
      search: { fileId: string; versionId: string | undefined }
    }
  | { to: '/pipelines'; search: { q: string | undefined } }
  | { to: '/datasets' }
  | { to: '/promotions' }
  | { to: '/materials'; search?: { selected: string } }

export function itemLink(item: WorkItem): WorkItemLink {
  const review = (
    meaning?: 'witnessed' | 'reviewed-and-approved',
  ): WorkItemLink | null =>
    item.revisionId
      ? {
          to: '/review/$revisionId',
          params: { revisionId: item.revisionId },
          ...(meaning ? { search: { signatureMeaning: meaning } } : {}),
        }
      : null
  const record = (): WorkItemLink =>
    item.recordId
      ? { to: '/records/$recordId', params: { recordId: item.recordId } }
      : { to: '/inbox' }

  switch (item.kind) {
    case 'witness_requested':
      return review('witnessed') ?? { to: '/inbox' }
    case 'review_requested':
      // The review page needs the exact revision; the record is the fallback
      // for an item that has not named one.
      return review() ?? record()
    case 'approval_unsigned':
      return review('reviewed-and-approved') ?? record()
    case 'witness_signed':
      return review() ?? record()
    // The returned banner and the resubmit action live in the notebook.
    case 'review_returned':
      return record()
    case 'access_requested':
      return { to: '/settings/access' }
    case 'access_decided':
      return item.projectId
        ? {
            to: '/projects/$projectId',
            params: { projectId: item.projectId },
          }
        : { to: '/inbox' }
    case 'agent_proposal':
      return {
        to: '/pipelines/agents',
        search: {
          view: 'proposals',
          ...(item.sourceId ? { proposal: item.sourceId } : {}),
        },
      }
    case 'verification_requested':
    case 'verification_granted':
      return { to: '/settings/signatures' }
    case 'invitation_accepted':
      return { to: '/settings/members' }
    case 'sample_awaiting_release':
    case 'sample_hold_exceeded':
      return item.recordId
        ? { to: '/samples/$sampleId', params: { sampleId: item.recordId } }
        : { to: '/inbox' }
    case 'calibration_overdue':
      return item.sourceId
        ? {
            to: '/instruments/$instrumentId',
            params: { instrumentId: item.sourceId },
          }
        : { to: '/inbox' }
    default:
      break
  }
  if (item.sourceType === 'connector_run' && item.connectorId)
    return {
      to: '/settings/integrations/$connectorId',
      params: { connectorId: item.connectorId },
    }
  if (item.sourceType === 'dataset_import_file' && item.sourceId)
    return {
      to: '/settings/instruments',
      search: {
        fileId: item.sourceId,
        versionId: item.parserVersionId ?? undefined,
      },
    }
  if (item.kind === 'run_failed' || item.kind === 'run_waiting')
    // Until the run is resolved, at least narrow the list to the pipeline the
    // item is about.
    return { to: '/pipelines', search: { q: item.identifier ?? undefined } }
  if (
    item.kind === 'approval_requested' &&
    item.identifier === 'column_promotion'
  )
    return { to: '/promotions' }
  if (item.kind === 'data_issue') return { to: '/datasets' }
  if (item.kind === 'material_expiring')
    return item.recordId
      ? { to: '/materials', search: { selected: item.recordId } }
      : { to: '/materials' }
  return record()
}
