/**
 * Webhook events for agents: switched on and off, operation policies made and
 * turned off, signed policy changes, proposals and workflows.
 */
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

import { WEBHOOK_SSE_PIPELINE } from '../define'

const event = (
  entry: Pick<EventCatalogueEntry, 'name' | 'summary' | 'producer' | 'notes'>,
): EventCatalogueEntry => ({
  family: 'administration',
  wireName: entry.name,
  status: 'stable',
  introducedIn: 'agents-01',
  consumers: WEBHOOK_SSE_PIPELINE,
  ...entry,
})

export const AGENT_POLICY_EVENTS: readonly EventCatalogueEntry[] =
  Object.freeze([
    event({
      name: 'agent.enabled',
      summary: 'An agent on the Agents page was switched on.',
      producer: {
        entityType: 'agent_definition',
        operation: 'update',
        when: { key: 'event', equals: 'enabled' },
      },
      notes: 'Payload carries `agentId`, `displayId`, `name` and `enabled`.',
    }),
    event({
      name: 'agent.disabled',
      summary: 'An agent on the Agents page was switched off.',
      producer: {
        entityType: 'agent_definition',
        operation: 'update',
        when: { key: 'event', equals: 'disabled' },
      },
      notes: 'Payload carries `agentId`, `displayId`, `name` and `enabled`.',
    }),
    event({
      name: 'agent.operation_policy.disabled',
      summary:
        'A policy that let a service credential run a kind of draft on its own was turned off.',
      producer: {
        entityType: 'agent_operation_policy',
        operation: 'update',
        when: { key: 'event', equals: 'disabled' },
      },
      notes: 'Payload carries `name`, `operationKind` and `enabled`.',
    }),
    event({
      name: 'agent.operation_policy.created',
      summary:
        'A signed policy now lets one service credential run one kind of draft on its own, within limits.',
      producer: { entityType: 'agent_operation_policy', operation: 'create' },
      notes: 'Payload carries `name`, `credentialId` and `operationKind`.',
    }),
    event({
      name: 'agent.signed_policy.changed',
      summary:
        'The policy of an agent on the Agents page was changed, with a reason and a signature.',
      producer: {
        entityType: 'agent_operation_policy',
        operation: 'update',
        when: { key: 'effect', equals: 'agent_policy_changed' },
      },
      notes:
        'Payload carries `displayId`, `revision`, the new `policy` and the `reason`.',
    }),
    event({
      name: 'agent.proposal.created',
      summary: 'An agent proposed a change for a person to approve.',
      producer: { entityType: 'agent_operation_proposal', operation: 'create' },
      notes: 'Payload carries `status` and `operationKind`.',
    }),
    event({
      name: 'agent.proposal.updated',
      summary:
        'An agent’s proposal moved on: approved, rejected, signed, run or failed.',
      producer: { entityType: 'agent_operation_proposal', operation: 'update' },
      notes: 'Payload carries the new `status` and `operationKind`.',
    }),
    event({
      name: 'agent.workflow.created',
      summary: 'An agent started a workflow of several steps.',
      producer: { entityType: 'agent_workflow', operation: 'create' },
      notes:
        'Payload carries `workflowId`, `goal`, `status`, `currentStep` and `revision`.',
    }),
    event({
      name: 'agent.workflow.updated',
      summary:
        'An agent workflow moved on: waiting for approval, paused, finished, cancelled or out of budget.',
      producer: { entityType: 'agent_workflow', operation: 'update' },
      notes:
        'Payload carries `workflowId`, `status`, `previousStatus`, `currentStep` and `revision`.',
    }),
  ])

/** Each event in a scientist’s words, for pickers. */
export const AGENT_POLICY_EVENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    'agent.enabled': 'An agent is switched on',
    'agent.disabled': 'An agent is switched off',
    'agent.operation_policy.created': 'An agent may run a kind of draft itself',
    'agent.operation_policy.disabled':
      'An agent may no longer run a kind of draft itself',
    'agent.signed_policy.changed': 'An agent’s signed policy changes',
    'agent.proposal.created': 'An agent proposes a change',
    'agent.proposal.updated': 'An agent’s proposal moves on',
    'agent.workflow.created': 'An agent starts a workflow',
    'agent.workflow.updated': 'An agent workflow moves on',
  })
