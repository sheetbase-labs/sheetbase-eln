/**
 * .eln archive builder (ELN Consortium file format).
 *
 * A .eln file is a ZIP holding one top-level folder with an RO-Crate 1.1
 * `ro-crate-metadata.json` (https://github.com/TheELNConsortium/TheELNFileFormat).
 * Each experiment becomes a `Dataset` entity in the crate with its attached
 * files, linked Datasets (CSV), signature records and audit history as parts.
 * `experiment.json` carries the native Notebook document so a Sheetbase import
 * is lossless for text; other ELNs read the crate metadata.
 *
 * Pure and deterministic: bytes derive from the input alone. `exportedAt` is
 * the one caller-supplied timestamp (RO-Crate requires `datePublished`).
 */
import { createHash } from 'node:crypto'

import { z } from 'zod'

import { ZipWriter } from '../export/zip'

export const ELN_CONTEXT = [
  'https://w3id.org/ro/crate/1.1/context',
  { sheetbase: 'https://sheetbase.io/ns/eln#' },
] as const

export interface ElnBlock {
  id: string
  type: string
  order: number
  payloadSchemaVersion: number
  payload: unknown
}

export interface ElnFile {
  fileRecordId: string
  fileIdentifier: string
  displayName: string
  mediaType: string
  /** Absent when the stored bytes could not be read; listed as missing. */
  bytes: Uint8Array | null
  missingReason?: string
}

export interface ElnDataset {
  id: string
  displayId: string | null
  name: string
  description: string | null
  csv: string
}

export interface ElnSignature {
  id: string
  revisionId: string
  signerUserId: string
  signerName: string | null
  signerRole: string
  signatureMeaning: string
  authMethod: string
  revisionIntegrityDigest: string
  signedAt: string
}

export interface ElnExperiment {
  record: {
    id: string
    identifier: string
    title: string
    kind: string
    status: string
    tags: string[]
    createdAt?: string | null
    properties?: unknown
    customFields?: unknown
  }
  blocks: ElnBlock[]
  files: ElnFile[]
  datasets: ElnDataset[]
  signatures: ElnSignature[]
  auditCsv: string
}

export interface ElnArchiveInput {
  /** Archive title: the project or the single experiment. */
  name: string
  description?: string | null
  /** Project this export covers, when exporting a whole project. */
  project?: { id: string; key: string; title: string; status: string } | null
  workspaceId: string
  exportedAt: string
  experiments: ElnExperiment[]
  /** Licence the package is released under, when it is being published. */
  license?: { id: string; url: string; name: string } | null
  /** Who the package is by, when it is being published. */
  authors?: Array<{ name: string }>
  /** DOI reserved for the package, when it is being published. */
  doi?: string | null
}

/** A value an RO-Crate entity holds before serialisation; `undefined` marks a
 * property the package leaves out. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue }

type Json = Record<string, JsonValue>

/** File-system safe, ASCII, no leading dots; never empty. */
export function safeName(name: string, fallback: string): string {
  const cleaned = name
    .normalize('NFKD')
    // Keep ranges such as "2–8 °C" readable: Unicode dashes become hyphens
    // before non-ASCII is dropped.
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^\x20-\x7e]/g, '')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\\/:*?"<>|\0-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()

  return cleaned || fallback
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The document fields this reader knows: a payload's own `doc` and one node's
 * kind, text and children. */
const documentNodeSchema = z.object({
  doc: z.json().optional(),
  type: z.json().optional(),
  text: z.json().optional(),
  content: z.json().optional(),
})

const documentTextSchema = z.string()
const documentChildrenSchema = z.array(z.json())

/** Concatenate every string leaf named `text` in a document tree. */
export function plainTextOf(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A block payload is opaque JSONB owned by its block type; this reader decodes it with z.json() and documentNodeSchema before reading the three keys it knows.
  payload: unknown,
): string {
  const lines: string[] = []

  const walk = (node: z.infer<ReturnType<typeof z.json>>): string => {
    const parsed = documentNodeSchema.safeParse(node)

    if (!parsed.success) return ''

    const n = parsed.data
    const text = documentTextSchema.safeParse(n.text)

    if (n.type === 'text' && text.success) return text.data

    const children = documentChildrenSchema.safeParse(n.content)
    const joined = children.success ? children.data.map(walk) : []

    return n.type === 'paragraph' || n.type === 'heading'
      ? joined.join('')
      : joined.join('\n')
  }

  const decoded = z.json().safeParse(payload)

  if (!decoded.success) return ''

  const node = documentNodeSchema.safeParse(decoded.data)
  const root = node.success ? (node.data.doc ?? decoded.data) : decoded.data
  const text = walk(root).trim()

  if (text) lines.push(text)

  return lines.join('\n')
}

function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name)

    return name
  }

  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`

    if (!taken.has(candidate)) {
      taken.add(candidate)

      return candidate
    }
  }
}

export interface BuiltElnArchive {
  bytes: Uint8Array
  /** Names of files whose bytes were unavailable, with the reason. */
  missingFiles: Array<{ experiment: string; name: string; reason: string }>
}

export async function buildElnArchive(
  input: ElnArchiveInput,
): Promise<BuiltElnArchive> {
  const root = safeName(input.name, 'sheetbase-export')
  const writer = new ZipWriter()
  const graph: Json[] = []
  const rootParts: Json[] = []
  const missingFiles: BuiltElnArchive['missingFiles'] = []
  const persons = new Map<string, Json>()
  const takenDirs = new Set<string>()

  const add = (path: string, content: string | Uint8Array) =>
    writer.add(`${root}/${path}`, content)

  for (const exp of input.experiments) {
    const { record } = exp

    const dir = uniqueName(
      takenDirs,
      safeName(`${record.identifier} ${record.title}`, record.identifier),
    )

    const dirId = `./${dir}/`
    const parts: Json[] = []
    const entities: Json[] = []

    // Native document, for lossless Sheetbase import.
    const native = {
      formatVersion: 1,
      record: {
        id: record.id,
        identifier: record.identifier,
        title: record.title,
        kind: record.kind,
        status: record.status,
        tags: record.tags,
        properties: record.properties ?? {},
        customFields: record.customFields ?? {},
      },
      blocks: exp.blocks,
    }

    add(`${dir}/experiment.json`, JSON.stringify(native, null, 2))
    entities.push({
      '@id': `${dirId}experiment.json`,
      '@type': 'File',
      name: 'Sheetbase notebook document',
      encodingFormat: 'application/json',
      conformsTo: { '@id': 'https://sheetbase.io/ns/eln#experiment' },
    })
    parts.push({ '@id': `${dirId}experiment.json` })

    const takenFiles = new Set<string>()

    for (const file of exp.files) {
      if (!file.bytes) {
        missingFiles.push({
          experiment: record.identifier,
          name: file.displayName,
          reason: file.missingReason ?? 'unavailable',
        })
        continue
      }

      const name = uniqueName(
        takenFiles,
        safeName(file.displayName, file.fileIdentifier),
      )

      const path = `${dir}/files/${name}`
      add(path, file.bytes)
      entities.push({
        '@id': `./${path}`,
        '@type': 'File',
        name: file.displayName,
        identifier: file.fileIdentifier,
        encodingFormat: file.mediaType,
        contentSize: String(file.bytes.length),
        sha256: sha256(file.bytes),
      })
      parts.push({ '@id': `./${path}` })
    }

    const takenSets = new Set<string>()

    for (const dataset of exp.datasets) {
      const name = uniqueName(
        takenSets,
        `${safeName(dataset.displayId ?? dataset.name, dataset.id)}.csv`,
      )

      const path = `${dir}/datasets/${name}`
      const bytes = new TextEncoder().encode(dataset.csv)
      add(path, bytes)
      entities.push({
        '@id': `./${path}`,
        '@type': 'File',
        name: dataset.name,
        description: dataset.description ?? undefined,
        identifier: dataset.displayId ?? dataset.id,
        encodingFormat: 'text/csv',
        contentSize: String(bytes.length),
        sha256: sha256(bytes),
      })
      parts.push({ '@id': `./${path}` })
    }

    if (exp.signatures.length > 0) {
      const sigBytes = new TextEncoder().encode(
        JSON.stringify(exp.signatures, null, 2),
      )

      add(`${dir}/signatures.json`, sigBytes)
      entities.push({
        '@id': `${dirId}signatures.json`,
        '@type': 'File',
        name: 'Electronic signatures',
        encodingFormat: 'application/json',
        contentSize: String(sigBytes.length),
        sha256: sha256(sigBytes),
      })
      parts.push({ '@id': `${dirId}signatures.json` })

      for (const sig of exp.signatures) {
        const personId = `#person-${sig.signerUserId}`

        if (!persons.has(personId)) {
          persons.set(personId, {
            '@id': personId,
            '@type': 'Person',
            name: sig.signerName ?? sig.signerUserId,
          })
        }

        entities.push({
          '@id': `#signature-${sig.id}`,
          '@type': ['Action', 'sheetbase:Signature'],
          name: `Signed: ${sig.signatureMeaning}`,
          agent: { '@id': personId },
          object: { '@id': dirId },
          endTime: sig.signedAt,
          'sheetbase:meaning': sig.signatureMeaning,
          'sheetbase:signerRole': sig.signerRole,
          'sheetbase:authMethod': sig.authMethod,
          'sheetbase:revisionId': sig.revisionId,
          'sheetbase:revisionIntegrityDigest': sig.revisionIntegrityDigest,
        })
      }
    }

    const auditBytes = new TextEncoder().encode(exp.auditCsv)
    add(`${dir}/audit.csv`, auditBytes)
    entities.push({
      '@id': `${dirId}audit.csv`,
      '@type': 'File',
      name: 'Audit history',
      encodingFormat: 'text/csv',
      contentSize: String(auditBytes.length),
      sha256: sha256(auditBytes),
    })
    parts.push({ '@id': `${dirId}audit.csv` })

    const text = exp.blocks
      .filter((b) => b.type === 'rich_text')
      .map((b) => plainTextOf(b.payload))
      .filter(Boolean)
      .join('\n\n')

    graph.push({
      '@id': dirId,
      '@type': 'Dataset',
      identifier: record.identifier,
      name: record.title,
      text,
      keywords: record.tags.join(', '),
      dateCreated: record.createdAt ?? undefined,
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'status', value: record.status },
        { '@type': 'PropertyValue', name: 'kind', value: record.kind },
      ],
      hasPart: parts,
    })
    graph.push(...entities)
    rootParts.push({ '@id': dirId })
  }

  const rootEntity = {
    '@id': './',
    '@type': 'Dataset',
    name: input.name,
    description: input.description ?? undefined,
    datePublished: input.exportedAt,
    license: input.license ? { '@id': input.license.url } : undefined,
    author: input.authors?.length
      ? input.authors.map((_, i) => ({ '@id': `#author-${i + 1}` }))
      : undefined,
    identifier: input.project
      ? input.project.key
      : input.doi
        ? `https://doi.org/${input.doi}`
        : undefined,
    hasPart: rootParts,
    additionalProperty: input.project
      ? [
          {
            '@type': 'PropertyValue',
            name: 'projectStatus',
            value: input.project.status,
          },
        ]
      : undefined,
  }

  const publishing: Json[] = []

  if (input.license) {
    publishing.push({
      '@id': input.license.url,
      '@type': 'CreativeWork',
      name: input.license.name,
      identifier: input.license.id,
    })
  }

  for (const [i, author] of (input.authors ?? []).entries()) {
    publishing.push({
      '@id': `#author-${i + 1}`,
      '@type': 'Person',
      name: author.name,
    })
  }

  const crate = {
    '@context': ELN_CONTEXT,
    '@graph': [
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        about: { '@id': './' },
        conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
        sdPublisher: { '@id': '#sheetbase' },
        dateCreated: input.exportedAt,
      },
      {
        '@id': '#sheetbase',
        '@type': 'Organization',
        name: 'Sheetbase',
        url: 'https://sheetbase.io',
      },
      rootEntity,
      ...publishing,
      ...persons.values(),
      ...graph,
    ],
  }

  add('ro-crate-metadata.json', JSON.stringify(crate, null, 2))

  return { bytes: await writer.stream(), missingFiles }
}
