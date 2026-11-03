import { PAYLOAD_SCHEMA_VERSION, validateBlock } from './blocks'
import { plainTextToRichText } from './blocks/plain-text'
import { isRichTextPayload, richTextToPlainText } from './blocks/rich-text'
import type { DataClient } from './data-client'
import { recordDestination, sheetPath } from './navigation'
import { fetchRecordById } from './scientific-records'
import { toBlock } from './notebook-data'
import type { BlockWire } from './notebook-data'
import { sheetInstanceFromWire } from './sheet-instance-data'
import { sheetInstanceStateSchema } from './sheet-instance'
import { PROPOSAL_TOOLS, isProposalTool } from './assistant-proposals'
import type { AssistantProposal } from './assistant-proposals'

/**
 * Turns a model's proposal arguments into a card payload, against the person's
 * own data. Reads only. A bad id, a record the person cannot see, or a block
 * that is not plain text comes back as a short message the model can act on.
 */

export type ProposalOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const MAX_SHOWN = 240

function clip(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= MAX_SHOWN ? flat : `${flat.slice(0, MAX_SHOWN)}…`
}

function show(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return clip(typeof value === 'string' ? value : JSON.stringify(value))
}

async function fetchBlock(client: DataClient, blockId: string) {
  const rows = await client.list<BlockWire>(
    'blocks',
    `?id=eq.${encodeURIComponent(blockId)}`,
  )
  return rows.at(0) ? toBlock(rows[0] as BlockWire) : null
}

export async function buildAssistantProposal(
  client: DataClient,
  workspaceId: string,
  name: string,
  args: unknown,
): Promise<ProposalOutcome> {
  if (!isProposalTool(name)) {
    return { ok: false, message: 'That tool is not available.' }
  }
  const parsed = PROPOSAL_TOOLS[name].schema.safeParse(args)
  if (!parsed.success) {
    return {
      ok: false,
      message: `The proposal was not valid: ${parsed.error.issues
        .map(
          (issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`,
        )
        .join('; ')}`,
    }
  }
  const input = parsed.data as Record<string, unknown>
  const title = String(input.title)
  const summary = String(input.summary)

  switch (name) {
    case 'sheetbase.notebook_block.insert': {
      const recordId = String(input.recordId)
      const record = await fetchRecordById(client, recordId)
      if (!record) return { ok: false, message: 'That record was not found.' }
      const payload = plainTextToRichText(String(input.text))
      if (!validateBlock({ type: 'rich_text', payload }).ok) {
        return { ok: false, message: 'That text could not be made a block.' }
      }
      const afterBlockId =
        typeof input.afterBlockId === 'string' ? input.afterBlockId : null
      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: `${record.identifier} · ${record.title}`,
          deepLink: recordDestination(record.kind, record.id),
          changes: [
            {
              label: 'New text block',
              before: null,
              after: clip(String(input.text)),
            },
          ],
          operation: {
            kind: 'notebook_block.insert',
            recordId,
            afterBlockId,
            block: {
              type: 'rich_text',
              payload,
              payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
            },
            expectedRevision: record.structureVersion,
          } as AssistantProposal['operation'],
        },
      }
    }
    case 'sheetbase.notebook_block.update': {
      const block = await fetchBlock(client, String(input.blockId))
      if (!block) return { ok: false, message: 'That block was not found.' }
      if (block.type !== 'rich_text' || !isRichTextPayload(block.payload)) {
        return {
          ok: false,
          message: 'Only text blocks can be changed this way.',
        }
      }
      const record = await fetchRecordById(client, block.recordId)
      const payload = plainTextToRichText(String(input.text))
      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: record
            ? `${record.identifier} · ${record.title}`
            : 'Notebook',
          deepLink: record ? recordDestination(record.kind, record.id) : null,
          changes: [
            {
              label: 'Text block',
              before: show(richTextToPlainText(block.payload)),
              after: clip(String(input.text)),
            },
          ],
          operation: {
            kind: 'notebook_block.update',
            blockId: block.id,
            expectedVersion: block.version,
            payload,
            payloadSchemaVersion: block.payloadSchemaVersion,
          } as AssistantProposal['operation'],
        },
      }
    }
    case 'sheetbase.record.custom_fields.update': {
      const record = await fetchRecordById(client, String(input.recordId))
      if (!record) return { ok: false, message: 'That record was not found.' }
      const values = input.values as Record<string, unknown>
      const current = record.customFields ?? {}
      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: `${record.identifier} · ${record.title}`,
          deepLink: recordDestination(record.kind, record.id),
          changes: Object.entries(values).map(([field, value]) => ({
            label: field,
            before: show(current[field]),
            after: show(value) ?? '(empty)',
          })),
          operation: {
            kind: 'record.custom_fields.update',
            recordId: record.id,
            expectedMetadataVersion: record.metadataVersion,
            values,
          } as AssistantProposal['operation'],
        },
      }
    }
    case 'sheetbase.sheet_instance.update': {
      const rows = await client.list<unknown>(
        'sheet_instances',
        `?id=eq.${encodeURIComponent(String(input.instanceId))}&limit=1`,
      )
      if (rows.length === 0) {
        return { ok: false, message: 'That sheet was not found.' }
      }
      const instance = sheetInstanceFromWire(rows[0])
      const patch = input.localValues as Record<string, Record<string, unknown>>
      const localValues = { ...instance.state.localValues }
      const changes: AssistantProposal['changes'] = []
      for (const [rowId, cells] of Object.entries(patch)) {
        localValues[rowId] = { ...localValues[rowId], ...cells } as never
        for (const [fieldId, value] of Object.entries(cells)) {
          const label =
            instance.state.localFields.find(
              (field) => field.fieldId === fieldId,
            )?.label ?? fieldId
          changes.push({
            label: `${label} · ${rowId}`,
            before: show(instance.state.localValues[rowId]?.[fieldId]),
            after: show(value) ?? '(empty)',
          })
        }
      }
      const state = { ...instance.state, localValues }
      const checked = sheetInstanceStateSchema.safeParse(state)
      if (!checked.success) {
        return {
          ok: false,
          message: `Those values do not fit the sheet: ${checked.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        }
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title,
          summary,
          target: instance.name,
          deepLink: sheetPath(instance.id),
          changes,
          operation: {
            kind: 'sheet_instance.update',
            instanceId: instance.id,
            expectedRevision: instance.revision,
            state: checked.data,
          } as AssistantProposal['operation'],
        },
      }
    }
  }
  void workspaceId
}
