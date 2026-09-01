import * as React from 'react'

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

export type RichTextPayload = Record<string, unknown> & {
  doc: RichTextDocument
}

export const EMPTY_RICH_TEXT_PAYLOAD: RichTextPayload = {
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isSafeLink(href: string): boolean {
  return (
    href.startsWith('/') || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)
  )
}

function isMark(value: unknown): value is RichTextMark {
  if (!isObject(value) || typeof value.type !== 'string') return false
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
    typeof attrs.href === 'string' &&
    isSafeLink(attrs.href) &&
    [attrs.target, attrs.rel, attrs.class].every(
      (attribute) =>
        attribute === undefined ||
        attribute === null ||
        typeof attribute === 'string',
    )
  )
}

function isTextNode(value: unknown): value is RichTextTextNode {
  if (!isObject(value) || !hasOnlyKeys(value, ['type', 'text', 'marks'])) {
    return false
  }
  if (
    value.type !== 'text' ||
    typeof value.text !== 'string' ||
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
        (value.attrs.start as number) < 1)
    ) {
      return false
    }
    if (
      value.attrs.type !== undefined &&
      value.attrs.type !== null &&
      typeof value.attrs.type !== 'string'
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

function renderText(node: RichTextTextNode, key: number): React.ReactNode {
  let child: React.ReactNode = node.text
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        child = <strong>{child}</strong>
        break
      case 'italic':
        child = <em>{child}</em>
        break
      case 'code':
        child = (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {child}
          </code>
        )
        break
      case 'subscript':
        child = <sub>{child}</sub>
        break
      case 'superscript':
        child = <sup>{child}</sup>
        break
      case 'link':
        child = (
          <a
            className="text-primary underline underline-offset-2"
            href={mark.attrs.href}
            rel={mark.attrs.rel ?? undefined}
            target={mark.attrs.target ?? undefined}
          >
            {child}
          </a>
        )
        break
    }
  }
  return <React.Fragment key={key}>{child}</React.Fragment>
}

function renderNode(
  node: RichTextHeadingNode | RichTextParagraphNode | RichTextListNode,
  key: number,
  anchorPrefix?: string,
  /**
   * NOTE-02 same-block collapse: the node belongs to a collapsed section.
   * Hidden from view but kept in the DOM with `print:contents` so printed
   * and exported output stays fully expanded — the same mechanism the
   * block-granular collapse uses.
   */
  hidden = false,
): React.ReactNode {
  const hiddenClass = hidden ? 'hidden print:contents' : undefined
  if (node.type === 'paragraph') {
    return (
      <p key={key} className={hiddenClass}>
        {node.content?.map(renderText) ?? null}
      </p>
    )
  }
  if (node.type === 'heading') {
    const Tag = node.attrs.level === 2 ? 'h2' : 'h3'
    return (
      <Tag
        // NOTE-02: stable in-payload anchor. The ordinal is the heading's
        // index within the block payload — the same key the outline uses.
        id={anchorPrefix ? `${anchorPrefix}-h${key}` : undefined}
        className={[
          'scroll-mt-28',
          node.attrs.level === 2
            ? 'font-display text-lg font-semibold leading-7 tracking-tight'
            : 'font-display text-base font-semibold leading-6 tracking-tight',
          // NOTE-02 nested collapse: a lower-level heading inside a
          // collapsed enclosing section (e.g. an H3 inside a collapsed H2)
          // is hidden from view but kept for print, like other nodes.
          hiddenClass,
        ]
          .filter(Boolean)
          .join(' ')}
        key={key}
      >
        {node.content?.map(renderText) ?? null}
      </Tag>
    )
  }
  const Tag = node.type === 'orderedList' ? 'ol' : 'ul'
  return (
    <Tag
      key={key}
      className={hiddenClass}
      start={node.type === 'orderedList' ? node.attrs?.start : undefined}
    >
      {node.content.map((item, itemIndex) => (
        <li key={itemIndex}>
          {item.content.map((child, childKey) => renderNode(child, childKey))}
        </li>
      ))}
    </Tag>
  )
}

export function RichTextContent({
  payload,
  className,
  anchorPrefix,
  hiddenNodeIndexes,
}: {
  payload: RichTextPayload
  className?: string
  /** NOTE-02: when set, H2/H3 nodes get stable `#<prefix>-h<index>` anchors. */
  anchorPrefix?: string
  /**
   * NOTE-02 same-block collapse: top-level node indexes inside this payload
   * hidden by a collapsed section. Hidden nodes stay in the DOM with
   * `hidden print:contents` so print output remains fully expanded.
   */
  hiddenNodeIndexes?: ReadonlySet<number>
}) {
  return (
    <div
      className={[
        'space-y-1.5 text-sm leading-6 text-foreground [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5 [&_p]:min-h-[1.25rem] [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {payload.doc.content.map((node, key) =>
        renderNode(node, key, anchorPrefix, hiddenNodeIndexes?.has(key)),
      )}
    </div>
  )
}
