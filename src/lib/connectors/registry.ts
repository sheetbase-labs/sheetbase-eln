/**
 * INT-01 — Connector SDK surface.
 *
 * Future integrations plug in here instead of inventing their own execution,
 * security or provenance model. Two extension points:
 *
 * - `CONNECTOR_TYPE_CATALOGUE`: static descriptors used by the product UI.
 * - `PARSERS`: ingestion parsers keyed by stable `parserId`. A parser turns an
 *   instrument payload into metadata + a tabular sheet with explicit identity
 *   (`parserId@version`) that is recorded in the run's provenance. Parsers are
 *   pure: no network, no side effects — validation and commit always go
 *   through the canonical Dataset RPCs afterwards.
 */
import type { ConnectorDirection, ConnectorType } from './types'
import { t } from '#/copy'

export interface ConnectorTypeDescriptor {
  type: ConnectorType
  label: string
  description: string
  directions: ConnectorDirection[]
}

export const CONNECTOR_TYPE_CATALOGUE: ConnectorTypeDescriptor[] = [
  {
    type: 'instrument',
    label: t('data.connectorRegistry.scientificInstrument'),
    description: t('data.connectorRegistry.ingestOutputsFromLab'),
    directions: ['inbound'],
  },
  {
    type: 'storage',
    label: t('data.connectorRegistry.fileStorage'),
    description: t('data.connectorRegistry.watchFetchFilesFrom'),
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'webhook',
    label: t('data.connectorRegistry.webhookEndpoint'),
    description: t('data.connectorRegistry.receiveEventsFromDeliver'),
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'database',
    label: t('data.connectorRegistry.databaseDataPlatform'),
    description: t('data.connectorRegistry.queryPublishAgainstEnterprise'),
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'custom',
    label: t('data.connectorRegistry.customIntegration'),
    description: t('data.connectorRegistry.workspaceBuiltIntegrationUsing'),
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
]

/** Structured output of one instrument payload parsed by a registered parser. */
export interface ParsedInstrumentPayload {
  /** Instrument/vendor metadata extracted from headers (serial, plate id, ...). */
  metadata: Record<string, string>
  /** Column headers of the data table. */
  headers: string[]
  rows: Array<Record<string, string>>
  warnings: string[]
}

export interface IngestionParser {
  /** Stable identity recorded in run results and change event payloads. */
  readonly parserId: string
  /** Bumped on any behavioural change to parsing so provenance stays honest. */
  readonly version: number
  readonly label: string
  parse: (text: string) => ParsedInstrumentPayload
}

const parserRegistry = new Map<string, IngestionParser>()

export function registerParser(parser: IngestionParser): void {
  parserRegistry.set(parser.parserId, parser)
}

export function getParser(parserId: string): IngestionParser | undefined {
  return parserRegistry.get(parserId)
}

export function listParsers(): IngestionParser[] {
  return [...parserRegistry.values()]
}

export function formatParserIdentity(parser: IngestionParser): string {
  return `${parser.parserId}@${parser.version}`
}
