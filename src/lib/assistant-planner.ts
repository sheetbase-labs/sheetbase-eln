import { z } from 'zod'

import type { ExperimentPlan } from './planner/plan'

/**
 * The experiment planner and optimisation campaigns from the assistant. The
 * model names things the way people do, the server finds them and sends back a
 * card, and nothing happens until the person presses the button. A plan card
 * makes the plan and applies it in one step; a campaign card starts a
 * campaign, asks for a round, approves a round the person has read or enters
 * results.
 */

export const PLAN_TOOL = 'sheetbase.planner.plan_experiment'
export const CAMPAIGN_START_TOOL = 'sheetbase.campaign.start'
export const CAMPAIGN_ROUND_TOOL = 'sheetbase.campaign.request_round'
export const CAMPAIGN_APPROVE_TOOL = 'sheetbase.campaign.approve_round'
export const CAMPAIGN_RESULTS_TOOL = 'sheetbase.campaign.enter_results'

export const PLANNER_PROPOSE_TOOL_NAMES = [
  PLAN_TOOL,
  CAMPAIGN_START_TOOL,
  CAMPAIGN_ROUND_TOOL,
  CAMPAIGN_APPROVE_TOOL,
  CAMPAIGN_RESULTS_TOOL,
] as const

export type PlannerProposeToolName = (typeof PLANNER_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const campaign = z
  .string()
  .min(1)
  .max(200)
  .describe('The campaign by identifier such as CMP-0003 or by title.')

export const proposePlanSchema = z
  .object({
    title,
    summary,
    goal: z
      .string()
      .min(1)
      .max(1000)
      .describe('What the person wants to find out.'),
    project: z
      .string()
      .min(1)
      .max(200)
      .describe('The project the experiment belongs to, by name or key.'),
    experimentTitle: z.string().min(1).max(200),
    protocol: z
      .string()
      .max(200)
      .optional()
      .describe(
        'A protocol to start from, by identifier or title. Leave out for a blank experiment.',
      ),
    parts: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          day: z.number().min(0).max(3650).optional(),
          handsOnMinutes: z.number().min(0).max(1440).optional(),
          waitMinutes: z.number().min(0).max(525_600).optional(),
          gate: z
            .enum(['warn', 'block'])
            .optional()
            .describe(
              'Set when this part must wait until the part before it is done: warn lets the person go on with a reason, block does not.',
            ),
          instruments: z
            .array(
              z.object({
                name: z.string().min(1).max(200),
                minutes: z.number().min(1).max(1440).optional(),
              }),
            )
            .optional(),
        }),
      )
      .max(30)
      .optional(),
    plate: z
      .object({
        format: z.enum(['24_well', '96_well', '384_well']),
        conditions: z
          .array(
            z.object({
              label: z.string().min(1).max(120),
              count: z.number().int().min(1).max(96),
            }),
          )
          .max(48),
        replicates: z.number().int().min(1).max(8).optional(),
        blanks: z.number().int().min(0).max(48).optional(),
        negatives: z.number().int().min(0).max(48).optional(),
        positives: z.number().int().min(0).max(48).optional(),
        volumeUl: z.number().positive().max(100_000).optional(),
      })
      .optional(),
    worklist: z
      .object({
        format: z.enum(['csv', 'echo', 'tecan_gwl', 'hamilton', 'opentrons']),
        sourcePlate: z.string().min(1).max(100),
      })
      .optional(),
    samples: z
      .array(
        z.object({
          sample: z.string().min(1).max(200).describe('By identifier or name.'),
          quantity: z.number().positive().max(1_000_000),
        }),
      )
      .max(30)
      .optional(),
    schedule: z
      .boolean()
      .optional()
      .describe(
        'True to ask for a schedule on the instruments the parts need.',
      ),
    warnings: z.array(z.string().max(300)).max(10).optional(),
  })
  .strict()

export const campaignStartSchema = z
  .object({ title, summary, campaign })
  .strict()

export const campaignRoundSchema = z
  .object({ title, summary, campaign })
  .strict()

export const campaignApproveSchema = z
  .object({
    title,
    summary,
    campaign,
    round: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'The round number. Defaults to the round waiting for approval.',
      ),
  })
  .strict()

export const campaignResultsSchema = z
  .object({
    title,
    summary,
    campaign,
    round: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The round number. Defaults to the round waiting for results.'),
    results: z
      .array(
        z.object({
          condition: z
            .number()
            .int()
            .min(1)
            .describe('The condition number in the round.'),
          values: z
            .array(
              z.object({
                objective: z
                  .string()
                  .min(1)
                  .max(80)
                  .describe('The objective by name.'),
                value: z.number().finite(),
              }),
            )
            .min(1),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict()

/** What a planner or campaign card does when its button is pressed. */
export type PlannerAction =
  | {
      kind: 'plan.apply'
      projectId: string
      goal: string
      plan: ExperimentPlan
    }
  | { kind: 'campaign.start'; recordId: string }
  | { kind: 'campaign.round'; recordId: string }
  | { kind: 'campaign.approve'; roundId: string; recordId: string }
  | {
      kind: 'campaign.results'
      roundId: string
      recordId: string
      results: Array<{ trial: number; results: Record<string, number> }>
    }

export type PlannerActionKind = PlannerAction['kind']

const KINDS: readonly string[] = [
  'plan.apply',
  'campaign.start',
  'campaign.round',
  'campaign.approve',
  'campaign.results',
]

export function isPlannerAction(action: {
  kind: string
}): action is PlannerAction {
  return KINDS.includes(action.kind)
}

export interface PlannerActionResult {
  openHref?: string
}
