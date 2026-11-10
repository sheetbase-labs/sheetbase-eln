/**
 * Checks for the assistant (server side).
 *
 * Each check puts a task to the assistant's own tools against a fixture
 * workspace and compares what comes back with a known right answer. In tools
 * mode nothing is asked of a model: the lookups and cards run exactly as in the
 * app, so the checks work with AI switched off and catch a change that breaks
 * a lookup or a card. In model mode the connected model is asked the question
 * in plain words, with the same tools, and its answer and cards are checked.
 */
import { createAssistantToolkit } from './assistant-tools.server'
import { streamAssistant } from './assistant'
import type { AssistantDeps } from './assistant'
import { AI_FEATURE_FLAGS } from './ai-feature-flags'
import type { AiFeatureFlags } from './ai-feature-flags'
import {
  ASSISTANT_PROPOSE_TOOL_NAMES,
  ASSISTANT_READ_TOOL_NAMES,
  toWireToolName,
} from './agent-tool-catalogue'
import {
  AGENT_ACTIONS,
  agentActionAlwaysNever,
  resolveAgentActionLevel,
} from './agent-action-policy'
import { z } from 'zod'

import { EVAL_TASK_META } from './ai-eval-tasks'
import type { EvalMode, EvalResult, EvalTaskMeta } from './ai-eval-tasks'
import type { DataClient } from './data-client'
import type { AssistantProposal } from './assistant-proposals'

export const FIXTURE_WORKSPACE = '99999999-9999-4999-8999-999999999999'
const FIXTURE_USER = 'eval-fixture-user'

type Row = Record<string, z.core.util.JSONType | undefined>

/** The invented lab the checks run against. */
export const EVAL_FIXTURE = {
  reagent_orders: [
    {
      id: 'o-8',
      number: 8,
      material_title: 'Taq polymerase',
      supplier: 'Supplier B',
      catalog_no: 'TQ-100',
      quantity: 4,
      unit: 'units',
      status: 'ordered',
      expected_on: '2026-11-20',
      note: null,
    },
    {
      id: 'o-7',
      material_record_id: 'r-gfp',
      number: 7,
      material_title: 'Anti-GFP antibody',
      supplier: 'Supplier A',
      catalog_no: 'AG-7',
      quantity: 1,
      unit: 'vial',
      status: 'requested',
      expected_on: null,
      note: null,
    },
    {
      id: 'o-5',
      number: 5,
      material_title: 'Tris buffer',
      supplier: 'Supplier A',
      catalog_no: 'TB-1',
      quantity: 2,
      unit: 'L',
      status: 'received',
      expected_on: null,
      note: null,
    },
  ],
  instruments: [
    {
      id: 'i-1',
      display_id: 'INS-0001',
      name: 'QuantStudio 5 qPCR',
      location: 'Lab 2',
      instrument_type: 'qpcr',
      retired_at: null,
      out_of_service_at: null,
    },
    {
      id: 'i-2',
      display_id: 'INS-0002',
      name: 'Plate reader',
      location: 'Lab 1',
      instrument_type: 'other',
      retired_at: null,
      out_of_service_at: '2026-11-01T00:00:00Z',
    },
  ],
  instrument_feeds: [
    {
      id: 'f-1',
      name: 'Freezer F-80 temperature',
      unit: '°C',
      low_limit: -90,
      high_limit: -70,
      limit_state: 'ok',
      last_value: -80.2,
      last_at: '2026-11-06T08:00:00Z',
      instrument: { name: 'Freezer F-80', display_id: 'INS-0003' },
    },
    {
      id: 'f-2',
      name: 'Incubator I-2 CO2',
      unit: '%',
      low_limit: 4.5,
      high_limit: 5.5,
      limit_state: 'high',
      last_value: 6.1,
      last_at: '2026-11-06T08:00:00Z',
      instrument: { name: 'Incubator I-2', display_id: 'INS-0004' },
    },
  ],
  records: [
    {
      id: 'r-taq',
      kind: 'material',
      identifier: 'MAT-0001',
      title: 'Taq polymerase',
      metadata_version: 1,
      properties: { quantity: 3, quantityUnit: 'units' },
      deleted_at: null,
      archived_at: null,
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'r-etoh',
      kind: 'material',
      identifier: 'MAT-0003',
      title: 'Ethanol 96%',
      metadata_version: 1,
      properties: { quantity: 1, quantityUnit: 'bottle' },
      deleted_at: null,
      archived_at: null,
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'r-gfp',
      kind: 'material',
      identifier: 'MAT-0002',
      title: 'Anti-GFP antibody',
      metadata_version: 1,
      properties: { quantity: 1, quantityUnit: 'vial' },
      deleted_at: null,
      archived_at: null,
      updated_at: '2026-11-01T00:00:00Z',
    },
  ],
}

// ---------------------------------------------------------------------------
// A tiny read-only PostgREST for the fixture.
// ---------------------------------------------------------------------------

/** A fixture value as the sort compares it: the number, the text, or its JSON. */
function comparable(value: z.core.util.JSONType): string | number {
  const numeric = z.number().safeParse(value)

  if (numeric.success) return numeric.data

  const textual = z.string().safeParse(value)

  return textual.success ? textual.data : JSON.stringify(value)
}

/** Numbers sort numerically; anything else sorts as text. */
function compareOrder(left: string | number, right: string | number): number {
  const numbers = z.tuple([z.number(), z.number()]).safeParse([left, right])

  return numbers.success
    ? numbers.data[0] < numbers.data[1]
      ? -1
      : 1
    : String(left) < String(right)
      ? -1
      : 1
}

function compare(
  a: z.core.util.JSONType | undefined,
  b: z.core.util.JSONType | undefined,
): number {
  if (a === b) return 0

  if (a === null || a === undefined) return 1

  if (b === null || b === undefined) return -1

  return compareOrder(comparable(a), comparable(b))
}

function matchesFilter(
  value: z.core.util.JSONType | undefined,
  expression: string,
): boolean {
  const dot = expression.indexOf('.')
  const operator = dot === -1 ? expression : expression.slice(0, dot)
  const rest = dot === -1 ? '' : expression.slice(dot + 1)

  const text =
    value === null || value === undefined ? '' : String(comparable(value))

  switch (operator) {
    case 'eq':
      return text === rest
    case 'neq':
      return text !== rest
    case 'is':
      return rest === 'null'
        ? value === null || value === undefined
        : value !== null && value !== undefined
    case 'in':
      return rest
        .replace(/^\(|\)$/g, '')
        .split(',')
        .includes(text)
    case 'not': {
      return !matchesFilter(value, rest)
    }

    case 'ilike': {
      const pattern = decodeURIComponent(rest)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '.*')

      return new RegExp(`^${pattern}$`, 'i').test(text)
    }

    default:
      return true
  }
}

/** Reads the rows a query would return from fixture tables. Read-only. */
export function createFixtureClient(
  tables: Record<string, Row[]> = EVAL_FIXTURE,
): DataClient {
  const read = (resource: string, query = ''): Row[] => {
    let rows = [...(tables[resource] ?? [])]
    let order: string | null = null
    let limit = Infinity

    for (const part of query.replace(/^\?/, '').split('&')) {
      if (!part) continue
      const eq = part.indexOf('=')
      const key = part.slice(0, eq)
      const value = part.slice(eq + 1)

      if (key === 'select') continue

      if (key === 'order') order = value
      else if (key === 'limit') limit = Number(value)
      else if (key === 'or') {
        const clauses = value.replace(/^\(|\)$/g, '').split(',')
        rows = rows.filter((row) =>
          clauses.some((clause) => {
            const first = clause.indexOf('.')

            return matchesFilter(
              row[clause.slice(0, first)],
              clause.slice(first + 1),
            )
          }),
        )
      } else {
        rows = rows.filter((row) => matchesFilter(row[key], value))
      }
    }

    if (order) {
      const [column, direction] = order.split(',')[0].split('.')
      rows.sort((a, b) =>
        direction === 'desc'
          ? compare(b[column], a[column])
          : compare(a[column], b[column]),
      )
    }

    return rows.slice(0, limit)
  }

  const refuse = () => {
    throw new Error('The fixture workspace is read-only.')
  }

  return {
    list: async <T>(resource: string, query?: string) =>
      // SAFETY: the caller's T names the fixture rows this read serves; every check reads tables it defined in EVAL_FIXTURE.
      read(resource, query) as T[],
    count: async (resource: string, query?: string) =>
      read(resource, query).length,
    rpc: refuse,
    insert: refuse,
    patch: refuse,
    remove: refuse,
  }
}

// ---------------------------------------------------------------------------
// Tasks.
// ---------------------------------------------------------------------------

interface Outcome {
  text: string
  proposals: AssistantProposal[]
  error?: string
}

const cardAction = z.looseObject({ kind: z.string() })

interface Expectation {
  includes?: string[]
  excludes?: string[]
  /** The card the assistant should have made, by its action kind. */
  card?: { kind: string; match?: Record<string, z.core.util.JSONType> }
  /** No card should have been made. */
  noCard?: boolean
}

interface TaskDefinition {
  meta: EvalTaskMeta
  /** The tool the task runs in tools mode. */
  tool?: { name: string; args: Record<string, z.core.util.JSONType> }
  /** For tasks that need no tools or model at all. */
  direct?: () => { text: string }
  expect: Expectation
}

function flagsAllOn(): AiFeatureFlags {
  // SAFETY: AI_FEATURE_FLAGS lists every AiFeatureFlagKey, so the built object has each of them.
  return Object.fromEntries(
    AI_FEATURE_FLAGS.map((flag) => [flag.key, true]),
  ) as AiFeatureFlags
}

function meta(key: string): EvalTaskMeta {
  const found = EVAL_TASK_META.find((task) => task.key === key)

  if (!found) throw new Error(`No check named ${key}`)

  return found
}

const TASKS: readonly TaskDefinition[] = [
  {
    meta: meta('find.open-orders'),
    tool: {
      name: 'sheetbase.lab.list',
      args: { area: 'reagent_orders', openOnly: true },
    },
    expect: {
      includes: ['Taq polymerase', 'Anti-GFP antibody'],
      excludes: ['Tris buffer'],
    },
  },
  {
    meta: meta('find.instruments-down'),
    tool: { name: 'sheetbase.lab.list', args: { area: 'instruments' } },
    expect: { includes: ['Plate reader'] },
  },
  {
    meta: meta('summarise.freezers'),
    tool: {
      name: 'sheetbase.lab.list',
      args: { area: 'readings', openOnly: true },
    },
    expect: { includes: ['Incubator I-2'], excludes: ['Freezer F-80'] },
  },
  {
    meta: meta('propose.reagent-order'),
    tool: {
      name: 'sheetbase.reagent.order',
      args: {
        title: 'Order Ethanol 96%',
        summary: 'Order 2 more Ethanol 96%.',
        material: 'Ethanol 96%',
        quantity: 2,
      },
    },
    expect: { card: { kind: 'reagent.order', match: { quantity: 2 } } },
  },
  {
    meta: meta('propose.not-twice'),
    tool: {
      name: 'sheetbase.reagent.order',
      args: {
        title: 'Order Anti-GFP antibody',
        summary: 'Order 3 more.',
        material: 'Anti-GFP antibody',
        quantity: 3,
      },
    },
    expect: { noCard: true, includes: ['already open'] },
  },
  {
    meta: meta('guardrails.default-ask'),
    direct: () => ({
      text: resolveAgentActionLevel([], 'request_reagent_order'),
    }),
    expect: { includes: ['ask'] },
  },
  {
    meta: meta('guardrails.most-specific'),
    direct: () => {
      const policies = [
        {
          action_key: 'create_shipment',
          subject_kind: 'everyone',
          role: null,
          credential_id: null,
          level: 'auto',
        },
        {
          action_key: 'create_shipment',
          subject_kind: 'role',
          role: 'member',
          credential_id: null,
          level: 'never',
        },
        {
          action_key: 'create_shipment',
          subject_kind: 'credential',
          role: null,
          credential_id: 'agent-1',
          level: 'ask',
        },
      ] as const

      const levels = [
        resolveAgentActionLevel(policies, 'create_shipment', {
          role: 'scientist',
        }),
        resolveAgentActionLevel(policies, 'create_shipment', {
          role: 'member',
        }),
        resolveAgentActionLevel(policies, 'create_shipment', {
          role: 'member',
          credentialId: 'agent-1',
        }),
      ]

      return { text: levels.join(',') }
    },
    expect: { includes: ['auto,never,ask'] },
  },
  {
    meta: meta('guardrails.always-off'),
    direct: () => {
      const policies = [
        {
          action_key: 'sign_record',
          subject_kind: 'everyone',
          role: null,
          credential_id: null,
          level: 'auto',
        },
      ] as const

      const keys = [
        'sign_record',
        'submit_experiment_for_review',
        'amend_record',
        'lock_record',
        'delete_record',
      ]

      const levels = keys.map((key) => resolveAgentActionLevel(policies, key))

      const offered = AGENT_ACTIONS.filter((action) =>
        agentActionAlwaysNever(action.key),
      ).length

      return { text: `${levels.join(',')};offered=${offered}` }
    },
    expect: {
      includes: ['never,never,never,never,never;offered=0'],
    },
  },
  {
    meta: meta('guardrails.assistant-reads-only'),
    direct: () => {
      const overlap = ASSISTANT_READ_TOOL_NAMES.filter((name) =>
        ASSISTANT_PROPOSE_TOOL_NAMES.includes(name),
      )

      return { text: `overlap=${overlap.length}` }
    },
    expect: { includes: ['overlap=0'] },
  },
]

function check(outcome: Outcome, expectation: Expectation): string | null {
  const haystack = `${outcome.text}\n${JSON.stringify(outcome.proposals)}`

  for (const text of expectation.includes ?? []) {
    if (!haystack.toLowerCase().includes(text.toLowerCase())) {
      return `The answer should mention “${text}” and does not.`
    }
  }

  for (const text of expectation.excludes ?? []) {
    if (haystack.toLowerCase().includes(text.toLowerCase())) {
      return `The answer should not mention “${text}” but does.`
    }
  }

  if (expectation.noCard && outcome.proposals.length > 0) {
    return 'A card was proposed, and none should have been.'
  }

  if (expectation.card) {
    const wanted = expectation.card

    const found = outcome.proposals.find((proposal) => {
      const decoded = cardAction.safeParse(proposal.action)

      if (!decoded.success || decoded.data.kind !== wanted.kind) return false

      const action = decoded.data

      return Object.entries(wanted.match ?? {}).every(
        ([key, value]) => action[key] === value,
      )
    })

    if (!found) {
      return `A ${wanted.kind} card was expected and was not proposed.`
    }
  }

  return null
}

function expectedText(expectation: Expectation): string {
  const parts: string[] = []

  if (expectation.includes?.length)
    parts.push(`mentions ${expectation.includes.join(', ')}`)

  if (expectation.excludes?.length)
    parts.push(`does not mention ${expectation.excludes.join(', ')}`)

  if (expectation.card) parts.push(`proposes a ${expectation.card.kind} card`)

  if (expectation.noCard) parts.push('proposes no card')

  return parts.join('; ')
}

// ---------------------------------------------------------------------------
// Running.
// ---------------------------------------------------------------------------

export interface ModelHarness {
  deps: Omit<AssistantDeps, 'client' | 'toolkit'>
}

async function runInTools(
  task: TaskDefinition,
  toolkit: Awaited<ReturnType<typeof createAssistantToolkit>>,
): Promise<Outcome> {
  if (task.direct) return { ...task.direct(), proposals: [] }

  if (!task.tool || !toolkit) {
    return {
      text: '',
      proposals: [],
      error: 'The assistant has no tools here.',
    }
  }

  const result = await toolkit.run(
    toWireToolName(task.tool.name),
    JSON.stringify(task.tool.args),
  )

  return {
    text: result.text,
    proposals: result.proposal ? [result.proposal] : [],
    error: result.isError ? result.text : undefined,
  }
}

async function runWithModel(
  task: TaskDefinition,
  harness: ModelHarness,
  client: DataClient,
  toolkit: Awaited<ReturnType<typeof createAssistantToolkit>>,
): Promise<Outcome> {
  const proposals: AssistantProposal[] = []

  const wrapped = toolkit
    ? {
        ...toolkit,
        run: async (name: string, argumentsJson: string) => {
          const result = await toolkit.run(name, argumentsJson)

          if (result.proposal) proposals.push(result.proposal)

          return result
        },
      }
    : undefined

  const started = await streamAssistant(
    {
      workspaceId: FIXTURE_WORKSPACE,
      messages: [{ role: 'user', content: task.meta.prompt }],
      objectRefs: [],
    },
    { ...harness.deps, client, toolkit: wrapped },
  )

  if (started.status !== 'ok') {
    return { text: '', proposals, error: started.message }
  }

  let text = ''

  try {
    for await (const event of started.events) {
      if (event.type === 'text') text += event.delta
    }
  } catch (error) {
    return {
      text,
      proposals,
      error: error instanceof Error ? error.message : 'The model failed.',
    }
  }

  return { text, proposals }
}

/** The tool a task would make the assistant use, for scripted models in tests. */
export function evalTaskTool(key: string): TaskDefinition['tool'] {
  return TASKS.find((task) => task.meta.key === key)?.tool
}

export interface RunEvalsInput {
  mode: EvalMode
  /** Needed in model mode. */
  harness?: ModelHarness
}

/**
 * Run every check. In model mode, tasks that need a model run through it; the
 * guardrail checks, which need none, run either way.
 */
export async function runEvalTasks(
  input: RunEvalsInput,
): Promise<EvalResult[]> {
  const client = createFixtureClient()

  const toolkit = await createAssistantToolkit({
    client,
    actor: { kind: 'user', id: FIXTURE_USER },
    workspaceId: FIXTURE_WORKSPACE,
    flags: flagsAllOn(),
    timeZone: 'UTC',
    now: new Date('2026-11-06T09:00:00Z'),
  })

  const results: EvalResult[] = []

  for (const task of TASKS) {
    const started = Date.now()
    let outcome: Outcome

    try {
      if (input.mode === 'model' && task.meta.usesModel) {
        // SAFETY: RunEvalsInput requires a harness in model mode, and this branch only runs in that mode.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each check is timed on its own and reports that duration; running them together would make the reported numbers measure each other.
        outcome = await runWithModel(
          task,
          input.harness as ModelHarness,
          client,
          toolkit,
        )
      } else {
        outcome = await runInTools(task, toolkit)
      }
    } catch (error) {
      outcome = {
        text: '',
        proposals: [],
        error: error instanceof Error ? error.message : 'The check crashed.',
      }
    }

    let problem = check(outcome, task.expect)

    // A tool error is only the right answer when the task expects a refusal.
    if (outcome.error && !task.expect.noCard) {
      problem = outcome.error
    }

    results.push({
      taskKey: task.meta.key,
      area: task.meta.area,
      title: task.meta.title,
      status: problem === null ? 'passed' : 'failed',
      expected: expectedText(task.expect),
      actual: outcome.text.slice(0, 600),
      detail: problem ?? '',
      durationMs: Date.now() - started,
    })
  }

  return results
}
