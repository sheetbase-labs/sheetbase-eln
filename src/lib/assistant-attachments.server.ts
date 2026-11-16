import {
  ATTACHMENT_CELL_MAX_CHARS,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_SHEETS,
  ATTACHMENT_SHEET_MAX_COLS,
  ATTACHMENT_SHEET_MAX_ROWS,
  ATTACHMENT_TEXT_MAX_CHARS,
  chatAttachmentSchema,
} from './assistant-attachments'
import type { ChatAttachment } from './assistant-attachments'
import type { ImportDelimiter } from './import-parse'
import { extractDocumentText } from './file-text'
import { isXlsxBytes, parseDelimited, readXlsxMatrices } from './import-parse'

/**
 * Reads one dropped file into what the assistant can work from. Pure with
 * respect to the person and the workspace: bytes in, a reading out. Nothing is
 * stored, and nothing here writes to the lab.
 */

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly code: 'too_big' | 'unsupported' | 'unreadable',
  ) {
    super(message)
  }
}

type Reading = Pick<
  ChatAttachment,
  'kind' | 'mediaType' | 'sheets' | 'text' | 'image' | 'truncated' | 'note'
>

const OFFICE_TYPES = new Map([
  ['pdf', 'application/pdf'],
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  [
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['odp', 'application/vnd.oasis.opendocument.presentation'],
  ['doc', 'application/msword'],
  ['xls', 'application/vnd.ms-excel'],
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')

  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The picture type the bytes really are, whatever the name says. */
export function sniffImageType(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }

  if (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Rows and cells kept to the sizes the chat allows, with whether anything was cut. */
export interface BoundedRows {
  rows: string[][]
  truncated: boolean
}

export function boundRows(rows: string[][]): BoundedRows {
  let truncated = rows.length > ATTACHMENT_SHEET_MAX_ROWS

  const kept = rows.slice(0, ATTACHMENT_SHEET_MAX_ROWS).map((row) => {
    if (row.length > ATTACHMENT_SHEET_MAX_COLS) truncated = true

    return row.slice(0, ATTACHMENT_SHEET_MAX_COLS).map((value) => {
      const text = value.trim()

      if (text.length > ATTACHMENT_CELL_MAX_CHARS) truncated = true

      return text.slice(0, ATTACHMENT_CELL_MAX_CHARS)
    })
  })

  // Trailing blank rows are padding from the spreadsheet, not data.
  while (kept.length > 0 && kept.at(-1)?.every((value) => value === '')) {
    kept.pop()
  }

  return { rows: kept, truncated }
}

/**
 * The delimiter a text export uses. A reader's export opens with a title and
 * settings lines that hold no delimiter at all, so the first line says nothing:
 * look at the first fifty lines and take the delimiter on the most of them.
 */
export function detectBodyDelimiter(text: string): ImportDelimiter {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 50)

  const score = (delimiter: string) =>
    lines.filter((line) => line.includes(delimiter)).length

  const tabs = score('\t')
  const semicolons = score(';')
  const commas = score(',')

  if (tabs > 0 && tabs >= semicolons && tabs >= commas) return '\t'

  if (semicolons > commas) return ';'

  return ','
}

function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function tableReading(
  sheets: Array<{ name: string; rows: string[][] }>,
  mediaType: string,
  note: string | null = null,
): Reading {
  let truncated = sheets.length > ATTACHMENT_MAX_SHEETS

  const kept = sheets.slice(0, ATTACHMENT_MAX_SHEETS).flatMap((sheet) => {
    const bounded = boundRows(sheet.rows)

    if (bounded.truncated) truncated = true

    return bounded.rows.length === 0
      ? []
      : [{ name: sheet.name.slice(0, 100) || 'Sheet', rows: bounded.rows }]
  })

  if (kept.length === 0) {
    throw new AttachmentError('That file has no data in it.', 'unreadable')
  }

  return {
    kind: 'table',
    mediaType,
    sheets: kept,
    text: '',
    image: null,
    truncated,
    note,
  }
}

function documentReading(
  text: string,
  mediaType: string,
  note: string | null = null,
): Reading {
  const clean = text.replaceAll('\u0000', '')

  return {
    kind: 'document',
    mediaType,
    sheets: [],
    text: clean.slice(0, ATTACHMENT_TEXT_MAX_CHARS),
    image: null,
    truncated: clean.length > ATTACHMENT_TEXT_MAX_CHARS,
    note,
  }
}

async function read(
  bytes: Uint8Array,
  name: string,
  claimedType: string,
): Promise<Reading> {
  const extension = extensionOf(name)

  const image = sniffImageType(bytes)

  if (image) {
    if (bytes.byteLength > ATTACHMENT_IMAGE_MAX_BYTES) {
      throw new AttachmentError(
        'That picture is too big to read. Try a smaller copy.',
        'too_big',
      )
    }

    return {
      kind: 'image',
      mediaType: image,
      sheets: [],
      text: '',
      image: `data:${image};base64,${toBase64(bytes)}`,
      truncated: false,
      note: null,
    }
  }

  if (IMAGE_EXTENSIONS.has(extension) || /^tiff?$/.test(extension)) {
    throw new AttachmentError(
      'That picture could not be read. Use a PNG, JPEG or WebP.',
      'unsupported',
    )
  }

  // A spreadsheet workbook: the zip signature plus the name, because docx and
  // pptx are zips too.
  if (extension === 'xlsx' || (extension === '' && isXlsxBytes(bytes))) {
    // SAFETY: slice() of a Uint8Array's buffer copies exactly its bytes into a fresh ArrayBuffer, never a SharedArrayBuffer.
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    const matrices = await readXlsxMatrices(copy)

    return tableReading(
      matrices.map((sheet) => ({ name: sheet.name, rows: sheet.matrix })),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  }

  const officeType = OFFICE_TYPES.get(extension)

  if (officeType) {
    const text = await extractDocumentText(streamOf(bytes), officeType)

    return documentReading(
      text,
      officeType,
      text.trim() === ''
        ? extension === 'pdf'
          ? 'It has no text layer, so it is probably a scan. Ask the person to attach a picture of the page instead.'
          : 'No text could be read from it.'
        : extension === 'xls'
          ? 'Read from the older Excel format as text, so columns may run together.'
          : null,
    )
  }

  if (
    ['csv', 'tsv', 'txt', 'tab', 'dat', 'json', 'asc'].includes(extension) ||
    claimedType.startsWith('text/')
  ) {
    const text = decodeUtf8(bytes)

    if (text.includes('\u0000')) {
      throw new AttachmentError(
        'That does not look like a text file.',
        'unsupported',
      )
    }

    if (extension === 'json') return documentReading(text, 'application/json')
    const delimiter = detectBodyDelimiter(text)
    const rows = parseDelimited(text, delimiter)
    const widest = rows.reduce((n, row) => Math.max(n, row.length), 0)

    // Prose or a log, not a table: keep it as text. A reader's export has a
    // header block first and then the grid, so look at the typical row, not
    // only the first.
    const wide = rows.filter((row) => row.length > 1).length

    if (widest < 2 || wide < Math.min(3, rows.length)) {
      return documentReading(text, 'text/plain')
    }

    return tableReading(
      [{ name: 'Sheet 1', rows }],
      delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv',
    )
  }

  throw new AttachmentError(
    'I can read spreadsheets (CSV, TSV, XLSX), PDFs, Word and text files, and PNG, JPEG or WebP pictures.',
    'unsupported',
  )
}

/** One file, read. Throws `AttachmentError` for a file it will not take. */
export async function readAttachmentFile(
  bytes: Uint8Array,
  name: string,
  claimedType: string,
  id: string = crypto.randomUUID(),
): Promise<ChatAttachment> {
  if (bytes.byteLength === 0) {
    throw new AttachmentError('That file is empty.', 'unreadable')
  }

  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(
      `That file is over ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`,
      'too_big',
    )
  }

  let reading: Reading

  try {
    reading = await read(bytes, name, claimedType)
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError(
      'That file could not be read. It may be damaged or protected.',
      'unreadable',
    )
  }

  return chatAttachmentSchema.parse({
    id,
    name: name.slice(0, 200) || 'file',
    bytes: bytes.byteLength,
    ...reading,
  })
}
