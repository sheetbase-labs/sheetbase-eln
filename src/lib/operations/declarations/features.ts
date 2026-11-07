/**
 * Operations for model features and optimisation campaigns.
 */
import { t } from '#/copy'

import {
  CAMPAIGN_APPROVE_TOOL,
  CAMPAIGN_RESULTS_TOOL,
  CAMPAIGN_ROUND_TOOL,
  CAMPAIGN_START_TOOL,
  MODEL_FEATURE_TOOL,
} from '../../assistant-planner'
import { defineOperations, input } from '../descriptor'

export const FEATURE_OPERATIONS = defineOperations([
  {
    name: 'set_model_capability',
    label: 'Switch a feature on or off for a record model',
    summary: 'Switch a feature on or off for a record model',
    description:
      'Turns a feature of a record model on or off; `p_capability` is the feature key, such as `campaigns`, whose records can then be set up as campaigns. `p_settings` replaces the feature’s settings when given. Needs permission to edit models. Returns whether the feature is now on.',
    kind: 'write',
    inputs: [
      input('p_model_key', 'text'),
      input('p_capability', 'text'),
      input('p_enabled', 'bool'),
      input('p_settings', 'json', false),
    ],
    result: 'bool',
    assistant: { tool: MODEL_FEATURE_TOOL },
    events: [
      {
        name: 'model.feature.enabled',
        family: 'administration',
        summary:
          'A feature, such as Campaigns, was switched on for a record model.',
        producer: {
          entityType: 'model_capability',
          operation: 'update',
          when: { key: 'change', equals: 'enabled' },
        },
        notes: 'Payload carries modelKey and feature.',
      },
      {
        name: 'model.feature.disabled',
        family: 'administration',
        summary: 'A feature was switched off for a record model.',
        producer: {
          entityType: 'model_capability',
          operation: 'update',
          when: { key: 'change', equals: 'disabled' },
        },
        notes: 'Payload carries modelKey and feature.',
      },
    ],
  },
  {
    name: 'configure_campaign',
    label: 'Set up or change a campaign’s design, budget and plate',
    summary: 'Set up or change a campaign’s design, budget and plate',
    description:
      'Saves the factors, objectives, budget and plate layout for a record of a campaign model. The factors and objectives are fixed once a round has been asked for; the budget, layout and the rest can still change. Returns the campaign.',
    kind: 'write',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_factors', 'json'),
      input('p_objectives', 'json'),
      input('p_batch_size', 'int', false),
      input('p_max_rounds', 'int', false),
      input('p_max_runs', 'int', false),
      input('p_engine', 'text', false),
      input('p_layout', 'json', false),
      input('p_template_record_id', 'uuid', false),
      input('p_auto_propose', 'bool', false),
      input('p_seed', 'int', false),
    ],
    result: 'row:campaigns',
  },
  {
    name: 'start_campaign',
    label: 'Start or resume a campaign',
    summary: 'Start or resume a campaign',
    description:
      'Makes the campaign active and asks for its first round, or for the next one when it is resumed. The optimiser works the round out in the background; a person approves it. Returns the campaign.',
    kind: 'write',
    inputs: [input('p_record_id', 'uuid')],
    result: 'row:campaigns',
    assistant: { tool: CAMPAIGN_START_TOOL },
    events: [
      {
        name: 'campaign.started',
        family: 'record',
        summary:
          'An optimisation campaign was started and its first round asked for.',
        producer: {
          entityType: 'campaign',
          operation: 'create',
        },
        notes: 'Payload carries campaignId, status and rounds.',
      },
    ],
  },
  {
    name: 'set_campaign_status',
    label: 'Pause or finish a campaign',
    summary: 'Pause or finish a campaign',
    description:
      '`p_status` is `paused` or `finished`. Finishing sets aside a round that is waiting for a person; results already in are kept. Returns the campaign.',
    kind: 'write',
    inputs: [input('p_record_id', 'uuid'), input('p_status', 'text')],
    result: 'row:campaigns',
    events: [
      {
        name: 'campaign.finished',
        family: 'record',
        summary:
          'An optimisation campaign finished: it spent its rounds or runs, or a person finished it.',
        producer: {
          entityType: 'campaign',
          operation: 'update',
          when: { key: 'change', equals: 'finished' },
        },
        notes: 'Payload carries campaignId, status and rounds.',
      },
    ],
  },
  {
    name: 'request_campaign_round',
    label: 'Ask for the next round',
    summary: 'Ask for the next round',
    description:
      'Queues the next round when none is waiting and budget is left. The optimiser works it out in the background and the round waits for a person to approve it. Returns the round.',
    kind: 'write',
    inputs: [input('p_record_id', 'uuid')],
    result: 'row:campaign_rounds',
    assistant: { tool: CAMPAIGN_ROUND_TOOL },
    pipeline: {
      label: t('data.pipelineActions.proposeNextRound'),
      description: t('data.pipelineActions.proposeNextRoundDescription'),
    },
    events: [
      {
        name: 'campaign.round.proposed',
        family: 'record',
        summary:
          'The optimiser proposed a round of conditions for a campaign. Nothing is made until a person approves it.',
        producer: {
          entityType: 'campaign_round',
          operation: 'create',
        },
        notes:
          'Payload carries roundId, campaignId, number, status, trials, engine, experimentId, plateRunId and best (the best result so far).',
      },
    ],
  },
  {
    name: 'approve_campaign_round',
    label: 'Approve a proposed round',
    summary: 'Approve a proposed round',
    description:
      'Makes the round’s experiment (joined to the campaign’s series), its plate and, when the campaign has a liquid handler, its worklist. Only a person decides this. Returns the round.',
    kind: 'write',
    inputs: [input('p_round_id', 'uuid')],
    result: 'row:campaign_rounds',
    assistant: { tool: CAMPAIGN_APPROVE_TOOL },
    events: [
      {
        name: 'campaign.round.approved',
        family: 'record',
        summary:
          'A campaign round was approved: its experiment, plate run and worklist were made.',
        producer: {
          entityType: 'campaign_round',
          operation: 'update',
          when: { key: 'change', equals: 'approved' },
        },
        notes:
          'Payload carries roundId, campaignId, number, status, trials, engine, experimentId, plateRunId and best (the best result so far).',
      },
    ],
  },
  {
    name: 'reject_campaign_round',
    label: 'Reject a proposed round',
    summary: 'Reject a proposed round',
    description:
      'Sets the round’s conditions aside so the optimiser can propose another. A rejected round does not use up the budget. Returns the round.',
    kind: 'write',
    inputs: [input('p_round_id', 'uuid'), input('p_reason', 'text', false)],
    result: 'row:campaign_rounds',
    events: [
      {
        name: 'campaign.round.rejected',
        family: 'record',
        summary: 'A campaign round was rejected and its conditions set aside.',
        producer: {
          entityType: 'campaign_round',
          operation: 'update',
          when: { key: 'change', equals: 'rejected' },
        },
        notes:
          'Payload carries roundId, campaignId, number, status, trials, engine, experimentId, plateRunId and best (the best result so far).',
      },
    ],
  },
  {
    name: 'record_campaign_results',
    label: 'Enter the results of a round',
    summary: 'Enter the results of a round',
    description:
      'Takes each condition’s result for each objective. The round is complete when every condition has every result, and the next round is asked for when the campaign does that automatically. Returns the round.',
    kind: 'write',
    inputs: [input('p_round_id', 'uuid'), input('p_results', 'json')],
    result: 'row:campaign_rounds',
    assistant: { tool: CAMPAIGN_RESULTS_TOOL },
    events: [
      {
        name: 'campaign.round.completed',
        family: 'record',
        summary:
          'Every result of a campaign round is in, and the next round was asked for or the campaign finished.',
        producer: {
          entityType: 'campaign_round',
          operation: 'update',
          when: { key: 'change', equals: 'completed' },
        },
        notes:
          'Payload carries roundId, campaignId, number, status, trials, engine, experimentId, plateRunId and best (the best result so far).',
      },
    ],
  },
  {
    name: 'pull_campaign_round_results',
    label: 'Read an objective from the round’s plate',
    summary: 'Read an objective from the round’s plate',
    description:
      'Fills one objective for each condition from the readings on the round’s plate: the mean of the condition’s wells. Returns the round.',
    kind: 'write',
    inputs: [input('p_round_id', 'uuid'), input('p_objective_key', 'text')],
    result: 'row:campaign_rounds',
  },
])
