/**
 * The words of a generated report, read back from the document that was stored
 * when it was generated.
 *
 * Word and PDF copies are made from that stored document, never from the live
 * sections, so every format shows the report exactly as that version was
 * generated. The fingerprint is the checksum of what the report was generated
 * from; it is the same for every format of one generation.
 */
import { z } from 'zod'

export type ReportParagraph =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'meta'; text: string }

export interface ReportDocumentSection {
  heading: string
  /** In the order the stored document has them: the words, then where they came from. */
  body: ReportParagraph[]
}

export interface ReportDocument {
  title: string
  subtitle: string | null
  /** "DOC-0001 · v3". */
  meta: string
  /** The short readable form of the checksum, the same in every format. */
  fingerprint: string
  generatedAt: string | null
  sections: ReportDocumentSection[]
}

const ENTITIES = new Map([
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&amp;', '&'],
])

const ENTITY_PATTERN = /&(?:lt|gt|quot|#39|amp);/g

function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (m) => ENTITIES.get(m) ?? m)
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The short form of a checksum a person can read out or compare. */
export function shortFingerprint(checksum: string): string {
  const head = checksum.slice(0, 8).toUpperCase()

  return `${head.slice(0, 4)}-${head.slice(4)}`
}

interface ProseNode {
  type?: string
  text?: string
  content?: ProseNode[]
}

const proseNode: z.ZodType<ProseNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    content: z.array(proseNode).optional(),
  }),
)

type Json = z.infer<ReturnType<typeof z.json>>

const frozenSchema = z.object({
  block: z
    .object({
      type: z.string().optional(),
      payload: z.json().optional(),
    })
    .optional(),
  snapshot: z.json().optional(),
  revisionDigest: z.string().optional(),
})

function nodeText(node: ProseNode): string {
  return (
    (node.text ?? '') + (node.content ?? []).map((n) => nodeText(n)).join('')
  )
}

function proseParagraphs(nodes: ProseNode[]): ReportParagraph[] {
  const out: ReportParagraph[] = []

  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content ?? []) {
        const text = nodeText(item).replace(/\s+/g, ' ').trim()

        if (text) out.push({ kind: 'bullet', text })
      }

      continue
    }

    const text = nodeText(node).replace(/\s+/g, ' ').trim()

    if (!text) continue
    out.push({ kind: node.type === 'heading' ? 'heading' : 'text', text })
  }

  return out
}

/** Every `text` value in a payload, in order, as one line. */
function textOf(value: Json | undefined): string {
  const out: string[] = []

  const walk = (node: Json | undefined) => {
    const list = z.array(z.json()).safeParse(node)

    if (list.success) {
      for (const item of list.data) walk(item)

      return
    }

    const record = z.record(z.string(), z.json()).safeParse(node)

    if (!record.success) return

    for (const [key, child] of Object.entries(record.data)) {
      const text = z.string().safeParse(child)

      if (key === 'text' && text.success) out.push(text.data)
      else walk(child)
    }
  }

  walk(value)

  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function safeJson(text: string): Json | null {
  try {
    return z.json().parse(JSON.parse(text))
  } catch {
    return null
  }
}

/** The frozen evidence of one section as paragraphs, instead of raw JSON. */
export function frozenParagraphs(json: string): ReportParagraph[] {
  const frozen = frozenSchema.safeParse(safeJson(json))

  if (!frozen.success) return [{ kind: 'code', text: json.trim() }]

  const out: ReportParagraph[] = []

  const payload = z
    .object({ doc: z.unknown().optional() })
    .safeParse(frozen.data.block?.payload)

  const doc = proseNode.safeParse(payload.success ? payload.data.doc : null)

  if (doc.success && doc.data.content?.length) {
    out.push(...proseParagraphs(doc.data.content))
  }

  if (out.length === 0) {
    const text = textOf(frozen.data.block?.payload ?? frozen.data.snapshot)

    if (text) out.push({ kind: 'text', text })
  }

  if (out.length === 0) {
    const kind = frozen.data.block?.type

    out.push({
      kind: 'text',
      text: kind
        ? `This section holds a ${kind.replace(/_/g, ' ')}, kept exactly as it was when the report was generated.`
        : 'This section holds saved data, kept exactly as it was when the report was generated.',
    })
  }

  if (frozen.data.revisionDigest) {
    out.push({
      kind: 'code',
      text: `Evidence digest ${frozen.data.revisionDigest}`,
    })
  }

  return out
}

function match(source: string, pattern: RegExp): string | null {
  const found = pattern.exec(source)

  return found?.[1] === undefined ? null : stripTags(found[1])
}

/** Read the stored document of one generation. */
export function parseReportHtml(
  html: string,
  info: { checksum: string; generatedAt: string | null },
): ReportDocument {
  const head = html.split(/<section[\s>]/, 1)[0] ?? ''

  const sectionSources = [
    ...html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g),
  ]

  const sections = sectionSources.map(
    ([, inner = '']): ReportDocumentSection => {
      const body: ReportParagraph[] = []
      let heading = ''

      for (const [, tag, attributes = '', content = ''] of inner.matchAll(
        /<(h2|p|pre)([^>]*)>([\s\S]*?)<\/\1>/g,
      )) {
        if (tag === 'h2') {
          heading = stripTags(content)
        } else if (tag === 'pre') {
          // Reports generated before the text was kept as words stored raw evidence.
          body.push(...frozenParagraphs(decodeEntities(content)))
        } else if (attributes.includes('meta')) {
          body.push({ kind: 'meta', text: stripTags(content) })
        } else {
          // Line breaks inside a paragraph are the person's own; each is kept.
          for (const line of decodeEntities(content).split(/\r?\n/)) {
            const text = line.replace(/\s+/g, ' ').trim()

            if (text) body.push({ kind: 'text', text })
          }
        }
      }

      return { heading, body }
    },
  )

  return {
    title:
      match(head, /<h1[^>]*>([\s\S]*?)<\/h1>/) ??
      match(head, /<title[^>]*>([\s\S]*?)<\/title>/) ??
      'Report',
    subtitle: match(head, /<p class="subtitle">([\s\S]*?)<\/p>/),
    meta: match(head, /<p class="meta">([\s\S]*?)<\/p>/) ?? '',
    fingerprint: shortFingerprint(info.checksum),
    generatedAt: info.generatedAt,
    sections,
  }
}

export const REPORT_FORMATS = ['docx', 'pdf', 'html'] as const

export type ReportFormat = (typeof REPORT_FORMATS)[number]

export const REPORT_CONTENT_TYPES: Readonly<Record<ReportFormat, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
}

/** A file name for a download: the identifier, version and format. */
export function reportFileName(
  identifier: string,
  version: number,
  format: ReportFormat,
): string {
  const safe = identifier
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safe || 'report'}-v${version}.${format}`
}
