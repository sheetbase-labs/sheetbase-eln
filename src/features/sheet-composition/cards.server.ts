import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import {
  findSheet,
  layoutVersions,
  sheetLabel,
} from '#/lib/assistant-rpc-cards.server'

import type { FeatureProposalOutcome } from '../define.server'
import {
  proposeSheetAdoptLayoutSchema,
  proposeSheetMaterializeSchema,
  SHEET_ADOPT_LAYOUT_TOOL,
  SHEET_COMPOSITION_PROPOSE_TOOL_NAMES,
  SHEET_MATERIALIZE_TOOL,
} from './cards'
import type { SheetCompositionProposeToolName } from './cards'

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isSheetCompositionProposalTool(
  name: string,
): name is SheetCompositionProposeToolName {
  return SHEET_COMPOSITION_PROPOSE_TOOL_NAMES.includes(name)
}

export function sheetCompositionProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SHEET_MATERIALIZE_TOOL,
      `Propose saving what a sheet holds right now as a new dataset, a fixed copy of its rows. ${NOTE}`,
      proposeSheetMaterializeSchema,
    ),
    toolDef(
      SHEET_ADOPT_LAYOUT_TOOL,
      `Propose moving a sheet to the newest published version of the layout it was made from. Only when nothing needs deciding; the sheet's own columns and values are kept. ${NOTE}`,
      proposeSheetAdoptLayoutSchema,
    ),
  ]
}

const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

export async function buildSheetCompositionProposal(
  name: SheetCompositionProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  switch (name) {
    case SHEET_MATERIALIZE_TOOL: {
      const parsed = proposeSheetMaterializeSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const sheet = await findSheet(client, input.sheet)

      if (!sheet.ok) return fail(sheet.message)
      const row = sheet.value

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: sheetLabel(row),
          deepLink: `/sheets/${row.id}`,
          changes: [
            { label: 'Dataset', before: null, after: input.name.trim() },
          ],
          action: {
            kind: 'sheet.materialize',
            instanceId: row.id,
            expectedRevision: Number(row.revision),
            outputName: input.name.trim(),
            idempotencyKey: crypto.randomUUID(),
          },
        },
      }
    }

    case SHEET_ADOPT_LAYOUT_TOOL: {
      const parsed = proposeSheetAdoptLayoutSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const sheet = await findSheet(client, input.sheet)

      if (!sheet.ok) return fail(sheet.message)
      const row = sheet.value
      const label = sheetLabel(row)

      const own = await client.list<{
        source_definition_version_id: string | null
      }>(
        'sheet_instances',
        `?id=eq.${row.id}&select=source_definition_version_id&limit=1`,
      )

      const sourceId = own.at(0)?.source_definition_version_id

      if (!sourceId) return fail(`${label} was not made from a layout.`)

      const current = await client.list<{
        definition_id: string
        version: number
      }>(
        'sheet_definition_versions',
        `?id=eq.${sourceId}&select=definition_id,version&limit=1`,
      )

      const source = current.at(0)

      if (!source) return fail('Its layout version could not be found.')

      const latest = (await layoutVersions(client, source.definition_id)).find(
        (version) => version.lifecycle === 'published',
      )

      if (!latest || latest.version <= source.version) {
        return fail(`${label} is already on the newest layout version.`)
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label,
          deepLink: `/sheets/${row.id}`,
          changes: [
            {
              label: 'Layout version',
              before: String(source.version),
              after: String(latest.version),
            },
          ],
          action: {
            kind: 'sheet.adopt_layout_version',
            instanceId: row.id,
            expectedRevision: Number(row.revision),
            targetDefinitionVersionId: latest.id,
            retryToken: crypto.randomUUID(),
          },
        },
      }
    }
  }
}
