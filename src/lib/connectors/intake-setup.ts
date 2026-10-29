/**
 * Guided data-intake setup for an instrument: the one connector that carries
 * an instrument's files in, made and changed from the instrument's page so
 * nobody types a connector key or a UUID.
 */
import type { DataClient } from '../data-client'
import { parseImportText } from '../import-parse'
import type { ParserSettingsRow } from '../parser-settings'
import { parserKindOf } from './builtin-parsers'
import type { ParserKind } from './builtin-parsers'
import { connectorKeyForInstrument } from './agent-package'
import { registerConnector, updateConnector } from './client'
import { detectParserId } from './instrument-parsers'
import { buildPickupConfig, pickupFormValues } from './pickup-config'
import type { PickupFormValues } from './pickup-config'
import { getParser } from './registry'
import type { ConnectorWire } from './types'

export const intakeSetupQueryKeys = {
  connector: (instrumentId: string) =>
    ['instrument-intake', 'connector', instrumentId] as const,
  agent: (connectorId: string) =>
    ['instrument-intake', 'agent', connectorId] as const,
}

/** What the setup asks: how files are read, and where they go. */
export interface IntakeSetupValues extends Omit<
  PickupFormValues,
  'autoDetect' | 'instrumentId'
> {
  /** A parser's key, or `''` to read each file by what's in it. */
  parserKey: string
}

export function intakeSetupValues(
  connector: ConnectorWire | null,
): IntakeSetupValues {
  const pickup = pickupFormValues(connector?.config ?? {})
  return {
    parserKey:
      connector?.parser_id && !pickup.autoDetect ? connector.parser_id : '',
    projectId: pickup.projectId,
    schemaVersionId: pickup.schemaVersionId,
    datasetId: pickup.datasetId,
    datasetNamePattern: pickup.datasetNamePattern,
  }
}

/** The instrument's own connector, if data intake was set up from here. */
export async function findInstrumentConnector(
  client: DataClient,
  instrumentId: string,
): Promise<ConnectorWire | null> {
  const rows = await client.list<ConnectorWire>(
    'connectors',
    '?connector_type=eq.instrument&status=neq.archived&select=*&order=created_at.asc',
  )
  return (
    rows.find((row) => {
      const pickup = row.config['pickup']
      return (
        pickup !== null &&
        typeof pickup === 'object' &&
        (pickup as Record<string, unknown>)['instrumentId'] === instrumentId
      )
    }) ?? null
  )
}

export type IntakeSetupErrors = Partial<Record<keyof IntakeSetupValues, string>>

/** Makes or updates the connector so the pickup endpoint finds everything. */
export async function saveIntakeSetup(
  client: DataClient,
  input: {
    workspaceId: string
    instrument: { id: string; name: string; displayId: string }
    existing: ConnectorWire | null
    values: IntakeSetupValues
  },
): Promise<
  | { ok: true; connector: ConnectorWire }
  | { ok: false; errors: IntakeSetupErrors }
> {
  const { values, existing, instrument } = input
  const built = buildPickupConfig(existing?.config ?? {}, {
    ...values,
    autoDetect: values.parserKey === '',
    instrumentId: instrument.id,
  })
  if (!built.ok) return { ok: false, errors: built.errors }
  const parserId = values.parserKey || null
  if (existing) {
    const connector = await updateConnector(client, {
      workspaceId: input.workspaceId,
      connectorId: existing.id,
      config: built.config,
      parserId,
    })
    return { ok: true, connector }
  }
  const connector = await registerConnector(client, {
    workspaceId: input.workspaceId,
    key: connectorKeyForInstrument(instrument.name, instrument.displayId),
    name: instrument.name,
    connectorType: 'instrument',
    direction: 'inbound',
    config: built.config,
    parserId,
  })
  return { ok: true, connector }
}

export type SamplePreview =
  | {
      status: 'ok'
      /** What read it: the parser's name, or what was recognised. */
      readBy: string
      headers: string[]
      rows: Array<Record<string, string>>
      rowCount: number
      warnings: string[]
    }
  | { status: 'unreadable'; reason: 'columns' | 'empty'; missing: string[] }
  | { status: 'later'; reason: 'service' | 'binary' }

const PREVIEW_ROWS = 5

function tablePreview(
  readBy: string,
  headers: string[],
  rows: Array<Record<string, string>>,
  warnings: string[],
): SamplePreview {
  if (rows.length === 0) {
    return { status: 'unreadable', reason: 'empty', missing: [] }
  }
  return {
    status: 'ok',
    readBy,
    headers,
    rows: rows.slice(0, PREVIEW_ROWS),
    rowCount: rows.length,
    warnings,
  }
}

/**
 * What a sample file would look like once read, using the parser the setup has
 * chosen (`parser` null = read by what's in the file). A parser that lives on
 * another service, or reads a binary format, can only be tried by a real file.
 */
export function previewSample(
  text: string,
  parser: ParserSettingsRow | null,
): SamplePreview {
  if (!parser) {
    const id = detectParserId(text)
    const reader = getParser(id)
    if (!reader) return { status: 'unreadable', reason: 'empty', missing: [] }
    try {
      const payload = reader.parse(text)
      return tablePreview(
        reader.label,
        payload.headers,
        payload.rows,
        payload.warnings,
      )
    } catch {
      return { status: 'unreadable', reason: 'empty', missing: [] }
    }
  }
  const version =
    parser.parser_versions.find((v) => v.status !== 'retired') ??
    parser.parser_versions.at(0)
  const kind: ParserKind = parserKindOf(parser.key, version?.signature ?? {})
  if (kind === 'webhook') return { status: 'later', reason: 'service' }
  if (parser.format === 'xlsx') return { status: 'later', reason: 'binary' }
  if (kind === 'builtin') {
    const reader = getParser(parser.key)
    if (!reader) return { status: 'later', reason: 'service' }
    try {
      const payload = reader.parse(text)
      return tablePreview(
        parser.name,
        payload.headers,
        payload.rows,
        payload.warnings,
      )
    } catch {
      return { status: 'unreadable', reason: 'empty', missing: [] }
    }
  }
  const required = Array.isArray(version?.signature['requiredHeaders'])
    ? (version.signature['requiredHeaders'] as string[])
    : []
  let sheet: ReturnType<typeof parseImportText>['sheets'][number]
  try {
    sheet = parseImportText(text, { header: true }).sheets[0]
  } catch {
    return { status: 'unreadable', reason: 'empty', missing: [] }
  }
  const have = new Set(sheet.headers.map((h) => h.trim().toLowerCase()))
  const missing = required.filter((h) => !have.has(h.toLowerCase()))
  if (missing.length > 0)
    return { status: 'unreadable', reason: 'columns', missing }
  return tablePreview(parser.name, sheet.headers, sheet.rows, [])
}
