import type {
  RichTextDocument,
  RichTextListItemNode,
  RichTextPayload,
} from './rich-text-data'

/**
 * Plain text to a rich-text block payload. Blank lines separate paragraphs;
 * lines starting `- ` or `* ` become a bullet list, `1. ` an ordered list, and
 * `## ` / `### ` a heading. Anything else is kept as written, so model output
 * and typed text land in the notebook the way they read.
 */
export function plainTextToRichText(text: string): RichTextPayload {
  const content: RichTextDocument['content'] = []
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: RichTextListItemNode[] } | null = null

  const textNodes = (value: string) =>
    value === '' ? undefined : [{ type: 'text' as const, text: value }]

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    content.push({
      type: 'paragraph',
      content: textNodes(paragraph.join(' ')),
    })
    paragraph = []
  }

  const flushList = () => {
    if (!list) return
    content.push({
      type: list.ordered ? 'orderedList' : 'bulletList',
      content: list.items,
    })
    list = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    const heading = /^(#{2,3})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)

    if (line === '') {
      flushParagraph()
      flushList()
    } else if (heading) {
      flushParagraph()
      flushList()
      content.push({
        type: 'heading',
        attrs: { level: heading[1] === '##' ? 2 : 3 },
        content: textNodes(heading[2]),
      })
    } else if (bullet || numbered) {
      flushParagraph()
      const ordered = numbered !== null

      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: textNodes(
              (bullet ? bullet[1] : (numbered?.[1] ?? '')).trim(),
            ),
          },
        ],
      })
    } else {
      flushList()
      paragraph.push(line)
    }
  }

  flushParagraph()
  flushList()

  if (content.length === 0) content.push({ type: 'paragraph' })

  return { doc: { type: 'doc', content } }
}
