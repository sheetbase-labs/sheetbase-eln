/**
 * Model features: the optional things a record model can switch on.
 *
 * A model is a kind of record the lab defines. A feature adds a behaviour to it
 * (today: campaigns). Each feature is declared once here: how it is named for a
 * scientist, and what it adds around the app. Switching a feature on for a model
 * is one row in `model_capabilities`; the rest of the app reads this list rather
 * than knowing about any one feature.
 *
 * Adding a feature: add a descriptor below and the code that its contributions
 * name. The tests check that every name a descriptor lists exists, so the list
 * cannot drift from the assistant tools, pipeline actions and events.
 */
import { t } from '#/copy'

import {
  COMPOUND_LOT_TOOL,
  COMPOUND_REGISTER_TOOL,
  LEGAL_HOLD_CREATE_TOOL,
  LEGAL_HOLD_RELEASE_TOOL,
  REGISTRY_ADD_TOOL,
  RETENTION_APPLY_TOOL,
  RETENTION_SET_TOOL,
  SPEC_LIMITS_SET_TOOL,
} from '../assistant-labwork'
import {
  CAMPAIGN_APPROVE_TOOL,
  CAMPAIGN_RESULTS_TOOL,
  CAMPAIGN_ROUND_TOOL,
  CAMPAIGN_START_TOOL,
} from '../assistant-planner'

/** What a feature adds to the app once a model has it. */
export interface FeatureContributions {
  /** A sidebar page (its key in `nav.ts`), shown only while a model has the feature. */
  navPage?: string
  /** Assistant and MCP tools that only make sense while a model has the feature. */
  tools?: readonly string[]
  /** Pipeline actions that belong to the feature. */
  pipelineActions?: readonly string[]
  /** Webhook events the feature emits (its own, beyond `model.feature.*`). */
  events?: readonly string[]
  /** Tables the feature reads and writes, as the API lists them. */
  tables?: readonly string[]
}

export interface ModelFeature {
  /** Stored in `model_capabilities.capability`. Lower case, letters, digits and underscores. */
  key: string
  /** What the lab sees: a short name and one sentence on what it does. */
  label: () => string
  hint: () => string
  /** The heading it sits under in the Features list. */
  group: FeatureGroup
  contributes: FeatureContributions
}

export type FeatureGroup = 'records' | 'quality' | 'planning'

/** The headings of the Features list, in order. */
export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  'records',
  'quality',
  'planning',
]

export const CAMPAIGNS_FEATURE = 'campaigns'
export const REGISTRY_FEATURE = 'registry'
export const INCIDENT_LOG_FEATURE = 'incident_log'
export const RESULT_LIMITS_FEATURE = 'result_limits'
export const LEGAL_HOLD_FEATURE = 'legal_hold'
export const RETENTION_FEATURE = 'retention'

export const MODEL_FEATURES: readonly ModelFeature[] = [
  {
    key: CAMPAIGNS_FEATURE,
    group: 'planning',
    label: () => t('features.campaigns.label'),
    hint: () => t('features.campaigns.hint'),
    contributes: {
      navPage: 'campaigns',
      tools: [
        CAMPAIGN_START_TOOL,
        CAMPAIGN_ROUND_TOOL,
        CAMPAIGN_APPROVE_TOOL,
        CAMPAIGN_RESULTS_TOOL,
      ],
      pipelineActions: ['request_campaign_round'],
      events: [
        'campaign.started',
        'campaign.finished',
        'campaign.round.proposed',
        'campaign.round.approved',
        'campaign.round.rejected',
        'campaign.round.completed',
      ],
      tables: ['campaigns', 'campaign_rounds'],
    },
  },
  {
    key: REGISTRY_FEATURE,
    group: 'records',
    label: () => t('features.registry.label'),
    hint: () => t('features.registry.hint'),
    contributes: {
      navPage: 'registry',
      tools: [REGISTRY_ADD_TOOL, COMPOUND_REGISTER_TOOL, COMPOUND_LOT_TOOL],
      events: [
        'registry.entry.created',
        'compound.registered',
        'compound.structure_changed',
        'compound.lot_added',
      ],
    },
  },
  {
    key: INCIDENT_LOG_FEATURE,
    group: 'quality',
    label: () => t('features.incidentLog.label'),
    hint: () => t('features.incidentLog.hint'),
    contributes: {
      navPage: 'incidents',
      events: ['incident.reported'],
    },
  },
  {
    key: RESULT_LIMITS_FEATURE,
    group: 'quality',
    label: () => t('features.resultLimits.label'),
    hint: () => t('features.resultLimits.hint'),
    contributes: {
      tools: [SPEC_LIMITS_SET_TOOL],
      tables: ['field_spec_limits', 'record_spec_results'],
    },
  },
  {
    key: LEGAL_HOLD_FEATURE,
    group: 'quality',
    label: () => t('features.legalHold.label'),
    hint: () => t('features.legalHold.hint'),
    contributes: {
      tools: [LEGAL_HOLD_CREATE_TOOL, LEGAL_HOLD_RELEASE_TOOL],
      events: ['legal_hold.created', 'legal_hold.released'],
      tables: ['legal_holds', 'legal_hold_records'],
    },
  },
  {
    key: RETENTION_FEATURE,
    group: 'quality',
    label: () => t('features.retention.label'),
    hint: () => t('features.retention.hint'),
    contributes: {
      tools: [RETENTION_SET_TOOL, RETENTION_APPLY_TOOL],
      events: ['retention.applied'],
      tables: ['retention_rules'],
    },
  },
]

export const featureByKey = (key: string): ModelFeature | undefined =>
  MODEL_FEATURES.find((f) => f.key === key)

/** The sidebar pages that only exist while some model has their feature. */
export const FEATURE_NAV_PAGES: ReadonlyMap<string, string> = new Map(
  MODEL_FEATURES.flatMap((f) =>
    f.contributes.navPage ? [[f.contributes.navPage, f.key] as const] : [],
  ),
)
