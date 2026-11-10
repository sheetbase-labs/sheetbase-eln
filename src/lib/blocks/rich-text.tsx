import * as React from 'react'

import { LinkedText } from '#/components/ui/linked-text'
import type {
  RichTextHeadingNode,
  RichTextListNode,
  RichTextParagraphNode,
  RichTextPayload,
  RichTextTextNode,
} from './rich-text-data'

function renderText(node: RichTextTextNode, key: number): React.ReactNode {
  const plain = !(node.marks ?? []).some(
    (mark) => mark.type === 'link' || mark.type === 'code',
  )

  // An identifier that names a real record reads as a link to it.
  let child: React.ReactNode = plain ? (
    <LinkedText text={node.text} />
  ) : (
    node.text
  )

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
