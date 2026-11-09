import type { DataClient } from './data-client'
import type { ExperimentAction } from './assistant-experiments'
import {
  setExperimentStatus,
  startExperimentRecord,
} from './experiment-lifecycle'
import { recordPath } from './navigation'

/**
 * Runs an experiment, alias or label template card's action as the person. Loaded only in the browser, when a button is pressed.
 */
export async function runExperimentAction(
  client: DataClient,
  action: ExperimentAction,
): Promise<{ openHref?: string } | undefined> {
  switch (action.kind) {
    case 'experiments.start':
      await startExperimentRecord(client, {
        recordId: action.recordId,
        reason: action.reason ?? undefined,
      })
      return { openHref: `/experiments/${action.recordId}/summary` }
    case 'experiments.status':
      await setExperimentStatus(client, {
        recordId: action.recordId,
        status: action.status,
        reason: action.reason,
      })
      return
    case 'experiments.outcome':
      await client.rpc('set_experiment_decision', {
        p_record_id: action.recordId,
        p_decision: action.outcome,
        p_notes: action.notes,
      })
      return
    case 'experiments.delete_draft':
      await client.rpc('delete_experiment_draft', {
        p_record_id: action.recordId,
      })
      return
    case 'experiments.alias_add':
      await client.rpc('add_record_alias', {
        p_record_id: action.recordId,
        p_alias: action.alias,
      })
      return { openHref: recordPath(action.recordId) }
    case 'experiments.alias_remove':
      await client.rpc('remove_record_alias', {
        p_record_id: action.recordId,
        p_alias: action.alias,
      })
      return
    case 'experiments.label_archive':
      await client.rpc('set_label_template_archived', {
        p_template_id: action.templateId,
        p_archived: action.archived,
      })
      return
  }
}
