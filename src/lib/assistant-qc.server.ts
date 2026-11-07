import {
  QC_ACKNOWLEDGE_TOOL,
  QC_PROPOSE_TOOL_NAMES,
  QC_SET_BASELINE_TOOL,
  proposeQcAcknowledgeSchema,
  proposeQcBaselineSchema,
} from './assistant-qc'
import type { QcProposeToolName } from './assistant-qc'
import { invalid, likeValue, toolDef } from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { AssistantProposal, ProposalChange } from './assistant-proposals'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * Cards for quality control (see `assistant-qc.ts`). Each builder finds the
 * series the person named under their own access, checks what it can, and
 * returns a card saying exactly what will change. Nothing is written here.
 */

export type QcOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isQcProposalTool(name: string): name is QcProposeToolName {
  return (QC_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

export function qcProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      QC_SET_BASELINE_TOOL,
      `Propose setting the control limits of a tracked quality control series, from a mean and SD or from its first N points. Every point is judged again. ${NOTE}`,
      proposeQcBaselineSchema,
    ),
    toolDef(
      QC_ACKNOWLEDGE_TOOL,
      `Propose acknowledging the open rule breaches of a quality control series with a note, optionally leaving them out of the limits. ${NOTE}`,
      proposeQcAcknowledgeSchema,
    ),
  ]
}

interface SeriesRow {
  id: string
  name: string
  mean: number | null
  sd: number | null
  state: string
}

interface BreachRow {
  id: string
  value: number
  at: string
  violations: string[]
}

const fail = (message: string): QcOutcome => ({ ok: false, message })

async function findSeries(
  context: LabToolContext,
  text: string,
): Promise<{ ok: true; series: SeriesRow } | { ok: false; message: string }> {
  const rows = await context.client.list<SeriesRow>(
    'qc_series',
    `?name=ilike.${likeValue(text)}&select=id,name,mean,sd,state&order=name.asc&limit=6`,
  )
  if (rows.length === 0)
    return {
      ok: false,
      message: `No quality control series matches "${text}".`,
    }
  const exact = rows.filter(
    (r) => r.name.toLowerCase() === text.trim().toLowerCase(),
  )
  if (exact.length === 1) return { ok: true, series: exact[0] }
  if (rows.length === 1) return { ok: true, series: rows[0] }
  return {
    ok: false,
    message: `More than one series matches "${text}": ${rows
      .map((r) => r.name)
      .join(', ')}. Ask the person which one, naming these.`,
  }
}

const limitsText = (s: { mean: number | null; sd: number | null }) =>
  s.mean !== null && s.sd !== null ? `mean ${s.mean}, SD ${s.sd}` : 'not set'

export async function buildQcProposal(
  name: QcProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<QcOutcome> {
  switch (name) {
    case QC_SET_BASELINE_TOOL: {
      const parsed = proposeQcBaselineSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findSeries(context, input.series)
      if (!found.ok) return fail(found.message)
      const series = found.series
      let limits: { mean: number; sd: number } | { firstN: number }
      let after: string
      if (input.mean !== undefined && input.sd !== undefined) {
        limits = { mean: input.mean, sd: input.sd }
        after = limitsText(limits)
      } else if (input.firstN !== undefined) {
        limits = { firstN: input.firstN }
        after = `taken from the first ${input.firstN} points`
      } else {
        return fail(
          'Ask the person for the mean and SD, or how many of the first points to take them from.',
        )
      }
      const changes: ProposalChange[] = [
        { label: 'Series', before: null, after: series.name },
        { label: 'Limits', before: limitsText(series), after },
      ]
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${series.name} · Quality control`,
          deepLink: '/plates',
          changes,
          action: { kind: 'qc.set_baseline', seriesId: series.id, limits },
        },
      }
    }
    case QC_ACKNOWLEDGE_TOOL: {
      const parsed = proposeQcAcknowledgeSchema.safeParse(args)
      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const found = await findSeries(context, input.series)
      if (!found.ok) return fail(found.message)
      const series = found.series
      const open = await context.client.list<BreachRow>(
        'qc_points',
        `?series_id=eq.${series.id}&violations=neq.{}&acknowledged_at=is.null&excluded=eq.false&select=id,value,at,violations&order=at.desc&limit=50`,
      )
      if (open.length === 0)
        return fail(`${series.name} has no open breaches to acknowledge.`)
      const exclude = input.exclude ?? false
      const changes: ProposalChange[] = [
        { label: 'Series', before: null, after: series.name },
        {
          label: 'Breaches',
          before: `${open.length} open`,
          after: 'acknowledged',
        },
        { label: 'Note', before: null, after: input.note },
      ]
      if (exclude)
        changes.push({
          label: 'Limits',
          before: 'including these points',
          after: 'leaving these points out',
        })
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${series.name} · Quality control`,
          deepLink: '/plates',
          changes,
          action: {
            kind: 'qc.acknowledge',
            pointIds: open.map((p) => p.id),
            note: input.note,
            exclude,
          },
        },
      }
    }
  }
}
