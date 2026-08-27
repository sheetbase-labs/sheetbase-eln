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

export interface ConnectorTypeDescriptor {
  type: ConnectorType
  label: string
  description: string
  directions: ConnectorDirection[]
}

export const CONNECTOR_TYPE_CATALOGUE: ConnectorTypeDescriptor[] = [
  {
    type: 'instrument',
    label: 'Scientific instrument',
    description:
      'Ingest outputs from lab instruments into Datasets through a registered parser.',
    directions: ['inbound'],
  },
  {
    type: 'storage',
    label: 'File storage',
    description: 'Watch or fetch files from external storage locations.',
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'webhook',
    label: 'Webhook endpoint',
    description: 'Receive events from, or deliver events to, external systems.',
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'database',
    label: 'Database / data platform',
    description: 'Query or publish against enterprise data platforms.',
    directions: ['inbound', 'outbound', 'bidirectional'],
  },
  {
    type: 'custom',
    label: 'Custom integration',
    description: 'Workspace-built integration using the generic run model.',
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
