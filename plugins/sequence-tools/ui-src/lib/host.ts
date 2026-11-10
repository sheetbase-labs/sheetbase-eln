/**
 * What the sequence block asks Sheetbase for. Each call is a `sheetbase.host`
 * request, made as the person, and the plugin's manifest declares the access
 * (projects:read and write, files:read, models:read). Changes ask
 * the person first.
 */
import { z } from 'zod'

import { sequenceOf } from '#/lib/sequence-block'
import type { SequenceBlockPayload } from '#/lib/sequence-block'

export interface BlockContext {
  plugin?: string
  block?: string
  recordId?: string | null
  blockId?: string | null
  readOnly?: boolean
}

export interface SiblingSequence {
  id: string
  payload: SequenceBlockPayload
}

interface BlockRow {
  id: string
  type: string
  payload: unknown
}

const pluginPayload = z.looseObject({
  plugin: z.string().optional(),
  block: z.string().optional(),
  state: z.unknown().optional(),
})

/** The other sequence blocks in this notebook that have a sequence. */
export async function siblingSequences(
  context: BlockContext,
): Promise<SiblingSequence[]> {
  const rows = await sheetbase.host<BlockRow[]>('blocks.list')

  return rows
    .filter((r) => r.id !== context.blockId)
    .map((r) => {
      const parsed = pluginPayload.safeParse(r.payload ?? {})

      if (r.type === 'plugin' && parsed.success) {
        const body = parsed.data

        return body.plugin === context.plugin && body.block === context.block
          ? { id: r.id, payload: sequenceOf(body.state ?? {}) }
          : null
      }

      return null
    })
    .filter((r): r is SiblingSequence => r !== null)
    .filter((r) => r.payload.residues.length > 0)
}

/** Add a sequence block below this one. */
export async function insertSequenceBelow(
  context: BlockContext,
  payload: SequenceBlockPayload,
): Promise<void> {
  await sheetbase.host('blocks.insertBelow', {
    type: 'plugin',
    payload: {
      plugin: context.plugin,
      block: context.block,
      state: payload,
    },
  })
}

export interface LinkedFile {
  fileRecordId: string
  name: string
  createdAt: string
}

export const listFiles = () => sheetbase.host<LinkedFile[]>('files.list')

export async function readTextFile(fileRecordId: string): Promise<string> {
  const out = await sheetbase.host<{ content: string }>('files.read', {
    fileRecordId,
    as: 'text',
  })

  return out.content
}
