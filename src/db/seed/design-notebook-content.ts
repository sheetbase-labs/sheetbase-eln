/**
 * Notebook content for the demo's experiments: what a scientist would have
 * written down, in the shape of the real blocks (objective, method, a results
 * table, a headline metric, observations, a conclusion). Every number comes
 * from a hash of the experiment's identifier, so a reseed writes the same
 * notebook and the text always agrees with the table beside it.
 */
import { createHash } from 'node:crypto'

export interface Readout {
  name: string
  unit: string
  base: number
  /** Relative spread across conditions: 0.1 is plus or minus 10 %. */
  spread: number
  digits: number
  higherIsBetter?: boolean
}

export interface Topic {
  title: string
  objective: string
  /** Replaces the kit's method paragraph when the experiment differs. */
  method?: string
  factor?: string
  conditions?: readonly string[]
  readouts?: readonly Readout[]
}

export interface Kit {
  /** One per experiment in the project, in the order they were run. */
  topics: readonly Topic[]
  factor: string
  conditions: readonly string[]
  readouts: readonly Readout[]
  method: string
  quirks: readonly string[]
  next: readonly string[]
  prep: readonly string[]
  holdReason: string
}

export type NotebookBlock = {
  type: string
  order: number
  payload: Record<string, unknown>
}

export type NotebookStatus =
  | 'draft'
  | 'planned'
  | 'in_progress'
  | 'on_hold'
  | 'in_review'
  | 'returned'
  | 'approved'

function unit01(key: string): number {
  const digest = createHash('sha1').update(key).digest()
  return digest.readUInt32BE(0) / 0xffffffff
}

function pick<T>(items: readonly T[], key: string): T {
  return items[Math.floor(unit01(key) * items.length) % items.length]
}

function doc(heading: string, ...paragraphs: string[]) {
  return {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: heading }],
        },
        ...paragraphs.map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      ],
    },
  }
}

function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value
}

function fixed(value: number, digits: number): string {
  return value.toFixed(digits)
}

interface Cell {
  condition: string
  values: number[]
}

function measure(
  identifier: string,
  conditions: readonly string[],
  readouts: readonly Readout[],
): Cell[] {
  return conditions.map((condition, c) => ({
    condition,
    values: readouts.map((readout, r) => {
      const wobble = unit01(`${identifier}:${c}:${r}`) - 0.5
      const trend = (c - (conditions.length - 1) / 2) * 0.35 * wobble
      return readout.base * (1 + readout.spread * 2 * (wobble + trend))
    }),
  }))
}

function chooseConditions(
  identifier: string,
  all: readonly string[],
): readonly string[] {
  if (all.length <= 3) return all
  const keep = 3 + (unit01(`${identifier}:n`) > 0.5 ? 1 : 0)
  const start = Math.floor(unit01(`${identifier}:s`) * (all.length - keep + 1))
  return all.slice(start, start + keep)
}

export const APPROVAL_NOTES = [
  'Data and conclusion agree, replicates are tight. Approved.',
  'Method is clear and the table supports the conclusion. Approved.',
  'Good run. Approved; carry the winning condition into the next one.',
  'Reviewed against the raw data. Approved.',
] as const

export const RETURN_NOTES = [
  'Please state the replicate count and how the error bars were calculated before this goes through.',
  'The conclusion is stronger than the table allows. Add the second run or soften the wording.',
] as const

export interface BuildInput {
  identifier: string
  status: NotebookStatus
  topic: Topic
  kit: Kit
  /** First free block order in the record. */
  firstOrder: number
}

/** The blocks that make up one experiment's notebook, in reading order. */
export function buildNotebook(input: BuildInput): NotebookBlock[] {
  const { identifier, status, topic, kit } = input
  const factor = topic.factor ?? kit.factor
  const readouts = topic.readouts ?? kit.readouts
  const conditions = chooseConditions(
    identifier,
    topic.conditions ?? kit.conditions,
  )
  const blocks: Array<Omit<NotebookBlock, 'order'>> = []

  blocks.push({ type: 'rich_text', payload: doc('Objective', topic.objective) })

  const started = status !== 'draft' && status !== 'planned'
  const method = topic.method ?? kit.method
  blocks.push({
    type: 'rich_text',
    payload: doc(
      started ? 'Method' : 'Planned method',
      method,
      started
        ? `${conditions.length} conditions, three replicates each, run on the same day from one starting pool.`
        : `${conditions.length} conditions, three replicates each, to be run on the same day from one starting pool.`,
    ),
  })

  if (!started) {
    blocks.push({
      type: 'checklist',
      payload: {
        items: kit.prep.map((text, i) => ({
          text,
          checked: status === 'planned' && i === 0,
        })),
      },
    })
    return number(blocks, input.firstOrder)
  }

  const finished =
    status === 'in_review' || status === 'returned' || status === 'approved'
  const cells = measure(identifier, conditions, readouts)
  // Work in progress has the last condition still to read out.
  const pending = finished ? -1 : cells.length - 1
  blocks.push({
    type: 'table',
    payload: {
      columns: [
        factor,
        ...readouts.map((r) => (r.unit ? `${r.name} (${r.unit})` : r.name)),
      ],
      rows: cells.map((cell, c) => [
        cell.condition,
        ...cell.values.map((v, r) =>
          c === pending ? '—' : fixed(v, readouts[r]?.digits ?? 1),
        ),
      ]),
    },
  })

  const done = cells.filter((_, c) => c !== pending)
  const primary = readouts[0]
  if (done.length === 0) return number(blocks, input.firstOrder)
  const higher = primary.higherIsBetter !== false
  const ranked = [...done].sort((a, b) =>
    higher
      ? (b.values[0] ?? 0) - (a.values[0] ?? 0)
      : (a.values[0] ?? 0) - (b.values[0] ?? 0),
  )
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  const bestValue = fixed(best.values[0] ?? 0, primary.digits)
  const gap = fixed(
    Math.abs((best.values[0] ?? 0) - (worst.values[0] ?? 0)),
    primary.digits,
  )
  const second = readouts.at(1)
  const secondValues = done.map((cell) => cell.values[1] ?? 0)
  const secondLine = second
    ? ` ${second.name} stayed between ${fixed(Math.min(...secondValues), second.digits)} and ${withUnit(fixed(Math.max(...secondValues), second.digits), second.unit)}.`
    : ''
  const lead = finished ? '' : 'So far, '
  const verb = finished ? 'gave' : 'is giving'
  const observation = `${lead}${best.condition} ${verb} the ${higher ? 'highest' : 'lowest'} ${primary.name.toLowerCase()} at ${withUnit(bestValue, primary.unit)}, ${withUnit(gap, primary.unit)} ${higher ? 'above' : 'below'} ${worst.condition}.${secondLine} ${pick(kit.quirks, `${identifier}:q`)}`
  blocks.push({
    type: 'rich_text',
    payload: doc(
      finished ? 'Observations' : 'Observations so far',
      observation,
    ),
  })

  if (finished) {
    blocks.push({
      type: 'metric',
      payload: {
        label: `Best ${primary.name.toLowerCase()}`,
        value: bestValue,
        unit: primary.unit,
        provenance: `${best.condition}, mean of three replicates`,
      },
    })
    const roll = unit01(`${identifier}:verdict`)
    const verdict =
      roll < 0.1 ? 'inconclusive' : roll < 0.16 ? 'not_supported' : 'supported'
    const text =
      verdict === 'supported'
        ? `${best.condition} is the better choice on ${primary.name.toLowerCase()}. ${pick(kit.next, `${identifier}:n`)}`
        : verdict === 'inconclusive'
          ? `The ${withUnit(gap, primary.unit)} gap between ${best.condition} and ${worst.condition} is within what the replicates scatter by. Repeat before choosing.`
          : `${best.condition} did not beat the current condition by the margin we set out to see. Keep the current setting.`
    blocks.push({
      type: 'conclusion',
      payload: {
        text,
        verdict,
        basis: `Results table: ${primary.name.toLowerCase()} by ${factor.toLowerCase()}, three replicates per condition.`,
      },
    })
  } else {
    blocks.push({
      type: 'callout',
      payload:
        status === 'on_hold'
          ? { variant: 'warning', text: kit.holdReason }
          : {
              variant: 'note',
              text: `Still to read out: ${cells[cells.length - 1]?.condition}. ${pick(kit.next, `${identifier}:n`)}`,
            },
    })
  }
  return number(blocks, input.firstOrder)
}

function number(
  blocks: Array<Omit<NotebookBlock, 'order'>>,
  firstOrder: number,
): NotebookBlock[] {
  return blocks.map((block, i) => ({ ...block, order: firstOrder + i }))
}
