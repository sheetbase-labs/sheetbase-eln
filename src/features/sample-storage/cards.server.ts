import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  findExperiment,
  invalid,
  likeValue,
  toolDef,
} from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { findSample, pick, sampleLabel } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'
import { shipmentReference } from '#/lib/shipments'
import { stocktakeReference } from '#/lib/stocktake'

import type { FeatureProposalOutcome } from '../define.server'
import {
  MATERIAL_SAFETY_TOOL,
  POSITION_STATUS_TOOL,
  proposeMaterialSafetySchema,
  proposePositionStatusSchema,
  proposeReleaseRulesSchema,
  proposeSampleLabelSchema,
  proposeSampleMatchSchema,
  proposeSampleWithdrawSchema,
  proposeShipmentDispatchSchema,
  proposeShipmentUpdateSchema,
  proposeStocktakeCancelSchema,
  proposeStocktakeResolveSchema,
  proposeStocktakeScanSchema,
  proposeWorkflowSaveSchema,
  proposeWorkflowStatusSchema,
  RELEASE_RULES_TOOL,
  SAMPLE_LABEL_TOOL,
  SAMPLE_MATCH_TOOL,
  SAMPLE_STORAGE_PROPOSE_TOOL_NAMES,
  SAMPLE_WITHDRAW_TOOL,
  SHIPMENT_DISPATCH_TOOL,
  SHIPMENT_UPDATE_TOOL,
  STOCKTAKE_CANCEL_TOOL,
  STOCKTAKE_RESOLVE_TOOL,
  STOCKTAKE_SCAN_TOOL,
  WORKFLOW_SAVE_TOOL,
  WORKFLOW_STATUS_TOOL,
} from './cards'
import type { SampleStorageAction, SampleStorageProposeToolName } from './cards'

/**
 * The sample and storage cards (see `cards.ts`). Each builder finds what the
 * model named under the signed-in person's own access, by ID as well as by
 * name, and returns a card that says exactly what will change. Nothing is
 * written here.
 */

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isSampleStorageProposalTool(
  name: string,
): name is SampleStorageProposeToolName {
  return SAMPLE_STORAGE_PROPOSE_TOOL_NAMES.includes(name)
}

export function sampleStorageProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SAMPLE_WITHDRAW_TOOL,
      `Propose taking an amount out of a sample for an experiment, optionally into a new linked tube. It is refused if more is asked for than is free. ${NOTE}`,
      proposeSampleWithdrawSchema,
    ),
    toolDef(
      SAMPLE_LABEL_TOOL,
      `Propose recording that a sample's label was printed. ${NOTE}`,
      proposeSampleLabelSchema,
    ),
    toolDef(
      SAMPLE_MATCH_TOOL,
      `Propose filing every sample whose typed storage place names exactly one free box position into that position. Others keep their text. ${NOTE}`,
      proposeSampleMatchSchema,
    ),
    toolDef(
      POSITION_STATUS_TOOL,
      `Propose marking an empty box position available, quarantined or missing. ${NOTE}`,
      proposePositionStatusSchema,
    ),
    toolDef(
      STOCKTAKE_SCAN_TOOL,
      `Propose recording that a sample or material was found during an open stocktake. ${NOTE}`,
      proposeStocktakeScanSchema,
    ),
    toolDef(
      STOCKTAKE_RESOLVE_TOOL,
      `Propose how to settle a misplaced, unexpected or missing item in a stocktake. ${NOTE}`,
      proposeStocktakeResolveSchema,
    ),
    toolDef(
      STOCKTAKE_CANCEL_TOOL,
      `Propose cancelling an open stocktake. Nothing counted is kept. ${NOTE}`,
      proposeStocktakeCancelSchema,
    ),
    toolDef(
      SHIPMENT_DISPATCH_TOOL,
      `Propose marking a draft shipment as sent, with its carrier, tracking reference and expected date. ${NOTE}`,
      proposeShipmentDispatchSchema,
    ),
    toolDef(
      SHIPMENT_UPDATE_TOOL,
      `Propose changing a shipment's counterparty, carrier, tracking reference, expected date or notes. ${NOTE}`,
      proposeShipmentUpdateSchema,
    ),
    toolDef(
      MATERIAL_SAFETY_TOOL,
      `Propose setting a material's chemical safety: GHS pictograms, signal word and hazard statements. ${NOTE}`,
      proposeMaterialSafetySchema,
    ),
    toolDef(
      WORKFLOW_SAVE_TOOL,
      `Propose a sample workflow: an ordered list of steps a sample moves through. A workflow with the same name is changed. ${NOTE}`,
      proposeWorkflowSaveSchema,
    ),
    toolDef(
      WORKFLOW_STATUS_TOOL,
      `Propose archiving a sample workflow or bringing it back. ${NOTE}`,
      proposeWorkflowStatusSchema,
    ),
    toolDef(
      RELEASE_RULES_TOOL,
      `Propose the checks a sample of one type must pass before it can be released. They replace the type's current rules. Releasing the sample itself stays a person's own decision. ${NOTE}`,
      proposeReleaseRulesSchema,
    ),
  ]
}

const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

interface FoundRecord {
  id: string
  identifier: string
  title: string
  kind: string
  metadata_version: number
}

const label = (row: FoundRecord): string => `${row.identifier} · ${row.title}`

async function findRecordOf(
  client: DataClient,
  kinds: readonly string[],
  wanted: string,
): Promise<Lookup<FoundRecord>> {
  const like = likeValue(wanted)

  const rows = await client.list<FoundRecord>(
    'records',
    `?deleted_at=is.null&archived_at=is.null&kind=in.(${kinds.join(',')})&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,kind,metadata_version&order=identifier.asc&limit=6`,
  )

  const lower = wanted.trim().toLowerCase()

  return pick(
    rows,
    wanted,
    kinds.join(' or '),
    label,
    (row) =>
      row.identifier.toLowerCase() === lower ||
      row.title.toLowerCase() === lower,
  )
}

interface FoundStocktake {
  id: string
  number: number
  status: string
  scope_name: string
}

async function findStocktake(
  client: DataClient,
  wanted: string,
  openOnly: boolean,
): Promise<Lookup<FoundStocktake>> {
  const number = /^ST-?(\d+)$/i.exec(wanted.trim())

  const rows = await client.list<FoundStocktake>(
    'stocktakes',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `scope_name=ilike.${likeValue(wanted)}`
    }${openOnly ? '&status=eq.open' : ''}&select=id,number,status,scope_name&order=number.desc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    openOnly ? 'open stocktake' : 'stocktake',
    (row) => `${stocktakeReference(row.number)} ${row.scope_name}`,
    (row) => number !== null && row.number === Number(number[1]),
  )
}

const stocktakeLabel = (row: FoundStocktake): string =>
  `${stocktakeReference(row.number)} · ${row.scope_name}`

interface FoundShipment {
  id: string
  number: number
  status: string
  counterparty: string
  carrier: string | null
  tracking_reference: string | null
  expected_on: string | null
  notes: string | null
}

async function findShipment(
  client: DataClient,
  wanted: string,
  statuses: readonly string[],
): Promise<Lookup<FoundShipment>> {
  const number = /^SHP-?(\d+)$/i.exec(wanted.trim())

  const rows = await client.list<FoundShipment>(
    'shipments',
    `?${
      number
        ? `number=eq.${Number(number[1])}`
        : `counterparty=ilike.${likeValue(wanted)}`
    }&select=id,number,status,counterparty,carrier,tracking_reference,expected_on,notes&order=number.desc&limit=8`,
  )

  const usable = rows.filter((row) => statuses.includes(row.status))

  if (usable.length === 0 && rows.length > 0) {
    return {
      ok: false,
      message: `${shipmentReference(rows[0].number)} is ${rows[0].status.replaceAll('_', ' ')}, so this cannot be done to it.`,
    }
  }

  return pick(
    usable,
    wanted,
    'shipment',
    (row) => `${shipmentReference(row.number)} ${row.counterparty}`,
    (row) => number !== null && row.number === Number(number[1]),
  )
}

interface FoundBox {
  id: string
  name: string
  code: string | null
}

async function findBox(
  client: DataClient,
  wanted: string,
): Promise<Lookup<FoundBox>> {
  const like = likeValue(wanted)

  const boxes = await client.list<FoundBox>(
    'storage_boxes',
    `?archived_at=is.null&or=(name.ilike.${like},code.ilike.${like})&select=id,name,code&limit=6`,
  )

  const lower = wanted.trim().toLowerCase()

  return pick(
    boxes,
    wanted,
    'box',
    (box) => `${box.name} (${box.code ?? ''})`,
    (box) =>
      box.name.toLowerCase() === lower || box.code?.toLowerCase() === lower,
  )
}

const today = (): string => new Date().toISOString().slice(0, 10)

export async function buildSampleStorageProposal(
  name: SampleStorageProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  const card = (
    input: { title: string; summary: string },
    rest: {
      target: string
      deepLink: string | null
      changes: ProposalChange[]
      action: SampleStorageAction
    },
  ): FeatureProposalOutcome => ({
    ok: true,
    proposal: {
      tool: name,
      title: input.title,
      summary: input.summary,
      ...rest,
    },
  })

  switch (name) {
    case SAMPLE_WITHDRAW_TOOL: {
      const parsed = proposeSampleWithdrawSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const sample = await findSample(client, input.sample)

      if (!sample.ok) return fail(sample.message)
      const experiment = await findExperiment(client, input.experiment)

      if ('message' in experiment) return fail(experiment.message)
      const unit = input.unit?.trim() || null

      const changes: ProposalChange[] = [
        {
          label: 'Take',
          before: null,
          after: `${input.quantity}${unit ? ` ${unit}` : ''}`,
        },
        {
          label: 'For',
          before: null,
          after: `${experiment.identifier} · ${experiment.title}`,
        },
      ]

      if (input.newContainer) {
        changes.push({
          label: 'New tube',
          before: null,
          after: input.newContainer.trim(),
        })
      }

      return card(input, {
        target: sampleLabel(sample.value),
        deepLink: `/records/${sample.value.id}`,
        changes,
        action: {
          kind: 'sample.withdraw',
          recordId: sample.value.id,
          metadataVersion: sample.value.metadata_version,
          quantity: input.quantity,
          unit,
          experimentId: experiment.id,
          notes: input.notes?.trim() || null,
          newContainer: input.newContainer?.trim() || null,
        },
      })
    }

    case SAMPLE_LABEL_TOOL: {
      const parsed = proposeSampleLabelSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const sample = await findSample(client, input.sample)

      if (!sample.ok) return fail(sample.message)

      return card(input, {
        target: sampleLabel(sample.value),
        deepLink: `/records/${sample.value.id}`,
        changes: [
          {
            label: 'Label',
            before: null,
            after: `Printed ${sample.value.identifier}`,
          },
        ],
        action: {
          kind: 'sample.label_printed',
          recordId: sample.value.id,
          metadataVersion: sample.value.metadata_version,
          identifier: sample.value.identifier,
        },
      })
    }

    case SAMPLE_MATCH_TOOL: {
      const parsed = proposeSampleMatchSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))

      return card(parsed.data, {
        target: 'Samples with a typed storage place',
        deepLink: '/samples',
        changes: [
          {
            label: 'Samples',
            before: 'Place typed as text',
            after: 'Filed in the box position it names, where exactly one fits',
          },
        ],
        action: {
          kind: 'sample.match_locations',
          workspaceId: context.workspaceId,
        },
      })
    }

    case POSITION_STATUS_TOOL: {
      const parsed = proposePositionStatusSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const box = await findBox(client, input.box)

      if (!box.ok) return fail(box.message)

      const rows = await client.list<{
        id: string
        label: string
        status: string
      }>(
        'storage_positions',
        `?box_id=eq.${box.value.id}&label=ilike.${likeValue(input.position.trim())}&select=id,label,status&limit=4`,
      )

      const position = rows.find(
        (row) =>
          row.label.toLowerCase() === input.position.trim().toLowerCase(),
      )

      if (!position) {
        return fail(`Box ${box.value.name} has no position ${input.position}.`)
      }

      if (position.status === 'occupied') {
        return fail(
          `${box.value.name} ${position.label} holds a sample, so its status cannot change. Move the sample first.`,
        )
      }

      return card(input, {
        target: `${box.value.name} · ${position.label}`,
        deepLink: '/settings/lab/storage',
        changes: [
          { label: 'Status', before: position.status, after: input.status },
        ],
        action: {
          kind: 'storage.position_status',
          positionId: position.id,
          status: input.status,
          notes: input.notes?.trim() || null,
        },
      })
    }

    case STOCKTAKE_SCAN_TOOL: {
      const parsed = proposeStocktakeScanSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const stocktake = await findStocktake(client, input.stocktake, true)

      if (!stocktake.ok) return fail(stocktake.message)

      const item = await findRecordOf(
        client,
        ['sample', 'material'],
        input.item,
      )

      if (!item.ok) return fail(item.message)
      let boxId: string | null = null
      let boxName: string | null = null

      if (input.box) {
        const box = await findBox(client, input.box)

        if (!box.ok) return fail(box.message)
        boxId = box.value.id
        boxName = box.value.name
      }

      return card(input, {
        target: stocktakeLabel(stocktake.value),
        deepLink: `/stocktake/${stocktake.value.id}`,
        changes: [
          { label: 'Found', before: null, after: label(item.value) },
          ...(boxName ? [{ label: 'In', before: null, after: boxName }] : []),
        ],
        action: {
          kind: 'stocktake.scan',
          stocktakeId: stocktake.value.id,
          recordId: item.value.id,
          boxId,
        },
      })
    }

    case STOCKTAKE_RESOLVE_TOOL: {
      const parsed = proposeStocktakeResolveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const stocktake = await findStocktake(client, input.stocktake, false)

      if (!stocktake.ok) return fail(stocktake.message)
      const like = likeValue(input.item)

      const items = await client.list<{
        id: string
        identifier: string
        title: string | null
        state: string
        resolution: string | null
      }>(
        'stocktake_items',
        `?stocktake_id=eq.${stocktake.value.id}&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,state,resolution&order=identifier.asc&limit=6`,
      )

      const lower = input.item.trim().toLowerCase()

      const item = pick(
        items,
        input.item,
        'item in that stocktake',
        (row) => `${row.identifier} · ${row.title ?? ''}`,
        (row) => row.identifier.toLowerCase() === lower,
      )

      if (!item.ok) return fail(item.message)

      if (item.value.resolution) {
        return fail(
          `${item.value.identifier} is already settled (${item.value.resolution.replaceAll('_', ' ')}).`,
        )
      }

      return card(input, {
        target: `${stocktakeLabel(stocktake.value)} · ${item.value.identifier}`,
        deepLink: `/stocktake/${stocktake.value.id}`,
        changes: [
          {
            label: 'Settle',
            before: item.value.state.replaceAll('_', ' '),
            after: input.action.replaceAll('_', ' '),
          },
        ],
        action: {
          kind: 'stocktake.resolve',
          itemId: item.value.id,
          stocktakeId: stocktake.value.id,
          action: input.action,
          notes: input.notes?.trim() || null,
        },
      })
    }

    case STOCKTAKE_CANCEL_TOOL: {
      const parsed = proposeStocktakeCancelSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const stocktake = await findStocktake(client, input.stocktake, true)

      if (!stocktake.ok) return fail(stocktake.message)

      return card(input, {
        target: stocktakeLabel(stocktake.value),
        deepLink: `/stocktake/${stocktake.value.id}`,
        changes: [{ label: 'Stocktake', before: 'Open', after: 'Cancelled' }],
        action: { kind: 'stocktake.cancel', stocktakeId: stocktake.value.id },
      })
    }

    case SHIPMENT_DISPATCH_TOOL: {
      const parsed = proposeShipmentDispatchSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const shipment = await findShipment(client, input.shipment, ['draft'])

      if (!shipment.ok) return fail(shipment.message)
      const row = shipment.value

      return card(input, {
        target: `${shipmentReference(row.number)} · ${row.counterparty}`,
        deepLink: '/shipments',
        changes: [
          { label: 'Status', before: 'Draft', after: 'In transit' },
          { label: 'Sent', before: null, after: input.shippedOn ?? today() },
          ...(input.carrier
            ? [{ label: 'Carrier', before: row.carrier, after: input.carrier }]
            : []),
          ...(input.trackingReference
            ? [
                {
                  label: 'Tracking',
                  before: row.tracking_reference,
                  after: input.trackingReference,
                },
              ]
            : []),
          ...(input.expectedOn
            ? [
                {
                  label: 'Expected',
                  before: row.expected_on,
                  after: input.expectedOn,
                },
              ]
            : []),
        ],
        action: {
          kind: 'shipment.dispatch',
          shipmentId: row.id,
          shippedOn: input.shippedOn ?? null,
          carrier: input.carrier?.trim() || null,
          trackingReference: input.trackingReference?.trim() || null,
          expectedOn: input.expectedOn ?? null,
        },
      })
    }

    case SHIPMENT_UPDATE_TOOL: {
      const parsed = proposeShipmentUpdateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      if (
        !input.counterparty &&
        !input.carrier &&
        !input.trackingReference &&
        !input.expectedOn &&
        !input.notes
      ) {
        return fail('Say what to change on the shipment.')
      }

      const shipment = await findShipment(client, input.shipment, [
        'draft',
        'in_transit',
      ])

      if (!shipment.ok) return fail(shipment.message)
      const row = shipment.value
      const changes: ProposalChange[] = []

      const push = (field: string, before: string | null, after?: string) => {
        if (after) changes.push({ label: field, before, after })
      }

      push('Counterparty', row.counterparty, input.counterparty)
      push('Carrier', row.carrier, input.carrier)
      push('Tracking', row.tracking_reference, input.trackingReference)
      push('Expected', row.expected_on, input.expectedOn)
      push('Notes', row.notes, input.notes)

      return card(input, {
        target: `${shipmentReference(row.number)} · ${row.counterparty}`,
        deepLink: '/shipments',
        changes,
        action: {
          kind: 'shipment.update',
          shipmentId: row.id,
          counterparty: input.counterparty?.trim() || null,
          carrier: input.carrier?.trim() || null,
          trackingReference: input.trackingReference?.trim() || null,
          expectedOn: input.expectedOn ?? null,
          notes: input.notes?.trim() || null,
        },
      })
    }

    case MATERIAL_SAFETY_TOOL: {
      const parsed = proposeMaterialSafetySchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const material = await findRecordOf(client, ['material'], input.material)

      if (!material.ok) return fail(material.message)

      const changes: ProposalChange[] = [
        {
          label: 'Pictograms',
          before: null,
          after: input.pictograms.length ? input.pictograms.join(', ') : 'None',
        },
        {
          label: 'Signal word',
          before: null,
          after: input.signalWord,
        },
      ]

      if (input.hazardStatements?.length) {
        changes.push({
          label: 'Hazards',
          before: null,
          after: input.hazardStatements.join(', '),
        })
      }

      return card(input, {
        target: label(material.value),
        deepLink: '/materials',
        changes,
        action: {
          kind: 'material.safety',
          recordId: material.value.id,
          pictograms: input.pictograms,
          signalWord: input.signalWord === 'none' ? null : input.signalWord,
          hazardStatements: input.hazardStatements ?? [],
          allLots: input.allLots ?? true,
        },
      })
    }

    case WORKFLOW_SAVE_TOOL: {
      const parsed = proposeWorkflowSaveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const names = input.steps.map((step) => step.name.trim().toLowerCase())

      if (new Set(names).size !== names.length) {
        return fail('Each step needs its own name.')
      }

      const existing = await client.list<{ id: string; name: string }>(
        'sample_workflows',
        `?name=ilike.${encodeURIComponent(input.name.trim())}&select=id,name&limit=2`,
      )

      const found = existing.find(
        (row) => row.name.toLowerCase() === input.name.trim().toLowerCase(),
      )

      const stages = found
        ? await client.list<{ id: string; name: string }>(
            'sample_workflow_stages',
            `?workflow_id=eq.${found.id}&select=id,name`,
          )
        : []

      const keys = input.steps.map((step, index) => {
        const same = stages.find(
          (stage) =>
            stage.name.toLowerCase() === step.name.trim().toLowerCase(),
        )

        return same?.id ?? `new-${index}`
      })

      return card(input, {
        target: found ? input.name : `New workflow · ${input.name}`,
        deepLink: '/settings/lab/workflows',
        changes: [
          {
            label: 'Steps',
            before: found ? 'Changed to' : null,
            after: input.steps.map((step) => step.name.trim()).join(' → '),
          },
          ...(input.sampleType
            ? [{ label: 'For', before: null, after: input.sampleType }]
            : []),
        ],
        action: {
          kind: 'sample_workflow.save',
          workflowId: found?.id ?? null,
          definition: {
            name: input.name.trim(),
            description: input.description?.trim() ?? '',
            sampleType: input.sampleType?.trim() ?? '',
            autoEnrol: input.autoEnrol ?? false,
            stages: input.steps.map((step, index) => ({
              key: keys[index],
              id: keys[index].startsWith('new-') ? undefined : keys[index],
              name: step.name.trim(),
              description: '',
              turnaroundDays: step.turnaroundDays ?? null,
              final: index === input.steps.length - 1,
              requiredFields: step.requiredFields ?? [],
              actions: [],
              next: index === input.steps.length - 1 ? [] : [keys[index + 1]],
            })),
          },
        },
      })
    }

    case WORKFLOW_STATUS_TOOL: {
      const parsed = proposeWorkflowStatusSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const rows = await client.list<{
        id: string
        name: string
        status: string
      }>(
        'sample_workflows',
        `?name=ilike.${likeValue(input.workflow)}&select=id,name,status&limit=6`,
      )

      const lower = input.workflow.trim().toLowerCase()

      const found = pick(
        rows,
        input.workflow,
        'workflow',
        (row) => row.name,
        (row) => row.name.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      if (found.value.status === input.status) {
        return fail(`${found.value.name} is already ${input.status}.`)
      }

      return card(input, {
        target: found.value.name,
        deepLink: '/settings/lab/workflows',
        changes: [
          { label: 'Status', before: found.value.status, after: input.status },
        ],
        action: {
          kind: 'sample_workflow.set_status',
          workflowId: found.value.id,
          status: input.status,
        },
      })
    }

    case RELEASE_RULES_TOOL: {
      const parsed = proposeReleaseRulesSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const describe = (rule: (typeof input.rules)[number]): string => {
        switch (rule.kind) {
          case 'no_result':
            return `No result of ${rule.result}`
          case 'min_measurements':
            return `At least ${rule.count} measurements`
          case 'measurement_required':
            return `${rule.measurement} measured`
          case 'measurement_range':
            return `${rule.measurement} between ${rule.min ?? 'any'} and ${rule.max ?? 'any'}`
        }
      }

      return card(input, {
        target: `Release rules · ${input.sampleType}`,
        deepLink: '/settings/lab/release',
        changes: [
          {
            label: 'Rules',
            before: null,
            after: input.rules.length
              ? input.rules.map(describe).join('; ')
              : 'None',
          },
        ],
        action: {
          kind: 'release_rules.set',
          workspaceId: context.workspaceId,
          sampleType: input.sampleType.trim(),
          rules: input.rules,
        },
      })
    }
  }
}
