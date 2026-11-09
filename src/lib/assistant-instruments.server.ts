import {
  CONNECTOR_SET_TOOL,
  INSTRUMENTS_PROPOSE_TOOL_NAMES,
  INSTRUMENT_ADD_TOOL,
  INSTRUMENT_CALIBRATE_TOOL,
  INSTRUMENT_QUALIFY_TOOL,
  INSTRUMENT_RETIRE_TOOL,
  RUN_CREATE_TOOL,
  RUN_UPDATE_TOOL,
  proposeConnectorSetSchema,
  proposeInstrumentAddSchema,
  proposeInstrumentCalibrateSchema,
  proposeInstrumentQualifySchema,
  proposeInstrumentRetireSchema,
  proposeRunCreateSchema,
  proposeRunUpdateSchema,
} from './assistant-instruments'
import type { InstrumentsProposeToolName } from './assistant-instruments'
import {
  invalid,
  likeValue,
  memberNames,
  toolDef,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for instruments, runs and connectors (see `assistant-instruments.ts`).
 * Each builder finds what the person named under their own access, checks
 * what it can, and returns a card saying exactly what will change. Nothing is
 * written here.
 */

export type InstrumentsOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isInstrumentsProposalTool(
  name: string,
): name is InstrumentsProposeToolName {
  return (INSTRUMENTS_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function instrumentsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      INSTRUMENT_ADD_TOOL,
      `Propose adding an instrument to the workspace. For people who manage instruments. ${NOTE}`,
      proposeInstrumentAddSchema,
    ),
    toolDef(
      INSTRUMENT_RETIRE_TOOL,
      `Propose retiring an instrument, or bringing a retired one back. A retired instrument cannot be booked. ${NOTE}`,
      proposeInstrumentRetireSchema,
    ),
    toolDef(
      INSTRUMENT_CALIBRATE_TOOL,
      `Propose recording a calibration of an instrument and when the next is due. ${NOTE}`,
      proposeInstrumentCalibrateSchema,
    ),
    toolDef(
      INSTRUMENT_QUALIFY_TOOL,
      `Propose qualifying a person on an instrument until a date, or taking their qualification away. For people who manage instruments. ${NOTE}`,
      proposeInstrumentQualifySchema,
    ),
    toolDef(
      RUN_CREATE_TOOL,
      `Propose recording a new run on an instrument. ${NOTE}`,
      proposeRunCreateSchema,
    ),
    toolDef(
      RUN_UPDATE_TOOL,
      `Propose marking an open instrument run as running, completed or failed. Completing a run can start pipelines. ${NOTE}`,
      proposeRunUpdateSchema,
    ),
    toolDef(
      CONNECTOR_SET_TOOL,
      `Propose pausing, resuming or archiving a connector that brings data in from another system. For people who manage integrations. ${NOTE}`,
      proposeConnectorSetSchema,
    ),
  ]
}

const fail = (message: string): InstrumentsOutcome => ({ ok: false, message })

interface InstrumentRow {
  id: string
  name: string
  display_id: string | null
  retired_at: string | null
}

const label = (row: { name: string; display_id: string | null }) =>
  row.display_id ? `${row.name} (${row.display_id})` : row.name

async function findInstrument(
  context: LabToolContext,
  text: string,
  retired: boolean,
): Promise<
  { ok: true; instrument: InstrumentRow } | { ok: false; message: string }
> {
  const like = likeValue(text)
  const rows = await context.client.list<InstrumentRow>(
    'instruments',
    `?workspace_id=eq.${encodeURIComponent(context.workspaceId)}&retired_at=${retired ? 'not.is.null' : 'is.null'}&or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id,retired_at&order=name.asc&limit=6`,
  )
  const lower = text.trim().toLowerCase()
  const exact = rows.filter(
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )
  if (exact.length === 1) return { ok: true, instrument: exact[0] }
  if (rows.length === 1) return { ok: true, instrument: rows[0] }
  if (rows.length === 0)
    return {
      ok: false,
      message: `No ${retired ? 'retired ' : ''}instrument matches "${text}".`,
    }
  return {
    ok: false,
    message: `More than one instrument matches "${text}": ${rows
      .map(label)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

const startOf = (day: string) => `${day}T00:00:00Z`

export async function buildInstrumentsProposal(
  name: InstrumentsProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<InstrumentsOutcome> {
  switch (name) {
    case INSTRUMENT_ADD_TOOL: {
      const parsed = proposeInstrumentAddSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const changes: ProposalChange[] = [
        { label: 'Instrument', before: null, after: input.name.trim() },
      ]
      if (input.instrumentType)
        changes.push({
          label: 'Kind',
          before: null,
          after: input.instrumentType,
        })
      if (input.model)
        changes.push({ label: 'Model', before: null, after: input.model })
      if (input.serialNumber)
        changes.push({
          label: 'Serial number',
          before: null,
          after: input.serialNumber,
        })
      if (input.location)
        changes.push({ label: 'Where', before: null, after: input.location })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: 'Instruments',
          deepLink: '/instruments',
          changes,
          action: {
            kind: 'instrument.add',
            workspaceId: context.workspaceId,
            name: input.name.trim(),
            instrumentType: input.instrumentType ?? null,
            model: input.model?.trim() || null,
            serialNumber: input.serialNumber?.trim() || null,
            vendor: input.vendor?.trim() || null,
            location: input.location?.trim() || null,
          },
        },
      }
    }
    case INSTRUMENT_RETIRE_TOOL: {
      const parsed = proposeInstrumentRetireSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const retire = input.retire ?? true
      const found = await findInstrument(context, input.instrument, !retire)
      if (!found.ok) return fail(found.message)
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(found.instrument),
          deepLink: '/instruments',
          changes: [
            {
              label: 'Status',
              before: retire ? 'In use' : 'Retired',
              after: retire ? 'Retired' : 'In use',
            },
          ],
          action: {
            kind: 'instrument.retire',
            instrumentId: found.instrument.id,
            retired: retire,
          },
        },
      }
    }
    case INSTRUMENT_CALIBRATE_TOOL: {
      const parsed = proposeInstrumentCalibrateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      if (input.dueOn <= input.performedOn)
        return fail(
          'The next calibration must be due after this one. Ask the person.',
        )
      const found = await findInstrument(context, input.instrument, false)
      if (!found.ok) return fail(found.message)
      const changes: ProposalChange[] = [
        { label: 'Calibrated', before: null, after: input.performedOn },
        { label: 'Next due', before: null, after: input.dueOn },
      ]
      if (input.notes)
        changes.push({ label: 'Notes', before: null, after: input.notes })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(found.instrument),
          deepLink: '/instruments',
          changes,
          action: {
            kind: 'instrument.calibrate',
            instrumentId: found.instrument.id,
            performedAt: startOf(input.performedOn),
            dueAt: startOf(input.dueOn),
            notes: input.notes?.trim() || null,
          },
        },
      }
    }
    case INSTRUMENT_QUALIFY_TOOL: {
      const parsed = proposeInstrumentQualifySchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const revoke = input.revoke ?? false
      if (!revoke && !input.validUntil)
        return fail('Ask the person until when the qualification lasts.')
      const found = await findInstrument(context, input.instrument, false)
      if (!found.ok) return fail(found.message)
      const people = await memberNames(context.client)
      const wanted = input.person.trim().toLowerCase()
      const matches = [...people.entries()].filter(([, personName]) =>
        personName.toLowerCase().includes(wanted),
      )
      const exact = matches.filter(
        ([, personName]) => personName.toLowerCase() === wanted,
      )
      const chosen = exact.length === 1 ? exact : matches
      if (chosen.length === 0)
        return fail(`No one in the workspace is called "${input.person}".`)
      if (chosen.length > 1)
        return fail(
          `More than one person matches "${input.person}": ${chosen
            .map(([, personName]) => personName)
            .join(', ')}. Ask the person which one, naming these.`,
        )
      const [userId, personName] = chosen[0]
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(found.instrument),
          deepLink: '/instruments',
          changes: revoke
            ? [
                {
                  label: personName,
                  before: 'Qualified',
                  after: 'Not qualified',
                },
              ]
            : [
                {
                  label: personName,
                  before: null,
                  after: `Qualified until ${input.validUntil}`,
                },
              ],
          action: {
            kind: 'instrument.qualify',
            instrumentId: found.instrument.id,
            userId,
            validUntil: revoke ? null : startOf(input.validUntil!),
            qualifiedFor: input.qualifiedFor?.trim() || null,
          },
        },
      }
    }
    case RUN_CREATE_TOOL: {
      const parsed = proposeRunCreateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findInstrument(context, input.instrument, false)
      if (!found.ok) return fail(found.message)
      const stamp = (context.now ?? new Date())
        .toISOString()
        .slice(0, 16)
        .replace(/[-:T]/g, '')
      const runIdentifier = input.runIdentifier?.trim() || `RUN-${stamp}`
      const changes: ProposalChange[] = [
        { label: 'Run', before: null, after: input.name.trim() },
        { label: 'Identifier', before: null, after: runIdentifier },
      ]
      if (input.protocol)
        changes.push({ label: 'Protocol', before: null, after: input.protocol })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label(found.instrument),
          deepLink: '/instruments',
          changes,
          action: {
            kind: 'run.create',
            workspaceId: context.workspaceId,
            instrumentId: found.instrument.id,
            name: input.name.trim(),
            runIdentifier,
            protocolName: input.protocol?.trim() || null,
            operator: input.operator?.trim() || null,
          },
        },
      }
    }
    case RUN_UPDATE_TOOL: {
      const parsed = proposeRunUpdateSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.run)
      const rows = await context.client.list<{
        id: string
        name: string
        run_identifier: string
        status: string
      }>(
        'instrument_runs',
        `?workspace_id=eq.${encodeURIComponent(context.workspaceId)}&status=in.(queued,running)&or=(name.ilike.${like},run_identifier.ilike.${like})&select=id,name,run_identifier,status&order=created_at.desc&limit=6`,
      )
      if (rows.length === 0) return fail(`No open run matches "${input.run}".`)
      const exact = rows.filter(
        (row) =>
          row.run_identifier.toLowerCase() === input.run.trim().toLowerCase(),
      )
      const run =
        exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null
      if (!run)
        return fail(
          `More than one open run matches "${input.run}": ${rows
            .map((row) => `${row.name} (${row.run_identifier})`)
            .join(', ')}. Ask the person which one, naming these.`,
        )
      if (input.status === 'running' && run.status === 'running')
        return fail(`${run.name} is already running.`)
      const changes: ProposalChange[] = [
        { label: 'Status', before: run.status, after: input.status },
      ]
      if (input.status === 'failed' && input.error)
        changes.push({
          label: 'What went wrong',
          before: null,
          after: input.error,
        })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${run.name} (${run.run_identifier})`,
          deepLink: '/instruments',
          changes,
          action: {
            kind: 'run.update',
            workspaceId: context.workspaceId,
            runId: run.id,
            status: input.status,
            error: input.error?.trim() || null,
          },
        },
      }
    }
    case CONNECTOR_SET_TOOL: {
      const parsed = proposeConnectorSetSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.connector)
      const rows = await context.client.list<{
        id: string
        name: string
        status: string
      }>(
        'connectors',
        `?workspace_id=eq.${encodeURIComponent(context.workspaceId)}&or=(name.ilike.${like},key.ilike.${like})&select=id,name,status&order=name.asc&limit=6`,
      )
      if (rows.length === 0)
        return fail(`No connector matches "${input.connector}".`)
      const exact = rows.filter(
        (row) =>
          row.name.toLowerCase() === input.connector.trim().toLowerCase(),
      )
      const connector =
        exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null
      if (!connector)
        return fail(
          `More than one connector matches "${input.connector}": ${rows
            .map((row) => row.name)
            .join(', ')}. Ask the person which one, naming these.`,
        )
      if (connector.status === input.status)
        return fail(`${connector.name} is already ${input.status}.`)
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${connector.name} · Connector`,
          deepLink: '/settings/workspace/integrations',
          changes: [
            { label: 'Status', before: connector.status, after: input.status },
          ],
          action: {
            kind: 'connector.set',
            workspaceId: context.workspaceId,
            connectorId: connector.id,
            status: input.status,
          },
        },
      }
    }
  }
}
