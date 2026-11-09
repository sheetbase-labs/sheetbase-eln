/** Record type, sheet definition and template tools for the model: reads that answer, and cards that propose. */
import {
  buildSchemaProposal,
  isSchemaProposalTool,
  isSchemaReadTool,
  runSchemaReadTool,
  schemaProposalDefs,
  schemaReadDefs,
} from '#/lib/assistant-schema.server'
import { defineAssistantServer } from '../define.server'

export const assistantServer = defineAssistantServer({
  readDefs: schemaReadDefs,
  isReadTool: isSchemaReadTool,
  runReadTool: runSchemaReadTool,
  proposalDefs: schemaProposalDefs,
  isProposalTool: isSchemaProposalTool,
  buildProposal: (name, args, context) =>
    isSchemaProposalTool(name)
      ? buildSchemaProposal(name, args, context)
      : Promise.resolve({ ok: false, message: 'Unknown tool.' }),
})
