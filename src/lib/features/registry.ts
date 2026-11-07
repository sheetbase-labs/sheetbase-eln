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
  contributes: FeatureContributions
}

export const CAMPAIGNS_FEATURE = 'campaigns'

export const MODEL_FEATURES: readonly ModelFeature[] = [
  {
    key: CAMPAIGNS_FEATURE,
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
]

export const featureByKey = (key: string): ModelFeature | undefined =>
  MODEL_FEATURES.find((f) => f.key === key)

/** The sidebar pages that only exist while some model has their feature. */
export const FEATURE_NAV_PAGES: ReadonlyMap<string, string> = new Map(
  MODEL_FEATURES.flatMap((f) =>
    f.contributes.navPage ? [[f.contributes.navPage, f.key] as const] : [],
  ),
)
