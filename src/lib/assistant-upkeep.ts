import { z } from 'zod'

/**
 * Keeping the lab tidy from the assistant: start a project, follow a record or
 * project, mark notifications read, move a reagent order on or cancel it,
 * cancel a shipment, reserve some of a sample for an experiment, quarantine or
 * dispose of a sample, and log a service visit.
 *
 * Like the other cards, the model names things the way people do, the server
 * finds them and sends back a card, and nothing happens until the person
 * presses the button. The button calls the ordinary RPC as the signed-in
 * person, so permissions, versions and the audit trail are the page's own.
 * Signing, approving, deciding requests and releasing samples stay with people.
 */

export const PROJECT_CREATE_TOOL = 'sheetbase.project.create'
export const FOLLOW_TOOL = 'sheetbase.follow'
export const NOTIFICATIONS_READ_TOOL = 'sheetbase.inbox.mark_read'
export const REAGENT_UPDATE_TOOL = 'sheetbase.reagent.update'
export const SHIPMENT_CANCEL_TOOL = 'sheetbase.shipment.cancel'
export const SAMPLE_RESERVE_TOOL = 'sheetbase.sample.reserve'
export const SAMPLE_QUARANTINE_TOOL = 'sheetbase.sample.quarantine'
export const SAMPLE_DISPOSE_TOOL = 'sheetbase.sample.dispose'
export const INSTRUMENT_LOG_TOOL = 'sheetbase.instrument.log_service'
export const ABSENCE_SET_TOOL = 'sheetbase.absence.set'
export const ABSENCE_CANCEL_TOOL = 'sheetbase.absence.cancel'
export const HANDOVER_TOOL = 'sheetbase.handover.start'
export const GROUP_ROLE_SET_TOOL = 'sheetbase.group_role.set'
export const GROUP_ROLE_REMOVE_TOOL = 'sheetbase.group_role.remove'
export const SCIM_TOKEN_REVOKE_TOOL = 'sheetbase.scim_token.revoke'
export const TIMESTAMPS_SET_TOOL = 'sheetbase.timestamps.set'
export const TIMESTAMPS_RETRY_TOOL = 'sheetbase.timestamps.retry'

export const UPKEEP_PROPOSE_TOOL_NAMES = [
  PROJECT_CREATE_TOOL,
  FOLLOW_TOOL,
  NOTIFICATIONS_READ_TOOL,
  REAGENT_UPDATE_TOOL,
  SHIPMENT_CANCEL_TOOL,
  SAMPLE_RESERVE_TOOL,
  SAMPLE_QUARANTINE_TOOL,
  SAMPLE_DISPOSE_TOOL,
  INSTRUMENT_LOG_TOOL,
  ABSENCE_SET_TOOL,
  ABSENCE_CANCEL_TOOL,
  HANDOVER_TOOL,
  GROUP_ROLE_SET_TOOL,
  GROUP_ROLE_REMOVE_TOOL,
  SCIM_TOKEN_REVOKE_TOOL,
  TIMESTAMPS_SET_TOOL,
  TIMESTAMPS_RETRY_TOOL,
] as const

export type UpkeepProposeToolName = (typeof UPKEEP_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const sampleRef = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The sample as the person names it: its identifier (S-0142) or name.',
  )

export const proposeProjectCreateSchema = z
  .object({
    title,
    summary,
    projectName: z
      .string()
      .min(1)
      .max(200)
      .describe('The name of the new project, in the person’s words.'),
    startedOn: day.optional().describe('When it starts, if they said.'),
  })
  .strict()

export const proposeFollowSchema = z
  .object({
    title,
    summary,
    target: z.enum(['record', 'project']),
    name: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The record by identifier (EXP-12) or title, or the project by name or key.',
      ),
    follow: z
      .boolean()
      .optional()
      .describe('false to stop following. Default true.'),
  })
  .strict()

export const proposeNotificationsReadSchema = z
  .object({ title, summary })
  .strict()

export const proposeReagentUpdateSchema = z
  .object({
    title,
    summary,
    order: z
      .string()
      .min(1)
      .max(200)
      .describe('The order by number (RO-0012) or words from the material.'),
    change: z
      .enum(['ordered', 'cancelled'])
      .describe(
        'ordered: it has now been placed with the supplier. cancelled: it is not needed.',
      ),
    supplier: z.string().max(200).optional(),
    orderReference: z
      .string()
      .max(200)
      .optional()
      .describe('The supplier’s order or PO number.'),
    expectedOn: day.optional().describe('When it should arrive.'),
    reason: z.string().max(400).optional().describe('Why, for a cancellation.'),
  })
  .strict()

export const proposeShipmentCancelSchema = z
  .object({
    title,
    summary,
    shipment: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The shipment by number (SHP-0012) or words from who it is for.',
      ),
    reason: z.string().max(400).optional(),
  })
  .strict()

export const proposeSampleReserveSchema = z
  .object({
    title,
    summary,
    sample: sampleRef,
    experiment: z
      .string()
      .min(1)
      .max(200)
      .describe('The experiment it is held for, by identifier or title.'),
    quantity: z.number().positive(),
    notes: z.string().max(400).optional(),
  })
  .strict()

export const proposeSampleRetireSchema = z
  .object({
    title,
    summary,
    sample: sampleRef,
    reason: z
      .string()
      .min(1)
      .max(400)
      .describe('Why, in the person’s words. Ask if they have not said.'),
    notes: z.string().max(400).optional(),
  })
  .strict()

export const proposeInstrumentLogSchema = z
  .object({
    title,
    summary,
    instrument: z.string().min(1).max(200),
    kind: z.enum(['repair', 'service', 'inspection', 'other']),
    visitedOn: day.describe('The day of the visit.'),
    summaryOfWork: z
      .string()
      .min(1)
      .max(400)
      .describe('One line on what was done.'),
    details: z.string().max(2_000).optional(),
    performedBy: z
      .string()
      .max(200)
      .optional()
      .describe('Who did it, such as the engineer or company.'),
  })
  .strict()

export const proposeAbsenceSetSchema = z
  .object({
    title,
    summary,
    from: day
      .optional()
      .describe('First day away, YYYY-MM-DD. Defaults to today.'),
    until: day.describe('The last day away, YYYY-MM-DD.'),
    cover: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'The colleague who covers reviews while they are away, by name. Leave out if they did not name one.',
      ),
    note: z.string().max(500).optional(),
  })
  .strict()

export const proposeAbsenceCancelSchema = z.object({ title, summary }).strict()

export const proposeHandoverSchema = z
  .object({
    title,
    summary,
    to: z
      .string()
      .min(1)
      .max(200)
      .describe('The colleague who takes over, by name.'),
    from: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Whose work moves, by name. Leave out when the person is handing over their own work.',
      ),
  })
  .strict()

export const proposeTimestampsSetSchema = z
  .object({
    title,
    summary,
    service: z
      .enum(['off', 'dfn', 'digicert', 'custom'])
      .describe(
        'Which independent time-stamping service confirms when signatures were made, or off to stop.',
      ),
    address: z
      .string()
      .max(500)
      .optional()
      .describe('The service address, only for custom (http:// or https://).'),
  })
  .strict()

export const proposeTimestampsRetrySchema = z
  .object({
    title,
    summary,
    signatureId: z
      .string()
      .uuid()
      .describe('A signature that gave up, from the timestamps list.'),
  })
  .strict()

export const proposeGroupRoleSetSchema = z
  .object({
    title,
    summary,
    group: z
      .string()
      .min(1)
      .max(200)
      .describe('The sign-in group as the identity provider spells it.'),
    role: z.enum([
      'admin',
      'steward',
      'scientist',
      'analyst',
      'reviewer',
      'viewer',
    ]),
  })
  .strict()

export const proposeGroupRoleRemoveSchema = z
  .object({
    title,
    summary,
    group: z.string().min(1).max(200),
  })
  .strict()

export const proposeScimTokenRevokeSchema = z
  .object({
    title,
    summary,
    /** The label the token was given when it was made. */
    token: z.string().min(1).max(200),
  })
  .strict()

/** What an upkeep card does when its button is pressed. */
export type UpkeepAction =
  | { kind: 'project.create'; title: string; startedOn: string | null }
  | {
      kind: 'follow.set'
      target: 'record' | 'project'
      id: string
      following: boolean
    }
  | { kind: 'notifications.read' }
  | {
      kind: 'reagent.ordered'
      orderId: string
      supplier: string | null
      orderReference: string | null
      expectedOn: string | null
    }
  | { kind: 'reagent.cancel'; orderId: string; reason: string | null }
  | { kind: 'shipment.cancel'; shipmentId: string; reason: string }
  | {
      kind: 'sample.reserve'
      recordId: string
      experimentId: string
      quantity: number
      unit: string | null
      notes: string | null
    }
  | {
      kind: 'sample.quarantine'
      recordId: string
      expectedMetadataVersion: number
      reason: string
      notes: string | null
    }
  | {
      kind: 'sample.dispose'
      recordId: string
      expectedMetadataVersion: number
      reason: string
      notes: string | null
    }
  | {
      kind: 'instrument.log'
      instrumentId: string
      serviceKind: 'repair' | 'service' | 'inspection' | 'other'
      visitedOn: string
      summary: string
      details: string | null
      performedBy: string | null
    }
  | {
      kind: 'absence.set'
      workspaceId: string
      startsOn: string
      endsOn: string
      delegateUserId: string | null
      note: string | null
    }
  | { kind: 'absence.cancel'; absenceId: string }
  | {
      kind: 'handover.run'
      workspaceId: string
      fromUserId: string
      toUserId: string
      selection: string[]
    }
  | {
      kind: 'group_role.set'
      workspaceId: string
      groupName: string
      role: string
    }
  | { kind: 'group_role.remove'; mappingId: string }
  | { kind: 'scim_token.revoke'; tokenId: string }
  | {
      kind: 'timestamps.set'
      workspaceId: string
      service: 'off' | 'dfn' | 'digicert' | 'custom'
      address: string | null
    }
  | { kind: 'timestamps.retry'; signatureId: string }

export type UpkeepActionKind = UpkeepAction['kind']

const KINDS: readonly string[] = [
  'project.create',
  'follow.set',
  'notifications.read',
  'reagent.ordered',
  'reagent.cancel',
  'shipment.cancel',
  'sample.reserve',
  'sample.quarantine',
  'sample.dispose',
  'instrument.log',
  'absence.set',
  'absence.cancel',
  'handover.run',
  'group_role.set',
  'group_role.remove',
  'scim_token.revoke',
  'timestamps.set',
  'timestamps.retry',
]

export function isUpkeepAction(action: {
  kind: string
}): action is UpkeepAction {
  return KINDS.includes(action.kind)
}

/** What running a card gave back, for the card to link to. */
export interface UpkeepActionResult {
  openHref?: string
}
