/**
 * .eln archive parser for import. Pure: bytes in, a plan of draft experiments
 * out. Only Notebook text is imported; blocks that reference workspace objects
 * (files, Sheets, Datasets, charts) and attached files are reported as skipped
 * rather than half-recreated, so an import never fabricates links or evidence.
 */
import { PAYLOAD_SCHEMA_VERSION, isRichTextPayload } from '../blocks'
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

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function paragraphs(text: string): unknown {
  const content = text
    .split(/\r?\n/)
    .map((line) =>
      line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    )
  return {
    doc: {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    },
  }
}

function decodeJson(bytes: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ElnImportError(`${name} is not valid JSON.`)
  }
}

function ref(value: unknown): string | null {
  if (isObject(value) && typeof value['@id'] === 'string') return value['@id']
  return typeof value === 'string' ? value : null
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function clampTitle(title: unknown, fallback: string): string {
  const text = typeof title === 'string' ? title.trim() : ''
  return (text || fallback).slice(0, MAX_TITLE)
}

function splitKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(',')
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
  const crate = decodeJson(entries.get(metadataPath)!, 'ro-crate-metadata.json')
  const graph =
    isObject(crate) && Array.isArray(crate['@graph']) ? crate['@graph'] : null
  if (!graph) throw new ElnImportError('ro-crate-metadata.json has no @graph.')

  const byId = new Map<string, Json>()
  for (const entity of graph) {
    if (isObject(entity) && typeof entity['@id'] === 'string')
      byId.set(entity['@id'], entity)
  }
  const rootEntity = byId.get('./')
  if (!rootEntity) throw new ElnImportError('The crate has no root dataset.')

  const warnings: string[] = []
  const experiments: ImportedExperiment[] = []

  for (const partRef of asList(rootEntity.hasPart)) {
    const id = ref(partRef)
    const entity = id ? byId.get(id) : undefined
    if (!id || !entity) continue
    const types = asList(entity['@type'])
    if (!types.includes('Dataset')) continue

    const nativePath = `${prefix}${id.replace(/^\.\//, '')}experiment.json`
    const nativeBytes = entries.get(nativePath)
    const label = clampTitle(entity.name, id)

    // Everything beyond text is reported, never silently dropped.
    const skippedFiles = asList(entity.hasPart)
      .map(ref)
      .filter((p): p is string => !!p)
      .filter(
        (p) =>
          byId.get(p)?.['@type'] === 'File' && !p.endsWith('/experiment.json'),
      )
    if (skippedFiles.length > 0) {
      warnings.push(
        `${label}: ${skippedFiles.length} attached file(s) were not imported.`,
      )
    }

    if (nativeBytes) {
      const doc = decodeJson(nativeBytes, nativePath)
      const record = isObject(doc) && isObject(doc.record) ? doc.record : null
      const blocks =
        isObject(doc) && Array.isArray(doc.blocks) ? doc.blocks : []
      const kept = blocks
        .filter(
          (b): b is Json =>
            isObject(b) &&
            b.type === 'rich_text' &&
            isRichTextPayload(b.payload),
        )
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
        sourceIdentifier:
          typeof record?.identifier === 'string' ? record.identifier : null,
      })
      continue
    }

    const text =
      typeof entity.text === 'string'
        ? entity.text
        : typeof entity.description === 'string'
          ? entity.description
          : plainTextOf(entity.text)
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
      sourceIdentifier:
        typeof entity.identifier === 'string' ? entity.identifier : null,
    })
  }

  if (experiments.length === 0) {
    throw new ElnImportError('The archive contains no experiments.')
  }
  return { experiments, warnings }
}
