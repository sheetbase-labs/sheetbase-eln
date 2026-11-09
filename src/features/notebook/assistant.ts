/** Notebook cards in the browser: which actions are ours, how they run, their words. */
import { isNotebookAction } from '#/lib/assistant-notebook'
import type {
  NotebookAction,
  NotebookProposeToolName,
} from '#/lib/assistant-notebook'
import { defineAssistant } from '../define'

const words = (key: string) => `notebook.assistantPanel.proposal.${key}`

export const assistant = defineAssistant<
  NotebookAction,
  NotebookProposeToolName
>()({
  isAction: isNotebookAction,
  async run(client, action) {
    const { runNotebookAction } = await import('#/lib/assistant-notebook-run')
    return runNotebookAction(client, action)
  },
  cardWords: {
    'notebook.comment_add': words('addComment'),
    'notebook.comment_reply': words('replyToComment'),
    'notebook.comment_resolve': words('resolveComment'),
    'notebook.file_status': words('setFileStatus'),
    'notebook.protocol_new_version': words('newProtocolVersion'),
    'notebook.protocol_set_status': words('setProtocolStatus'),
    'notebook.protocol_confirm_current': words('confirmProtocolCurrent'),
    'notebook.protocol_assign_training': words('assignTraining'),
    'notebook.protocol_unassign_training': words('unassignTraining'),
    'notebook.protocol_record_trained': words('recordTrained'),
    'notebook.deviation_reason': words('setDeviationReason'),
    'notebook.approval_request': words('requestApproval'),
    'notebook.approval_withdraw': words('withdrawApproval'),
  },
})
