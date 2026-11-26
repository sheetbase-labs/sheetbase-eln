import { z } from 'zod'

import { findAttachment } from '#/lib/assistant-attachments'
import type { ChatAttachment } from '#/lib/assistant-attachments'
import { likeValue } from '#/lib/assistant-lab-tools.server'
import {
  cardSchema,
  changed,
  fail,
  findDataset,
  isUuid,
  ok,
  rpcCard,
  same,
  sheetLabel,
} from '#/lib/assistant-rpc-cards.server'
import type { RpcArgs, RpcJson } from '#/lib/assistant-rpc-cards'
import { pick } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import { DATASET_CARDS } from './cards'
import { versionFields } from './cards.server'
import type { VersionField } from './cards.server'
import { readStoredSheet } from './stored-file.server'
import type { StoredFile } from './stored-file.server'

/**
 * The import card: rows from a file into a dataset. The file is either one
 * dropped into this chat, or one already kept in the workspace. The card shows
 * which column of the file goes to which column of the dataset and how many
 * rows would be added, and nothing is written until the person presses the
 * button.
 *
 * A chat file has no stored original, so its rows are added with the ordinary
 * row call and the reason names the file. A workspace file goes through the
 * app's import, which keeps the file, the parser and a receipt with the rows.
 */

const IMPORT = DATASET_CARDS.find(
  (card) => card.tool === 'sheetbase.dataset.import_file',
)

const covers = IMPORT?.covers ?? []

const importFileSchema = cardSchema({
  dataset: z
    .string()
    .min(1)
    .max(200)
    .describe('The dataset to add the rows to, by ID (DS-0311) or name.'),
  file: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The file: one dropped into this chat (File 1, or its name), or one already kept in the workspace (its name or ID).',
    ),
  sheet: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('The worksheet to read, when the file has several.'),
})

const FILE_COLUMNS =
  'id,workspace_id,dataset_id,filename,media_type,byte_size,checksum,storage_key,format,status,parse_error'

async function findStoredFile(
  client: DataClient,
  wanted: string,
): Promise<{ ok: true; value: StoredFile } | { ok: false; message: string }> {
  const like = likeValue(wanted)

  const rows = await client.list<StoredFile>(
    'dataset_import_files',
    `?or=(filename.ilike.${like}${isUuid(wanted) ? `,id.eq.${wanted.trim()}` : ''})&select=${FILE_COLUMNS}&order=created_at.desc&limit=6`,
  )

  return pick(
    rows,
    wanted,
    'file',
    (row) => row.filename,
    (row) => same(row.filename, wanted) || same(row.id, wanted),
  )
}

interface Mapped {
  /** Source heading and the dataset column it goes to, in file order. */
  pairs: Array<{ source: string; field: VersionField | null }>
  matched: number
}

function mapHeadings(
  headings: readonly string[],
  fields: readonly VersionField[],
): Mapped {
  const pairs = headings.map((source) => ({
    source,
    field:
      fields.find(
        (each) => same(each.label, source) || same(each.key, source),
      ) ?? null,
  }))

  return { pairs, matched: pairs.filter((pair) => pair.field).length }
}

const listOf = (names: readonly string[]): string =>
  names.length > 6
    ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more`
    : names.join(', ')

function attachmentRows(
  file: ChatAttachment,
  sheet: string | undefined,
):
  | { ok: true; headings: string[]; rows: string[][] }
  | { ok: false; message: string } {
  if (file.kind !== 'table' || file.sheets.length === 0) {
    return fail(
      `${file.name} is not a spreadsheet, so there are no rows to import.`,
    )
  }

  if (file.truncated) {
    return fail(
      `Only part of ${file.name} could be read in the chat, and importing part of a file would leave rows out. Add it to the workspace on the dataset’s Import screen, then ask me again with its name.`,
    )
  }

  const chosen = sheet
    ? file.sheets.find((each) => same(each.name, sheet))
    : file.sheets.at(0)

  if (!chosen) {
    return fail(
      `${file.name} has no worksheet “${sheet ?? ''}”. Its worksheets are ${file.sheets.map((each) => each.name).join(', ')}.`,
    )
  }

  const [head, ...body] = chosen.rows
  const headings = head.map((cellText) => cellText.trim())

  if (headings.every((heading) => heading === '')) {
    return fail(`${file.name} has no heading row to match to columns.`)
  }

  return {
    ok: true,
    headings,
    rows: body.filter((row) => row.some((value) => value.trim() !== '')),
  }
}

/** The import card, reading kept files with `read` (the tests give it a fake). */
export const importFileCard = (readFile: typeof readStoredSheet) =>
  rpcCard({
    tool: 'sheetbase.dataset.import_file',
    covers,
    description:
      'Propose importing the rows of a spreadsheet into a dataset: a file dropped into this chat, or one already kept in the workspace. Columns are matched to the dataset’s columns by heading, and the card shows the match and the row count before anything is added. Use this, not add_rows, for a whole file.',
    schema: importFileSchema,
    async build(input, { client, attachments }) {
      const found = await findDataset(client, input.dataset)

      if (!found.ok) return found

      if (found.value.lifecycle !== 'active') {
        return fail(`${sheetLabel(found.value)} is archived. Restore it first.`)
      }

      const fields = (
        await versionFields(client, found.value.schema_version_id)
      ).filter((field) => field.lifecycle !== 'retired')

      const chat = findAttachment(attachments ?? [], input.file)

      let name: string
      let headings: string[]
      let count: number
      let rowsOf: (mapped: Mapped) => RpcJson[] = () => []
      let stored: StoredFile | null = null
      let worksheet: string | undefined

      if (chat) {
        const read = attachmentRows(chat, input.sheet)

        if (!read.ok) return read
        name = chat.name
        headings = read.headings
        count = read.rows.length

        rowsOf = (mapped) =>
          read.rows.map((row): RpcJson => {
            const values: Record<string, RpcJson> = {}

            mapped.pairs.forEach((pair, index) => {
              const text = (row[index] ?? '').trim()

              if (pair.field && text !== '') values[pair.field.field_id] = text
            })

            const created: RpcArgs = {
              operation: 'create',
              rowId: crypto.randomUUID(),
              values,
              reason: `Imported from ${chat.name}`,
            }

            return created
          })
      } else {
        const file = await findStoredFile(client, input.file)

        if (!file.ok) {
          return fail(
            `${file.message} Drop the file into the chat, or add it to the workspace on the dataset’s Import screen.`,
          )
        }

        stored = file.value
        name = file.value.filename
        const read = await readFile(file.value, input.sheet)

        if (!read.ok) return read
        headings = read.headings
        count = read.rowCount
        worksheet = read.sheetName
      }

      const mapped = mapHeadings(headings, fields)

      if (mapped.matched === 0) {
        return fail(
          `None of the columns in ${name} match a column of ${sheetLabel(found.value)}. The file has ${listOf(headings)}; the dataset has ${listOf(fields.map((field) => field.label))}.`,
        )
      }

      if (count === 0) return fail(`${name} has no rows to import.`)

      const left = mapped.pairs
        .filter((pair) => !pair.field)
        .map((pair) => pair.source)

      const changes = [
        changed('Rows added', null, String(count)),
        changed(
          'Columns matched',
          null,
          mapped.pairs
            .filter((pair) => pair.field)
            .map((pair) => `${pair.source} → ${pair.field?.label ?? ''}`)
            .join(', '),
        ),
      ]

      if (left.length > 0) changes.push(changed('Left out', null, listOf(left)))

      const target = sheetLabel(found.value)
      const deepLink = `/datasets/${found.value.id}`

      if (stored) {
        const sources: RpcJson[] = mapped.pairs.map((pair): RpcJson => ({
          source: pair.source,
          fieldId: pair.field?.field_id ?? null,
          unit: null,
        }))

        const mapping: RpcArgs = { sources }

        if (worksheet) mapping.sheetName = worksheet

        return ok({
          target,
          deepLink,
          changes,
          rpc: 'commit_dataset_import',
          args: {
            fileId: stored.id,
            datasetId: found.value.id,
            mapping,
            sheetName: worksheet ?? null,
            idempotencyKey: crypto.randomUUID(),
          },
        })
      }

      return ok({
        target,
        deepLink,
        changes,
        rpc:
          count > 1_000
            ? 'commit_dataset_row_batch_atomic'
            : 'commit_dataset_row_batch',
        args: {
          p_dataset_id: found.value.id,
          p_expected_dataset_revision: found.value.revision,
          p_rows: rowsOf(mapped),
          p_idempotency_key: crypto.randomUUID(),
        },
      })
    },
  })

export const importFile = importFileCard(readStoredSheet)
