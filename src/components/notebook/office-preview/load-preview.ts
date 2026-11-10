import { isOpenDocument, PREVIEW_MAX_BYTES } from '#/lib/office-preview/kinds'
import type { PreviewKind } from '#/lib/office-preview/kinds'
import {
  EXPANDED_SHEET_LIMITS,
  INLINE_SHEET_LIMITS,
  readCsvSheets,
  readOdsSheets,
  readXlsxSheets,
} from '#/lib/office-preview/sheets'
import type { PreviewSheet } from '#/lib/office-preview/sheets'
import { readOdpSlides, readPptxSlides } from '#/lib/office-preview/slides'
import type { PreviewSlide } from '#/lib/office-preview/slides'

export type LoadedPreview =
  | { kind: 'sheets'; sheets: PreviewSheet[] }
  | { kind: 'html'; html: string }
  | { kind: 'slides'; slides: PreviewSlide[] }
  | { kind: 'pdf'; bytes: Uint8Array }

export interface PreviewSource {
  fileRecordId: string
  version: number | null
  kind: PreviewKind
  mediaType: string
  name: string
  expanded: boolean
}

export function downloadUrl(fileRecordId: string, version: number | null) {
  const base = `/api/files/${encodeURIComponent(fileRecordId)}/download`

  return version === null ? base : `${base}?version=${version}`
}

export async function loadPreview(
  source: PreviewSource,
): Promise<LoadedPreview> {
  const res = await fetch(downloadUrl(source.fileRecordId, source.version))

  if (!res.ok) throw new Error(`The file could not be opened (${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())

  if (bytes.byteLength > PREVIEW_MAX_BYTES) {
    throw new Error('The file is too large to preview.')
  }

  const limits = source.expanded ? EXPANDED_SHEET_LIMITS : INLINE_SHEET_LIMITS
  const odf = isOpenDocument(source.mediaType, source.name)

  switch (source.kind) {
    case 'pdf':
      return { kind: 'pdf', bytes }
    case 'csv':
      return { kind: 'sheets', sheets: readCsvSheets(bytes, limits) }
    case 'sheet':
      return {
        kind: 'sheets',
        sheets: odf
          ? readOdsSheets(bytes, limits)
          : await readXlsxSheets(bytes, limits),
      }
    case 'slides':
      return {
        kind: 'slides',
        slides: odf ? readOdpSlides(bytes) : readPptxSlides(bytes),
      }
    case 'document': {
      const { readDocxHtml, readOdtHtml } =
        await import('#/lib/office-preview/document')

      return {
        kind: 'html',
        html: odf ? readOdtHtml(bytes) : await readDocxHtml(bytes),
      }
    }
  }
}
