/**
 * Optimisation campaigns: the shapes shared by the app, the server and the
 * optimisers. A campaign says which factors may vary and over what range, what
 * to maximise, minimise or hit, and how many rounds and runs it may spend. Each
 * round an optimiser proposes a batch of conditions (trials); results come back
 * and the next round learns from them.
 */
import { z } from 'zod'

export const FACTOR_KINDS = ['continuous', 'discrete', 'categorical'] as const
export type FactorKind = (typeof FACTOR_KINDS)[number]

export const OBJECTIVE_DIRECTIONS = ['maximise', 'minimise', 'target'] as const
export type ObjectiveDirection = (typeof OBJECTIVE_DIRECTIONS)[number]

export const CAMPAIGN_ENGINES = ['auto', 'baybe', 'builtin'] as const
export type CampaignEngine = (typeof CAMPAIGN_ENGINES)[number]

export const CAMPAIGN_STATUSES = [
  'draft',
  'active',
  'paused',
  'finished',
] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const ROUND_STATUSES = [
  'requested',
  'proposing',
  'proposed',
  'approved',
  'completed',
  'rejected',
  'failed',
] as const
export type RoundStatus = (typeof ROUND_STATUSES)[number]

const KEY = /^[a-z][a-z0-9_]{0,39}$/

export const factorSchema = z
  .object({
    key: z.string().regex(KEY),
    label: z.string().min(1).max(80),
    kind: z.enum(FACTOR_KINDS),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    values: z.array(z.union([z.number().finite(), z.string()])).optional(),
    unit: z.string().max(20).optional(),
  })
  .strict()
  .superRefine((factor, ctx) => {
    if (factor.kind === 'continuous') {
      if (
        factor.min === undefined ||
        factor.max === undefined ||
        factor.min >= factor.max
      )
        ctx.addIssue({
          code: 'custom',
          message: 'A continuous factor needs a minimum below its maximum.',
        })
    } else {
      const values = factor.values ?? []
      if (values.length < 2 || values.length > 50)
        ctx.addIssue({
          code: 'custom',
          message: 'Give between 2 and 50 values.',
        })
      const wanted = factor.kind === 'discrete' ? 'number' : 'string'
      if (values.some((v) => typeof v !== wanted))
        ctx.addIssue({
          code: 'custom',
          message:
            factor.kind === 'discrete'
              ? 'Discrete values are numbers.'
              : 'Categorical values are words.',
        })
    }
  })

export type Factor = z.infer<typeof factorSchema>

export const objectiveSchema = z
  .object({
    key: z.string().regex(KEY),
    label: z.string().min(1).max(80),
    direction: z.enum(OBJECTIVE_DIRECTIONS),
    target: z.number().finite().optional(),
    weight: z.number().positive().finite().optional(),
    unit: z.string().max(20).optional(),
  })
  .strict()
  .superRefine((objective, ctx) => {
    if (objective.direction === 'target' && objective.target === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'An objective with a target needs the value to hit.',
      })
  })

export type Objective = z.infer<typeof objectiveSchema>

export const designSchema = z
  .object({
    factors: z.array(factorSchema).min(1).max(24),
    objectives: z.array(objectiveSchema).min(1).max(4),
  })
  .strict()
  .superRefine((design, ctx) => {
    const seen = new Set<string>()
    for (const key of [...design.factors, ...design.objectives].map(
      (item) => item.key,
    )) {
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', message: `"${key}" is used twice.` })
      seen.add(key)
    }
  })

/** A factor setting: a number for continuous and discrete factors, a word for categorical ones. */
export type FactorValue = number | string
export type TrialFactors = Record<string, FactorValue>

export interface Trial {
  trial: number
  factors: TrialFactors
  wells?: string[]
  results?: Record<string, number> | null
}

export interface Observation {
  factors: TrialFactors
  values: Record<string, number>
}

export interface CampaignLayout {
  plateFormat?: string | null
  replicates?: number
  blanks?: number
  positives?: number
  negatives?: number
  volumeUl?: number
  worklistFormat?: string | null
  sourcePlate?: string | null
}

export interface CampaignRow {
  record_id: string
  workspace_id: string
  factors: Factor[]
  objectives: Objective[]
  batch_size: number
  max_rounds: number
  max_runs: number | null
  engine: CampaignEngine
  layout: CampaignLayout
  template_record_id: string | null
  auto_propose: boolean
  seed: number
  status: CampaignStatus
  series_record_id: string | null
  created_at: string
  updated_at: string
}

export interface RoundRationale {
  observations?: number
  strategy?: string
  note?: string
  best?: {
    round: number
    trial: number
    factors: TrialFactors
    values: Record<string, number>
  } | null
  [key: string]: unknown
}

export interface CampaignRoundRow {
  id: string
  workspace_id: string
  campaign_record_id: string
  number: number
  status: RoundStatus
  batch_size: number
  engine: string | null
  engine_version: string | null
  image_digest: string | null
  trials: Trial[]
  rationale: RoundRationale
  plate: {
    format?: string
    wells?: unknown[]
    transfers?: unknown[]
  } | null
  experiment_record_id: string | null
  plate_run_id: string | null
  worklist_id: string | null
  error_message: string | null
  requested_by_user_id: string
  decided_by_user_id: string | null
  decided_at: string | null
  created_at: string
  proposed_at: string | null
  completed_at: string | null
}

/** A round in the words a scientist uses. */
export function roundReference(campaignIdentifier: string, number: number) {
  return `${campaignIdentifier} round ${number}`
}

/**
 * One score per observation, higher is better, so a batch of results can be
 * compared across objectives: each objective is turned into "higher is better"
 * (minimise flips the sign, a target becomes the distance from it), put on a
 * common scale and added up by weight. The optimisers learn this score.
 */
export function scoreObservations(
  objectives: readonly Objective[],
  observations: readonly Observation[],
): number[] {
  if (observations.length === 0) return []
  const totalWeight = objectives.reduce((sum, o) => sum + (o.weight ?? 1), 0)
  const scores = new Array<number>(observations.length).fill(0)
  for (const objective of objectives) {
    const raw = observations.map((o) => {
      const value = o.values[objective.key] ?? 0
      if (objective.direction === 'minimise') return -value
      if (objective.direction === 'target')
        return -Math.abs(value - (objective.target ?? 0))
      return value
    })
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length
    const spread = Math.sqrt(
      raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length,
    )
    const weight = objective.weight ?? 1
    raw.forEach((x, i) => {
      scores[i] += (weight * (spread > 0 ? (x - mean) / spread : 0)) / totalWeight
    })
  }
  return scores
}

/** The best observation so far by score, with where it came from. */
export function bestObservation<T extends Observation>(
  objectives: readonly Objective[],
  observations: readonly T[],
): { index: number; observation: T } | null {
  const scores = scoreObservations(objectives, observations)
  let index = -1
  scores.forEach((score, i) => {
    if (index < 0 || score > scores[index]) index = i
  })
  return index < 0 ? null : { index, observation: observations[index] }
}

/** Rounds and runs a campaign can still spend (null runs means no run limit). */
export function campaignBudget(
  campaign: Pick<CampaignRow, 'max_rounds' | 'max_runs'>,
  rounds: ReadonlyArray<Pick<CampaignRoundRow, 'status' | 'trials'>>,
) {
  const used = rounds.filter(
    (r) => r.status !== 'rejected' && r.status !== 'failed',
  )
  const runsUsed = rounds
    .filter(
      (r) =>
        r.status === 'proposed' ||
        r.status === 'approved' ||
        r.status === 'completed',
    )
    .reduce((sum, r) => sum + r.trials.length, 0)
  return {
    roundsUsed: used.length,
    roundsLeft: Math.max(campaign.max_rounds - used.length, 0),
    runsUsed,
    runsLeft:
      campaign.max_runs === null
        ? null
        : Math.max(campaign.max_runs - runsUsed, 0),
  }
}
