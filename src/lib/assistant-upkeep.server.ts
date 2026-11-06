import type { z } from 'zod'

import {
  ABSENCE_CANCEL_TOOL,
  ABSENCE_SET_TOOL,
  FOLLOW_TOOL,
  GROUP_ROLE_REMOVE_TOOL,
  SCIM_TOKEN_REVOKE_TOOL,
  GROUP_ROLE_SET_TOOL,
  TIMESTAMPS_RETRY_TOOL,
  TIMESTAMPS_SET_TOOL,
  proposeTimestampsRetrySchema,
  proposeTimestampsSetSchema,
  HANDOVER_TOOL,
  INSTRUMENT_LOG_TOOL,
  NOTIFICATIONS_READ_TOOL,
  PROJECT_CREATE_TOOL,
  REAGENT_UPDATE_TOOL,
  SAMPLE_DISPOSE_TOOL,
  SAMPLE_QUARANTINE_TOOL,
  SAMPLE_RESERVE_TOOL,
  SHIPMENT_CANCEL_TOOL,
  UPKEEP_PROPOSE_TOOL_NAMES,
  proposeAbsenceCancelSchema,
  proposeAbsenceSetSchema,
  proposeFollowSchema,
  proposeGroupRoleRemoveSchema,
  proposeScimTokenRevokeSchema,
  proposeGroupRoleSetSchema,
  proposeHandoverSchema,
  proposeInstrumentLogSchema,
  proposeNotificationsReadSchema,
  proposeProjectCreateSchema,
  proposeReagentUpdateSchema,
  proposeSampleReserveSchema,
  proposeSampleRetireSchema,
  proposeShipmentCancelSchema,
} from './assistant-upkeep'
import type { UpkeepAction, UpkeepProposeToolName } from './assistant-upkeep'
import {
  findExperiment,
  instrumentLabel,
  invalid,
  likeValue,
  memberNames,
  resolveInstrument,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { DataClient } from './data-client'
import { fetchTimestampSettings } from './timestamps/client'
import { shipmentReference } from './shipments'
import { toHandoverItems } from './handover'
import type { HandoverItemWire } from './handover'
import { WORKSPACE_ROLE_LABELS } from './workspace-admin'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for keeping the lab tidy (see `assistant-upkeep.ts`). Each builder
 * finds what the person named under their own access, checks what it can, and
 * returns a card saying exactly what will change. Nothing is written here.
 */

export type UpkeepOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isUpkeepProposalTool(
  name: string,
): name is UpkeepProposeToolName {
  return (UPKEEP_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function upkeepProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      PROJECT_CREATE_TOOL,
      `Propose starting a new project. ${NOTE}`,
      proposeProjectCreateSchema,
    ),
    toolDef(
      FOLLOW_TOOL,
      `Propose following a record or a project (or stopping), so it shows in the person’s Inbox and they hear about new comments. ${NOTE}`,
      proposeFollowSchema,
    ),
    toolDef(
      NOTIFICATIONS_READ_TOOL,
      `Propose marking all of the person’s notifications as read, such as when they ask to clear their inbox. ${NOTE}`,
      proposeNotificationsReadSchema,
    ),
    toolDef(
      REAGENT_UPDATE_TOOL,
      `Propose marking a reagent order as placed with the supplier, or cancelling it. ${NOTE}`,
      proposeReagentUpdateSchema,
    ),
    toolDef(
      SHIPMENT_CANCEL_TOOL,
      `Propose cancelling a shipment that has not arrived. ${NOTE}`,
      proposeShipmentCancelSchema,
    ),
    toolDef(
      SAMPLE_RESERVE_TOOL,
      `Propose holding back some of a sample for an experiment, so others cannot use it up. ${NOTE}`,
      proposeSampleReserveSchema,
    ),
    toolDef(
      SAMPLE_QUARANTINE_TOOL,
      `Propose quarantining a sample, with the reason. It stays on record but cannot be used. ${NOTE}`,
      proposeSampleRetireSchema,
    ),
    toolDef(
      SAMPLE_DISPOSE_TOOL,
      `Propose recording that a sample was disposed of, with the reason. This cannot be undone, so ask first if the person has not clearly said so. ${NOTE}`,
      proposeSampleRetireSchema,
    ),
    toolDef(
      INSTRUMENT_LOG_TOOL,
      `Propose adding a repair, service or inspection visit to an instrument’s history. ${NOTE}`,
      proposeInstrumentLogSchema,
    ),
    toolDef(
      ABSENCE_SET_TOOL,
      `Propose setting the person’s own out of office: the dates they are away and, if they name one, the colleague who covers the reviews waiting on them. ${NOTE}`,
      proposeAbsenceSetSchema,
    ),
    toolDef(
      ABSENCE_CANCEL_TOOL,
      `Propose cancelling the person’s own out of office, such as when they are back early or their plans changed. ${NOTE}`,
      proposeAbsenceCancelSchema,
    ),
    toolDef(
      HANDOVER_TOOL,
      `Propose handing a person's open work (assigned records, tasks, reviews waiting, instruments) to a colleague, for someone leaving or for the person's own work. ${NOTE}`,
      proposeHandoverSchema,
    ),
    toolDef(
      GROUP_ROLE_SET_TOOL,
      `Propose that a sign-in group gives a role, so people in that group get it when they sign in. For people who manage members. ${NOTE}`,
      proposeGroupRoleSetSchema,
    ),
    toolDef(
      GROUP_ROLE_REMOVE_TOOL,
      `Propose removing a sign-in group's role mapping. ${NOTE}`,
      proposeGroupRoleRemoveSchema,
    ),
    toolDef(
      SCIM_TOKEN_REVOKE_TOOL,
      `Propose switching off a directory sync token, so the identity provider can no longer add, change or suspend people. For people who manage members. ${NOTE}`,
      proposeScimTokenRevokeSchema,
    ),
    toolDef(
      TIMESTAMPS_SET_TOOL,
      `Propose choosing the independent time-stamping service that confirms when signatures were made, or turning it off. Only a fingerprint of each signature record is sent to the service. For people who manage the audit settings. ${NOTE}`,
      proposeTimestampsSetSchema,
    ),
    toolDef(
      TIMESTAMPS_RETRY_TOOL,
      `Propose asking again for a timestamp on a signature whose timestamp gave up. List the timestamps area first for its id. ${NOTE}`,
      proposeTimestampsRetrySchema,
    ),
  ]
}

// ---------------------------------------------------------------------------
// Lookups by the words people use.
// ---------------------------------------------------------------------------

export type Lookup<T> = { ok: true; value: T } | { ok: false; message: string }

export function pick<T>(
  rows: readonly T[],
  wanted: string,
  what: string,
  label: (row: T) => string,
  exact: (row: T) => boolean,
): Lookup<T> {
  const exacts = rows.filter(exact)
  if (exacts.length === 1) return { ok: true, value: exacts[0] }
  if (rows.length === 1) return { ok: true, value: rows[0] }
  if (rows.length === 0) {
    return { ok: false, message: `No ${what} matches "${wanted}".` }
  }
  return {
    ok: false,
    message: `More than one ${what} matches "${wanted}": ${rows
      .slice(0, 8)
      .map(label)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

export interface SampleRow {
  id: string
  identifier: string
  title: string
  status: string
  metadata_version: number
  properties: Record<string, unknown> | null
}

export async function findSample(
  client: DataClient,
  text: string,
): Promise<Lookup<SampleRow>> {
  const like = likeValue(text)
  const rows = await client.list<SampleRow>(
    'records',
    `?kind=eq.sample&deleted_at=is.null&archived_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,status,metadata_version,properties&order=updated_at.desc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  return pick(
    rows,
    text,
    'sample',
    (row) => `${row.identifier} ${row.title}`,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

export const sampleLabel = (row: SampleRow) =>
  `${row.identifier} · ${row.title}`

export function amountOf(row: SampleRow): {
  quantity: number | null
  unit: string
} {
  const props = row.properties ?? {}
  return {
    quantity: typeof props.quantity === 'number' ? props.quantity : null,
    unit: typeof props.quantityUnit === 'string' ? props.quantityUnit : '',
  }
}

export const withUnit = (quantity: number, unit: string) =>
  `${quantity}${unit ? ` ${unit}` : ''}`

export const sentence = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

const orderReference = (number: number) =>
  `RO-${String(number).padStart(4, '0')}`

export function parse<T extends z.ZodType>(
  schema: T,
  args: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; message: string } {
  const parsed = schema.safeParse(args)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, message: invalid(parsed.error) }
}

function card(
  tool: UpkeepProposeToolName,
  input: { title: string; summary: string },
  rest: {
    target: string
    deepLink: string | null
    changes: ProposalChange[]
    action: UpkeepAction
  },
): UpkeepOutcome {
  return {
    ok: true,
    proposal: {
      tool,
      title: input.title,
      summary: input.summary,
      ...rest,
    },
  }
}

const roleLabel = (role: string): string =>
  (WORKSPACE_ROLE_LABELS as Record<string, string | undefined>)[role] ?? role

const fail = (message: string): UpkeepOutcome => ({ ok: false, message })

async function findOpenOrder(
  client: DataClient,
  text: string,
  statuses: string,
): Promise<
  Lookup<{
    id: string
    number: number
    material_title: string
    status: string
    quantity: string | number
    unit: string | null
    supplier: string | null
  }>
> {
  const number = /^RO-?(\d+)$/i.exec(text.trim())
  const rows = await client.list<{
    id: string
    number: number
    material_title: string
    status: string
    quantity: string | number
    unit: string | null
    supplier: string | null
  }>(
    'reagent_orders',
    `?status=in.(${statuses})&${
      number
        ? `number=eq.${Number(number[1])}`
        : `material_title=ilike.${likeValue(text)}`
    }&select=id,number,material_title,status,quantity,unit,supplier&order=number.desc&limit=6`,
  )
  return pick(
    rows,
    text,
    'open order',
    (row) => `${orderReference(row.number)} ${row.material_title}`,
    (row) => number !== null && row.number === Number(number[1]),
  )
}

export async function buildUpkeepProposal(
  name: UpkeepProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<UpkeepOutcome> {
  const { client, workspaceId } = context
  switch (name) {
    case PROJECT_CREATE_TOOL: {
      const parsed = parse(proposeProjectCreateSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const same = await client.list<{ id: string; title: string }>(
        'projects',
        `?title=ilike.${encodeURIComponent(input.projectName.trim().replaceAll(/[*,()"\\]/g, ' '))}&select=id,title&limit=3`,
      )
      if (
        same.some(
          (row) =>
            row.title.toLowerCase() === input.projectName.trim().toLowerCase(),
        )
      ) {
        return fail(
          `There is already a project called "${input.projectName}". Ask whether they meant that one.`,
        )
      }
      const changes: ProposalChange[] = [
        { label: 'Project', before: null, after: input.projectName.trim() },
      ]
      if (input.startedOn) {
        changes.push({ label: 'Starts', before: null, after: input.startedOn })
      }
      return card(name, input, {
        target: input.projectName.trim(),
        deepLink: '/projects',
        changes,
        action: {
          kind: 'project.create',
          title: input.projectName.trim(),
          startedOn: input.startedOn ?? null,
        },
      })
    }

    case ABSENCE_SET_TOOL: {
      const parsed = parse(proposeAbsenceSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const todayLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: context.timeZone,
      }).format(new Date())
      const startsOn = input.from ?? todayLocal
      if (input.until < startsOn) {
        return fail(
          'The last day away is before the first. Ask which dates they meant.',
        )
      }
      if (input.until < todayLocal) {
        return fail('Those dates are already past. Ask which dates they meant.')
      }
      let delegate: { id: string; name: string } | null = null
      if (input.cover) {
        const members = await memberNames(client)
        const lower = input.cover.trim().toLowerCase()
        const words = lower.split(/\s+/).filter(Boolean)
        const matches = [...members.entries()]
          .map(([id, personName]) => ({ id, name: personName }))
          .filter(
            (member) =>
              member.id !== context.userId &&
              words.every((word) => member.name.toLowerCase().includes(word)),
          )
        const found = pick(
          matches,
          input.cover,
          'colleague',
          (row) => row.name,
          (row) => row.name.toLowerCase() === lower,
        )
        if (!found.ok) return fail(found.message)
        delegate = found.value
      }
      const changes: ProposalChange[] = [
        { label: 'First day away', before: null, after: startsOn },
        { label: 'Back after', before: null, after: input.until },
        {
          label: 'Reviews covered by',
          before: null,
          after: delegate?.name ?? 'No one',
        },
      ]
      if (input.note?.trim()) {
        changes.push({ label: 'Note', before: null, after: input.note.trim() })
      }
      return card(name, input, {
        target: 'Out of office',
        deepLink: '/settings/account/away',
        changes,
        action: {
          kind: 'absence.set',
          workspaceId,
          startsOn,
          endsOn: input.until,
          delegateUserId: delegate?.id ?? null,
          note: input.note?.trim() || null,
        },
      })
    }

    case HANDOVER_TOOL: {
      const parsed = parse(proposeHandoverSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const members = await memberNames(client)
      const find = (text: string, skipSelf: boolean) => {
        const lower = text.trim().toLowerCase()
        const words = lower.split(/\s+/).filter(Boolean)
        const matches = [...members.entries()]
          .map(([id, personName]) => ({ id, name: personName }))
          .filter(
            (member) =>
              !(skipSelf && member.id === context.userId) &&
              words.every((word) => member.name.toLowerCase().includes(word)),
          )
        return pick(
          matches,
          text,
          'colleague',
          (row) => row.name,
          (row) => row.name.toLowerCase() === lower,
        )
      }
      const to = find(input.to, true)
      if (!to.ok) return fail(to.message)
      let from = {
        id: context.userId,
        name: members.get(context.userId) ?? 'You',
      }
      if (input.from) {
        const found = find(input.from, false)
        if (!found.ok) return fail(found.message)
        from = found.value
      }
      if (from.id === to.value.id) {
        return fail('Work cannot be handed to the same person.')
      }
      const rows = await client.rpc<HandoverItemWire[]>(
        'preview_member_handover',
        { p_workspace_id: workspaceId, p_user_id: from.id },
      )
      const items = toHandoverItems(rows).filter((item) => item.count > 0)
      if (items.length === 0) {
        return fail(`${from.name} has no open work to hand over.`)
      }
      return card(name, input, {
        target: `${from.name} to ${to.value.name}`,
        deepLink: '/settings/workspace/members',
        changes: items.map((item) => ({
          label: item.label,
          before: `${item.count} with ${from.name}`,
          after: `${item.count} with ${to.value.name}`,
        })),
        action: {
          kind: 'handover.run',
          workspaceId,
          fromUserId: from.id,
          toUserId: to.value.id,
          selection: items.map((item) => item.key),
        },
      })
    }

    case GROUP_ROLE_SET_TOOL: {
      const parsed = parse(proposeGroupRoleSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const existing = await client.list<{ role: string }>(
        'idp_group_mappings',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&group_name=ilike.${likeValue(input.group)}&select=role&limit=1`,
      )
      return card(name, input, {
        target: input.group.trim(),
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: `Sign-in group ${input.group.trim()}`,
            before: existing[0] ? roleLabel(existing[0].role) : null,
            after: WORKSPACE_ROLE_LABELS[input.role],
          },
        ],
        action: {
          kind: 'group_role.set',
          workspaceId,
          groupName: input.group.trim(),
          role: input.role,
        },
      })
    }

    case TIMESTAMPS_SET_TOOL: {
      const parsed = parse(proposeTimestampsSetSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      if (
        input.service === 'custom' &&
        !/^https?:\/\/\S+$/.test(input.address ?? '')
      ) {
        return fail(
          'A time-stamping service of your own needs its address, starting with http:// or https://.',
        )
      }
      const current = await fetchTimestampSettings(client, workspaceId)
      const nameOf = (service: string | null) =>
        service === 'dfn'
          ? 'DFN-Verein'
          : service === 'digicert'
            ? 'DigiCert'
            : service === 'custom'
              ? 'Their own service'
              : 'Off'
      return card(name, input, {
        target: 'Trusted timestamps',
        deepLink: '/settings/workspace/audit',
        changes: [
          {
            label: 'Time-stamping service',
            before: nameOf(current.enabled ? current.authority : null),
            after:
              input.service === 'custom'
                ? `Their own service (${input.address})`
                : nameOf(input.service === 'off' ? null : input.service),
          },
        ],
        action: {
          kind: 'timestamps.set',
          workspaceId,
          service: input.service,
          address: input.service === 'custom' ? (input.address ?? null) : null,
        },
      })
    }

    case TIMESTAMPS_RETRY_TOOL: {
      const parsed = parse(proposeTimestampsRetrySchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        signature_id: string
        status: string
        attempts: number
      }>(
        'signature_timestamps',
        `?signature_id=eq.${encodeURIComponent(input.signatureId)}&select=signature_id,status,attempts&limit=1`,
      )
      if (!rows[0]) return fail('That signature has no timestamp to retry.')
      if (rows[0].status === 'stamped') {
        return fail('That signature is already timestamped.')
      }
      return card(name, input, {
        target: 'Signature timestamp',
        deepLink: '/settings/workspace/audit',
        changes: [
          {
            label: 'Timestamp',
            before: `Gave up after ${rows[0].attempts} tries`,
            after: 'Asked for again',
          },
        ],
        action: {
          kind: 'timestamps.retry',
          signatureId: input.signatureId,
        },
      })
    }

    case GROUP_ROLE_REMOVE_TOOL: {
      const parsed = parse(proposeGroupRoleRemoveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        group_name: string
        role: string
      }>(
        'idp_group_mappings',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&group_name=ilike.${likeValue(input.group)}&select=id,group_name,role&limit=6`,
      )
      const lower = input.group.trim().toLowerCase()
      const found = pick(
        rows,
        input.group,
        'sign-in group',
        (row) => row.group_name,
        (row) => row.group_name.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      return card(name, input, {
        target: found.value.group_name,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: `Sign-in group ${found.value.group_name}`,
            before: roleLabel(found.value.role),
            after: 'No role from this group',
          },
        ],
        action: { kind: 'group_role.remove', mappingId: found.value.id },
      })
    }

    case SCIM_TOKEN_REVOKE_TOOL: {
      const parsed = parse(proposeScimTokenRevokeSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const rows = await client.list<{
        id: string
        label: string
        last_used_at: string | null
      }>(
        'scim_tokens',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&revoked_at=is.null&label=ilike.${likeValue(input.token)}&select=id,label,last_used_at&limit=6`,
      )
      const lower = input.token.trim().toLowerCase()
      const found = pick(
        rows,
        input.token,
        'directory sync token',
        (row) => row.label,
        (row) => row.label.toLowerCase() === lower,
      )
      if (!found.ok) return fail(found.message)
      return card(name, input, {
        target: found.value.label,
        deepLink: '/settings/workspace/members',
        changes: [
          {
            label: `Directory sync token ${found.value.label}`,
            before: found.value.last_used_at
              ? `Last used ${found.value.last_used_at.slice(0, 10)}`
              : 'Never used',
            after: 'Switched off',
          },
        ],
        action: { kind: 'scim_token.revoke', tokenId: found.value.id },
      })
    }

    case ABSENCE_CANCEL_TOOL: {
      const parsed = parse(proposeAbsenceCancelSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const todayLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: context.timeZone,
      }).format(new Date())
      const rows = await client.list<{
        id: string
        starts_on: string
        ends_on: string
      }>(
        'member_absences',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(context.userId)}&cancelled_at=is.null&ends_on=gte.${todayLocal}&order=starts_on.asc&limit=1&select=id,starts_on,ends_on`,
      )
      if (rows.length === 0) return fail('They have no out of office set.')
      return card(name, parsed.data, {
        target: 'Out of office',
        deepLink: '/settings/account/away',
        changes: [
          {
            label: 'Out of office',
            before: `${rows[0].starts_on} to ${rows[0].ends_on}`,
            after: 'Cancelled',
          },
        ],
        action: { kind: 'absence.cancel', absenceId: rows[0].id },
      })
    }

    case FOLLOW_TOOL: {
      const parsed = parse(proposeFollowSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const following = input.follow ?? true
      const like = likeValue(input.name)
      const lower = input.name.trim().toLowerCase()
      let found: Lookup<{ id: string; label: string }>
      if (input.target === 'project') {
        const rows = await client.list<{
          id: string
          key: string
          title: string
        }>(
          'projects',
          `?archived_at=is.null&or=(key.ilike.${like},title.ilike.${like})&select=id,key,title&order=title.asc&limit=6`,
        )
        found = pick(
          rows.map((row) => ({
            id: row.id,
            label: row.title,
            key: row.key.toLowerCase(),
          })),
          input.name,
          'project',
          (row) => row.label,
          (row) => row.key === lower || row.label.toLowerCase() === lower,
        )
      } else {
        const rows = await client.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=6`,
        )
        found = pick(
          rows.map((row) => ({
            id: row.id,
            label: `${row.identifier} · ${row.title}`,
            identifier: row.identifier.toLowerCase(),
            title: row.title.toLowerCase(),
          })),
          input.name,
          'record',
          (row) => row.label,
          (row) => row.identifier === lower || row.title === lower,
        )
      }
      if (!found.ok) return fail(found.message)
      const already = await client.list<Record<string, string>>(
        input.target === 'project' ? 'project_follows' : 'work_item_follows',
        `?${input.target === 'project' ? 'project_id' : 'record_id'}=eq.${encodeURIComponent(found.value.id)}&select=${input.target === 'project' ? 'project_id' : 'record_id'}&limit=1`,
      )
      if (following && already.length > 0) {
        return fail(`The person already follows ${found.value.label}.`)
      }
      if (!following && already.length === 0) {
        return fail(`The person does not follow ${found.value.label}.`)
      }
      return card(name, input, {
        target: found.value.label,
        deepLink:
          input.target === 'project'
            ? `/projects/${found.value.id}`
            : `/records/${found.value.id}`,
        changes: [
          {
            label: 'Following',
            before: following ? 'No' : 'Yes',
            after: following ? 'Yes' : 'No',
          },
        ],
        action: {
          kind: 'follow.set',
          target: input.target,
          id: found.value.id,
          following,
        },
      })
    }

    case NOTIFICATIONS_READ_TOOL: {
      const parsed = parse(proposeNotificationsReadSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const unread = await client.list<{ id: string }>(
        'my_notifications',
        '?read_at=is.null&select=id&limit=500',
      )
      if (unread.length === 0) {
        return fail('There is nothing unread to mark as read. Tell the person.')
      }
      return card(name, parsed.data, {
        target: 'Notifications',
        deepLink: '/inbox',
        changes: [
          {
            label: 'Unread',
            before: String(unread.length),
            after: '0',
          },
        ],
        action: { kind: 'notifications.read' },
      })
    }

    case REAGENT_UPDATE_TOOL: {
      const parsed = parse(proposeReagentUpdateSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await findOpenOrder(
        client,
        input.order,
        input.change === 'ordered' ? 'requested' : 'requested,ordered',
      )
      if (!found.ok) return fail(found.message)
      const order = found.value
      const quantity = withUnit(Number(order.quantity), order.unit ?? '')
      const changes: ProposalChange[] = [
        {
          label: 'Material',
          before: null,
          after: `${order.material_title} (${quantity})`,
        },
        {
          label: 'Status',
          before: order.status === 'requested' ? 'Requested' : 'Ordered',
          after: input.change === 'ordered' ? 'Ordered' : 'Cancelled',
        },
      ]
      if (input.change === 'ordered') {
        if (input.supplier) {
          changes.push({
            label: 'Supplier',
            before: order.supplier,
            after: input.supplier,
          })
        }
        if (input.orderReference) {
          changes.push({
            label: 'Order number',
            before: null,
            after: input.orderReference,
          })
        }
        if (input.expectedOn) {
          changes.push({
            label: 'Expected',
            before: null,
            after: input.expectedOn,
          })
        }
      } else if (input.reason) {
        changes.push({ label: 'Reason', before: null, after: input.reason })
      }
      return card(name, input, {
        target: orderReference(order.number),
        deepLink: '/materials',
        changes,
        action:
          input.change === 'ordered'
            ? {
                kind: 'reagent.ordered',
                orderId: order.id,
                supplier: input.supplier ?? null,
                orderReference: input.orderReference ?? null,
                expectedOn: input.expectedOn ?? null,
              }
            : {
                kind: 'reagent.cancel',
                orderId: order.id,
                reason: input.reason?.trim() || null,
              },
      })
    }

    case SHIPMENT_CANCEL_TOOL: {
      const parsed = parse(proposeShipmentCancelSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const number = /^SHP-?(\d+)$/i.exec(input.shipment.trim())
      const rows = await client.list<{
        id: string
        number: number
        direction: string
        status: string
        counterparty: string
      }>(
        'shipments',
        `?${
          number
            ? `number=eq.${Number(number[1])}`
            : `counterparty=ilike.${likeValue(input.shipment)}`
        }&select=id,number,direction,status,counterparty&order=number.desc&limit=8`,
      )
      const open = rows.filter(
        (row) => row.status === 'draft' || row.status === 'in_transit',
      )
      if (open.length === 0) {
        return fail(
          rows.length > 0
            ? `${shipmentReference(rows[0].number)} is already ${rows[0].status.replaceAll('_', ' ')}, so it cannot be cancelled.`
            : `No shipment matches "${input.shipment}".`,
        )
      }
      const found = pick(
        open,
        input.shipment,
        'open shipment',
        (row) => `${shipmentReference(row.number)} ${row.counterparty}`,
        (row) => number !== null && row.number === Number(number[1]),
      )
      if (!found.ok) return fail(found.message)
      const shipment = found.value
      const changes: ProposalChange[] = [
        {
          label: shipment.direction === 'inbound' ? 'From' : 'To',
          before: null,
          after: shipment.counterparty,
        },
        {
          label: 'Status',
          before: sentence(shipment.status.replaceAll('_', ' ')),
          after: 'Cancelled',
        },
      ]
      if (input.reason) {
        changes.push({ label: 'Reason', before: null, after: input.reason })
      }
      return card(name, input, {
        target: shipmentReference(shipment.number),
        deepLink: '/shipments',
        changes,
        action: {
          kind: 'shipment.cancel',
          shipmentId: shipment.id,
          reason: input.reason?.trim() ?? '',
        },
      })
    }

    case SAMPLE_RESERVE_TOOL: {
      const parsed = parse(proposeSampleReserveSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const sample = await findSample(client, input.sample)
      if (!sample.ok) return fail(sample.message)
      const row = sample.value
      if (!['available', 'reserved'].includes(row.status)) {
        return fail(
          `${sampleLabel(row)} is ${row.status.replaceAll('_', ' ')}, so it cannot be reserved.`,
        )
      }
      const { quantity: have, unit } = amountOf(row)
      if (have !== null && input.quantity > have) {
        return fail(
          `${row.identifier} has only ${withUnit(have, unit)}, so ${withUnit(input.quantity, unit)} cannot be reserved. Tell the person.`,
        )
      }
      const experiment = await findExperiment(client, input.experiment)
      if (typeof experiment === 'string') return fail(experiment)
      return card(name, input, {
        target: sampleLabel(row),
        deepLink: `/records/${row.id}`,
        changes: [
          {
            label: 'Reserve',
            before: null,
            after: withUnit(input.quantity, unit),
          },
          {
            label: 'For',
            before: null,
            after: `${experiment.identifier} · ${experiment.title}`,
          },
        ],
        action: {
          kind: 'sample.reserve',
          recordId: row.id,
          experimentId: experiment.id,
          quantity: input.quantity,
          unit: unit || null,
          notes: input.notes?.trim() || null,
        },
      })
    }

    case SAMPLE_QUARANTINE_TOOL:
    case SAMPLE_DISPOSE_TOOL: {
      const parsed = parse(proposeSampleRetireSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const dispose = name === SAMPLE_DISPOSE_TOOL
      const sample = await findSample(client, input.sample)
      if (!sample.ok) return fail(sample.message)
      const row = sample.value
      const allowed = dispose
        ? !['disposed', 'released'].includes(row.status)
        : ['available', 'reserved', 'hold_exceeded'].includes(row.status)
      if (!allowed) {
        return fail(
          `${sampleLabel(row)} is ${row.status.replaceAll('_', ' ')}, so it cannot be ${dispose ? 'disposed of' : 'quarantined'}. Tell the person.`,
        )
      }
      const changes: ProposalChange[] = [
        {
          label: 'Status',
          before: sentence(row.status.replaceAll('_', ' ')),
          after: dispose ? 'Disposed' : 'Quarantined',
        },
        { label: 'Reason', before: null, after: input.reason.trim() },
      ]
      return card(name, input, {
        target: sampleLabel(row),
        deepLink: `/records/${row.id}`,
        changes,
        action: {
          kind: dispose ? 'sample.dispose' : 'sample.quarantine',
          recordId: row.id,
          expectedMetadataVersion: row.metadata_version,
          reason: input.reason.trim(),
          notes: input.notes?.trim() || null,
        },
      })
    }

    case INSTRUMENT_LOG_TOOL: {
      const parsed = parse(proposeInstrumentLogSchema, args)
      if (!parsed.ok) return fail(parsed.message)
      const input = parsed.data
      const found = await resolveInstrument(
        client,
        workspaceId,
        input.instrument,
      )
      if (!found.ok) return fail(found.message)
      const changes: ProposalChange[] = [
        {
          label: 'Visit',
          before: null,
          after: `${input.kind}, ${input.visitedOn}`,
        },
        { label: 'What was done', before: null, after: input.summaryOfWork },
      ]
      if (input.performedBy) {
        changes.push({ label: 'By', before: null, after: input.performedBy })
      }
      return card(name, input, {
        target: instrumentLabel(found.instrument),
        deepLink: '/instruments',
        changes,
        action: {
          kind: 'instrument.log',
          instrumentId: found.instrument.id,
          serviceKind: input.kind,
          visitedOn: input.visitedOn,
          summary: input.summaryOfWork,
          details: input.details?.trim() || null,
          performedBy: input.performedBy?.trim() || null,
        },
      })
    }
  }
}
