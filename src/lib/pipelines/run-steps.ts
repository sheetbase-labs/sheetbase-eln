import type { PipelineConfig } from './config'
import type {
  PipelineRunLogWire,
  PipelineRunPromptWire,
  PipelineRunStatus,
} from './types'

export type RunStepState =
  'done' | 'failed' | 'waiting' | 'running' | 'not_started'

export interface RunStep {
  /** 1-based position in the run. */
  index: number
  name: string
  /** The step's identifier read as words: "check_units" becomes "Check units". */
  label: string
  kind: 'SQL' | 'Python'
  state: RunStepState
  /** "SQL", "Python · stopped here", "Waiting for a person", "Not started". */
  note: string
}

const NOTE: Record<RunStepState, string> = {
  done: '',
  failed: 'stopped here',
  waiting: 'Waiting for a person',
  running: 'Running',
  not_started: 'Not started',
}

function humanise(name: string): string {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The steps a version declares, in run order: the transform, then each step. */
function declared(
  config: Partial<PipelineConfig>,
): Array<{ name: string; kind: 'SQL' | 'Python' }> {
  const transform = config.transform
  const first =
    transform && transform.language !== 'none'
      ? [
          {
            name: 'Transform',
            kind:
              transform.language === 'python'
                ? ('Python' as const)
                : ('SQL' as const),
          },
        ]
      : []
  return [
    ...first,
    ...(config.steps ?? []).map((step) => ({
      name: step.name,
      kind: step.language === 'python' ? ('Python' as const) : ('SQL' as const),
    })),
  ]
}

/**
 * Where a run got to, read from what the engine records: a waiting run names
 * its step on the prompt, a failed run names it on its error log's `detail.step`
 * (or in the message). A run that does not say stops at the first step.
 */
export function runSteps(
  config: Partial<PipelineConfig>,
  run: { status: PipelineRunStatus },
  logs: PipelineRunLogWire[],
  prompt?: Pick<PipelineRunPromptWire, 'step_id'>,
): RunStep[] {
  const steps = declared(config)
  const named = (name: string) =>
    steps.findIndex((step) => step.name.toLowerCase() === name.toLowerCase())
  let reached = steps.length
  let state: RunStepState = 'done'
  if (run.status === 'waiting') {
    reached = Math.max(prompt ? named(prompt.step_id) : -1, 0)
    state = 'waiting'
  } else if (run.status === 'failed' || run.status === 'cancelled') {
    const error = [...logs].reverse().find((entry) => entry.level === 'error')
    const fromDetail =
      typeof error?.detail.step === 'string' ? named(error.detail.step) : -1
    const fromMessage = error
      ? steps.findIndex((step) => error.message.includes(step.name))
      : -1
    reached = Math.max(fromDetail, fromMessage, 0)
    state = run.status === 'failed' ? 'failed' : 'not_started'
  } else if (run.status === 'running') {
    reached = 0
    state = 'running'
  }
  return steps.map((step, position) => {
    const stepState: RunStepState =
      position < reached ? 'done' : position === reached ? state : 'not_started'
    const tail = NOTE[stepState]
    return {
      index: position + 1,
      name: step.name,
      label: humanise(step.name),
      kind: step.kind,
      state: stepState,
      note: tail ? `${step.kind} · ${tail}` : step.kind,
    }
  })
}

/** Run numbers within a definition: the oldest run is #1. */
export function runNumbers(
  runs: Array<{ id: string; started_at: string }>,
): Map<string, number> {
  return new Map(
    [...runs]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((run, index) => [run.id, index + 1]),
  )
}
