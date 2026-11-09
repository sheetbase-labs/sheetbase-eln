/** Notebook tools for the model: reads that answer, and cards that propose. */
import {
  buildNotebookProposal,
  isNotebookProposalTool,
  isNotebookReadTool,
  notebookProposalDefs,
  notebookReadDefs,
  runNotebookReadTool,
} from '#/lib/assistant-notebook.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: notebookReadDefs,
  isReadTool: isNotebookReadTool,
  runReadTool: runNotebookReadTool,
  proposalDefs: notebookProposalDefs,
  isProposalTool: isNotebookProposalTool,
  buildProposal: (name, args, context) =>
    isNotebookProposalTool(name)
      ? buildNotebookProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
