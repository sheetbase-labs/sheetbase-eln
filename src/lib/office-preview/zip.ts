import { unzipSync } from 'fflate'

import { PREVIEW_UNZIP_MAX_BYTES } from './kinds'

export type Archive = Record<string, Uint8Array>

/**
 * Unzip the parts of an Office or OpenDocument file a preview reads. Parts
 * outside `wanted` are never inflated, and the archive is refused when the
 * parts it would inflate declare more than the cap (zip-bomb guard).
 */
export function openArchive(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Archive {
  let declared = 0

  const archive = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false
      declared += file.originalSize

      if (declared > PREVIEW_UNZIP_MAX_BYTES) {
        throw new Error('The file is too large to preview.')
      }

      return true
    },
  })

  return archive
}

const decoder = new TextDecoder('utf-8')

export function partText(archive: Archive, name: string): string | null {
  return Object.hasOwn(archive, name) ? decoder.decode(archive[name]) : null
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The file could not be read.')
  }

  return doc
}

/** Resolve `target` (as written in a .rels file) against the part `from`. */
export function resolvePart(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)

  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.' && piece !== '') parts.push(piece)
  }

  return parts.join('/')
}

export function relationships(
  archive: Archive,
  relsPart: string,
  base: string,
): Map<string, string> {
  const xml = partText(archive, relsPart)
  const map = new Map<string, string>()

  if (!xml) return map
  const doc = parseXml(xml)

  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')

    if (id && target && rel.getAttribute('TargetMode') !== 'External') {
      map.set(id, resolvePart(base, target))
    }
  }

  return map
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

/** Media type of an embedded picture a browser can draw, else null. */
export function imageTypeOf(part: string): string | null {
  const extension = part.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]

  return extension ? (IMAGE_TYPES[extension] ?? null) : null
}
