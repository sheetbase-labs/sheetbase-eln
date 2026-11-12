/** Each parameter set event, and the change event it is delivered from. */
export const PARAMETER_SET_EVENT_CASES = [
  {
    name: 'pipeline.parameter_set.created',
    entityType: 'pipeline_parameter_set',
    operation: 'create',
    payload: {},
  },
  {
    name: 'pipeline.parameter_set.updated',
    entityType: 'pipeline_parameter_set',
    operation: 'update',
    payload: {},
  },
  {
    name: 'pipeline.parameter_set.deleted',
    entityType: 'pipeline_parameter_set',
    operation: 'delete',
    payload: {},
  },
] as const
