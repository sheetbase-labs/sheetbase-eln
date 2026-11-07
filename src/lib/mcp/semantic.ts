import { z } from 'zod'

import {
  LITERATURE_SEARCH_DESCRIPTION,
  LITERATURE_SEARCH_TOOL,
  SEMANTIC_SEARCH_DESCRIPTION,
  SEMANTIC_SEARCH_TOOL,
  literatureSearchSchema,
  semanticSearchSchema,
} from '../semantic-tools.server'

export {
  LITERATURE_SEARCH_TOOL,
  SEMANTIC_SEARCH_TOOL,
  runLiteratureSearch,
  runSemanticSearch,
} from '../semantic-tools.server'

/** The two read tools: search by meaning, and published papers when allowed. */
export function semanticMcpTools() {
  return [
    {
      name: SEMANTIC_SEARCH_TOOL,
      description: SEMANTIC_SEARCH_DESCRIPTION,
      inputSchema: z.toJSONSchema(semanticSearchSchema, { io: 'input' }),
      annotations: {
        title: 'Search the lab by meaning',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: LITERATURE_SEARCH_TOOL,
      description: LITERATURE_SEARCH_DESCRIPTION,
      inputSchema: z.toJSONSchema(literatureSearchSchema, { io: 'input' }),
      annotations: {
        title: 'Search published papers',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ]
}
