/**
 * Which calls to the data boundary create, edit or move a record, and what the
 * record will look like after them. A hook that runs before a save is shown
 * that picture and can refuse it or fill in fields.
 *
 * Pure: it reads a request (method, resource, query, body) and describes it.
 * The data proxy and the server's own data client both ask it before they
 * forward a write, so a plugin sees the same thing whichever way a person or a
 * script saves.
 *
 * Covered: writes to the `records` table, the calls that create a record
 * (`create_record`, `create_model_record`, `create_record_with_blocks`), edit
 * its fields (`update_record_custom_fields`) and change its status
 * (`set_experiment_status`, `transition_record_status`, `start_experiment`,
 * `release_sample`, `quarantine_sample`, `dispose_sample`). Any other way a
 * record changes still reaches the hooks that run after a save.
 */
import { applyFill } from './hook-answers'
import type { FieldFill, RecordSnapshot } from './hook-answers'
import type { RecordHookWhen } from './data-points'

type Json = Record<string, unknown>

export interface PlannedWrite {
  /** An existing record this write changes; null when it creates one. */
  recordId: string | null
  whens: RecordHookWhen[]
  /** The record as it will be, given how it is now (null for a new record). */
  after: (previous: RecordSnapshot | null) => {
    record: RecordSnapshot
    changed: string[]
  }
  /**
   * Puts a fill into the body that will be sent. Returns null when this call
   * has nowhere to put one (a status change).
   */
  withFill: (fill: FieldFill) => string | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asObject(value: unknown): Json {
  return isRecord(value) ? value : {}
}

function parseBody(body: string | undefined): unknown {
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function tags(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : fallback
}

const BLANK: RecordSnapshot = {
  id: null,
  identifier: null,
  kind: '',
  title: '',
  status: 'draft',
  tags: [],
  properties: {},
  custom_fields: {},
  project_id: null,
}

function fromRow(row: Json, base: RecordSnapshot): RecordSnapshot {
  return {
    id: typeof row.id === 'string' ? row.id : base.id,
    identifier:
      typeof row.identifier === 'string' ? row.identifier : base.identifier,
    kind: typeof row.kind === 'string' ? row.kind : base.kind,
    title: typeof row.title === 'string' ? row.title : base.title,
    status: typeof row.status === 'string' ? row.status : base.status,
    tags: tags(row.tags, base.tags),
    properties: isRecord(row.properties) ? row.properties : base.properties,
    custom_fields: isRecord(row.custom_fields)
      ? row.custom_fields
      : base.custom_fields,
    project_id:
      typeof row.project_id === 'string' ? row.project_id : base.project_id,
  }
}

function differing(a: RecordSnapshot, b: RecordSnapshot): string[] {
  const changed: string[] = []
  if (a.title !== b.title) changed.push('title')
  if (a.status !== b.status) changed.push('status')
  if (JSON.stringify(a.tags) !== JSON.stringify(b.tags)) changed.push('tags')
  if (JSON.stringify(a.properties) !== JSON.stringify(b.properties))
    changed.push('properties')
  if (JSON.stringify(a.custom_fields) !== JSON.stringify(b.custom_fields))
    changed.push('custom_fields')
  return changed
}

function withFillInto(body: Json, fill: FieldFill): Json {
  const out = { ...body }
  if (fill.custom_fields)
    out.custom_fields = {
      ...asObject(body.custom_fields),
      ...fill.custom_fields,
    }
  if (fill.properties)
    out.properties = { ...asObject(body.properties), ...fill.properties }
  if (fill.tags) out.tags = fill.tags
  return out
}

function created(row: Json): PlannedWrite {
  return {
    recordId: null,
    whens: ['created'],
    after: () => ({ record: fromRow(row, BLANK), changed: [] }),
    withFill: (fill) => JSON.stringify(withFillInto(row, fill)),
  }
}

/** A call that creates a record from named arguments. */
function createdFromArgs(args: Json, withCustom: boolean): PlannedWrite {
  const snapshot = (): RecordSnapshot => ({
    ...BLANK,
    kind: typeof args.p_kind === 'string' ? args.p_kind : '',
    title: typeof args.p_title === 'string' ? args.p_title : '',
    status: typeof args.p_status === 'string' ? args.p_status : 'draft',
    tags: tags(args.p_tags, []),
    properties: asObject(args.p_properties),
    custom_fields: withCustom ? asObject(args.p_custom_fields) : {},
    project_id:
      typeof args.p_project_id === 'string' ? args.p_project_id : null,
  })
  return {
    recordId: null,
    whens: ['created'],
    after: () => ({ record: snapshot(), changed: [] }),
    withFill: (fill) => {
      // create_record has no custom fields; a fill for them has nowhere to go.
      if (fill.custom_fields && !withCustom) return null
      const next = { ...args }
      if (fill.custom_fields)
        next.p_custom_fields = {
          ...asObject(args.p_custom_fields),
          ...fill.custom_fields,
        }
      if (fill.properties)
        next.p_properties = {
          ...asObject(args.p_properties),
          ...fill.properties,
        }
      if (fill.tags) next.p_tags = fill.tags
      return JSON.stringify(next)
    },
  }
}

function statusChange(recordId: string, status: string): PlannedWrite {
  return {
    recordId,
    whens: ['status-changed'],
    after: (previous) => {
      const base = previous ?? { ...BLANK, id: recordId }
      return { record: { ...base, status }, changed: ['status'] }
    },
    withFill: () => null,
  }
}

const FIXED_STATUS_CALLS: Record<string, string> = {
  start_experiment: 'in_progress',
  release_sample: 'released',
  quarantine_sample: 'quarantined',
  dispose_sample: 'disposed',
}

/**
 * Describes a write, or returns null when it is not one a hook can see.
 * A bulk insert gives one planned write per row.
 */
export function describeRecordWrite(input: {
  method: string
  kind: 'table' | 'rpc'
  resource: string
  /** The query string, with or without the leading `?`. */
  query: string
  body: string | undefined
}): PlannedWrite[] | null {
  const method = input.method.toUpperCase()
  const query = new URLSearchParams(input.query.replace(/^\?/, ''))
  const body = parseBody(input.body)

  if (input.kind === 'table') {
    if (input.resource !== 'records') return null
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : body === undefined ? [] : [body]
      const planned = rows.filter(isRecord).map(created)
      return planned.length > 0 ? planned : null
    }
    if (method === 'PATCH' && isRecord(body)) {
      const filter = query.get('id') ?? ''
      const recordId = filter.startsWith('eq.') ? filter.slice(3) : ''
      if (!UUID_RE.test(recordId)) return null
      const row = body
      const whens: RecordHookWhen[] =
        typeof row.status === 'string'
          ? ['edited', 'status-changed']
          : ['edited']
      return [
        {
          recordId,
          whens,
          after: (previous) => {
            const base = previous ?? { ...BLANK, id: recordId }
            const record = fromRow(row, base)
            return { record, changed: differing(base, record) }
          },
          withFill: (fill) => JSON.stringify(withFillInto(row, fill)),
        },
      ]
    }
    return null
  }

  if (method !== 'POST' || !isRecord(body)) return null
  const args = body
  switch (input.resource) {
    case 'create_record':
    case 'create_record_with_blocks':
      return [createdFromArgs(args, false)]
    case 'create_model_record':
      return [createdFromArgs(args, true)]
    case 'update_record_custom_fields': {
      const recordId = args.p_record_id
      if (typeof recordId !== 'string' || !UUID_RE.test(recordId)) return null
      const values = asObject(args.p_values)
      return [
        {
          recordId,
          whens: ['edited'],
          after: (previous) => {
            const base = previous ?? { ...BLANK, id: recordId }
            const record = {
              ...base,
              custom_fields: { ...base.custom_fields, ...values },
            }
            return { record, changed: differing(base, record) }
          },
          withFill: (fill) => {
            if (!fill.custom_fields) return null
            return JSON.stringify({
              ...args,
              p_values: { ...values, ...fill.custom_fields },
            })
          },
        },
      ]
    }
    case 'set_experiment_status':
    case 'transition_record_status': {
      const recordId = args.p_record_id
      const status =
        input.resource === 'set_experiment_status'
          ? args.p_status
          : args.p_target_status
      if (
        typeof recordId !== 'string' ||
        !UUID_RE.test(recordId) ||
        typeof status !== 'string'
      )
        return null
      return [statusChange(recordId, status)]
    }
    default: {
      const status = FIXED_STATUS_CALLS[input.resource]
      const recordId = args.p_record_id
      if (!status || typeof recordId !== 'string' || !UUID_RE.test(recordId))
        return null
      return [statusChange(recordId, status)]
    }
  }
}

export { applyFill }
