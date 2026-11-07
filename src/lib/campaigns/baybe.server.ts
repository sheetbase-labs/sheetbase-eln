/**
 * Proposes a campaign's next batch with BayBE, in the isolated Python runtime.
 * The runtime needs the `baybe` package (an image built with WITH_BAYBE=true) and
 * more memory than the default (PIPELINE_PYTHON_MEMORY); without them the
 * campaign's "automatic" engine uses the built-in optimiser instead.
 */
import {
  PipelinePythonError,
  executePythonTransform,
  getPythonRuntimeInfo,
} from '#/lib/pipeline-python.server'

import type { Factor, Objective, Observation, TrialFactors } from './campaign'

export const BAYBE_REQUIREMENT = 'baybe==0.15.0'

let pythonSource: Promise<string> | null = null
function source(): Promise<string> {
  pythonSource ??=
    import('../../../docker/pipeline-python/optimisers/baybe_recommend.py?raw').then(
      (module: { default: string }) => module.default,
    )
  return pythonSource
}

export class BaybeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaybeUnavailableError'
  }
}

/** Whether the configured runtime carries BayBE, and which version. */
export async function baybeVersion(): Promise<string | null> {
  try {
    const info = await getPythonRuntimeInfo()
    return info.packages?.['baybe'] ?? null
  } catch {
    return null
  }
}

export interface BaybeBatch {
  trials: TrialFactors[]
  version: string
  runtime: string
  strategy: string
}

export async function proposeWithBaybe(input: {
  factors: readonly Factor[]
  objectives: readonly Objective[]
  observations: readonly Observation[]
  batchSize: number
  seed: number
}): Promise<BaybeBatch> {
  try {
    const result = await executePythonTransform({
      statement: await source(),
      requirements: [BAYBE_REQUIREMENT],
      inputs: {},
      parameters: {
        factors: input.factors,
        objectives: input.objectives,
        observations: input.observations,
        batch_size: input.batchSize,
        seed: input.seed,
      },
    })
    const row = result.rows[0]
    const trials = Array.isArray(row?.['trials'])
      ? (row['trials'] as TrialFactors[])
      : []
    if (trials.length === 0)
      throw new Error('BayBE did not recommend any conditions.')
    return {
      trials,
      version: String(row?.['engine_version'] ?? ''),
      runtime: result.runtime,
      strategy: String(row?.['strategy'] ?? 'recommender'),
    }
  } catch (error) {
    if (
      error instanceof PipelinePythonError &&
      (error.code === 'runner_unavailable' ||
        /requirement|baybe/i.test(error.message))
    )
      throw new BaybeUnavailableError(error.message)
    throw error
  }
}
