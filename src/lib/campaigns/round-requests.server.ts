/**
 * Rounds asked for from the app, the API, the assistant, a pipeline or a finished
 * round (`api.request_campaign_round`). Picks each one up, reads the campaign and
 * every result so far, asks the optimiser for the next batch, lays it out as a
 * plate and writes the answer back for a person to approve. Nothing is made
 * until they do.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import { bestObservation } from './campaign'
import type {
  CampaignRow,
  Factor,
  Objective,
  Observation,
  RoundRationale,
  Trial,
  TrialFactors,
} from './campaign'
import {
  BaybeUnavailableError,
  baybeVersion,
  proposeWithBaybe,
} from './baybe.server'
import { layoutRound } from './layout'
import { proposeBatch } from './optimiser'

export const ROUND_SWEEP_INTERVAL_MS = 5_000
export const BUILTIN_ENGINE_VERSION = '1'

export interface RoundConnection {
  query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

interface ClaimedRound {
  id: string
  workspace_id: string
  campaign_record_id: string
  number: number
  batch_size: number
}

interface Origin {
  round: number
  trial: number
}

export interface Proposer {
  /** The engine's name for the round: 'baybe' or 'builtin'. */
  engine: string
  version: string
  digest: string | null
  trials: TrialFactors[]
  strategy: string
  note: string
}

export interface RoundDeps {
  connect: () => Promise<RoundConnection>
  /** Chosen by the sweep; replaced in tests. */
  propose?: (input: {
    campaign: CampaignRow
    observations: Observation[]
    batchSize: number
    seed: number
  }) => Promise<Proposer>
}

/** Pick the engine the campaign asks for, falling back to the built-in one when "auto". */
export async function proposeForCampaign(input: {
  campaign: CampaignRow
  observations: Observation[]
  batchSize: number
  seed: number
}): Promise<Proposer> {
  const { campaign } = input
  const args = {
    factors: campaign.factors,
    objectives: campaign.objectives,
    observations: input.observations,
    batchSize: input.batchSize,
    seed: input.seed,
  }
  const builtin = (): Proposer => {
    const out = proposeBatch(args)
    return {
      engine: 'builtin',
      version: BUILTIN_ENGINE_VERSION,
      digest: null,
      trials: out.trials,
      strategy: out.strategy,
      note: out.note,
    }
  }
  if (campaign.engine === 'builtin') return builtin()
  if (campaign.engine === 'auto' && (await baybeVersion()) === null)
    return builtin()
  try {
    const out = await proposeWithBaybe(args)
    return {
      engine: 'baybe',
      version: out.version,
      digest: out.runtime,
      trials: out.trials,
      strategy: out.strategy,
      note: `BayBE ${out.version} ${out.strategy === 'recommender' ? `learned from ${input.observations.length} results` : 'made the initial design'}.`,
    }
  } catch (error) {
    if (error instanceof BaybeUnavailableError && campaign.engine === 'auto')
      return builtin()
    if (error instanceof BaybeUnavailableError)
      throw new Error(
        `BayBE is not available in the Python runtime: ${error.message}`,
      )
    throw error
  }
}

/** Every finished trial of every round so far, with where it came from. */
async function loadObservations(
  conn: RoundConnection,
  campaignId: string,
  objectives: readonly Objective[],
): Promise<Array<Observation & Origin>> {
  const { rows } = await conn.query<{ number: number; trials: Trial[] }>(
    `SELECT number, trials FROM api.campaign_rounds
      WHERE campaign_record_id = $1 AND status IN ('approved', 'completed')
      ORDER BY number`,
    [campaignId],
  )
  const out: Array<Observation & Origin> = []
  for (const round of rows)
    for (const trial of round.trials) {
      const results = trial.results
      if (
        results &&
        objectives.every((o) => typeof results[o.key] === 'number')
      )
        out.push({
          factors: trial.factors,
          values: results,
          round: round.number,
          trial: trial.trial,
        })
    }
  return out
}

/** The numbers a fresh Number() would lose: factors come back as the optimiser made them. */
function trialsOf(
  factors: readonly Factor[],
  proposed: TrialFactors[],
): Trial[] {
  return proposed.map((values, i) => {
    const clean: TrialFactors = {}
    for (const f of factors) clean[f.key] = values[f.key]
    return { trial: i + 1, factors: clean, results: null }
  })
}

/** Claim and answer what is waiting. Returns how many were handled. */
export async function sweepCampaignRounds(deps: RoundDeps): Promise<number> {
  const conn = await deps.connect()
  const propose = deps.propose ?? proposeForCampaign
  let handled = 0
  try {
    for (let i = 0; i < 5; i++) {
      const { rows } = await conn.query<ClaimedRound | null>(
        `SELECT id, workspace_id, campaign_record_id, number, batch_size
           FROM internal.claim_campaign_round() WHERE id IS NOT NULL`,
      )
      const round = rows.at(0)
      if (!round) break
      let trials: Trial[] = []
      let rationale: RoundRationale = {}
      let plate: unknown = null
      let engine: Proposer | null = null
      let error: string | null = null
      try {
        const { rows: campaigns } = await conn.query<CampaignRow>(
          `SELECT * FROM api.campaigns WHERE record_id = $1`,
          [round.campaign_record_id],
        )
        const campaign = campaigns[0] as CampaignRow | undefined
        if (!campaign) throw new Error('The campaign is gone.')
        const observations = await loadObservations(
          conn,
          campaign.record_id,
          campaign.objectives,
        )
        engine = await propose({
          campaign,
          observations,
          batchSize: round.batch_size,
          seed: campaign.seed + round.number,
        })
        const made = layoutRound(
          trialsOf(campaign.factors, engine.trials),
          campaign.layout,
          campaign.seed + round.number,
        )
        trials = made.trials
        plate = made.plate
        const best = bestObservation(campaign.objectives, observations)
        rationale = {
          observations: observations.length,
          strategy: engine.strategy,
          note: engine.note,
          best: best
            ? {
                round: best.observation.round,
                trial: best.observation.trial,
                factors: best.observation.factors,
                values: best.observation.values,
              }
            : null,
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
      await conn.query(
        `SELECT internal.fill_campaign_round($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
        [
          round.id,
          engine?.engine ?? null,
          engine?.version ?? null,
          engine?.digest ?? null,
          JSON.stringify(trials),
          JSON.stringify(rationale),
          plate === null ? null : JSON.stringify(plate),
          error,
        ],
      )
      handled++
    }
  } finally {
    await conn.end()
  }
  return handled
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
const startedKey = '__sheetbaseCampaignRoundsStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

/** Starts answering round requests every few seconds. Safe to call twice. */
export function startCampaignRoundScheduler(): void {
  if (typeof window !== 'undefined' || disabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedKey]) return
  g[startedKey] = true
  const open = async () => {
    const client = new PooledClient({ connectionString: env.DATABASE_URL })
    await client.connect()
    return client
  }
  const tick = async () => {
    if (running) return
    running = true
    try {
      await sweepCampaignRounds({ connect: open })
    } catch (error) {
      logger.warn('campaign round sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }
  timer = setInterval(() => void tick(), ROUND_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopCampaignRoundScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedKey]
}
