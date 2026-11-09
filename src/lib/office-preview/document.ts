import DOMPurify from 'dompurify'

import { openArchive, parseXml, partText } from './zip'

/** The tags a converted document may keep; everything else is dropped. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'blockquote',
]

/**
 * Clean converted document HTML. The file is someone else's content, so only
 * a short list of tags and attributes survives and links open in a new tab.
 */
export function sanitiseDocumentHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  })

  const doc = new DOMParser().parseFromString(clean, 'text/html')

  for (const link of Array.from(doc.querySelectorAll('a'))) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }

  return doc.body.innerHTML
}

export async function readDocxHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const arrayBuffer = bytes.slice().buffer
  const { value } = await mammoth.convertToHtml({ arrayBuffer })

  return sanitiseDocumentHtml(value)
}

const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function odfBlock(node: Element): string {
  switch (node.localName) {
    case 'h': {
      const level = Math.min(
        Math.max(Number(node.getAttributeNS(TEXT_NS, 'outline-level') ?? 1), 1),
        4,
      )

      return `<h${level}>${escapeHtml(node.textContent)}</h${level}>`
    }

    case 'p':
      return `<p>${escapeHtml(node.textContent)}</p>`
    case 'list': {
      const items = Array.from(node.getElementsByTagNameNS(TEXT_NS, 'p'))
        .map((p) => `<li>${escapeHtml(p.textContent)}</li>`)
        .join('')

      return `<ul>${items}</ul>`
    }

    case 'table': {
      const rows = Array.from(
        node.getElementsByTagNameNS(TABLE_NS, 'table-row'),
      )
        .map((row) => {
          const cells = Array.from(
            row.getElementsByTagNameNS(TABLE_NS, 'table-cell'),
          )
            .map((c) => `<td>${escapeHtml(c.textContent)}</td>`)
            .join('')

          return `<tr>${cells}</tr>`
        })
        .join('')

      return `<table><tbody>${rows}</tbody></table>`
    }

    default:
      return ''
  }
}

export function readOdtHtml(bytes: Uint8Array): string {
  const archive = openArchive(bytes, (n) => n === 'content.xml')
  const xml = partText(archive, 'content.xml')

  if (!xml) throw new Error('The document has no content.')
  const doc = parseXml(xml)

  const body = doc
    .getElementsByTagNameNS(
      'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
      'text',
    )
    .item(0)

  if (!body) throw new Error('The document has no text.')
  const html = Array.from(body.children).map(odfBlock).join('')

  return sanitiseDocumentHtml(html)
}
