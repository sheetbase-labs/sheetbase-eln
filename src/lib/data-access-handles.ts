import { isUuid } from '#/lib/field-value-validation'

/**
 * The technical handles of a page, in the words a data steward uses: the
 * model key, the API route and the Postgres name. Names come from one place
 * so the panel, the Fields tables and the snippets never disagree.
 */

/** A model or field key as Postgres spells it: snake_case, no dots or dashes. */
export function pgIdentifier(key: string): string {
  const snake = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return /^[0-9]/.test(snake) ? `m_${snake}` : snake
}

/**
 * What the database says the reporting names are. Absent until it loads (and
 * for an unmapped model), when the plain spelling below stands in.
 */
export interface ReportingNames {
  viewName: (modelKey: string) => string | undefined
  columnName: (modelKey: string, fieldKey: string) => string | undefined
}

/** The views the database creates for built-in models, before it answers. */
const BUILT_IN_VIEWS: Readonly<Record<string, string | undefined>> = {
  experiment: 'experiments',
  sample: 'samples',
  material: 'materials',
  protocol_template: 'protocol_templates',
  study: 'studies',
  notebook_template: 'notebook_templates',
  file: 'files',
  report: 'reports',
  project: 'projects',
  instrument: 'instruments',
}

/** The reporting view a model's objects are read from, schema-qualified. */
export function reportingViewName(
  modelKey: string,
  names?: ReportingNames,
): string {
  const view =
    names?.viewName(modelKey) ??
    BUILT_IN_VIEWS[modelKey] ??
    pgIdentifier(modelKey)
  return view.includes('.') ? view : `data.${view}`
}

/** The column a field's values are read from in a reporting view. */
export function reportingColumnName(
  modelKey: string | null,
  fieldKey: string,
  names?: ReportingNames,
): string {
  return (
    (modelKey ? names?.columnName(modelKey, fieldKey) : undefined) ??
    pgIdentifier(fieldKey)
  )
}

export type DataAccessScope = 'list' | 'record' | 'model' | 'dataset'

export interface DataAccessHandle {
  scope: DataAccessScope
  /** What the page is, in a scientist's word: "Experiments", "Experiment". */
  label: string
  /** The model key, when the page has one. */
  modelKey: string | null
  /** The id or display ID a record page is addressed by. */
  recordRef: string | null
  /** The REST resource under `/api/db`, e.g. `records`. */
  resource: string
  /** PostgREST filters that scope the resource to this page. */
  filters: string[]
  /** What the SQL reads: a reporting view, or a real table. */
  relation: string
  /** Where-clauses scoping the relation to this page. */
  where: string[]
}

interface Surface {
  segment: string
  label: string
  singular: string
  modelKey: string
  resource: string
  /** Rows of this model share a table: the kind filter. */
  kindFilter?: string
  /** The column a display ID lives in. */
  refColumn: string
  relation?: string
}

const SURFACES: readonly Surface[] = [
  {
    segment: 'experiments',
    label: 'Experiments',
    singular: 'Experiment',
    modelKey: 'experiment',
    resource: 'records',
    kindFilter: 'experiment',
    refColumn: 'identifier',
  },
  {
    segment: 'samples',
    label: 'Samples',
    singular: 'Sample',
    modelKey: 'sample',
    resource: 'records',
    kindFilter: 'sample',
    refColumn: 'identifier',
  },
  {
    segment: 'materials',
    label: 'Materials',
    singular: 'Material',
    modelKey: 'material',
    resource: 'records',
    kindFilter: 'material',
    refColumn: 'identifier',
  },
  {
    segment: 'protocols',
    label: 'Protocols',
    singular: 'Protocol',
    modelKey: 'protocol_template',
    resource: 'records',
    kindFilter: 'protocol_template',
    refColumn: 'identifier',
  },
  {
    segment: 'projects',
    label: 'Projects',
    singular: 'Project',
    modelKey: 'project',
    resource: 'projects',
    refColumn: 'key',
  },
  {
    segment: 'instruments',
    label: 'Instruments',
    singular: 'Instrument',
    modelKey: 'instrument',
    resource: 'instruments',
    refColumn: 'identifier',
  },
  {
    segment: 'datasets',
    label: 'Datasets',
    singular: 'Dataset',
    modelKey: 'dataset',
    resource: 'datasets',
    refColumn: 'identifier',
  },
]

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Search params a list page keeps its filters in, as PostgREST filters. */
function filtersFromSearch(search: URLSearchParams): string[] {
  const out: string[] = []
  for (const [name, value] of search) {
    if (!value) continue
    if (name === 'status' || name === 'project') {
      const column = name === 'project' ? 'project_id' : 'status'
      const values = value.split(',').filter(Boolean)
      out.push(
        values.length > 1
          ? `${column}=in.(${values.join(',')})`
          : `${column}=eq.${value}`,
      )
    } else if (name === 'q') {
      out.push(`title=ilike.*${value}*`)
    }
  }
  return out
}

/** Reporting views name the display ID `display_id` and carry no project id. */
const VIEW_COLUMNS: Readonly<Record<string, string | null>> = {
  identifier: 'display_id',
  project_id: null,
}

function whereFromFilters(filters: string[], view: boolean): string[] {
  return filters.flatMap((filter) => {
    const match = /^([a-z_]+)=(eq|in|ilike)\.(.*)$/.exec(filter)
    if (!match) return []
    const [, rawColumn = '', op, rest] = match
    const column = view ? (VIEW_COLUMNS[rawColumn] ?? rawColumn) : rawColumn
    if (view && VIEW_COLUMNS[rawColumn] === null) return []
    if (op === 'eq') return [`${column} = ${sqlLiteral(rest)}`]
    if (op === 'ilike')
      return [`${column} ILIKE ${sqlLiteral(rest.replaceAll('*', '%'))}`]
    const values = rest
      .slice(1, -1)
      .split(',')
      .map((value) => sqlLiteral(value))
    return [`${column} IN (${values.join(', ')})`]
  })
}

function splitHref(href: string) {
  const [pathAndQuery = ''] = href.split('#')
  const [path = '', query = ''] = pathAndQuery.split('?')
  return {
    segments: path.split('/').filter(Boolean).map(decodeURIComponent),
    search: new URLSearchParams(query),
  }
}

/**
 * The handles for an app address, or null when the page has none (settings,
 * help, search...). Lists carry the filters in their address.
 */
export function resolveDataAccessHandle(
  href: string,
  names?: ReportingNames,
): DataAccessHandle | null {
  const { segments, search } = splitHref(href)
  const [segment, id] = segments
  if (!segment) return null

  if (segment === 'models') {
    if (!id) {
      return {
        scope: 'list',
        label: 'Models',
        modelKey: null,
        recordRef: null,
        resource: 'record_models',
        filters: [],
        relation: 'api.record_models',
        where: [],
      }
    }
    if (isUuid(id)) return null
    return {
      scope: 'model',
      label: 'Model',
      modelKey: id,
      recordRef: null,
      resource: 'records',
      filters: [`kind=eq.${id}`],
      relation: reportingViewName(id, names),
      where: [],
    }
  }

  if (segment === 'records' && id) {
    const column = isUuid(id) ? 'id' : 'identifier'
    return {
      scope: 'record',
      label: 'Record',
      modelKey: null,
      recordRef: id,
      resource: 'records',
      filters: [`${column}=eq.${id}`],
      relation: 'api.records',
      where: [`${column} = ${sqlLiteral(id)}`],
    }
  }

  const surface = SURFACES.find((entry) => entry.segment === segment)
  if (!surface || id === 'new') return null
  // Datasets are read from their table; every model has a reporting view.
  const view = surface.modelKey !== 'dataset'
  const relation = view
    ? reportingViewName(surface.modelKey, names)
    : `api.${surface.resource}`
  if (!id) {
    const filters = [
      ...(surface.kindFilter ? [`kind=eq.${surface.kindFilter}`] : []),
      ...filtersFromSearch(search),
    ]
    return {
      scope: 'list',
      label: surface.label,
      modelKey: surface.modelKey,
      recordRef: null,
      resource: surface.resource,
      filters,
      relation,
      where: whereFromFilters(
        filters.filter((filter) => !filter.startsWith('kind=')),
        view,
      ),
    }
  }
  const column = isUuid(id) ? 'id' : surface.refColumn
  const filter = `${column}=eq.${id}`
  return {
    scope: surface.segment === 'datasets' ? 'dataset' : 'record',
    label: surface.singular,
    modelKey: surface.modelKey,
    recordRef: id,
    resource: surface.resource,
    filters: [filter],
    relation,
    where: whereFromFilters([filter], view),
  }
}

export interface DataAccessSnippet {
  id: 'curl' | 'sdk' | 'python' | 'psycopg' | 'sql'
  label: string
  language: string
  code: string
}

export function apiRoute(handle: DataAccessHandle): string {
  const query = handle.filters.length ? `?${handle.filters.join('&')}` : ''
  return `/api/db/${handle.resource}${query}`
}

/**
 * The Python SDK call for a handle, or null where the SDK has no matching
 * method (other resources, or filters its list calls cannot express).
 */
function sdkCall(
  handle: DataAccessHandle,
): { call: string; scope: string } | null {
  const [filter, ...extra] = handle.filters
  const match = filter ? /^([a-z_]+)=eq\.(.*)$/.exec(filter) : null
  const column = match?.[1]
  const value = match?.[2] ?? ''
  if (handle.resource === 'records') {
    if (match && !extra.length && column === 'kind')
      return {
        call: `client.records.list(kind="${value}", limit=50)`,
        scope: 'records:read',
      }
    if (match && !extra.length && column === 'id' && isUuid(value))
      return { call: `client.records.get("${value}")`, scope: 'records:read' }
    return filter
      ? null
      : { call: 'client.records.list(limit=50)', scope: 'records:read' }
  }
  if (handle.resource === 'projects' || handle.resource === 'datasets') {
    const scope = `${handle.resource}:read`
    if (!filter)
      return { call: `client.${handle.resource}.list(limit=50)`, scope }
    if (match && !extra.length && column === 'id' && isUuid(value))
      return { call: `client.${handle.resource}.get("${value}")`, scope }
  }
  return null
}

export function dataAccessSnippets(
  handle: DataAccessHandle,
  origin: string,
): DataAccessSnippet[] {
  const route = apiRoute(handle)
  const sdk = sdkCall(handle)
  const url = `${origin}${route}${route.includes('?') ? '&' : '?'}limit=50`
  const sql = [
    `SELECT *`,
    `FROM ${handle.relation}`,
    ...(handle.where.length ? [`WHERE ${handle.where.join('\n  AND ')}`] : []),
    'LIMIT 50;',
  ].join('\n')
  return [
    {
      id: 'curl',
      label: 'curl',
      language: 'shell',
      code: `curl --fail -G -H "Authorization: Bearer $SHEETBASE_TOKEN" \\\n  '${url}'`,
    },
    ...(sdk
      ? [
          {
            id: 'sdk' as const,
            label: 'Python SDK',
            language: 'python',
            code: [
              'import os',
              'from sheetbase import SheetbaseClient',
              '',
              'client = SheetbaseClient(',
              `    base_url="${origin}",`,
              '    credential=os.environ["SHEETBASE_TOKEN"],',
              `    scopes=["${sdk.scope}"],`,
              ')',
              `rows = ${sdk.call}`,
            ].join('\n'),
          },
        ]
      : []),
    {
      id: 'python',
      label: 'Python (requests)',
      language: 'python',
      code: [
        'import os, requests',
        '',
        'response = requests.get(',
        `    "${url}",`,
        '    headers={"Authorization": f"Bearer {os.environ[\'SHEETBASE_TOKEN\']}"},',
        ')',
        'response.raise_for_status()',
        'rows = response.json()',
      ].join('\n'),
    },
    {
      id: 'psycopg',
      label: 'Python (psycopg)',
      language: 'python',
      code: [
        'import os, psycopg',
        '',
        'with psycopg.connect(os.environ["SHEETBASE_SQL_URL"]) as conn:',
        '    rows = conn.execute(',
        '        """',
        ...sql.split('\n').map((line) => `        ${line}`),
        '        """',
        '    ).fetchall()',
      ].join('\n'),
    },
    { id: 'sql', label: 'SQL', language: 'sql', code: sql },
  ]
}

/** A measurement table is a real table: its rows are read from it directly. */
export function scientificTableHandle(table: {
  name: string
  resource_name: string
}): DataAccessHandle {
  return {
    scope: 'list',
    label: table.name,
    modelKey: null,
    recordRef: null,
    resource: table.resource_name,
    filters: [],
    relation: `api.${table.resource_name}`,
    where: [],
  }
}
