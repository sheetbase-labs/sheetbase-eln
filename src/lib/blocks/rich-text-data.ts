import { z } from 'zod'

const stringSchema = z.string()
const nativeFieldsSchema = z.record(z.string(), z.unknown())

const nativeObjectSchema = z.custom<z.infer<typeof nativeFieldsSchema>>(
  (value) =>
    // Accept only native non-null, nonarray containers without copying identity or reading inherited/accessor values. This is not full document validation.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    typeof value === 'object' && value !== null && !Array.isArray(value),
)

function isString(value: unknown): value is string {
  return stringSchema.safeParse(value).success
}

export type RichTextMark =
  | { type: 'bold' | 'italic' | 'code' | 'subscript' | 'superscript' }
  | {
      type: 'link'
      attrs: {
        href: string
        target?: string | null
        rel?: string | null
        class?: string | null
      }
    }

export interface RichTextTextNode {
  type: 'text'
  text: string
  marks?: RichTextMark[]
}

export interface RichTextParagraphNode {
  type: 'paragraph'
  content?: RichTextTextNode[]
}

export interface RichTextHeadingNode {
  type: 'heading'
  attrs: { level: 2 | 3 }
  content?: RichTextTextNode[]
}

export interface RichTextListItemNode {
  type: 'listItem'
  content: Array<RichTextParagraphNode | RichTextListNode>
}

export interface RichTextListNode {
  type: 'bulletList' | 'orderedList'
  attrs?: { start?: number; type?: string | null }
  content: RichTextListItemNode[]
}

export interface RichTextDocument {
  type: 'doc'
  content: Array<RichTextHeadingNode | RichTextParagraphNode | RichTextListNode>
}

export type RichTextPayload = z.infer<typeof nativeFieldsSchema> & {
  doc: RichTextDocument
}

export const EMPTY_RICH_TEXT_PAYLOAD: RichTextPayload = {
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
}

const emptyRichTextSchema = z.unknown().transform((payload) => {
  if (!isObject(payload) || !isObject(payload.doc)) return false
  const content = payload.doc.content

  if (!Array.isArray(content)) return true

  return content.every(
    (node) =>
      isObject(node) &&
      node.type === 'paragraph' &&
      (!Array.isArray(node.content) || node.content.length === 0),
  )
})

/** Whether a rich-text payload holds no text at all: only empty paragraphs. */
export function isEmptyRichText(
  payload: z.input<typeof emptyRichTextSchema>,
): boolean {
  return emptyRichTextSchema.parse(payload)
}

function isObject(value: unknown): value is z.infer<typeof nativeObjectSchema> {
  return nativeObjectSchema.safeParse(value).success
}

function hasOnlyKeys(
  value: z.infer<typeof nativeObjectSchema>,
  keys: string[],
): boolean {
  const allowedKeys = new Set(keys)

  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isSafeLink(href: string): boolean {
  return (
    href.startsWith('/') || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)
  )
}

function isMark(value: unknown): value is RichTextMark {
  if (!isObject(value) || !isString(value.type)) return false

  if (
    ['bold', 'italic', 'code', 'subscript', 'superscript'].includes(value.type)
  ) {
    return hasOnlyKeys(value, ['type'])
  }

  if (value.type !== 'link' || !hasOnlyKeys(value, ['type', 'attrs'])) {
    return false
  }

  const attrs = value.attrs

  if (
    !isObject(attrs) ||
    !hasOnlyKeys(attrs, ['href', 'target', 'rel', 'class'])
  ) {
    return false
  }

  return (
    isString(attrs.href) &&
    isSafeLink(attrs.href) &&
    [attrs.target, attrs.rel, attrs.class].every(
      (attribute) =>
        attribute === undefined || attribute === null || isString(attribute),
    )
  )
}

function isTextNode(value: unknown): value is RichTextTextNode {
  if (!isObject(value) || !hasOnlyKeys(value, ['type', 'text', 'marks'])) {
    return false
  }

  if (
    value.type !== 'text' ||
    !isString(value.text) ||
    value.text.length === 0
  ) {
    return false
  }

  if (value.marks === undefined) return true

  if (!Array.isArray(value.marks) || !value.marks.every(isMark)) return false
  const markTypes = value.marks.map((mark) => mark.type)

  if (new Set(markTypes).size !== markTypes.length) return false

  if (markTypes.includes('code') && markTypes.length > 1) return false

  return !(markTypes.includes('subscript') && markTypes.includes('superscript'))
}

function isParagraph(value: unknown): value is RichTextParagraphNode {
  if (!isObject(value) || !hasOnlyKeys(value, ['type', 'content'])) return false

  return (
    value.type === 'paragraph' &&
    (value.content === undefined ||
      (Array.isArray(value.content) && value.content.every(isTextNode)))
  )
}

function isHeading(value: unknown): value is RichTextHeadingNode {
  if (!isObject(value) || !hasOnlyKeys(value, ['type', 'attrs', 'content'])) {
    return false
  }

  if (
    value.type !== 'heading' ||
    !isObject(value.attrs) ||
    !hasOnlyKeys(value.attrs, ['level']) ||
    (value.attrs.level !== 2 && value.attrs.level !== 3)
  ) {
    return false
  }

  return (
    value.content === undefined ||
    (Array.isArray(value.content) && value.content.every(isTextNode))
  )
}

function isList(value: unknown): value is RichTextListNode {
  if (!isObject(value) || !hasOnlyKeys(value, ['type', 'attrs', 'content'])) {
    return false
  }

  if (value.type !== 'bulletList' && value.type !== 'orderedList') return false

  if (value.attrs !== undefined) {
    if (
      !isObject(value.attrs) ||
      !hasOnlyKeys(value.attrs, ['start', 'type'])
    ) {
      return false
    }

    if (
      value.attrs.start !== undefined &&
      (!Number.isInteger(value.attrs.start) ||
        // @ts-expect-error Native compatibility: the prior integer check does not establish the later getter's type; preserve this third read's native coercion and throws.
        value.attrs.start < 1)
    ) {
      return false
    }

    if (
      value.attrs.type !== undefined &&
      value.attrs.type !== null &&
      !isString(value.attrs.type)
    ) {
      return false
    }
  }

  return (
    Array.isArray(value.content) &&
    value.content.length > 0 &&
    value.content.every((item) => {
      if (!isObject(item) || !hasOnlyKeys(item, ['type', 'content']))
        return false

      return (
        item.type === 'listItem' &&
        Array.isArray(item.content) &&
        item.content.length > 0 &&
        isParagraph(item.content[0]) &&
        item.content.slice(1).every(isList)
      )
    })
  )
}

export function isRichTextPayload(value: unknown): value is RichTextPayload {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ['doc']) ||
    !isObject(value.doc)
  ) {
    return false
  }

  const doc = value.doc

  return (
    hasOnlyKeys(doc, ['type', 'content']) &&
    doc.type === 'doc' &&
    Array.isArray(doc.content) &&
    doc.content.length > 0 &&
    doc.content.every(
      (node) => isHeading(node) || isParagraph(node) || isList(node),
    )
  )
}

export function richTextToPlainText(payload: RichTextPayload): string {
  function nodeText(
    node: RichTextHeadingNode | RichTextParagraphNode | RichTextListNode,
  ): string {
    if (node.type === 'paragraph' || node.type === 'heading') {
      return node.content?.map((child) => child.text).join('') ?? ''
    }

    return node.content
      .map((item) => item.content.map(nodeText).join('\n'))
      .join('\n')
  }

  return payload.doc.content.map(nodeText).join('\n').trim()
}
