/**
 * The server half of a feature's assistant (`assistant.server.ts`): the tools
 * it offers the model and how it answers them. Read tools answer in the
 * reply; proposal tools build a card and change nothing. Proposal tools are
 * offered only when the workspace lets agents draft.
 */
import type { ProviderToolDef } from '#/lib/ai-providers/types'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'

export type FeatureProposalOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

export interface FeatureAssistantServer {
  readDefs?: () => ProviderToolDef[]
  isReadTool?: (name: string) => boolean
  runReadTool?: (
    name: string,
    args: unknown,
    context: LabToolContext,
  ) => Promise<{ text: string; isError: boolean }>
  proposalDefs?: () => ProviderToolDef[]
  isProposalTool?: (name: string) => boolean
  buildProposal?: (
    name: string,
    args: unknown,
    context: LabToolContext,
  ) => Promise<FeatureProposalOutcome>
}

export function defineAssistantServer(
  server: FeatureAssistantServer,
): FeatureAssistantServer {
  return Object.freeze(server)
}
