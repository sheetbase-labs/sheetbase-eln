/**
 * The experiment planner: a goal in plain words becomes one reviewable plan.
 * The model only sees the protocols, instruments and samples the lab really
 * has, named by short keys (t1, i1, s1) so a long id is never copied wrongly;
 * its answer is checked against them, the plate is laid out here (not by the
 * model), and what cannot be matched is left out and listed as a warning. The
 * result is a draft a person reads and applies; applying makes everything in
 * one step (`api.apply_experiment_plan`).
 */
import { z } from 'zod'

import { extractJsonObject } from '../ai-import-mapping'
import { layoutRound } from '../campaigns/layout'
import type { Trial } from '../campaigns/campaign'
import { WORKLIST_FORMATS } from '../plate-worklist'
import type { WorklistFormat } from '../plate-worklist'
import { FORMAT_DIMENSIONS } from '../plate-map'
import type { PlateFormat } from '../plate-map'

export const MAX_PLAN_PARTS = 30
export const MAX_CONTEXT_PROTOCOLS = 30
export const MAX_CONTEXT_INSTRUMENTS = 60
export const MAX_CONTEXT_SAMPLES = 40
export const MAX_PLAN_CONDITIONS = 96

export interface PlannerProtocol {
  id: string
  identifier: string
  title: string
}

export interface PlannerInstrument {
  id: string
  name: string
}

export interface PlannerSample {
  id: string
  identifier: string
  title: string
  quantity: number | null
  unit: string | null
}

export interface PlannerContext {
  protocols: PlannerProtocol[]
  instruments: PlannerInstrument[]
  samples: PlannerSample[]
}

export interface PlanPartNeed {
  instrumentId: string
  name?: string
  minutes: number
}

export interface PlanPart {
  title: string
  dayOffset: number
  handsOnMinutes: number
  waitAfterMinutes: number
  needs: PlanPartNeed[]
}

export interface PlanWell {
  wellCode: string
  role: 'sample' | 'positive_control' | 'negative_control' | 'blank'
  sampleLabel?: string
  volumeUl?: number
}

export interface PlanTransfer {
  sourceWell: string
  destWell: string
  volumeUl: number
  label?: string
}

export interface ExperimentPlan {
  summary: string
  rationale?: string
  experiment: {
    title: string
    templateRecordId?: string | null
    templateLabel?: string
  }
  parts: PlanPart[]
  plate?: { name: string; format: PlateFormat; wells: PlanWell[] } | null
  worklist?: {
    format: WorklistFormat
    mode: 'stamp'
    sourcePlate: string
    transfers: PlanTransfer[]
  } | null
  samples: Array<{
    recordId: string
    quantity: number
    unit?: string
    label?: string
  }>
  schedule: boolean
  warnings: string[]
}

/** "PLN-0003". */
export function planReference(number: number): string {
  return `PLN-${String(number).padStart(4, '0')}`
}

const protocolKey = (i: number) => `t${i + 1}`
const instrumentKey = (i: number) => `i${i + 1}`
const sampleKey = (i: number) => `s${i + 1}`

export function plannerInstruction(
  goal: string,
  context: PlannerContext,
): string {
  const quantity = (s: PlannerSample) =>
    s.quantity === null ? 'amount unknown' : `${s.quantity} ${s.unit ?? ''}`.trim()
  return [
    `Goal: ${JSON.stringify(goal.trim())}`,
    'Protocols you may start the experiment from (key | identifier | title):',
    ...context.protocols
      .slice(0, MAX_CONTEXT_PROTOCOLS)
      .map((p, i) => `- ${protocolKey(i)} | ${p.identifier} | ${p.title}`),
    context.protocols.length === 0 ? '(none)' : '',
    'Instruments the lab has (key | name):',
    ...context.instruments
      .slice(0, MAX_CONTEXT_INSTRUMENTS)
      .map((n, i) => `- ${instrumentKey(i)} | ${n.name}`),
    context.instruments.length === 0 ? '(none)' : '',
    'Samples that can be set aside (key | identifier | name | amount left):',
    ...context.samples
      .slice(0, MAX_CONTEXT_SAMPLES)
      .map(
        (s, i) =>
          `- ${sampleKey(i)} | ${s.identifier} | ${s.title} | ${quantity(s)}`,
      ),
    context.samples.length === 0 ? '(none)' : '',
    '',
    'Reply with JSON only: {"summary":"<two sentences: what will be done and why this way>","rationale":"<one or two sentences on the choices>","experimentTitle":"<short title>","protocol":"<protocol key or null>","parts":[{"title":"<what is done>","day":<days from the start, 0 first>,"handsOnMinutes":<minutes at the bench>,"waitMinutes":<minutes to wait afterwards, such as an incubation>,"instruments":[{"key":"<instrument key>","minutes":<minutes on the instrument>}]}],"plate":{"format":"96_well|384_well|24_well","conditions":[{"label":"<what is in these wells>","count":<how many different conditions of this kind>}],"replicates":<wells per condition>,"blanks":<n>,"negatives":<n>,"positives":<n>,"volumeUl":<microlitres per well or null>} or null,"worklist":{"format":"csv|echo|tecan_gwl|hamilton|opentrons","sourcePlate":"<name of the plate the liquid handler takes from>"} or null,"samples":[{"key":"<sample key>","quantity":<amount to set aside>}],"schedule":<true to ask for a schedule on the instruments>,"warnings":["<anything the person should check>"]}.',
    'Rules: use only protocols, instruments and samples listed above and refer to them by key; leave a field out when nothing listed fits instead of guessing. Plan only what the goal asks for; do not invent steps, volumes or samples. A part that needs an instrument names it; give every part a realistic hands-on time. Use a plate only when the goal involves one, and a worklist only when a liquid handler is asked for. Say in "warnings" what you assumed.',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n')
}

const positiveInt = (max: number) =>
  z.number().int().min(0).max(max).optional().nullable()

const answerSchema = z.object({
  summary: z.string().max(1200).optional().default(''),
  rationale: z.string().max(1200).optional(),
  experimentTitle: z.string().max(200).optional(),
  protocol: z.string().max(20).optional().nullable(),
  parts: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        day: z.number().min(0).max(3650).optional().nullable(),
        handsOnMinutes: z.number().min(0).max(1440).optional().nullable(),
        waitMinutes: z.number().min(0).max(525_600).optional().nullable(),
        instruments: z
          .array(
            z.object({
              key: z.string().max(20),
              minutes: z.number().min(1).max(1440).optional().nullable(),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .max(MAX_PLAN_PARTS)
    .optional()
    .default([]),
  plate: z
    .object({
      format: z.string().max(20).optional().nullable(),
      conditions: z
        .array(
          z.object({
            label: z.string().min(1).max(120),
            count: z.number().int().min(1).max(MAX_PLAN_CONDITIONS),
          }),
        )
        .max(48)
        .optional()
        .default([]),
      replicates: positiveInt(8),
      blanks: positiveInt(48),
      negatives: positiveInt(48),
      positives: positiveInt(48),
      volumeUl: z.number().positive().max(100_000).optional().nullable(),
    })
    .optional()
    .nullable(),
  worklist: z
    .object({
      format: z.string().max(20).optional().nullable(),
      sourcePlate: z.string().max(100).optional().nullable(),
    })
    .optional()
    .nullable(),
  samples: z
    .array(
      z.object({
        key: z.string().max(20),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .max(30)
    .optional()
    .default([]),
  schedule: z.boolean().optional().default(false),
  warnings: z.array(z.string().max(300)).max(10).optional().default([]),
})

function clean(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

/** Lay out a plate from named groups of conditions, labelled as the model named them. */
export function layoutConditions(
  conditions: ReadonlyArray<{ label: string; count: number }>,
  options: {
    format: PlateFormat
    replicates: number
    blanks: number
    negatives: number
    positives: number
    volumeUl?: number
    withWorklist: boolean
  },
  seed: number,
): {
  wells: PlanWell[]
  transfers: PlanTransfer[]
} {
  const labels: string[] = []
  for (const group of conditions)
    for (let i = 0; i < group.count; i++)
      labels.push(group.count > 1 ? `${group.label} ${i + 1}` : group.label)
  const trials: Trial[] = labels.map((label, i) => ({
    trial: i + 1,
    factors: { label },
  }))
  const { plate, trials: placed } = layoutRound(
    trials,
    {
      plateFormat: options.format,
      replicates: options.replicates,
      blanks: options.blanks,
      negatives: options.negatives,
      positives: options.positives,
      ...(options.volumeUl ? { volumeUl: options.volumeUl } : {}),
      ...(options.withWorklist ? { worklistFormat: 'csv' } : {}),
    },
    seed,
  )
  if (!plate) return { wells: [], transfers: [] }
  const labelOf = new Map<string, string>()
  for (const trial of placed)
    for (const code of trial.wells ?? [])
      labelOf.set(code, String(trial.factors['label']))
  return {
    wells: plate.wells.map((well) => ({
      ...well,
      ...(labelOf.has(well.wellCode)
        ? { sampleLabel: labelOf.get(well.wellCode) }
        : {}),
    })),
    transfers: plate.transfers.map((transfer) => ({
      ...transfer,
      label: labelOf.get(transfer.destWell),
    })),
  }
}

/** A stable seed from the goal, so the same plan lays out the same way. */
function seedOf(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

/**
 * Turn the model's answer into a plan, keeping only what checks out. Returns
 * null when nothing usable came back.
 */
export function parsePlanAnswer(
  text: string,
  goal: string,
  context: PlannerContext,
): ExperimentPlan | null {
  const parsed = answerSchema.safeParse(extractJsonObject(text))
  if (!parsed.success) return null
  const answer = parsed.data
  const warnings = answer.warnings.map((w) => clean(w, 300)).filter(Boolean)

  const protocolByKey = new Map(
    context.protocols
      .slice(0, MAX_CONTEXT_PROTOCOLS)
      .map((p, i) => [protocolKey(i), p] as const),
  )
  const instrumentByKey = new Map(
    context.instruments
      .slice(0, MAX_CONTEXT_INSTRUMENTS)
      .map((n, i) => [instrumentKey(i), n] as const),
  )
  const sampleByKey = new Map(
    context.samples
      .slice(0, MAX_CONTEXT_SAMPLES)
      .map((s, i) => [sampleKey(i), s] as const),
  )

  const title = clean(answer.experimentTitle, 200) || clean(goal, 120)
  if (!title) return null

  let protocol: PlannerProtocol | undefined
  if (answer.protocol) {
    protocol = protocolByKey.get(answer.protocol)
    if (!protocol) warnings.push('A protocol the plan named was not found, so it starts blank.')
  }

  const parts: PlanPart[] = answer.parts.map((part, index) => {
    const needs: PlanPartNeed[] = []
    for (const need of part.instruments) {
      const instrument = instrumentByKey.get(need.key)
      if (!instrument) {
        warnings.push(
          `An instrument for “${clean(part.title, 60)}” was not found and was left out.`,
        )
        continue
      }
      if (needs.some((n) => n.instrumentId === instrument.id)) continue
      needs.push({
        instrumentId: instrument.id,
        name: instrument.name,
        minutes: Math.round(need.minutes ?? 30),
      })
    }
    return {
      title: clean(part.title, 200),
      dayOffset: Math.round(part.day ?? index),
      handsOnMinutes: Math.round(part.handsOnMinutes ?? 60),
      waitAfterMinutes: Math.round(part.waitMinutes ?? 0),
      needs,
    }
  })

  let plate: ExperimentPlan['plate'] = null
  let worklist: ExperimentPlan['worklist'] = null
  if (answer.plate && answer.plate.conditions.length > 0) {
    const asked = answer.plate.format ?? '96_well'
    const format: PlateFormat =
      asked in FORMAT_DIMENSIONS ? (asked as PlateFormat) : '96_well'
    if (asked !== format)
      warnings.push(`A plate format “${asked}” is not supported, so a 96-well plate is used.`)
    const wantsWorklist = Boolean(answer.worklist)
    const volumeUl = answer.plate.volumeUl ?? (wantsWorklist ? 20 : undefined)
    try {
      const laid = layoutConditions(
        answer.plate.conditions.map((c) => ({
          label: clean(c.label, 100),
          count: c.count,
        })),
        {
          format,
          replicates: Math.max(1, answer.plate.replicates ?? 1),
          blanks: answer.plate.blanks ?? 0,
          negatives: answer.plate.negatives ?? 0,
          positives: answer.plate.positives ?? 0,
          volumeUl,
          withWorklist: wantsWorklist,
        },
        seedOf(goal),
      )
      plate = { name: `${title} plate`, format, wells: laid.wells }
      if (wantsWorklist && laid.transfers.length > 0) {
        const asked = answer.worklist?.format ?? 'csv'
        const worklistFormat: WorklistFormat = (
          WORKLIST_FORMATS as readonly string[]
        ).includes(asked)
          ? (asked as WorklistFormat)
          : 'csv'
        worklist = {
          format: worklistFormat,
          mode: 'stamp',
          sourcePlate: clean(answer.worklist?.sourcePlate, 100) || 'Conditions',
          transfers: laid.transfers,
        }
      }
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : 'The plate could not be laid out.',
      )
    }
  }

  const samples: ExperimentPlan['samples'] = []
  for (const wanted of answer.samples) {
    const sample = sampleByKey.get(wanted.key)
    if (!sample) {
      warnings.push('A sample the plan named was not found and was left out.')
      continue
    }
    if (samples.some((s) => s.recordId === sample.id)) continue
    if (sample.quantity !== null && wanted.quantity > sample.quantity)
      warnings.push(
        `${sample.identifier} has ${sample.quantity} ${sample.unit ?? ''} left, less than the ${wanted.quantity} the plan sets aside.`.replace(
          /\s+\./,
          '.',
        ),
      )
    samples.push({
      recordId: sample.id,
      quantity: wanted.quantity,
      ...(sample.unit ? { unit: sample.unit } : {}),
      label: `${sample.identifier} ${sample.title}`,
    })
  }

  if (parts.length === 0 && !plate && samples.length === 0 && !protocol)
    return null

  return {
    summary: clean(answer.summary, 1200),
    ...(answer.rationale ? { rationale: clean(answer.rationale, 1200) } : {}),
    experiment: {
      title,
      ...(protocol
        ? {
            templateRecordId: protocol.id,
            templateLabel: `${protocol.identifier} ${protocol.title}`,
          }
        : {}),
    },
    parts,
    plate,
    worklist,
    samples,
    schedule: answer.schedule && parts.some((p) => p.needs.length > 0),
    warnings: [...new Set(warnings)],
  }
}

/** How many wells a plan's plate uses for samples and for controls. */
export function plateCounts(plan: ExperimentPlan): {
  samples: number
  controls: number
} {
  const wells = plan.plate?.wells ?? []
  return {
    samples: wells.filter((w) => w.role === 'sample').length,
    controls: wells.filter((w) => w.role !== 'sample').length,
  }
}
