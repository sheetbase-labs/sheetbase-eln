/**
 * .eln archive parser for import. Pure: bytes in, a plan of draft experiments
 * out. Only Notebook text is imported; blocks that reference workspace objects
 * (files, Sheets, Datasets, charts) and attached files are reported as skipped
 * rather than half-recreated, so an import never fabricates links or evidence.
 */
import { z } from 'zod'

import { PAYLOAD_SCHEMA_VERSION, isRichTextPayload } from '../blocks'
import type { RichTextPayload } from '../blocks'
import { plainTextOf } from './eln-archive'
import { readZip, ZipReadError } from './zip-read'

export interface ImportedExperiment {
  title: string
  tags: string[]
  /** Blocks ready for create_record_with_blocks. */
  blocks: Array<{
    type: 'rich_text'
    payload: unknown
    payload_schema_version: number
    order: number
  }>
  source: 'sheetbase' | 'ro-crate'
  sourceIdentifier: string | null
}

export interface ElnImportPlan {
  experiments: ImportedExperiment[]
  warnings: string[]
}

export class ElnImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ElnImportError'
  }
}

const MAX_TITLE = 300
const MAX_TAGS = 50

/** A value read from an archive's JSON sidecars. */
const archiveJson = z.json()

type ArchiveJson = z.infer<typeof archiveJson>

const archiveText = z.string()
const archiveJsonList = z.array(archiveJson)

/** RO-Crate writes a single value where a list is allowed. */
function asList(value: ArchiveJson | undefined): readonly ArchiveJson[] {
  const list = archiveJsonList.safeParse(value).data

  if (list !== undefined) return list

  return value === undefined ? [] : [value]
}

function textOf(value: ArchiveJson | undefined): string | undefined {
  return archiveText.safeParse(value).data
}

/** One entity in the crate's `@graph`. */
interface CrateEntity {
  id: string
  /** The raw `@type`, compared verbatim where the crate names a single type. */
  typeValue: ArchiveJson
  types: readonly ArchiveJson[]
  name: string | undefined
  hasPart: readonly ArchiveJson[]
  /** The entity's `text` when it is a plain string. */
  text: string | undefined
  /** The raw `text`, for rich-text payloads `plainTextOf` walks. */
  rawText: ArchiveJson
  description: string | undefined
  keywords: string | string[] | undefined
  identifier: string | undefined
}

const optionalCrateText = z.string().optional().catch(undefined)

const crateKeywords = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .catch(undefined)

const crateEntityFields = z.looseObject({
  '@id': z.string(),
  '@type': archiveJson.optional().catch(undefined),
  name: optionalCrateText,
  hasPart: archiveJson.optional().catch(undefined),
  text: archiveJson.optional().catch(undefined),
  description: optionalCrateText,
  keywords: crateKeywords,
  identifier: optionalCrateText,
})

/** Decode one graph entity; entities without a usable `@id` are skipped. */
function crateEntity(raw: ArchiveJson): CrateEntity | null {
  const decoded = crateEntityFields.safeParse(raw)

  if (!decoded.success) return null

  const fields = decoded.data

  return {
    id: fields['@id'],
    typeValue: fields['@type'] ?? null,
    types: asList(fields['@type']),
    name: fields.name,
    hasPart: asList(fields.hasPart),
    text: textOf(fields.text),
    rawText: fields.text ?? null,
    description: fields.description,
    keywords: fields.keywords,
    identifier: fields.identifier,
  }
}

const crateGraph = z.looseObject({ '@graph': z.array(archiveJson) })

const nativeExperiment = z.looseObject({
  record: archiveJson.optional().catch(undefined),
  blocks: archiveJsonList.optional().catch(undefined),
})

const nativeRecord = z.looseObject({
  title: optionalCrateText,
  tags: crateKeywords,
  identifier: optionalCrateText,
})

const nativeBlock = z.looseObject({
  type: z.literal('rich_text'),
  payload: archiveJson,
  order: archiveJson,
})

/** A crate reference: a bare string, or an object carrying `@id`. */
const crateReference = z.union([
  z.string(),
  z.looseObject({ '@id': z.string() }).transform((node) => node['@id']),
])

function refId(value: ArchiveJson | undefined): string | null {
  return crateReference.safeParse(value).data ?? null
}

function paragraphs(text: string): RichTextPayload {
  const content = text.split(/\r?\n/).map((line) =>
    line
      ? {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: line }],
        }
      : { type: 'paragraph' as const },
  )

  return {
    doc: {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    },
  }
}

function decodeJson(bytes: Uint8Array, name: string): ArchiveJson {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)

    return archiveJson.parse(JSON.parse(decoded))
  } catch {
    throw new ElnImportError(`${name} is not valid JSON.`)
  }
}

function clampTitle(title: string | undefined, fallback: string): string {
  const text = title?.trim() ?? ''

  return (text || fallback).slice(0, MAX_TITLE)
}

function splitKeywords(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : (value ?? '').split(',')

  return [...new Set(raw.map((t) => t.trim()).filter(Boolean))].slice(
    0,
    MAX_TAGS,
  )
}

export function parseElnArchive(bytes: Uint8Array): ElnImportPlan {
  let entries: Map<string, Uint8Array>

  try {
    entries = readZip(bytes)
  } catch (error) {
    if (error instanceof ZipReadError) throw new ElnImportError(error.message)
    throw error
  }

  const metadataPath = [...entries.keys()].find(
    (name) =>
      name === 'ro-crate-metadata.json' ||
      /^[^/]+\/ro-crate-metadata\.json$/.test(name),
  )

  if (!metadataPath) {
    throw new ElnImportError(
      'This is not a .eln archive: ro-crate-metadata.json is missing.',
    )
  }

  const prefix = metadataPath.slice(
    0,
    metadataPath.length - 'ro-crate-metadata.json'.length,
  )

  const metadataBytes = entries.get(metadataPath)

  if (!metadataBytes) {
    throw new ElnImportError(
      'This is not a .eln archive: ro-crate-metadata.json is missing.',
    )
  }

  const crate = crateGraph.safeParse(
    decodeJson(metadataBytes, 'ro-crate-metadata.json'),
  )

  if (!crate.success) {
    throw new ElnImportError('ro-crate-metadata.json has no @graph.')
  }

  const byId = new Map<string, CrateEntity>()

  for (const raw of crate.data['@graph']) {
    const entity = crateEntity(raw)

    if (entity) byId.set(entity.id, entity)
  }

  const rootEntity = byId.get('./')

  if (!rootEntity) throw new ElnImportError('The crate has no root dataset.')

  const warnings: string[] = []
  const experiments: ImportedExperiment[] = []

  for (const partRef of rootEntity.hasPart) {
    const id = refId(partRef)
    const entity = id ? byId.get(id) : undefined

    if (!id || !entity) continue

    if (!entity.types.includes('Dataset')) continue

    const nativePath = `${prefix}${id.replace(/^\.\//, '')}experiment.json`
    const nativeBytes = entries.get(nativePath)
    const label = clampTitle(entity.name, id)

    // Everything beyond text is reported, never silently dropped. A Sheetbase
    // archive's signature and audit sidecars are evidence of the source
    // system, not attachments, so they are reported on their own line.
    const fileParts = entity.hasPart
      .map(refId)
      .filter((p): p is string => !!p)
      .filter(
        (p) =>
          byId.get(p)?.typeValue === 'File' && !p.endsWith('/experiment.json'),
      )

    const isSidecar = (p: string) =>
      p.endsWith('/signatures.json') || p.endsWith('/audit.csv')

    const skippedFiles = fileParts.filter((p) => !isSidecar(p))

    if (skippedFiles.length > 0) {
      warnings.push(
        `${label}: ${skippedFiles.length} attached file(s) were not imported.`,
      )
    }

    if (fileParts.some(isSidecar)) {
      warnings.push(
        `${label}: signatures and audit history stay with the source; they were not imported.`,
      )
    }

    if (nativeBytes) {
      const native = nativeExperiment.safeParse(
        decodeJson(nativeBytes, nativePath),
      )

      const data = native.success ? native.data : {}
      const record = nativeRecord.safeParse(data.record).data ?? null
      const blocks = data.blocks ?? []

      const kept = blocks
        .flatMap((block) => {
          const parsed = nativeBlock.safeParse(block)

          return parsed.success && isRichTextPayload(parsed.data.payload)
            ? [parsed.data]
            : []
        })
        .sort((a, b) => Number(a.order) - Number(b.order))

      const dropped = blocks.length - kept.length

      if (dropped > 0) {
        warnings.push(
          `${label}: ${dropped} non-text block(s) were not imported.`,
        )
      }

      experiments.push({
        title: clampTitle(record?.title, label),
        tags: splitKeywords(record?.tags),
        blocks: (kept.length
          ? kept.map((b) => b.payload)
          : [paragraphs('')]
        ).map((payload, index) => ({
          type: 'rich_text' as const,
          payload,
          payload_schema_version: PAYLOAD_SCHEMA_VERSION,
          order: index + 1,
        })),
        source: 'sheetbase',
        sourceIdentifier: record?.identifier ?? null,
      })
      continue
    }

    const text =
      entity.text ?? entity.description ?? plainTextOf(entity.rawText)

    experiments.push({
      title: label,
      tags: splitKeywords(entity.keywords),
      blocks: [
        {
          type: 'rich_text',
          payload: paragraphs(text),
          payload_schema_version: PAYLOAD_SCHEMA_VERSION,
          order: 1,
        },
      ],
      source: 'ro-crate',
      sourceIdentifier: entity.identifier ?? null,
    })
  }

  if (experiments.length === 0) {
    throw new ElnImportError('The archive contains no experiments.')
  }

  return { experiments, warnings }
}
