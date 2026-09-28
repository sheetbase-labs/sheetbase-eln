import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): the Scan surface (MOB-02 / LAB-05). Resolves a
 * typed or scanned code to a real record or instrument by its stable identifier.
 * LAB-06's "also known as" aliases are not modelled yet, so only canonical
 * identifiers resolve; that is stated on the screen rather than faked.
 */
export interface ScanTarget {
  /** Record uuid or instrument uuid. */
  id: string
  /** Stable public identifier, e.g. SMP-2231 or INS-0007. */
  identifier: string
  title: string
  kind: 'sample' | 'record' | 'instrument'
  status: { tone: Tone; label: string }
  /** Secondary line: kind label and type/status detail. */
  line: string
}

interface RecordWire {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
}

interface InstrumentWire {
  id: string
  display_id: string | null
  name: string
  instrument_type: string
  connection_status: string
}

const RECORD_FIELDS = 'id,identifier,title,kind,status'
const INSTRUMENT_FIELDS = 'id,display_id,name,instrument_type,connection_status'

const KIND_LABELS: Record<string, string> = {
  sample: 'Sample',
  experiment: 'Experiment',
  reagent: 'Material',
  protocol_template: 'Protocol template',
  notebook_template: 'Notebook template',
  report: 'Report',
  study: 'Study',
}

export function scanKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

function toRecordTarget(row: RecordWire): ScanTarget {
  const kind = row.kind === 'sample' ? 'sample' : 'record'
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    kind,
    status: { tone: 'stored', label: row.status.replace(/_/g, ' ') },
    line: `${scanKindLabel(row.kind)} · ${row.status.replace(/_/g, ' ')}`,
  }
}

function toInstrumentTarget(row: InstrumentWire): ScanTarget {
  return {
    id: row.id,
    identifier: row.display_id ?? row.id.slice(0, 8),
    title: row.name,
    kind: 'instrument',
    status:
      row.connection_status === 'connected'
        ? { tone: 'ok', label: 'Connected' }
        : { tone: 'stored', label: 'Disconnected' },
    line: `Instrument · ${row.instrument_type}`,
  }
}

export interface ScanResolution {
  found: boolean
  code: string
  hit?: ScanTarget
  suggestions: ScanTarget[]
}

/** Where a scanned target opens. Samples, instruments and other records each
 * have their own canonical surface. */
export function scanTargetHref(target: ScanTarget): {
  to: string
  params: Record<string, string>
} {
  switch (target.kind) {
    case 'sample':
      return { to: '/samples/$sampleId', params: { sampleId: target.id } }
    case 'instrument':
      return {
        to: '/instruments/$instrumentId',
        params: { instrumentId: target.id },
      }
    default:
      return { to: '/records/$recordId', params: { recordId: target.id } }
  }
}

export function scanTargetActionLabel(target: ScanTarget): string {
  switch (target.kind) {
    case 'sample':
      return 'Open sample'
    case 'instrument':
      return 'Open instrument'
    default:
      return 'Open record'
  }
}

export async function resolveScanCode(
  code: string,
  client: DataClient = notebookDataClient,
): Promise<ScanResolution> {
  const trimmed = code.trim()
  if (!trimmed) return { found: false, code: trimmed, suggestions: [] }
  const exact = encodeURIComponent(trimmed)
  const fuzzy = encodeURIComponent(`*${trimmed}*`)

  const [exactRecords, exactInstruments] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?select=${RECORD_FIELDS}&identifier=eq.${exact}&limit=5`,
    ),
    client.list<InstrumentWire>(
      'instruments',
      `?select=${INSTRUMENT_FIELDS}&display_id=eq.${exact}&limit=5`,
    ),
  ])

  const exactTargets = [
    ...exactRecords.map(toRecordTarget),
    ...exactInstruments.map(toInstrumentTarget),
  ]
  if (exactTargets.length > 0) {
    return {
      found: true,
      code: trimmed,
      hit: exactTargets[0],
      suggestions: exactTargets.slice(1),
    }
  }

  const [fuzzyRecords, fuzzyInstruments] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?select=${RECORD_FIELDS}&identifier=ilike.${fuzzy}&limit=8`,
    ),
    client.list<InstrumentWire>(
      'instruments',
      `?select=${INSTRUMENT_FIELDS}&display_id=ilike.${fuzzy}&limit=8`,
    ),
  ])
  const suggestions = [
    ...fuzzyRecords.map(toRecordTarget),
    ...fuzzyInstruments.map(toInstrumentTarget),
  ].slice(0, 5)
  return { found: false, code: trimmed, suggestions }
}
