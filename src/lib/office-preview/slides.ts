import {
  imageTypeOf,
  openArchive,
  parseXml,
  partText,
  relationships,
} from './zip'
import type { Archive } from './zip'

export interface SlideImage {
  data: Uint8Array
  mediaType: string
}

export interface PreviewSlide {
  number: number
  title: string | null
  lines: string[]
  images: SlideImage[]
}

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'

const R_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const PRESENTATION_NS = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Cap on slides read, so a very long deck cannot stall the page. */
export const MAX_PREVIEW_SLIDES = 200

function paragraphText(p: Element, ns: string, run: string): string {
  return Array.from(p.getElementsByTagNameNS(ns, run))
    .map((r) => r.textContent)
    .join('')
    .trim()
}

function slidePartsInOrder(archive: Archive): string[] {
  const presentation = partText(archive, 'ppt/presentation.xml')

  const rels = relationships(
    archive,
    'ppt/_rels/presentation.xml.rels',
    'ppt/presentation.xml',
  )

  if (presentation) {
    const doc = parseXml(presentation)
    const ordered: string[] = []

    for (const id of Array.from(doc.getElementsByTagNameNS(P_NS, 'sldId'))) {
      const rId = id.getAttributeNS(R_NS, 'id')
      const part = rId ? rels.get(rId) : undefined

      if (part && part in archive) ordered.push(part)
    }

    if (ordered.length > 0) return ordered
  }

  return Object.keys(archive)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(
      (a, b) =>
        Number(a.match(/(\d+)\.xml$/)?.[1]) -
        Number(b.match(/(\d+)\.xml$/)?.[1]),
    )
}

export function readPptxSlides(bytes: Uint8Array): PreviewSlide[] {
  const archive = openArchive(
    bytes,
    (n) =>
      n === 'ppt/presentation.xml' ||
      n === 'ppt/_rels/presentation.xml.rels' ||
      /^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/.test(n) ||
      /^ppt\/media\//.test(n),
  )

  const parts = slidePartsInOrder(archive).slice(0, MAX_PREVIEW_SLIDES)

  return parts.map((part, index) => {
    const doc = parseXml(partText(archive, part) ?? '<p/>')

    const rels = relationships(
      archive,
      part.replace(/([^/]+)$/, '_rels/$1.rels'),
      part,
    )

    let title: string | null = null
    const lines: string[] = []

    for (const shape of Array.from(doc.getElementsByTagNameNS(P_NS, 'sp'))) {
      const placeholder = shape.getElementsByTagNameNS(P_NS, 'ph').item(0)
      const kind = placeholder?.getAttribute('type')
      const isTitle = kind === 'title' || kind === 'ctrTitle'

      const texts = Array.from(shape.getElementsByTagNameNS(A_NS, 'p'))
        .map((p) => paragraphText(p, A_NS, 't'))
        .filter(Boolean)

      if (isTitle && title === null && texts.length > 0) title = texts.join(' ')
      else lines.push(...texts)
    }

    const images: SlideImage[] = []

    for (const blip of Array.from(doc.getElementsByTagNameNS(A_NS, 'blip'))) {
      const rId = blip.getAttributeNS(R_NS, 'embed')
      const target = rId ? rels.get(rId) : undefined
      const mediaType = target ? imageTypeOf(target) : null
      const data = target ? archive[target] : undefined

      if (mediaType && data) images.push({ data, mediaType })
    }

    return { number: index + 1, title, lines, images }
  })
}

export function readOdpSlides(bytes: Uint8Array): PreviewSlide[] {
  const archive = openArchive(
    bytes,
    (n) => n === 'content.xml' || /^(Pictures|media)\//i.test(n),
  )

  const xml = partText(archive, 'content.xml')

  if (!xml) throw new Error('The presentation has no content.')
  const doc = parseXml(xml)

  const pages = Array.from(doc.getElementsByTagNameNS(DRAW_NS, 'page')).slice(
    0,
    MAX_PREVIEW_SLIDES,
  )

  return pages.map((page, index) => {
    let title: string | null = null
    const lines: string[] = []

    for (const frame of Array.from(
      page.getElementsByTagNameNS(DRAW_NS, 'frame'),
    )) {
      const kind = frame.getAttributeNS(PRESENTATION_NS, 'class')

      const texts = Array.from(frame.getElementsByTagNameNS(TEXT_NS, 'p'))
        .map((p) => p.textContent.trim())
        .filter(Boolean)

      if (kind === 'title' && title === null && texts.length > 0)
        title = texts.join(' ')
      else lines.push(...texts)
    }

    const images: SlideImage[] = []

    for (const image of Array.from(
      page.getElementsByTagNameNS(DRAW_NS, 'image'),
    )) {
      const href = image.getAttributeNS(XLINK_NS, 'href')
      const mediaType = href ? imageTypeOf(href) : null
      const data = href ? archive[href] : undefined

      if (mediaType && data) images.push({ data, mediaType })
    }

    return { number: index + 1, title, lines, images }
  })
}
