import { unzipSync } from 'fflate'

/**
 * SRCH-01.3 — text extraction for uploaded files.
 *
 * Text formats (CSV, plain text, JSON) are decoded directly. PDFs go through
 * a text-layer parser and the Office formats (docx, xlsx, pptx) are unzipped
 * and their XML text runs collected. The text is stored on the file object
 * (with its original newlines) so search can name the matching line. Scanned
 * PDFs with no text layer yield no text and stay unsearchable by content.
 * OpenDocument files (odt, ods, odp) are read the same way from content.xml.
 * Spreadsheets contribute sheet names, text cells and numeric cell values.
 */
export const TEXT_EXTRACT_MAX_BYTES = 2 * 1024 * 1024

/** Largest binary document read into memory for extraction. */
export const DOCUMENT_EXTRACT_MAX_BYTES = 32 * 1024 * 1024

/** Cap on decompressed bytes read from an Office archive (zip-bomb guard). */
const OFFICE_UNZIP_MAX_BYTES = 64 * 1024 * 1024

/** `api.record_file_text` rejects text over 2,000,000 characters. */
const EXTRACTED_TEXT_MAX_CHARS = 1_900_000

const PDF_MEDIA_TYPE = 'application/pdf'
const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const ODT_MEDIA_TYPE = 'application/vnd.oasis.opendocument.text'
const ODS_MEDIA_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'
const ODP_MEDIA_TYPE = 'application/vnd.oasis.opendocument.presentation'

const TEXT_EXTRACTABLE_MEDIA_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/json',
])

const DOCUMENT_EXTRACTABLE_MEDIA_TYPES = new Set([
  PDF_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
  ODT_MEDIA_TYPE,
  ODS_MEDIA_TYPE,
  ODP_MEDIA_TYPE,
])

export function isTextExtractableMediaType(mediaType: string): boolean {
  return TEXT_EXTRACTABLE_MEDIA_TYPES.has(mediaType.trim().toLowerCase())
}

/** PDF, Office and OpenDocument files: formats that need a parser, not a decoder. */
export function isDocumentExtractableMediaType(mediaType: string): boolean {
  return DOCUMENT_EXTRACTABLE_MEDIA_TYPES.has(mediaType.trim().toLowerCase())
}

/** Any media type this module can pull searchable text out of. */
export function isSearchableMediaType(mediaType: string): boolean {
  return (
    isTextExtractableMediaType(mediaType) ||
    isDocumentExtractableMediaType(mediaType)
  )
}

/**
 * Read a byte stream up to `maxBytes` and decode it as UTF-8. Bytes beyond the
 * cap are ignored rather than failing the upload. Invalid UTF-8 sequences are
 * replaced, never thrown.
 */
export async function extractTextFromStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number = TEXT_EXTRACT_MAX_BYTES,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let read = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - read
      if (remaining <= 0) break
      const slice =
        value.byteLength > remaining ? value.subarray(0, remaining) : value
      read += slice.byteLength
      text += decoder.decode(slice, { stream: true })
      if (read >= maxBytes) break
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text
}

async function readAllBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let read = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      read += value.byteLength
      if (read > maxBytes) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(read)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = (entity as string).toLowerCase()
    if (lower.startsWith('#x')) {
      return safeCodePoint(Number.parseInt(lower.slice(2), 16)) ?? match
    }
    if (lower.startsWith('#')) {
      return safeCodePoint(Number.parseInt(lower.slice(1), 10)) ?? match
    }
    return XML_ENTITIES[lower] ?? match
  })
}

function safeCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null
  if (code >= 0xd800 && code <= 0xdfff) return null
  return String.fromCodePoint(code)
}

/**
 * Collect the text runs (`<w:t>`, `<a:t>`, `<t>`) of an OOXML part. Each
 * paragraph-like container (`<w:p>`, `<a:p>`, `<si>`, `<row>`) ends a line and
 * each tab or cell boundary becomes a space, so a search hit names a sensible
 * line.
 */
function ooxmlText(xml: string, runTag: string): string {
  const tokens = new RegExp(
    `<${runTag}(?:\\s[^>]*)?>([^<]*)</${runTag}>|(</(?:w:p|a:p|si|row)>)|(<w:tab\\s*/>|<w:br\\s*/>|</c>)`,
    'g',
  )
  let out = ''
  for (const match of xml.matchAll(tokens)) {
    const [, run, paragraphEnd] = match as unknown as [
      string,
      string | undefined,
      string | undefined,
    ]
    if (run !== undefined) out += decodeXmlEntities(run)
    else out += paragraphEnd ? '\n' : ' '
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function unzipOffice(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, Uint8Array> {
  let total = 0
  return unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false
      total += file.originalSize
      if (total > OFFICE_UNZIP_MAX_BYTES) {
        throw new Error('office archive expands beyond the extraction cap')
      }
      return true
    },
  })
}

function slideOrder(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0)
}

function officeParts(
  mediaType: string,
): { wanted: (name: string) => boolean; runTag: string } | null {
  switch (mediaType) {
    case DOCX_MEDIA_TYPE:
      return {
        wanted: (name) =>
          /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(
            name,
          ),
        runTag: 'w:t',
      }
    case XLSX_MEDIA_TYPE:
      return {
        wanted: (name) =>
          name === 'xl/workbook.xml' ||
          name === 'xl/sharedStrings.xml' ||
          /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
        runTag: 't',
      }
    case PPTX_MEDIA_TYPE:
      return {
        wanted: (name) =>
          /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(name),
        runTag: 'a:t',
      }
    default:
      return null
  }
}

/** Sheet names of an xlsx workbook, in tab order. */
function xlsxSheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet\s[^>]*?\bname="([^"]*)"/g)].map((match) =>
    decodeXmlEntities(match[1]),
  )
}

/**
 * Cell values of one xlsx worksheet: numbers, formula strings and inline
 * strings, one line per row. Shared-string cells hold an index, and their
 * text comes from sharedStrings.xml, so they are skipped here.
 */
function xlsxSheetText(xml: string): string {
  const rows: string[] = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cell of row[1].matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const type = /\bt="([^"]*)"/.exec(cell[1])?.[1] ?? 'n'
      const inner = cell[2] ?? ''
      if (type === 'inlineStr') {
        const text = ooxmlText(inner, 't')
        if (text) cells.push(text.replace(/\n/g, ' '))
      } else if (type === 'n' || type === 'str') {
        const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1]
        if (value !== undefined && value.trim() !== '') {
          cells.push(decodeXmlEntities(value.trim()))
        }
      }
    }
    if (cells.length > 0) rows.push(cells.join(' '))
  }
  return rows.join('\n')
}

/** Text of an OpenDocument content.xml: paragraphs, headings, cells and sheet names. */
function odfText(xml: string): string {
  const withBreaks = xml
    // A cell's paragraphs stay on the row's line.
    .replace(/<table:table-cell\b[^>]*>[\s\S]*?<\/table:table-cell>/g, (cell) =>
      cell.replace(/<\/text:p>/g, ' '),
    )
    .replace(/<table:table\s[^>]*?\btable:name="([^"]*)"[^>]*>/g, '\n$1\n')
    .replace(/<\/(?:text:p|text:h|table:table-row|text:list-item)>/g, '\n')
    .replace(
      /<text:(?:tab|line-break)\s*\/>|<text:s\b[^>]*\/>|<\/table:table-cell>/g,
      ' ',
    )
    .replace(/<[^>]*>/g, '')
  return decodeXmlEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function extractOdfText(bytes: Uint8Array): string {
  const entries = unzipOffice(bytes, (name) => name === 'content.xml')
  const content = entries['content.xml']
  return content ? odfText(new TextDecoder('utf-8').decode(content)) : ''
}

/** Text from an Office or OpenDocument archive. */
export function extractOfficeText(
  bytes: Uint8Array,
  mediaType: string,
): string {
  const type = mediaType.trim().toLowerCase()
  if (
    type === ODT_MEDIA_TYPE ||
    type === ODS_MEDIA_TYPE ||
    type === ODP_MEDIA_TYPE
  ) {
    return extractOdfText(bytes)
  }
  const parts = officeParts(type)
  if (!parts) return ''
  const entries = unzipOffice(bytes, parts.wanted)
  const names = Object.keys(entries).sort(
    (a, b) => slideOrder(a) - slideOrder(b) || b.localeCompare(a),
  )
  const decoder = new TextDecoder('utf-8')
  const sections: string[] = []
  for (const name of names) {
    const xml = decoder.decode(entries[name])
    if (name === 'xl/workbook.xml') {
      const sheets = xlsxSheetNames(xml)
      if (sheets.length > 0) sections.unshift(sheets.join('\n'))
      continue
    }
    // xlsx worksheets hold numbers and inline strings; shared strings carry
    // the rest.
    const text = /^xl\/worksheets\//.test(name)
      ? xlsxSheetText(xml)
      : ooxmlText(xml, parts.runTag)
    if (text) sections.push(text)
  }
  return sections.join('\n')
}

/** Text layer of a PDF, one line per text line, pages separated by a newline. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

/**
 * Extract searchable text from an uploaded file's byte stream, whatever its
 * format. Returns '' for unsupported types, files over the read cap and
 * documents with no text layer. Parser failures throw so the caller can log
 * them; the upload itself must not depend on extraction.
 */
export async function extractDocumentText(
  stream: ReadableStream<Uint8Array>,
  mediaType: string,
): Promise<string> {
  const type = mediaType.trim().toLowerCase()
  if (isTextExtractableMediaType(type)) return extractTextFromStream(stream)
  if (!isDocumentExtractableMediaType(type)) return ''
  const bytes = await readAllBytes(stream, DOCUMENT_EXTRACT_MAX_BYTES)
  if (!bytes) return ''
  const text =
    type === PDF_MEDIA_TYPE
      ? await extractPdfText(bytes)
      : extractOfficeText(bytes, type)
  return text.length > EXTRACTED_TEXT_MAX_CHARS
    ? text.slice(0, EXTRACTED_TEXT_MAX_CHARS)
    : text
}
