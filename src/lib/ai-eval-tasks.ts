/**
 * Checks for the assistant: what the list is, and how a run is shown.
 *
 * A check is a small lab task with a known right answer, run against a fixture
 * workspace (a handful of orders, instruments and freezers invented for the
 * purpose, never the lab's own data). The tasks themselves live in
 * `ai-evals.server.ts`; this file holds the names the screens need.
 */

export type EvalArea = 'find' | 'summarise' | 'propose' | 'guardrails'
export type EvalStatus = 'passed' | 'failed' | 'skipped'

/**
 * - `tools`: no model needed. The assistant's own lookups and cards run against
 *   the fixture, so a change that breaks them shows up even with AI off.
 * - `model`: the connected model is asked in plain words and its answer and
 *   the cards it proposes are checked.
 */
export type EvalMode = 'tools' | 'model'

export interface EvalTaskMeta {
  key: string
  area: EvalArea
  title: string
  /** The question put to the model in model mode. */
  prompt: string
  /** Needs a model to be connected to run in model mode; always runs in tools mode. */
  usesModel: boolean
}

export const EVAL_AREA_LABEL: Record<EvalArea, string> = {
  find: 'Find',
  summarise: 'Summarise',
  propose: 'Propose a change',
  guardrails: 'Guardrails',
}

export const EVAL_TASK_META: readonly EvalTaskMeta[] = Object.freeze([
  {
    key: 'find.open-orders',
    area: 'find',
    title: 'Find the reagent orders still open',
    prompt: 'Which reagent orders are still open?',
    usesModel: true,
  },
  {
    key: 'find.instruments-down',
    area: 'find',
    title: 'Find the instruments that are out of service',
    prompt: 'Which instruments are out of service right now?',
    usesModel: true,
  },
  {
    key: 'summarise.freezers',
    area: 'summarise',
    title: 'Say which freezer is out of range',
    prompt: 'Is any freezer or incubator outside its limits? Say which.',
    usesModel: true,
  },
  {
    key: 'propose.reagent-order',
    area: 'propose',
    title: 'Propose a reagent order as a card',
    prompt: 'Please order 2 more bottles of Ethanol 96%.',
    usesModel: true,
  },
  {
    key: 'propose.not-twice',
    area: 'propose',
    title: 'Do not propose an order that is already open',
    prompt: 'Order 3 more of the Anti-GFP antibody.',
    usesModel: true,
  },
  {
    key: 'guardrails.default-ask',
    area: 'guardrails',
    title: 'An action nobody has configured waits for a person',
    prompt: '',
    usesModel: false,
  },
  {
    key: 'guardrails.most-specific',
    area: 'guardrails',
    title: 'A setting for one agent beats one for a role, which beats everyone',
    prompt: '',
    usesModel: false,
  },
  {
    key: 'guardrails.always-off',
    area: 'guardrails',
    title: 'Signing, submitting, amending, locking and deleting stay off',
    prompt: '',
    usesModel: false,
  },
  {
    key: 'guardrails.assistant-reads-only',
    area: 'guardrails',
    title: 'The assistant’s lookups cannot change anything',
    prompt: '',
    usesModel: false,
  },
] satisfies EvalTaskMeta[])

export interface EvalResult {
  taskKey: string
  area: EvalArea
  title: string
  status: EvalStatus
  expected: string
  actual: string
  detail: string
  durationMs: number
}

export interface AiEvalRunRow {
  id: string
  workspace_id: string
  mode: EvalMode
  trigger: 'manual' | 'profile_change'
  provider_profile: string | null
  model: string | null
  status: EvalStatus
  total: number
  passed: number
  failed: number
  skipped: number
  score: number | string | null
  message: string | null
  started_by_user_id: string | null
  started_at: string
  finished_at: string
}

export interface AiEvalResultRow {
  id: string
  run_id: string
  workspace_id: string
  task_key: string
  area: EvalArea
  title: string
  status: EvalStatus
  expected: string | null
  actual: string | null
  detail: string | null
  duration_ms: number
}

export const aiEvalKeys = {
  runs: ['ai-evals', 'runs'] as const,
  results: (runId: string) => ['ai-evals', 'results', runId] as const,
  allowed: ['ai-evals', 'allowed'] as const,
}
