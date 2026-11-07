/**
 * Campaigns, read and changed through the database (migration planner_and_campaigns).
 * Reads go straight to the tables under row-level security; every change is an
 * RPC so the rules stay in the database.
 */
import type { DataClient } from '#/lib/data-client'
import { CAMPAIGNS_FEATURE } from '#/lib/features/registry'
import { setModelFeature } from '#/lib/features/data'
import { createStarterModel } from '#/lib/result-quality'
import type { StarterModel } from '#/lib/result-quality'

import type {
  CampaignEngine,
  CampaignLayout,
  CampaignRoundRow,
  CampaignRow,
  Factor,
  Objective,
} from './campaign'

export const campaignKeys = {
  all: ['campaigns'] as const,
  models: ['campaigns', 'models'] as const,
  list: (modelKeys: readonly string[]) =>
    ['campaigns', 'list', ...modelKeys] as const,
  one: (id: string) => ['campaigns', 'one', id] as const,
  rounds: (id: string) => ['campaigns', 'rounds', id] as const,
}

export interface CampaignModel {
  key: string
  name: string
}

export interface CampaignRecord {
  id: string
  identifier: string
  title: string
  kind: string
  project_id: string | null
  updated_at: string
  archived_at: string | null
}

export type CampaignListItem = CampaignRecord & {
  campaign: CampaignRow | null
}

/** The record models that have the Campaigns feature. */
export async function fetchCampaignModels(
  client: DataClient,
): Promise<CampaignModel[]> {
  const ticked = await client.list<{ model_key: string }>(
    'model_capabilities',
    `?select=model_key&capability=eq.${CAMPAIGNS_FEATURE}&order=model_key.asc`,
  )
  if (ticked.length === 0) return []
  const list = ticked.map((m) => encodeURIComponent(m.model_key)).join(',')
  const models = await client.list<{ key: string; name: string }>(
    'record_models',
    `?select=key,name&key=in.(${list})`,
  )
  const byKey = new Map(models.map((m) => [m.key, m.name]))
  return ticked.map((m) => ({
    key: m.model_key,
    name: byKey.get(m.model_key) ?? m.model_key,
  }))
}

/** Every campaign record of the models with the feature, with its settings once it has some. */
export async function fetchCampaignList(
  client: DataClient,
  modelKeys: readonly string[],
): Promise<CampaignListItem[]> {
  if (modelKeys.length === 0) return []
  const list = modelKeys.map((key) => encodeURIComponent(key)).join(',')
  const [records, campaigns] = await Promise.all([
    client.list<CampaignRecord>(
      'records',
      `?kind=in.(${list})&deleted_at=is.null&order=updated_at.desc&limit=500&select=id,identifier,title,kind,project_id,updated_at,archived_at`,
    ),
    client.list<CampaignRow>('campaigns', '?select=*&limit=1000'),
  ])
  const byRecord = new Map(campaigns.map((c) => [c.record_id, c]))
  return records.map((r) => ({ ...r, campaign: byRecord.get(r.id) ?? null }))
}

export async function fetchCampaign(
  client: DataClient,
  recordId: string,
): Promise<{ record: CampaignRecord; campaign: CampaignRow | null } | null> {
  const [records, campaigns] = await Promise.all([
    client.list<CampaignRecord>(
      'records',
      `?id=eq.${encodeURIComponent(recordId)}&select=id,identifier,title,kind,project_id,updated_at,archived_at&limit=1`,
    ),
    client.list<CampaignRow>(
      'campaigns',
      `?select=*&record_id=eq.${encodeURIComponent(recordId)}&limit=1`,
    ),
  ])
  return records[0]
    ? { record: records[0], campaign: campaigns[0] ?? null }
    : null
}

export function fetchRounds(
  client: DataClient,
  recordId: string,
): Promise<CampaignRoundRow[]> {
  return client.list<CampaignRoundRow>(
    'campaign_rounds',
    `?select=*&campaign_record_id=eq.${encodeURIComponent(recordId)}&order=number.desc&limit=100`,
  )
}

export interface CampaignSettings {
  factors: Factor[]
  objectives: Objective[]
  batchSize: number
  maxRounds: number
  maxRuns: number | null
  engine: CampaignEngine
  layout: CampaignLayout
  templateRecordId: string | null
  autoPropose: boolean
  seed: number
}

export function configureCampaign(
  client: DataClient,
  recordId: string,
  settings: CampaignSettings,
): Promise<CampaignRow> {
  return client.rpc<CampaignRow>('configure_campaign', {
    p_record_id: recordId,
    p_factors: settings.factors,
    p_objectives: settings.objectives,
    p_batch_size: settings.batchSize,
    p_max_rounds: settings.maxRounds,
    p_max_runs: settings.maxRuns,
    p_engine: settings.engine,
    p_layout: settings.layout,
    p_template_record_id: settings.templateRecordId,
    p_auto_propose: settings.autoPropose,
    p_seed: settings.seed,
  })
}

export const startCampaign = (client: DataClient, recordId: string) =>
  client.rpc<CampaignRow>('start_campaign', { p_record_id: recordId })

export const setCampaignStatus = (
  client: DataClient,
  recordId: string,
  status: 'paused' | 'finished',
) =>
  client.rpc<CampaignRow>('set_campaign_status', {
    p_record_id: recordId,
    p_status: status,
  })

export const requestRound = (client: DataClient, recordId: string) =>
  client.rpc<CampaignRoundRow>('request_campaign_round', {
    p_record_id: recordId,
  })

export const approveRound = (client: DataClient, roundId: string) =>
  client.rpc<CampaignRoundRow>('approve_campaign_round', {
    p_round_id: roundId,
  })

export const rejectRound = (
  client: DataClient,
  roundId: string,
  reason?: string,
) =>
  client.rpc<CampaignRoundRow>('reject_campaign_round', {
    p_round_id: roundId,
    ...(reason ? { p_reason: reason } : {}),
  })

export const recordResults = (
  client: DataClient,
  roundId: string,
  results: Array<{ trial: number; results: Record<string, number> }>,
) =>
  client.rpc<CampaignRoundRow>('record_campaign_results', {
    p_round_id: roundId,
    p_results: results,
  })

export const pullPlateResults = (
  client: DataClient,
  roundId: string,
  objectiveKey: string,
) =>
  client.rpc<CampaignRoundRow>('pull_campaign_round_results', {
    p_round_id: roundId,
    p_objective_key: objectiveKey,
  })

/** The ready-made campaign model. It is an ordinary model once set up. */
export const STARTER_CAMPAIGN_MODEL: StarterModel = {
  key: 'campaign',
  name: 'Campaign',
  prefix: 'CMP',
  description: 'An optimisation campaign: what to vary and what to improve.',
  fields: [
    {
      field_name: 'goal',
      label: 'Goal',
      logical_type: 'text',
      show_in_list: true,
    },
  ],
}

export async function setUpCampaignModel(
  client: DataClient,
  starter: StarterModel = STARTER_CAMPAIGN_MODEL,
): Promise<void> {
  await createStarterModel(client, starter, { incidentLog: false })
  await setModelFeature(client, starter.key, CAMPAIGNS_FEATURE, true)
}
