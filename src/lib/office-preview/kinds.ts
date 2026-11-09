/**
 * Which viewer opens a stored file inside a notebook block. The media type
 * decides, with the file name as a fallback because browsers report Office
 * files as `application/octet-stream` when they do not know the extension.
 */
export type PreviewKind = 'document' | 'sheet' | 'csv' | 'slides' | 'pdf'

const BY_MEDIA_TYPE: Record<string, PreviewKind> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'slides',
  'application/vnd.oasis.opendocument.presentation': 'slides',
}

const BY_EXTENSION: Record<string, PreviewKind> = {
  pdf: 'pdf',
  csv: 'csv',
  docx: 'document',
  odt: 'document',
  xlsx: 'sheet',
  ods: 'sheet',
  pptx: 'slides',
  odp: 'slides',
}

function lookup(
  table: Record<string, PreviewKind>,
  key: string,
): PreviewKind | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

export function previewKindOf(
  mediaType: string,
  name: string,
): PreviewKind | null {
  const byType = lookup(BY_MEDIA_TYPE, mediaType.trim().toLowerCase())

  if (byType) return byType
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]

  return (extension ? lookup(BY_EXTENSION, extension) : undefined) ?? null
}

/** Largest file the block opens on its own; bigger ones wait for a click. */
export const PREVIEW_AUTO_BYTES = 8 * 1024 * 1024

/** Largest file the browser will read at all. */
export const PREVIEW_MAX_BYTES = 40 * 1024 * 1024

/** Cap on bytes read out of an Office archive (zip-bomb guard). */
export const PREVIEW_UNZIP_MAX_BYTES = 128 * 1024 * 1024

/** True for the OpenDocument formats, which share one archive layout. */
export function isOpenDocument(mediaType: string, name: string): boolean {
  return (
    mediaType.includes('opendocument') || /\.(odt|ods|odp)$/i.test(name.trim())
  )
}
