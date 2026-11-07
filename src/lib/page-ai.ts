import { z } from 'zod'

import { callModel } from './ai-gateway'
import { gatewayFailure, prepare, pricingFor } from './assistant'
import type { AssistantDeps, AssistantSource, Failure } from './assistant'
import { AI_OBJECT_REF_KINDS } from './ai-context'
import type { GatewayUsage } from './ai-gateway'

/**
 * In-page AI. One governed call for the small helpers that live inside a page
 * (explain this, rewrite that, summarise these blocks) as opposed to the chat.
 *
 * It goes through the same readiness rules, context assembly and gateway as
 * the assistant: the workspace switch and the assistant flag decide whether it
 * runs, the person's own access decides what the model may see, and every call
 * is budgeted and logged. It never writes anything. The caller shows the text
 * as a suggestion and the person decides what to do with it.
 */

export const PAGE_AI_MAX_TEXT_CHARS = 20_000
export const PAGE_AI_MAX_INSTRUCTION_CHARS = 12_000
export const PAGE_AI_MAX_OBJECT_REFS = 4

export const PAGE_AI_TASKS = [
  'explain',
  'draft',
  'rewrite',
  'summarise',
  'conclude',
  'freeform',
  'map_columns',
  'search_filters',
  'explain_data',
  'suggest_chart',
  'draft_pipeline',
  'plan_experiment',
] as const

export type PageAiTask = (typeof PAGE_AI_TASKS)[number]

const TASK_INSTRUCTIONS: Record<PageAiTask, string> = {
  explain:
    'Explain the problem in plain language for a bench scientist and say how to fix it. Use only the facts supplied.',
  draft:
    'Draft the text the person asked for, in the plain style of a lab notebook entry. Use only facts from the supplied context and say so where something is unknown. Do not invent results, units or sample names.',
  rewrite:
    'Rewrite the supplied text as the person asked. Keep every number, unit, name and identifier exactly as written. Reply with the rewritten text only.',
  summarise:
    'Summarise the supplied content briefly for a colleague who has not seen it. Keep numbers and units exactly. Reply with the summary only.',
  conclude:
    'Write a short conclusion for the experiment from the supplied results. Say what the data shows, with the numbers, and note anything it does not show. Do not claim more than the data supports. Reply with the conclusion only.',
  freeform:
    'Follow the instruction using only the supplied context. Reply with the text only.',
  map_columns:
    'Match each file column to the target field it most likely feeds, and guess its unit and data type from its header and example values. Use only the target field ids supplied; leave a column unmatched when nothing fits. Never convert or rescale values. Reply with JSON only, exactly in the shape the instruction describes.',
  search_filters:
    'Turn the plain-English search into filters over the supplied fields. Use only the field keys and operators supplied; put anything you cannot express as a field filter into the free-text query. Reply with JSON only, exactly in the shape the instruction describes.',
  suggest_chart:
    'Choose a chart type and fields that show the supplied dataset best. Use only the chart types and field ids supplied. Reply with JSON only, exactly in the shape the instruction describes.',
  draft_pipeline:
    'Draft a data pipeline from the plain-English description: its inputs, parameters, SQL steps and where the result goes. Use only the schema, dataset and column names supplied and write SQL a person can read and change. Never invent columns. Reply with JSON only, exactly in the shape the instruction describes.',
  plan_experiment:
    'Plan the experiment the person describes: the protocol to start from, its parts with realistic bench and instrument times, a plate with conditions and controls, whether a liquid handler worklist is needed, and which samples to set aside. Use only the protocols, instruments and samples supplied, named by their keys, and never invent steps, volumes or samples; say in warnings what you assumed. Reply with JSON only, exactly in the shape the instruction describes.',
  explain_data:
    'Explain what the supplied data shows for a bench scientist, in a few short sentences. Quote numbers and units exactly as supplied, name the trend or outliers you can see, and say what the data does not show. Do not invent values, causes or sample names. Reply with the explanation only.',
}

export const pageAiSchema = z
  .object({
    workspaceId: z.string().uuid(),
    task: z.enum(PAGE_AI_TASKS),
    /** What the person asked for, e.g. "make this more formal". */
    instruction: z.string().max(PAGE_AI_MAX_INSTRUCTION_CHARS).default(''),
    /** The text being worked on: a selection, a block, a draft. */
    text: z.string().max(PAGE_AI_MAX_TEXT_CHARS).default(''),
    objectRefs: z
      .array(
        z
          .object({
            kind: z.enum(AI_OBJECT_REF_KINDS),
            id: z.string().uuid(),
            pinnedVersionId: z.string().uuid().nullish(),
          })
          .strict(),
      )
      .max(PAGE_AI_MAX_OBJECT_REFS)
      .default([]),
  })
  .strict()
  .refine(
    (input) =>
      input.text.trim() !== '' ||
      input.instruction.trim() !== '' ||
      input.objectRefs.length > 0,
    {
      message: 'Give the helper something to work on.',
    },
  )

export type PageAiInput = z.infer<typeof pageAiSchema>

export type PageAiResult =
  | {
      status: 'ok'
      text: string
      model: string
      mode: 'built-in' | 'provider'
      sources: AssistantSource[]
      usage: GatewayUsage
      /** Always true: the text is model output and is shown as a suggestion. */
      generated: true
    }
  | Failure

/** The prompt body: the instruction, then the text, in labelled parts. */
export function buildPageAiPrompt(input: PageAiInput): string {
  const parts: string[] = []
  if (input.instruction.trim())
    parts.push(`Instruction: ${input.instruction.trim()}`)
  if (input.text.trim()) parts.push(`Text:\n${input.text.trim()}`)
  if (parts.length === 0) parts.push('Instruction: Use the supplied context.')
  return parts.join('\n\n')
}

/**
 * Run one in-page call. Pure orchestration over the same deps the assistant
 * uses; the server function resolves them from the verified session.
 */
export async function runPageAi(
  input: PageAiInput,
  deps: AssistantDeps,
): Promise<PageAiResult> {
  const prepared = await prepare({ objectRefs: input.objectRefs }, deps)
  if ('status' in prepared) return prepared
  try {
    const result = await callModel(
      deps.actor,
      {
        model: deps.settings.model,
        tools: [],
        contextEnvelope: prepared.envelope,
        citations: [],
        instructions: TASK_INSTRUCTIONS[input.task],
        messages: [{ role: 'user', content: buildPageAiPrompt(input) }],
        limits: {
          maxTokens: deps.settings.maxTokensPerCall,
          maxCostMicrousd: deps.settings.maxCostMicrousdPerCall,
        },
      },
      { provider: prepared.provider, pricing: pricingFor(prepared, deps) },
    )
    return {
      status: 'ok',
      text: result.text.trim(),
      model: result.model,
      mode: prepared.mode,
      sources: prepared.sources,
      usage: result.usage,
      generated: true,
    }
  } catch (error) {
    return gatewayFailure(error)
  }
}
