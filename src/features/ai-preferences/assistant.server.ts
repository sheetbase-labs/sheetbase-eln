/** Preference tools for the model: a read that answers, and cards that propose. */
import { defineAssistantServer } from '../define.server'
import {
  aiPreferenceProposalDefs,
  buildAiPreferenceProposal,
  isAiPreferenceProposalTool,
} from './cards.server'
import {
  aiPreferencesReadDefs,
  isAiPreferencesReadTool,
  runAiPreferencesReadTool,
} from './read.server'

export const assistantServer = defineAssistantServer({
  readDefs: aiPreferencesReadDefs,
  isReadTool: isAiPreferencesReadTool,
  runReadTool: (name, _args, context) =>
    runAiPreferencesReadTool(name, context),
  proposalDefs: aiPreferenceProposalDefs,
  isProposalTool: isAiPreferenceProposalTool,
  buildProposal: (name, args, context) =>
    isAiPreferenceProposalTool(name)
      ? buildAiPreferenceProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
