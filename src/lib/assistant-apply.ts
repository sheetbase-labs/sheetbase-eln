import { z } from 'zod'

import { t } from '#/copy'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  decideAgentOperation,
  executeAgentOperation,
  proposeAgentOperation,
} from '#/lib/agent-operations'
import type {
  AgentOperation,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { runAssistantAction } from '#/lib/assistant-booking'
import { describeActionError, plainDatabaseError } from '#/lib/assistant-bench'
import { describeCalendarError } from '#/lib/calendar'
import { withCurrentStructureVersion } from '#/lib/assistant-fresh-operation'
import {
  recordCardOutcome,
  recordIdFromHref,
} from '#/lib/assistant-card-outcomes'
import type { CardOutcome } from '#/lib/assistant-card-outcomes'

/**
 * What pressing a card's button does. The chat card and the end-to-end tests
 * run this same code, so a test that applies a card applies it exactly as a
 * person would: the ordinary propose, approve and execute steps, or the same RPC
 * the page itself would run, as the signed-in person.
 */

/** The pipeline a followed-up proposal created: its id and revision. */
const createdPipeline = z.object({
  id: z.string().optional(),
  revision: z.union([z.number(), z.string()]).optional(),
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed apply is a caught throw, untyped by definition; only an Error's message is read.
export function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''

  return /stale|revision|version|conflict/i.test(message)
    ? t('notebook.assistantPanel.proposal.stale')
    : t('notebook.assistantPanel.proposal.failed', {
        reason: message
          ? plainDatabaseError(message)
          : t('common.errors.generic'),
      })
}

/** What pressing the card's button did, and anything it made along the way. */
export type ApplyOutcome =
  | { kind: 'signature'; opened?: string }
  | { kind: 'failed'; reason: string; opened?: string }
  | { kind: 'applied'; opened?: string; note?: string }

/** Runs one agent operation through propose, approve and execute; null means it waits on a signature. */
async function runOperation(
  client: DataClient,
  proposal: AssistantProposal,
  operation: AgentOperation,
  key: string,
  invocationId: string,
  workspaceId: string,
): Promise<AgentOperationProposal | null> {
  let row = await proposeAgentOperation(client, {
    workspaceId,
    title: proposal.title,
    summary: proposal.summary,
    operation: await withCurrentStructureVersion(client, operation),
    provenance: {
      agentId: 'assistant',
      agentName: 'Assistant',
      tool: { name: proposal.tool },
      model: { provider: 'sheetbase', name: 'assistant' },
      invocationId,
    },
    idempotencyKey: key,
  })

  if (row.status === 'pending') {
    if (row.signature_required) return null
    row = await decideAgentOperation(client, {
      proposalId: row.id,
      expectedRevision: Number(row.revision),
      decision: 'approve',
    })
  }

  if (row.status === 'approved') {
    row = await executeAgentOperation(client, {
      proposalId: row.id,
      expectedRevision: Number(row.revision),
    })
  }

  return row
}

/** The everyday action path: the same RPC the page itself would run. */
export async function applyAction(
  client: DataClient,
  proposal: AssistantProposal,
): Promise<ApplyOutcome> {
  const action = proposal.action

  if (!action) return { kind: 'failed', reason: failureReason(null) }

  try {
    const result = await runAssistantAction(client, action)

    return {
      kind: 'applied',
      opened: result?.openHref,
      note: result?.note,
    }
  } catch (error) {
    return {
      kind: 'failed',
      reason: t('notebook.assistantPanel.proposal.failed', {
        reason:
          error instanceof DataClientError
            ? plainDatabaseError(describeCalendarError(error))
            : describeActionError(error),
      }),
    }
  }
}

/** The proposal path: propose, approve and execute, then any follow-up. */
export async function applyProposal(
  client: DataClient,
  proposal: AssistantProposal,
  requestId: string,
  workspaceId: string,
): Promise<ApplyOutcome> {
  const operation = proposal.operation

  if (!operation) return { kind: 'failed', reason: failureReason(null) }

  try {
    const first = await runOperation(
      client,
      proposal,
      operation,
      `assistant-${requestId}`,
      requestId,
      workspaceId,
    )

    if (first === null) return { kind: 'signature' }

    if (first.status === 'failed') {
      return {
        kind: 'failed',
        reason: failureReason(new Error(first.error_message ?? '')),
      }
    }

    if (!proposal.followUp) return { kind: 'applied' }

    // The first change made something (a new pipeline); the second fills it
    // in, pinned to the revision the first one returned.
    const made = createdPipeline.safeParse(first.result)

    if (!made.success || !made.data.id)
      throw new Error(t('common.errors.generic'))
    const opened = `/pipelines/${made.data.id}/steps`

    const second = await runOperation(
      client,
      proposal,
      {
        kind: proposal.followUp.kind,
        workspaceId: proposal.followUp.workspaceId,
        definitionId: made.data.id,
        expectedDefinitionRevision: Number(made.data.revision),
        configuration: proposal.followUp.configuration,
      },
      `assistant-${requestId}-draft`,
      requestId,
      workspaceId,
    )

    if (second === null) return { kind: 'signature', opened }

    if (second.status === 'failed') {
      return {
        kind: 'failed',
        reason: failureReason(new Error(second.error_message ?? '')),
        opened,
      }
    }

    return { kind: 'applied', opened }
  } catch (error) {
    return { kind: 'failed', reason: failureReason(error) }
  }
}

/**
 * Tells the assistant what became of a card: at once, then again with the ID
 * of the record an applied card led to, once that record has been read.
 */
export async function rememberOutcome(
  client: DataClient,
  callId: string,
  base: CardOutcome,
): Promise<void> {
  recordCardOutcome(callId, base)
  const id = base.status === 'applied' ? recordIdFromHref(base.opened) : null

  if (!id) return

  try {
    const rows = await client.list<{
      identifier: string
      title: string
    }>('records', `?id=eq.${id}&select=identifier,title&limit=1`)

    const row = rows.at(0)

    if (row) recordCardOutcome(callId, { ...base, made: row })
  } catch {
    // The outcome stays as recorded, without the ID.
  }
}
