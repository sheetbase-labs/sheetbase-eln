import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  NOTE,
  card,
  fail,
  find,
  findMemberNamed,
  findRecordOf,
} from '#/lib/assistant-kit.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import type { FeatureProposalOutcome } from '../define.server'
import {
  REPORTS_PROPOSE_TOOL_NAMES,
  REPORT_CREATE_TOOL,
  REPORT_SCHEDULE_ACTIVE_TOOL,
  REPORT_SCHEDULE_DELETE_TOOL,
  REPORT_SCHEDULE_SAVE_TOOL,
  REPORT_SCHEDULE_SEND_TOOL,
  REPORT_SECTIONS_REORDER_TOOL,
  REPORT_SECTION_ADD_TOOL,
  REPORT_SECTION_BIND_TOOL,
  REPORT_SECTION_REMOVE_TOOL,
  REPORT_SECTION_UPDATE_TOOL,
  REPORT_UPDATE_TOOL,
  WEEKDAYS,
  proposeReportCreateSchema,
  proposeReportScheduleActiveSchema,
  proposeReportScheduleDeleteSchema,
  proposeReportScheduleSaveSchema,
  proposeReportScheduleSendSchema,
  proposeReportSectionAddSchema,
  proposeReportSectionBindSchema,
  proposeReportSectionRemoveSchema,
  proposeReportSectionUpdateSchema,
  proposeReportSectionsReorderSchema,
  proposeReportUpdateSchema,
} from './cards'
import type { ReportsProposeToolName } from './cards'

/**
 * The report cards (see `cards.ts`). Each builder finds what the model named
 * under the signed-in person's own access, by document number or title, and
 * returns a card that says exactly what will change. Nothing is written here.
 */

export function isReportsProposalTool(
  name: string,
): name is ReportsProposeToolName {
  return REPORTS_PROPOSE_TOOL_NAMES.includes(name)
}

export function reportsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      REPORT_CREATE_TOOL,
      `Propose starting a report, optionally in a project. Sections are added with their own tool. ${NOTE}`,
      proposeReportCreateSchema,
    ),
    toolDef(
      REPORT_UPDATE_TOOL,
      `Propose changing a report's title, subtitle or status (draft, in review, archived). Approving or publishing is done by a person in the app, never proposed. ${NOTE}`,
      proposeReportUpdateSchema,
    ),
    toolDef(
      REPORT_SECTION_ADD_TOOL,
      `Propose adding a section to the end of a report, with optional text. To fill a section from an experiment's results use the section_bind tool after. ${NOTE}`,
      proposeReportSectionAddSchema,
    ),
    toolDef(
      REPORT_SECTION_UPDATE_TOOL,
      `Propose changing a report section's title, text, type or position. ${NOTE}`,
      proposeReportSectionUpdateSchema,
    ),
    toolDef(
      REPORT_SECTION_BIND_TOOL,
      `Propose filling a report section from the submitted version of an experiment or record (a chart, table or text block), so the report always shows that exact data. ${NOTE}`,
      proposeReportSectionBindSchema,
    ),
    toolDef(
      REPORT_SECTION_REMOVE_TOOL,
      `Propose taking a section out of a report. ${NOTE}`,
      proposeReportSectionRemoveSchema,
    ),
    toolDef(
      REPORT_SECTIONS_REORDER_TOOL,
      `Propose putting a report's sections in a new order. ${NOTE}`,
      proposeReportSectionsReorderSchema,
    ),
    toolDef(
      REPORT_SCHEDULE_SAVE_TOOL,
      `Propose emailing a report on a rhythm (daily, weekly or monthly) to chosen members, with the detail attached as CSV: instrument usage, spend on orders or project status. A schedule with the same name is changed instead. ${NOTE}`,
      proposeReportScheduleSaveSchema,
    ),
    toolDef(
      REPORT_SCHEDULE_ACTIVE_TOOL,
      `Propose pausing or resuming a scheduled report. ${NOTE}`,
      proposeReportScheduleActiveSchema,
    ),
    toolDef(
      REPORT_SCHEDULE_SEND_TOOL,
      `Propose sending a scheduled report now, to its recipients. ${NOTE}`,
      proposeReportScheduleSendSchema,
    ),
    toolDef(
      REPORT_SCHEDULE_DELETE_TOOL,
      `Propose deleting a scheduled report. Nothing already sent is taken back. ${NOTE}`,
      proposeReportScheduleDeleteSchema,
    ),
  ]
}

interface ReportRow {
  id: string
  record_id: string
  title: string
  document_identifier: string
  status: string
}

const reportLabel = (row: ReportRow): string =>
  `${row.document_identifier} · ${row.title}`

const findReport = (
  client: DataClient,
  wanted: string,
): Promise<Lookup<ReportRow>> =>
  find<ReportRow>(client, wanted, {
    table: 'report_definitions',
    match: ['document_identifier', 'title'],
    select: 'id,record_id,title,document_identifier,status',
    what: 'report',
    order: 'updated_at.desc',
    label: reportLabel,
    names: (row) => [row.document_identifier, row.title],
  })

interface SectionRow {
  id: string
  title: string
  position: number
  section_type: string
  description: string | null
}

const findSection = (
  client: DataClient,
  reportId: string,
  wanted: string,
): Promise<Lookup<SectionRow>> =>
  find<SectionRow>(client, wanted, {
    table: 'report_sections',
    match: ['title'],
    select: 'id,title,position,section_type,description',
    what: 'report section',
    extra: `&report_id=eq.${encodeURIComponent(reportId)}`,
    order: 'position.asc',
    label: (row) => row.title,
    names: (row) => [row.title],
  })

interface ScheduleRow {
  id: string
  name: string
  active: boolean
  frequency: string
}

const findSchedule = (
  client: DataClient,
  wanted: string,
): Promise<Lookup<ScheduleRow>> =>
  find<ScheduleRow>(client, wanted, {
    table: 'scheduled_reports',
    match: ['name'],
    select: 'id,name,active,frequency',
    what: 'scheduled report',
    label: (row) => row.name,
    names: (row) => [row.name],
  })

const reportLink = (row: ReportRow): string => `/reports/${row.record_id}`

const SCHEDULE_PAGE = '/settings/lab/reports'

const KIND_WORDS = new Map<string, string>([
  ['instrument_usage', 'Instrument usage'],
  ['spend', 'Spend on orders'],
  ['project_status', 'Project status'],
])

interface RevisionRow {
  id: string
  structure_version: number
  block_snapshot: { id?: string; type?: string; payload?: unknown }[] | null
}

/** The words in a block, for matching a person's description of it. */
const blockWords = (block: { type?: string; payload?: unknown }): string =>
  `${block.type ?? ''} ${JSON.stringify(block.payload ?? '')}`.toLowerCase()

export async function buildReportsProposal(
  name: ReportsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case REPORT_CREATE_TOOL: {
      const parsed = proposeReportCreateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const project = input.project
        ? await findProject(client, input.project)
        : null

      if (project && !project.ok) return fail(project.message)

      const changes: ProposalChange[] = [
        { label: 'Report', before: null, after: input.report.trim() },
      ]

      if (input.subtitle)
        changes.push({ label: 'Subtitle', before: null, after: input.subtitle })

      if (project?.ok)
        changes.push({
          label: 'Project',
          before: null,
          after: project.value.title,
        })

      return card(name, input, 'New report', '/reports', changes, {
        kind: 'report.create',
        workspaceId,
        title: input.report.trim(),
        subtitle: input.subtitle ?? null,
        projectId: project?.ok ? project.value.id : null,
      })
    }

    case REPORT_UPDATE_TOOL: {
      const parsed = proposeReportUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (!input.name && input.subtitle === undefined && !input.status)
        return fail('Ask the person what to change on the report.')
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)
      const report = found.value
      const changes: ProposalChange[] = []

      if (input.name)
        changes.push({
          label: 'Title',
          before: report.title,
          after: input.name.trim(),
        })

      if (input.subtitle !== undefined)
        changes.push({ label: 'Subtitle', before: null, after: input.subtitle })

      if (input.status)
        changes.push({
          label: 'Status',
          before: report.status,
          after: input.status,
        })

      return card(
        name,
        input,
        reportLabel(report),
        reportLink(report),
        changes,
        {
          kind: 'report.update',
          workspaceId,
          id: report.id,
          title: input.name?.trim() ?? null,
          subtitle: input.subtitle ?? null,
          status: input.status ?? null,
        },
      )
    }

    case REPORT_SECTION_ADD_TOOL: {
      const parsed = proposeReportSectionAddSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)
      const report = found.value

      const changes: ProposalChange[] = [
        { label: 'Adds section', before: null, after: input.section.trim() },
      ]

      if (input.description)
        changes.push({ label: 'Text', before: null, after: input.description })

      return card(
        name,
        input,
        reportLabel(report),
        reportLink(report),
        changes,
        {
          kind: 'report.section_add',
          workspaceId,
          reportId: report.id,
          title: input.section.trim(),
          description: input.description ?? null,
          sectionType: input.type ?? 'text',
        },
      )
    }

    case REPORT_SECTION_UPDATE_TOOL: {
      const parsed = proposeReportSectionUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.name &&
        input.description === undefined &&
        !input.type &&
        !input.position
      )
        return fail('Ask the person what to change on the section.')
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)
      const section = await findSection(client, found.value.id, input.section)

      if (!section.ok) return fail(section.message)
      const row = section.value
      const changes: ProposalChange[] = []

      if (input.name)
        changes.push({
          label: 'Title',
          before: row.title,
          after: input.name.trim(),
        })

      if (input.description !== undefined)
        changes.push({
          label: 'Text',
          before: row.description,
          after: input.description,
        })

      if (input.type)
        changes.push({
          label: 'Type',
          before: row.section_type,
          after: input.type,
        })

      if (input.position)
        changes.push({
          label: 'Position',
          before: String(row.position),
          after: String(input.position),
        })

      return card(
        name,
        input,
        `${row.title} · ${reportLabel(found.value)}`,
        reportLink(found.value),
        changes,
        {
          kind: 'report.section_update',
          workspaceId,
          reportId: found.value.id,
          sectionId: row.id,
          title: input.name?.trim() ?? null,
          description: input.description ?? null,
          sectionType: input.type ?? null,
          position: input.position ?? null,
        },
      )
    }

    case REPORT_SECTION_BIND_TOOL: {
      const parsed = proposeReportSectionBindSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)
      const section = await findSection(client, found.value.id, input.section)

      if (!section.ok) return fail(section.message)

      const record = await findRecordOf(client, input.record, 'record', [
        'experiment',
        'protocol',
        'material',
        'sample',
        'study',
      ])

      if (!record.ok) return fail(record.message)

      const revisions = await client.list<RevisionRow>(
        'revisions',
        `?record_id=eq.${encodeURIComponent(record.value.id)}${input.version ? `&structure_version=eq.${input.version}` : ''}&select=id,structure_version,block_snapshot&order=created_at.desc,id.desc&limit=1`,
      )

      const revision = revisions.at(0)

      if (!revision)
        return fail(
          `${record.value.identifier} has no submitted version to use${input.version ? ` numbered ${input.version}` : ''}. A section can only show a submitted version.`,
        )

      const blocks = (revision.block_snapshot ?? []).filter(
        (block) => block.id !== undefined && block.id !== '',
      )

      const wanted = input.block?.trim().toLowerCase()

      const matches = wanted
        ? blocks.filter((block) => blockWords(block).includes(wanted))
        : blocks

      if (matches.length !== 1 || !matches[0].id)
        return fail(
          matches.length === 0
            ? `${record.value.identifier} version ${revision.structure_version} has no block matching "${input.block ?? ''}".`
            : `${record.value.identifier} version ${revision.structure_version} has ${matches.length} blocks (${matches
                .slice(0, 8)
                .map((block) => block.type ?? 'block')
                .join(', ')}); ask which one the section should show.`,
        )

      return card(
        name,
        input,
        `${section.value.title} · ${reportLabel(found.value)}`,
        reportLink(found.value),
        [
          {
            label: 'Shows',
            before: null,
            after: `${matches[0].type ?? 'Block'} from ${record.value.identifier} version ${revision.structure_version}`,
          },
        ],
        {
          kind: 'report.section_bind',
          workspaceId,
          reportId: found.value.id,
          sectionId: section.value.id,
          revisionId: revision.id,
          source: {
            blockId: matches[0].id,
            recordId: record.value.id,
            recordIdentifier: record.value.identifier,
            revisionVersion: revision.structure_version,
          },
        },
      )
    }

    case REPORT_SECTION_REMOVE_TOOL: {
      const parsed = proposeReportSectionRemoveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)
      const section = await findSection(client, found.value.id, input.section)

      if (!section.ok) return fail(section.message)

      return card(
        name,
        input,
        reportLabel(found.value),
        reportLink(found.value),
        [
          {
            label: 'Removes section',
            before: section.value.title,
            after: 'Gone',
          },
        ],
        {
          kind: 'report.section_remove',
          workspaceId,
          reportId: found.value.id,
          sectionId: section.value.id,
        },
      )
    }

    case REPORT_SECTIONS_REORDER_TOOL: {
      const parsed = proposeReportSectionsReorderSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findReport(client, input.report)

      if (!found.ok) return fail(found.message)

      const rows = await client.list<SectionRow>(
        'report_sections',
        `?report_id=eq.${encodeURIComponent(found.value.id)}&select=id,title,position,section_type,description&order=position.asc`,
      )

      const ids: string[] = []

      for (const wanted of input.order) {
        const lower = wanted.trim().toLowerCase()
        const free = rows.filter((row) => !ids.includes(row.id))
        const exact = free.filter((row) => row.title.toLowerCase() === lower)

        const partial = free.filter((row) =>
          row.title.toLowerCase().includes(lower),
        )

        const chosen =
          exact.length === 1
            ? exact[0]
            : partial.length === 1
              ? partial[0]
              : null

        if (!chosen)
          return fail(
            partial.length === 0
              ? `No section of ${found.value.title} matches "${wanted}" (or it is named twice).`
              : `More than one section matches "${wanted}": ${partial.map((row) => row.title).join(', ')}. Ask which.`,
          )
        ids.push(chosen.id)
      }

      if (ids.length !== rows.length)
        return fail(
          `${found.value.title} has ${rows.length} sections (${rows.map((row) => row.title).join(', ')}); name all of them in the order wanted.`,
        )

      const titleOf = (id: string) =>
        rows.find((row) => row.id === id)?.title ?? ''

      return card(
        name,
        input,
        reportLabel(found.value),
        reportLink(found.value),
        [
          {
            label: 'Order',
            before: rows.map((row) => row.title).join(' → '),
            after: ids.map(titleOf).join(' → '),
          },
        ],
        {
          kind: 'report.sections_reorder',
          workspaceId,
          reportId: found.value.id,
          sectionIds: ids,
        },
      )
    }

    case REPORT_SCHEDULE_SAVE_TOOL: {
      const parsed = proposeReportScheduleSaveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (input.frequency === 'monthly' && !input.monthDay)
        return fail('Ask which day of the month it should go out, 1 to 28.')

      const project =
        input.project && input.report !== 'instrument_usage'
          ? await findProject(client, input.project)
          : null

      if (project && !project.ok) return fail(project.message)

      const people: { user_id: string; name: string }[] = []

      for (const wanted of input.recipients) {
        const who = await findMemberNamed(client, wanted)

        if (!who.ok) return fail(who.message)
        people.push(who.value)
      }

      const existing = await client.list<ScheduleRow>(
        'scheduled_reports',
        `?name=eq.${encodeURIComponent(input.schedule.trim())}&select=id,name,active,frequency&limit=1`,
      )

      const weekday = input.weekday ? WEEKDAYS.indexOf(input.weekday) : 1
      const hour = input.hour ?? 8

      const when =
        input.frequency === 'daily'
          ? 'Every day'
          : input.frequency === 'weekly'
            ? `Every ${WEEKDAYS[weekday]}`
            : `On day ${input.monthDay} of every month`

      const changes: ProposalChange[] = [
        {
          label: 'Sends',
          before: null,
          after: KIND_WORDS.get(input.report) ?? input.report,
        },
        {
          label: 'Covers',
          before: null,
          after: input.period.replaceAll('_', ' '),
        },
        {
          label: 'When',
          before: null,
          after: `${when} at ${String(hour).padStart(2, '0')}:00 (${context.timeZone})`,
        },
        {
          label: 'To',
          before: null,
          after: people.map((p) => p.name).join(', '),
        },
      ]

      if (project?.ok)
        changes.push({
          label: 'Project',
          before: null,
          after: project.value.title,
        })

      return card(
        name,
        input,
        `${input.schedule.trim()} · Scheduled report${existing.length > 0 ? ' (changes the existing one)' : ''}`,
        SCHEDULE_PAGE,
        changes,
        {
          kind: 'report.schedule_save',
          id: existing.at(0)?.id ?? null,
          name: input.schedule.trim(),
          reportKind: input.report,
          projectId: project?.ok ? project.value.id : null,
          period: input.period,
          openHours: input.openHours ?? 10,
          frequency: input.frequency,
          weekday,
          monthDay: input.monthDay ?? 1,
          sendHour: hour,
          timeZone: context.timeZone,
          recipientUserIds: people.map((p) => p.user_id),
          active: existing.at(0)?.active ?? true,
        },
      )
    }

    case REPORT_SCHEDULE_ACTIVE_TOOL: {
      const parsed = proposeReportScheduleActiveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findSchedule(client, input.schedule)

      if (!found.ok) return fail(found.message)

      if (found.value.active === input.active)
        return fail(
          `${found.value.name} is already ${input.active ? 'running' : 'paused'}.`,
        )

      return card(
        name,
        input,
        `${found.value.name} · Scheduled report`,
        SCHEDULE_PAGE,
        [
          {
            label: 'Status',
            before: found.value.active ? 'Running' : 'Paused',
            after: input.active ? 'Running' : 'Paused',
          },
        ],
        {
          kind: 'report.schedule_active',
          id: found.value.id,
          active: input.active,
        },
      )
    }

    case REPORT_SCHEDULE_SEND_TOOL: {
      const parsed = proposeReportScheduleSendSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findSchedule(client, input.schedule)

      if (!found.ok) return fail(found.message)

      return card(
        name,
        input,
        `${found.value.name} · Scheduled report`,
        SCHEDULE_PAGE,
        [
          {
            label: 'Sends',
            before: null,
            after: 'To its recipients now, within a minute',
          },
        ],
        { kind: 'report.schedule_send', id: found.value.id },
      )
    }

    case REPORT_SCHEDULE_DELETE_TOOL: {
      const parsed = proposeReportScheduleDeleteSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findSchedule(client, input.schedule)

      if (!found.ok) return fail(found.message)

      return card(
        name,
        input,
        `${found.value.name} · Scheduled report`,
        SCHEDULE_PAGE,
        [{ label: 'Deletes', before: found.value.name, after: 'Gone' }],
        { kind: 'report.schedule_delete', id: found.value.id },
      )
    }
  }
}
