/**
 * Runs the data and search points of a plugin: importers, exporters, previews,
 * search providers, connectors, checks, same-thing rules and event reactions.
 * Server-only.
 *
 * Each goes through the same gate as every plugin call (`openExtensionPoint`:
 * the plugin is enabled in this workspace and an administrator has that part
 * switched on), the Python runs in the isolated runner with no network and no
 * database, the answer is checked before anything uses it, and the call is
 * written to the workspace's change log as `extension.invoked`. A plugin only
 * sees what a call hands it, and nothing it returns is trusted: tables are
 * bounded, text is length-limited, and every failure reaches the person as a
 * plain sentence.
 *
 * A connector cannot reach the network from the runner, so it works in two
 * steps: the plugin says which requests to make, this module makes them (only
 * to hosts the connector declared, only over HTTPS) and the plugin turns the
 * answers into rows.
 */
import { z } from 'zod'

import { validateConnectorEndpointUrl } from '../connectors/enterprise/host-policy.server'
import {
  ExtensionRunError,
  audit,
  checkDeclaredValues,
  defaultDeps,
  openExtensionPoint,
  runPackage,
} from './runtime.server'
import type { JsonValue } from '#/lib/workspace-admin'
import type { ExtensionRuntimeDeps, ResolvedInstall } from './runtime.server'
import type { DataItemPoint } from './runner-points'
import { INDEX_NAME_RE, afterAnswer, beforeAnswer } from './hook-answers'
import { pluginLimit } from './limits'
import type { AfterAnswer, BeforeAnswer, RecordSnapshot } from './hook-answers'
import type {
  ExtensionCheckDeclaration,
  ExtensionConnectorDeclaration,
  ExtensionEventHookDeclaration,
  ExtensionExporterDeclaration,
  ExtensionBarcodeFormatDeclaration,
  ExtensionImporterDeclaration,
  ExtensionInstrumentParserDeclaration,
  ExtensionLabelFormatDeclaration,
  ExtensionNotificationChannelDeclaration,
  ExtensionPreviewDeclaration,
  ExtensionPublisherDeclaration,
  ExtensionRecordHookDeclaration,
  ExtensionSamenessKeyDeclaration,
  ExtensionSearchProviderDeclaration,
  ExtensionStorageRuleDeclaration,
} from './data-points'

/** One row a plugin returns or reads: JSON values keyed by column name. */
type Row = Record<string, JsonValue>

export const IMPORT_MAX_CONTENT_BYTES =
  pluginLimit('SHEETBASE_PLUGIN_IMPORT_MAX_MB', 6) * 1024 * 1024

export const PREVIEW_MAX_ROWS = 200
export const PREVIEW_MAX_TEXT = 20_000

export const SEARCH_MAX_DOCUMENTS = pluginLimit(
  'SHEETBASE_PLUGIN_SEARCH_MAX_DOCUMENTS',
  5_000,
)

export const SEARCH_MAX_HITS = 100

export const CONNECTOR_MAX_REQUESTS = pluginLimit(
  'SHEETBASE_PLUGIN_CONNECTOR_MAX_REQUESTS',
  20,
)

export const CONNECTOR_MAX_RESPONSE_BYTES =
  pluginLimit('SHEETBASE_PLUGIN_CONNECTOR_MAX_RESPONSE_MB', 5) * 1024 * 1024

export const CONNECTOR_TIMEOUT_MS = 30_000

interface Caller {
  workspaceId: string
  actorUserId: string
  extensionKey: string
}

export type Declarations = {
  importers: ExtensionImporterDeclaration
  exporters: ExtensionExporterDeclaration
  previews: ExtensionPreviewDeclaration
  'search-providers': ExtensionSearchProviderDeclaration
  connectors: ExtensionConnectorDeclaration
  publishers: ExtensionPublisherDeclaration
  'notification-channels': ExtensionNotificationChannelDeclaration
  checks: ExtensionCheckDeclaration
  'sameness-keys': ExtensionSamenessKeyDeclaration
  'event-hooks': ExtensionEventHookDeclaration
  'record-hooks': ExtensionRecordHookDeclaration
  'instrument-parsers': ExtensionInstrumentParserDeclaration
  'label-formats': ExtensionLabelFormatDeclaration
  'barcode-formats': ExtensionBarcodeFormatDeclaration
  'storage-rules': ExtensionStorageRuleDeclaration
}

/** Opens the plugin and the declaration, runs `work`, audits the outcome. */
export async function withItem<
  TPoint extends keyof Declarations & DataItemPoint,
  T,
>(
  deps: ExtensionRuntimeDeps,
  caller: Caller,
  point: TPoint,
  itemId: string,
  work: (
    declaration: Declarations[TPoint],
    resolved: ResolvedInstall,
  ) => Promise<T>,
): Promise<{ value: T; durationMs: number }> {
  const resolved = await openExtensionPoint(
    deps,
    caller.workspaceId,
    caller.extensionKey,
    point,
  )

  // SAFETY: `point` is one of the manifest's contribution keys, and every
  // entry under it was declared with this shape when the package was installed
  // (the install gate validates each contribution against its own schema).
  const declaration = (
    resolved.manifest.contributions[point] as
      Array<Declarations[TPoint] & { id: string }> | undefined
  )?.find((entry) => entry.id === itemId)

  if (!declaration) {
    throw new ExtensionRunError(
      'not_declared',
      'That plugin doesn’t offer this any more.',
    )
  }

  const started = deps.now()

  const record = (ok: boolean, error?: string) =>
    audit(deps, {
      workspaceId: caller.workspaceId,
      actorUserId: caller.actorUserId,
      resolved,
      point,
      itemId,
      ok,
      runner: 'python',
      durationMs: deps.now() - started,
      error,
    })

  try {
    const value = await work(declaration, resolved)
    await record(true)

    return { value, durationMs: deps.now() - started }
  } catch (error) {
    await record(false, error instanceof Error ? error.message : String(error))
    throw error
  }
}

const bad = (message: string) => new ExtensionRunError('bad_answer', message)

function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>()

  for (const row of rows) for (const key of Object.keys(row)) seen.add(key)

  return [...seen]
}

// ---------------------------------------------------------------------------
// Importers.
// ---------------------------------------------------------------------------

export interface ImportedTable {
  columns: string[]
  rows: Row[]
}

export async function runExtensionImporter(
  args: Caller & {
    importerId: string
    filename: string
    /** The file as text, or base64 when the importer is declared `base64`. */
    content: string
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<ImportedTable & { durationMs: number }> {
  return readFileWithPlugin('importers', args.importerId, args, deps)
}

/**
 * An instrument parser reads the file an instrument writes. It is run like an
 * importer; the difference is that the file must also carry the text the
 * parser declared in `contains` (checked on text files), so two parsers can
 * share an extension and each take only its own instrument's files.
 */
export async function runExtensionInstrumentParser(
  args: Caller & {
    parserId: string
    filename: string
    content: string
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<ImportedTable & { durationMs: number }> {
  return readFileWithPlugin('instrument-parsers', args.parserId, args, deps)
}

async function readFileWithPlugin(
  point: 'importers' | 'instrument-parsers',
  itemId: string,
  args: Caller & { filename: string; content: string },
  deps: ExtensionRuntimeDeps,
): Promise<ImportedTable & { durationMs: number }> {
  if (args.content.length > IMPORT_MAX_CONTENT_BYTES)
    throw new ExtensionRunError(
      'too_large',
      'That file is too large to read with a plugin.',
    )

  const { value, durationMs } = await withItem(
    deps,
    args,
    point,
    itemId,
    async (declaration, resolved) => {
      const extension = `.${args.filename.split('.').pop()?.toLowerCase() ?? ''}`

      if (!declaration.extensions.includes(extension))
        throw new ExtensionRunError(
          'wrong_file',
          `This ${point === 'importers' ? 'importer' : 'parser'} reads ${declaration.extensions.join(', ')} files.`,
        )

      if (
        'contains' in declaration &&
        declaration.contains &&
        declaration.encoding === 'text' &&
        !declaration.contains.some((text) => args.content.includes(text))
      )
        throw new ExtensionRunError(
          'wrong_file',
          'This file does not look like one this parser reads.',
        )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'file-rows',
          entry: declaration.runner.entry,
          input: {
            content: args.content,
            filename: args.filename,
            encoding: declaration.encoding,
          },
        },
      })

      if (result.rows.length === 0)
        throw bad('The plugin found no rows in that file.')

      return { columns: columnsOf(result.rows), rows: result.rows }
    },
  )

  return { ...value, durationMs }
}

// ---------------------------------------------------------------------------
// Exporters.
// ---------------------------------------------------------------------------

export interface ExportedFile {
  filename: string
  mime: string
  encoding: 'text' | 'base64'
  content: string
}

export async function runExtensionExporter(
  args: Caller & {
    exporterId: string
    /** The name the file gets, without the extension. */
    name: string
    rows: Row[]
    options: unknown
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<ExportedFile & { durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'exporters',
    args.exporterId,
    async (declaration, resolved) => {
      const options = checkDeclaredValues(
        declaration.parameters,
        args.options ?? {},
        'input',
      )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: { data: args.rows },
        parameters: {
          kind: 'export',
          entry: declaration.runner.entry,
          input: options,
          encoding: declaration.encoding,
        },
      })

      const content = z.string().safeParse(result.rows.at(0)?.content)

      if (!content.success) throw bad('The plugin did not give back a file.')

      if (content.data.length > 32 * 1024 * 1024)
        throw bad('The file the plugin made is too large.')
      const safe = args.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'export'

      return {
        filename: `${safe}${declaration.extension}`,
        mime: declaration.mime,
        encoding: declaration.encoding,
        content: content.data,
      }
    },
  )

  return { ...value, durationMs }
}

// ---------------------------------------------------------------------------
// File previews.
// ---------------------------------------------------------------------------

const previewAnswer = z.union([
  z.strictObject({
    kind: z.literal('table'),
    columns: z.array(z.string().min(1).max(80)).max(50).optional(),
    rows: z.array(z.record(z.string(), z.json())).max(PREVIEW_MAX_ROWS),
  }),
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().max(PREVIEW_MAX_TEXT),
  }),
])

export type FilePreview =
  | { kind: 'table'; columns: string[]; rows: Row[] }
  | { kind: 'text'; text: string }

export async function runExtensionPreview(
  args: Caller & { previewId: string; filename: string; content: string },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<FilePreview> {
  if (args.content.length > IMPORT_MAX_CONTENT_BYTES)
    throw new ExtensionRunError(
      'too_large',
      'That file is too large to preview with a plugin.',
    )

  const { value } = await withItem(
    deps,
    args,
    'previews',
    args.previewId,
    async (declaration, resolved) => {
      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'file-value',
          entry: declaration.runner.entry,
          input: {
            content: args.content,
            filename: args.filename,
            encoding: declaration.encoding,
          },
        },
      })

      const parsed = previewAnswer.safeParse(result.rows.at(0))

      if (!parsed.success)
        throw bad(
          'The plugin’s preview isn’t a table (kind, columns, rows) or text (kind, text).',
        )

      return parsed.data.kind === 'text'
        ? parsed.data
        : {
            kind: 'table' as const,
            columns: parsed.data.columns ?? columnsOf(parsed.data.rows),
            rows: parsed.data.rows,
          }
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Search providers.
// ---------------------------------------------------------------------------

/** What a search provider is handed: the query, the documents, and a stage if set. */
interface SearchProviderInput {
  query: string
  documents: SearchDocument[]
  stage?: string
}

/** What a provider is handed for each record it looks through. */
export interface SearchDocument {
  id: string
  type: string
  title: string
  text: string
  fields?: Record<string, JsonValue>
}

const searchAnswer = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(200),
      score: z.number().finite().optional(),
      snippet: z.string().max(300).optional(),
    }),
  )
  .max(SEARCH_MAX_HITS)

export interface SearchHit {
  id: string
  score: number
  snippet: string | null
}

/**
 * A provider can also ask the app to rank what a hook put in one of the
 * plugin's own indexes (see `index` in a hook's answer): by a vector, by
 * words, or both. The app does the ranking, as the person searching.
 */
const nearestAnswer = z
  .strictObject({
    index: z.string().regex(INDEX_NAME_RE),
    vector: z.array(z.number().finite()).min(1).optional(),
    text: z.string().optional(),
    /** How many of the index's closest entries to take; the plugin's choice. */
    limit: z.number().int().positive().optional(),
    /** Hand those records back to the provider to check and score. */
    verify: z.boolean().optional(),
  })
  .refine((value) => value.vector || (value.text ?? '').trim() !== '', {
    message: 'nearest needs a vector or words',
  })

export interface SearchNearest {
  index: string
  vector: number[] | null
  text: string | null
  limit: number | null
  verify: boolean
}

export interface SearchResult {
  hits: SearchHit[]
  nearest: SearchNearest | null
}

export async function runExtensionSearch(
  args: Caller & {
    providerId: string
    query: string
    documents: SearchDocument[]
    /** `plan` asks an indexed provider what to look up; `rank` hands it what the index found. */
    stage?: 'plan' | 'rank'
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<SearchResult> {
  const { value } = await withItem(
    deps,
    args,
    'search-providers',
    args.providerId,
    async (declaration, resolved) => {
      const types = new Set(declaration.types)

      const documents = args.documents
        .filter((document) => types.has(document.type))
        .slice(0, SEARCH_MAX_DOCUMENTS)

      const known = new Set(documents.map((document) => document.id))

      // The stage names which question of a multi-stage search this is; the
      // plugin is handed it only when the person's search set one.
      const stageInput: SearchProviderInput = {
        query: args.query,
        documents,
      }

      if (args.stage) stageInput.stage = args.stage

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: stageInput,
        },
      })

      const parsed = searchAnswer.safeParse(result.rows.at(0)?.hits ?? [])

      if (!parsed.success)
        throw bad(
          'The plugin’s answer isn’t a list of hits (id, score, snippet).',
        )
      const rawNearest = result.rows.at(0)?.nearest
      let nearest: SearchNearest | null = null

      if (rawNearest !== undefined && rawNearest !== null) {
        const asked = nearestAnswer.safeParse(rawNearest)

        if (!asked.success)
          throw bad(
            'The plugin’s nearest isn’t an index name with a vector, words or both.',
          )
        nearest = {
          index: asked.data.index,
          vector: asked.data.vector ?? null,
          text: asked.data.text ?? null,
          limit: asked.data.limit ?? null,
          verify: asked.data.verify === true,
        }
      }

      // A provider can only point at records it was handed.
      return {
        hits: parsed.data
          .filter((hit) => known.has(hit.id))
          .map((hit) => ({
            id: hit.id,
            score: hit.score ?? 0,
            snippet: hit.snippet ?? null,
          })),
        nearest,
      }
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Checks.
// ---------------------------------------------------------------------------

const checkAnswer = z.strictObject({
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string().min(1).max(300),
})

export type CheckStatus = z.infer<typeof checkAnswer>['status']

export interface CheckOutcome {
  status: CheckStatus
  message: string
  durationMs: number
}

/** A table block's payload: column headings and the cell grid beneath them. */
const tablePayloadSchema = z.object({
  columns: z.array(z.coerce.string()).optional(),
  rows: z.array(z.array(z.coerce.string().nullish())).optional(),
})

/** A table block (`columns` headings, `rows` arrays) as one object per row, by input name. */
export function tableToCheckRows<Payload>(
  payload: Payload,
  declaration: ExtensionCheckDeclaration,
  columns: Record<string, string> | undefined,
): Row[] {
  const table = tablePayloadSchema.parse(payload ?? {})
  const headings = table.columns ?? []
  const grid = table.rows ?? []
  const index = new Map<string, number>()

  for (const input of declaration.inputs) {
    const heading = columns?.[input.name]

    const at = heading
      ? headings.findIndex(
          (h) => h.trim().toLowerCase() === heading.trim().toLowerCase(),
        )
      : -1

    if (at < 0) {
      if (input.required)
        throw bad(`Choose the column for “${input.label}” in this table.`)
      continue
    }

    index.set(input.name, at)
  }

  return grid.map((cells) => {
    const row: Row = {}

    for (const input of declaration.inputs) {
      const at = index.get(input.name)
      const raw = at === undefined ? '' : (cells[at] ?? '').trim()
      row[input.name] =
        raw === ''
          ? null
          : input.type === 'number'
            ? Number.isFinite(Number(raw))
              ? Number(raw)
              : null
            : raw
    }

    return row
  })
}

export async function runExtensionCheck(
  args: Caller & {
    checkId: string
    /** The bound columns, by the names the check declared. */
    rows?: Row[]
    /** Or a table block's payload and which column each input reads. */
    table?: { payload: unknown; columns: Record<string, string> }
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<CheckOutcome> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'checks',
    args.checkId,
    async (declaration, resolved) => {
      const rows =
        args.rows ??
        tableToCheckRows(args.table?.payload, declaration, args.table?.columns)

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: { data: rows },
        parameters: { kind: 'check', entry: declaration.runner.entry },
      })

      const parsed = checkAnswer.safeParse(result.rows.at(0))

      if (!parsed.success)
        throw bad(
          'The plugin’s check didn’t answer with a status (pass, warn or fail) and a message.',
        )

      return parsed.data
    },
  )

  return { ...value, durationMs }
}

// ---------------------------------------------------------------------------
// Same-thing rules.
// ---------------------------------------------------------------------------

export async function runExtensionSamenessKey(
  args: Caller & { keyId: string; values: unknown },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<string> {
  const { value } = await withItem(
    deps,
    args,
    'sameness-keys',
    args.keyId,
    async (declaration, resolved) => {
      const input = checkDeclaredValues(
        declaration.fields,
        args.values,
        'input',
      )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input,
        },
      })

      const key = z.string().min(1).max(500).safeParse(result.rows.at(0)?.key)

      if (!key.success || key.data.trim() === '')
        throw bad(
          'The plugin’s rule didn’t give back a key of 1-500 characters.',
        )

      return key.data
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Event reactions.
// ---------------------------------------------------------------------------

export interface HookNote {
  title: string
  body: string | null
}

/** What a plugin answered after an event or a save. Notes are parsed here; the rest is applied by the caller. */
export type HookAnswer = AfterAnswer

export async function runExtensionEventHook(
  args: Caller & {
    hookId: string
    event: { name: string; entityType: string; entityId: string; data: unknown }
    /** The record the event is about, so the plugin can see it. */
    record?: RecordSnapshot | null
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<HookAnswer> {
  const { value } = await withItem(
    deps,
    args,
    'event-hooks',
    args.hookId,
    async (declaration, resolved) => {
      if (!declaration.events.includes(args.event.name))
        throw new ExtensionRunError(
          'wrong_event',
          'This reaction was not set up for that event.',
        )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: { event: args.event, record: args.record ?? null },
        },
      })

      const parsed = afterAnswer.safeParse(result.rows.at(0) ?? {})

      if (!parsed.success)
        throw bad(
          `The plugin’s reaction gave an answer Sheetbase can’t use: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`,
        )

      return parsed.data
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Save and upload hooks.
// ---------------------------------------------------------------------------

export interface RecordHookInput {
  when: 'created' | 'edited' | 'uploaded' | 'status-changed'
  /** What the record is (or will be, for a hook that runs before the save). */
  record: RecordSnapshot
  /** The record as it was; null for a new one. */
  previous: RecordSnapshot | null
  /** Names of the fields that changed. */
  changed: string[]
  /** Before and after, for the fields the change log records (title, status, folder). */
  changes: Record<string, { from: unknown; to: unknown }>
  file?: {
    name: string
    media_type: string
    byte_size: number
    checksum: string | null
    /** The contents, in the encoding the hook asked for. Absent when it asked for none. */
    content?: string
    encoding?: 'text' | 'base64'
  } | null
}

export async function runExtensionRecordHook(
  args: Caller & { hookId: string; timing: 'before'; input: RecordHookInput },
  deps?: ExtensionRuntimeDeps,
): Promise<BeforeAnswer>
export async function runExtensionRecordHook(
  args: Caller & { hookId: string; timing: 'after'; input: RecordHookInput },
  deps?: ExtensionRuntimeDeps,
): Promise<AfterAnswer>
export async function runExtensionRecordHook(
  args: Caller & {
    hookId: string
    timing: 'before' | 'after'
    input: RecordHookInput
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<BeforeAnswer | AfterAnswer> {
  const { value } = await withItem(
    deps,
    args,
    'record-hooks',
    args.hookId,
    async (declaration, resolved) => {
      if (declaration.timing !== args.timing)
        throw new ExtensionRunError(
          'wrong_timing',
          'This hook runs at a different moment.',
        )

      if (!declaration.when.includes(args.input.when))
        throw new ExtensionRunError(
          'wrong_event',
          'This hook was not set up for that.',
        )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: { ...args.input, timing: args.timing },
        },
      })

      const schema = args.timing === 'before' ? beforeAnswer : afterAnswer
      const parsed = schema.safeParse(result.rows.at(0) ?? {})

      if (!parsed.success)
        throw bad(
          `The plugin’s hook gave an answer Sheetbase can’t use${
            args.timing === 'before'
              ? ' (before a save it can only refuse, warn or fill in fields)'
              : ''
          }: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`,
        )

      return parsed.data
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Connectors.
// ---------------------------------------------------------------------------

const requestPlan = z.strictObject({
  requests: z
    .array(
      z.strictObject({
        url: z.string().min(1).max(2000),
        headers: z
          .record(
            z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,40}$/),
            z.string().max(2000),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(CONNECTOR_MAX_REQUESTS),
})

/** Headers a plugin may not set: the app speaks for itself on those. */
export const FORBIDDEN_HEADERS = new Set([
  'host',
  'cookie',
  'set-cookie',
  'content-length',
  'connection',
  'transfer-encoding',
  'proxy-authorization',
  'upgrade',
])

export interface ConnectorResponse {
  url: string
  status: number
  text: string
  json: unknown
}

export interface ConnectorFetch {
  (
    url: URL,
    init: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
      body?: string
      headers: Record<string, string>
      signal: AbortSignal
    },
  ): Promise<{ status: number; body: Uint8Array }>
}

export const defaultFetch: ConnectorFetch = async (url, init) => {
  const request: RequestInit = {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: init.headers,
    signal: init.signal,
  }

  if (init.body !== undefined) request.body = init.body

  const response = await fetch(url, request)

  // A redirect could lead off the approved host; a plugin names the final URL.
  if (response.status >= 300 && response.status < 400)
    throw new ExtensionRunError(
      'redirected',
      'The service redirected the request somewhere else, which a connector may not follow.',
    )
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  while (reader) {
    const { done, value } = await reader.read()

    if (done) break
    size += value.byteLength

    if (size > CONNECTOR_MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ExtensionRunError(
        'too_large',
        'The service sent back more than a connector may read.',
      )
    }

    chunks.push(value)
  }

  const body = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { status: response.status, body }
}

/** The request a connector may make: the approved URL and the headers to send. */
export interface CheckedConnectorRequest {
  url: URL
  headers: Record<string, string>
}

/** Checks one request a plugin asked for against what the connector declared. */
export function checkConnectorRequest(
  declaration: Pick<ExtensionConnectorDeclaration, 'hosts'>,
  request: { url: string; headers?: Record<string, string> },
): CheckedConnectorRequest {
  let url: URL

  try {
    url = validateConnectorEndpointUrl(request.url)
  } catch (error) {
    throw new ExtensionRunError(
      'bad_request',
      error instanceof Error ? error.message : 'That address is not allowed.',
    )
  }

  if (url.protocol !== 'https:' || (url.port && url.port !== '443'))
    throw new ExtensionRunError(
      'bad_request',
      'A connector may only call HTTPS addresses on the standard port.',
    )

  if (!declaration.hosts.includes(url.hostname.toLowerCase()))
    throw new ExtensionRunError(
      'host_not_approved',
      `The plugin asked for ${url.hostname}, which is not one of the hosts it declared (${declaration.hosts.join(', ')}).`,
    )
  const headers: Record<string, string> = {}

  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()))
      throw new ExtensionRunError(
        'bad_request',
        `A connector may not set the ${name} header.`,
      )
    headers[name] = value
  }

  return { url, headers }
}

export async function runExtensionConnector(
  args: Caller & {
    connectorId: string
    parameters: unknown
    /** What the person typed for the connector's settings; never stored. */
    settings: Record<string, string>
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
  fetchUrl: ConnectorFetch = defaultFetch,
): Promise<ImportedTable & { durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'connectors',
    args.connectorId,
    async (declaration, resolved) => {
      const parameters = checkDeclaredValues(
        declaration.parameters,
        args.parameters ?? {},
        'input',
      )

      const given = (name: string): string | undefined => args.settings[name]

      for (const setting of declaration.settings) {
        if (setting.required && !given(setting.name)?.trim())
          throw new ExtensionRunError(
            'bad_input',
            `“${setting.label}” is needed.`,
          )
      }

      const settings = Object.fromEntries(
        declaration.settings
          .filter((setting) => given(setting.name) !== undefined)
          .map((setting) => [setting.name, given(setting.name)]),
      )

      // 1. The plugin says which requests to make.
      const planned = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: { parameters, settings },
        },
      })

      const plan = requestPlan.safeParse(planned.rows.at(0))

      if (!plan.success)
        throw bad(
          'The plugin’s request plan isn’t a list of requests (url, optional headers).',
        )

      // 2. The app makes them, to the declared hosts and nowhere else.
      const checked = plan.data.requests.map((request) =>
        checkConnectorRequest(declaration, request),
      )

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CONNECTOR_TIMEOUT_MS)
      const responses: ConnectorResponse[] = []

      try {
        for (const { url, headers } of checked) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- one request is in flight at a time, so a connector cannot open its whole declared fan-out against one service at once and the answers arrive in declared order.
          const answer = await fetchUrl(url, {
            headers: {
              Accept: 'application/json, text/plain, */*',
              ...headers,
            },
            signal: controller.signal,
          }).catch((error) => {
            if (error instanceof ExtensionRunError) throw error
            throw new ExtensionRunError(
              'service_unreachable',
              `${url.hostname} could not be reached.`,
            )
          })

          const text = new TextDecoder().decode(answer.body)
          let json: JsonValue = null

          try {
            json = JSON.parse(text)
          } catch {
            json = null
          }

          responses.push({
            url: url.toString(),
            status: answer.status,
            text,
            json,
          })
        }
      } finally {
        clearTimeout(timer)
      }

      // 3. The plugin turns the answers into rows.
      const parsed = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'rows',
          entry: declaration.parse.entry,
          input: { responses, parameters },
        },
      })

      if (parsed.rows.length === 0)
        throw bad('The service answered, but the plugin found no rows in it.')

      return { columns: columnsOf(parsed.rows), rows: parsed.rows }
    },
  )

  return { ...value, durationMs }
}

// ---------------------------------------------------------------------------
// Barcode formats.
// ---------------------------------------------------------------------------

export const BARCODE_MAX_MODULES = 4000
export const BARCODE_MAX_SIDE = 160

/** A code ready to draw: it is data, so no plugin code ever runs where it is shown. */
export type BarcodeDrawing =
  { kind: 'bars'; modules: string } | { kind: 'grid'; rows: string[] }

const barsAnswer = z.strictObject({
  modules: z
    .string()
    .regex(/^[01]+$/)
    .max(BARCODE_MAX_MODULES),
})

const gridAnswer = z
  .strictObject({
    grid: z
      .array(
        z
          .string()
          .regex(/^[01]+$/)
          .max(BARCODE_MAX_SIDE),
      )
      .min(1)
      .max(BARCODE_MAX_SIDE),
  })
  .refine((answer) =>
    answer.grid.every((row) => row.length === answer.grid[0]?.length),
  )

export async function runExtensionBarcodeFormat(
  args: Caller & { formatId: string; value: string },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<BarcodeDrawing & { durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'barcode-formats',
    args.formatId,
    async (declaration, resolved) => {
      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: { value: args.value },
        },
      })

      const answer = result.rows.at(0) ?? {}

      if (declaration.shape === '1d') {
        const parsed = barsAnswer.safeParse(answer)

        if (!parsed.success)
          throw bad(
            'The plugin’s barcode format didn’t answer with `modules`: a string of 1s (bar) and 0s (space).',
          )

        return { kind: 'bars' as const, modules: parsed.data.modules }
      }

      const parsed = gridAnswer.safeParse(answer)

      if (!parsed.success)
        throw bad(
          'The plugin’s barcode format didn’t answer with `grid`: rows of 1s (dark) and 0s (light), all the same length.',
        )

      return { kind: 'grid' as const, rows: parsed.data.grid }
    },
  )

  return { ...value, durationMs }
}

const decodedAnswer = z.strictObject({
  value: z.string().min(1).max(200).nullable(),
})

/** Turns the text a scanner read into the value the plugin says it stands for, or null when it is not one of its codes. */
export async function runExtensionBarcodeParse(
  args: Caller & { formatId: string; text: string },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<string | null> {
  const { value } = await withItem(
    deps,
    args,
    'barcode-formats',
    args.formatId,
    async (declaration, resolved) => {
      if (!declaration.parse)
        throw new ExtensionRunError(
          'not_declared',
          'That barcode format does not read scanned codes.',
        )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.parse.entry,
          input: { text: args.text.slice(0, 2000) },
        },
      })

      const parsed = decodedAnswer.safeParse(result.rows.at(0) ?? {})

      if (!parsed.success)
        throw bad(
          'The plugin’s scan reader didn’t answer with a `value` (text, or null when it is not its code).',
        )

      return parsed.data.value
    },
  )

  return value
}

// ---------------------------------------------------------------------------
// Label formats.
// ---------------------------------------------------------------------------

export const LABEL_MAX_LINES = 12

export interface LabelLine {
  text: string
  bold: boolean
}

const labelAnswer = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        text: z.string().max(120),
        bold: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(LABEL_MAX_LINES),
})

export async function runExtensionLabelFormat<
  Fields extends Record<string, unknown>,
>(
  args: Caller & {
    formatId: string
    kind: string
    /** The record's fields; the plugin reads the ones its format names. */
    record: Fields
    template: { widthMm: number; heightMm: number }
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<{ lines: LabelLine[]; durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'label-formats',
    args.formatId,
    async (declaration, resolved) => {
      if (!declaration.kinds.includes(args.kind))
        throw new ExtensionRunError(
          'wrong_kind',
          `This label layout is for ${declaration.kinds.join(', ')}, not ${args.kind}.`,
        )

      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: {
            kind: args.kind,
            record: args.record,
            template: args.template,
          },
        },
      })

      const parsed = labelAnswer.safeParse(result.rows.at(0) ?? {})

      if (!parsed.success)
        throw bad(
          `The plugin’s label layout gave an answer Sheetbase can’t use: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`,
        )

      return parsed.data.lines.map((line) => ({
        text: line.text,
        bold: line.bold === true,
      }))
    },
  )

  return { lines: value, durationMs }
}

// ---------------------------------------------------------------------------
// Storage rules.
// ---------------------------------------------------------------------------

export interface StorageRulePlace {
  /** The names above the position, outermost first: site, room, unit, shelf, rack, box. */
  path: string[]
  /** The box's own name, or the typed place for a place that isn't in the storage setup. */
  box: string | null
  /** A1, B7 … or null for a typed place. */
  position: string | null
  /** The coldest and warmest the place is kept at, in °C, when known. */
  temperatureC: { min: number | null; max: number | null } | null
  /** The kind of unit above it (freezer, fridge, incubator …) when known. */
  unitType: string | null
  /** How many positions the box has and how many are taken, when it is a box. */
  capacity: number | null
  held: number | null
}

export interface StorageRuleVerdict {
  status: 'ok' | 'warn' | 'refuse'
  message: string
}

const storageAnswer = z.strictObject({
  status: z.enum(['ok', 'warn', 'refuse']),
  message: z.string().max(400).optional(),
})

export async function runExtensionStorageRule<
  Fields extends Record<string, unknown>,
>(
  args: Caller & {
    ruleId: string
    /** The sample's fields; the plugin reads the ones its rule names. */
    sample: Fields
    to: StorageRulePlace
    from: string | null
  },
  deps: ExtensionRuntimeDeps = defaultDeps(),
): Promise<StorageRuleVerdict & { durationMs: number }> {
  const { value, durationMs } = await withItem(
    deps,
    args,
    'storage-rules',
    args.ruleId,
    async (declaration, resolved) => {
      const result = await runPackage(deps, args.workspaceId, resolved, {
        inputs: {},
        parameters: {
          kind: 'operation',
          entry: declaration.runner.entry,
          input: { sample: args.sample, to: args.to, from: args.from },
        },
      })

      const parsed = storageAnswer.safeParse(result.rows.at(0) ?? {})

      if (!parsed.success)
        throw bad(
          'The plugin’s storage rule didn’t answer with a status (ok, warn or refuse) and a message.',
        )

      if (parsed.data.status !== 'ok' && !parsed.data.message?.trim())
        throw bad(
          'The plugin’s storage rule warned or refused without saying why.',
        )

      return {
        status: parsed.data.status,
        message: parsed.data.message?.trim() ?? '',
      }
    },
  )

  return { ...value, durationMs }
}
