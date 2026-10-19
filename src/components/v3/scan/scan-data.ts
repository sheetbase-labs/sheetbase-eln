import type { Tone } from '#/components/v3/ui/status'
import { intakeHealth } from '#/components/v3/instruments/instruments-data'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import type { DataClient } from '#/lib/data-client'
import { resolveRegistryObject } from '#/lib/object-resolver'
import type { ResolvedObject } from '#/lib/object-resolver'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): the Scan surface (MOB-02 / LAB-05 / LAB-06).
 * Resolves a typed or scanned code to a real record or instrument by its stable
 * identifier or an "also known as" alias.
 */
export interface ScanTarget {
  /** Record uuid or instrument uuid. */
  id: string
  /** Stable public identifier, e.g. SMP-2231 or INS-0007. */
  identifier: string
  title: string
  kind: 'sample' | 'record' | 'instrument' | 'object'
  /** For `record`: the record's own kind (`experiment`, `material`, ...). */
  recordKind?: string
  /** For `object`: the registry kind (`dataset`, `project`, ...). */
  objectKind?: string
  status: { tone: Tone; label: string }
  /** Secondary line: kind label and type/status detail. */
  line: string
  /** Set when the code matched an "also known as" alias, not the identifier. */
  matchedAlias?: string
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
  intake_method: string
}

interface AliasWire {
  record_id: string
  alias: string
}

const RECORD_FIELDS = 'id,identifier,title,kind,status'
const INSTRUMENT_FIELDS = 'id,display_id,name,instrument_type,intake_method'

const KIND_LABELS: Record<string, string> = {
  sample: 'Sample',
  experiment: 'Experiment',
  material: 'Material',
  protocol_template: 'Protocol template',
  notebook_template: 'Notebook template',
  report: 'Report',
  study: 'Study',
  project: 'Project',
  dataset: 'Dataset',
  sheet: 'Sheet',
  pipeline: 'Pipeline',
  analysis: 'Analysis',
}

export function scanKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

function toRecordTarget(row: RecordWire): ScanTarget {
  const kind = row.kind === 'sample' ? 'sample' : 'record'
  const status = sampleStatus(row.status)
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    kind,
    recordKind: row.kind,
    status,
    line: `${scanKindLabel(row.kind)} · ${status.label}`,
  }
}

function toInstrumentTarget(row: InstrumentWire): ScanTarget {
  return {
    id: row.id,
    identifier: row.display_id ?? row.id.slice(0, 8),
    title: row.name,
    kind: 'instrument',
    status: intakeHealth(row.intake_method),
    line: `Instrument · ${row.instrument_type}`,
  }
}

function toObjectTarget(object: ResolvedObject): ScanTarget {
  return {
    id: object.id,
    identifier: object.identifier,
    title: object.title,
    kind: 'object',
    objectKind: object.kind,
    status: { tone: 'none', label: scanKindLabel(object.kind) },
    line: scanKindLabel(object.kind),
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
      // Every other kind is opened through the resolver, which sends it to the
      // page that owns it (experiment, material, dataset, project, ...).
      return { to: '/r/$identifier', params: { identifier: target.identifier } }
  }
}

export function scanTargetActionLabel(target: ScanTarget): string {
  switch (target.kind) {
    case 'sample':
      return 'Open sample'
    case 'instrument':
      return 'Open instrument'
    case 'object':
      return `Open ${scanKindLabel(target.objectKind ?? 'record').toLowerCase()}`
    default:
      return `Open ${scanKindLabel(target.recordKind ?? 'record').toLowerCase()}`
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

  const [exactRecords, exactInstruments, exactAliases] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?select=${RECORD_FIELDS}&identifier=eq.${exact}&limit=5`,
    ),
    client.list<InstrumentWire>(
      'instruments',
      `?select=${INSTRUMENT_FIELDS}&display_id=eq.${exact}&limit=5`,
    ),
    client.list<AliasWire>(
      'record_aliases',
      `?select=record_id,alias&alias=ilike.${exact}&limit=5`,
    ),
  ])

  const exactAliasTargets = await aliasTargets(client, exactAliases)
  const exactTargets = [
    ...exactRecords.map(toRecordTarget),
    ...exactInstruments.map(toInstrumentTarget),
    ...exactAliasTargets,
  ]
  // Not a record or an instrument: a dataset, project, sheet, pipeline or
  // analysis carries a display id too, and its label scans the same way.
  if (exactTargets.length === 0) {
    const other = await resolveRegistryObject(client, trimmed)
    if (other) exactTargets.push(toObjectTarget(other))
  }
  if (exactTargets.length > 0) {
    return {
      found: true,
      code: trimmed,
      hit: exactTargets[0],
      suggestions: exactTargets.slice(1),
    }
  }

  const [fuzzyRecords, fuzzyInstruments, fuzzyAliases] = await Promise.all([
    client.list<RecordWire>(
      'records',
      `?select=${RECORD_FIELDS}&identifier=ilike.${fuzzy}&limit=8`,
    ),
    client.list<InstrumentWire>(
      'instruments',
      `?select=${INSTRUMENT_FIELDS}&display_id=ilike.${fuzzy}&limit=8`,
    ),
    client.list<AliasWire>(
      'record_aliases',
      `?select=record_id,alias&alias=ilike.${fuzzy}&limit=8`,
    ),
  ])
  const fuzzyAliasTargets = await aliasTargets(client, fuzzyAliases)
  const suggestions = [
    ...fuzzyRecords.map(toRecordTarget),
    ...fuzzyInstruments.map(toInstrumentTarget),
    ...fuzzyAliasTargets,
  ].slice(0, 5)
  return { found: false, code: trimmed, suggestions }
}

/** Resolve alias rows to record targets, keeping the matched alias. */
async function aliasTargets(
  client: DataClient,
  aliases: AliasWire[],
): Promise<ScanTarget[]> {
  if (aliases.length === 0) return []
  const ids = Array.from(new Set(aliases.map((a) => a.record_id)))
  const records = await client.list<RecordWire>(
    'records',
    `?select=${RECORD_FIELDS}&id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`,
  )
  const byId = new Map(records.map((r) => [r.id, r]))
  const out: ScanTarget[] = []
  for (const alias of aliases) {
    const record = byId.get(alias.record_id)
    if (record)
      out.push({ ...toRecordTarget(record), matchedAlias: alias.alias })
  }
  return out
}
