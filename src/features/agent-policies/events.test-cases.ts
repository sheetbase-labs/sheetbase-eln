/**
 * How each agent event looks on the change feed, for the catalogue tests.
 */
export const AGENT_POLICY_EVENT_CASES = [
  {
    name: 'agent.enabled',
    entityType: 'agent_definition',
    operation: 'update',
    payload: { event: 'enabled' },
  },
  {
    name: 'agent.disabled',
    entityType: 'agent_definition',
    operation: 'update',
    payload: { event: 'disabled' },
  },
  {
    name: 'agent.operation_policy.disabled',
    entityType: 'agent_operation_policy',
    operation: 'update',
    payload: { event: 'disabled' },
  },
  {
    name: 'agent.operation_policy.created',
    entityType: 'agent_operation_policy',
    operation: 'create',
    payload: {},
  },
  {
    name: 'agent.signed_policy.changed',
    entityType: 'agent_operation_policy',
    operation: 'update',
    payload: { effect: 'agent_policy_changed' },
  },
  {
    name: 'agent.proposal.created',
    entityType: 'agent_operation_proposal',
    operation: 'create',
    payload: {},
  },
  {
    name: 'agent.proposal.updated',
    entityType: 'agent_operation_proposal',
    operation: 'update',
    payload: { status: 'approved' },
  },
  {
    name: 'agent.workflow.created',
    entityType: 'agent_workflow',
    operation: 'create',
    payload: {},
  },
  {
    name: 'agent.workflow.updated',
    entityType: 'agent_workflow',
    operation: 'update',
    payload: { status: 'paused' },
  },
]
