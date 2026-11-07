import { z } from 'zod'

/**
 * Robots and the lab scheduler from the assistant: send a worklist to a robot,
 * ask for a schedule for an experiment's parts, and accept a proposed
 * schedule. Writing or fixing analysis code is the ordinary "insert a notebook
 * block" and "update a notebook block" cards with a `code_cell` block. Like the
 * other cards, the model names things the way people do, the server finds them
 * and sends back a card, and nothing happens until the person presses the
 * button. A job sent to a robot waits for a person to press Start in Sheetbase:
 * the assistant never starts one.
 */

export const ROBOT_SEND_TOOL = 'sheetbase.robot.send_worklist'
export const SCHEDULE_PLAN_TOOL = 'sheetbase.schedule.plan'
export const SCHEDULE_ACCEPT_TOOL = 'sheetbase.schedule.accept'

export const AUTOMATION_PROPOSE_TOOL_NAMES = [
  ROBOT_SEND_TOOL,
  SCHEDULE_PLAN_TOOL,
  SCHEDULE_ACCEPT_TOOL,
] as const

export type AutomationProposeToolName =
  (typeof AUTOMATION_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeRobotSendSchema = z
  .object({
    title,
    summary,
    worklist: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The worklist by its name or number such as WL-0004. It must be planned, not yet completed.',
      ),
    robot: z
      .string()
      .min(1)
      .max(200)
      .describe('The robot instrument, by name or INS number.'),
    note: z
      .string()
      .max(500)
      .optional()
      .describe('A note for the person who presses Start.'),
  })
  .strict()

export const proposeSchedulePlanSchema = z
  .object({
    title,
    summary,
    experiment: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The experiment by identifier such as EXP-0145 or by title. It must be split into parts.',
      ),
  })
  .strict()

export const proposeScheduleAcceptSchema = z
  .object({
    title,
    summary,
    experiment: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The experiment whose latest proposed schedule to accept, by identifier or title.',
      ),
  })
  .strict()

/** What an automation card does when its button is pressed. */
export type AutomationAction =
  | {
      kind: 'robot.send'
      worklistId: string
      instrumentId: string
      note: string | null
    }
  | { kind: 'schedule.plan'; recordId: string }
  | { kind: 'schedule.accept'; proposalId: string; recordId: string }

export type AutomationActionKind = AutomationAction['kind']

const KINDS: readonly string[] = [
  'robot.send',
  'schedule.plan',
  'schedule.accept',
]

export function isAutomationAction(action: {
  kind: string
}): action is AutomationAction {
  return KINDS.includes(action.kind)
}

export interface AutomationActionResult {
  openHref?: string
}
