import { t } from '#/copy'
import type {
  ScientificColumnWire,
  ScientificTableWire,
  ScientificValues,
} from '#/lib/scientific-sheet-data'

export interface ScientificApiRequestExample {
  id: 'list' | 'filter' | 'insert' | 'update'
  title: string
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  body?: ScientificValues
  code: string
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildScientificApiExamples(
  table: ScientificTableWire,
  options: { rowId?: string; rowVersion?: number } = {},
): ScientificApiRequestExample[] {
  const fields = table.columns.map((column) => column.field_name)
  const first = fields[0] ?? 'col_<field>'
  const second = fields[1] ?? first
  const select = ['id', 'version', ...fields].join(',')
  const rowId = options.rowId ?? '<row-uuid>'
  const rowVersion = options.rowVersion ?? 1
  const base = `/api/db/${table.resource_name}`
  const insertBody: ScientificValues = {}

  for (const column of table.columns.slice(0, 2)) {
    insertBody[column.field_name] = exampleValue(column)
  }

  const updateBody = {
    [second]: exampleValue(table.columns[1] ?? table.columns[0]),
  }

  const definitions = [
    {
      id: 'list',
      title: t('notebook.scientificApiInspector.title'),
      method: 'GET',
      path: `${base}?select=${select}&order=created_at.asc,id.asc&limit=50`,
    },
    {
      id: 'filter',
      title: t('notebook.scientificApiInspector.filterRowsTitle'),
      method: 'GET',
      path: `${base}?select=${select}&${first}=not.is.null&limit=50`,
    },
    {
      id: 'insert',
      title: t('notebook.scientificApiInspector.insertARowTitle'),
      method: 'POST',
      path: base,
      body: insertBody,
    },
    {
      id: 'update',
      title: t('notebook.scientificApiInspector.updateTheSelectedRowTitle'),
      method: 'PATCH',
      path: `${base}?id=eq.${rowId}&version=eq.${rowVersion}`,
      body: updateBody,
    },
  ] satisfies Array<Omit<ScientificApiRequestExample, 'code'>>

  return definitions.map((example) => {
    const body = 'body' in example ? example.body : undefined

    const parts = [
      `curl --fail${example.method === 'GET' ? ' -G' : ` -X ${example.method}`}`,
      '-H "Authorization: Bearer $TOKEN"',
      ...(body
        ? [
            "-H 'content-type: application/json'",
            "-H 'Prefer: return=representation'",
            `-d ${shellQuote(JSON.stringify(body))}`,
          ]
        : []),
      shellQuote(example.path),
    ]

    return { ...example, body, code: parts.join(' \\\n  ') }
  })
}

function exampleValue(column?: ScientificColumnWire) {
  if (!column) return 'value'

  switch (column.logical_type) {
    case 'integer':
      return 1
    case 'decimal':
      return 1.5
    case 'boolean':
      return true
    case 'date':
      return '2026-07-20'
    case 'timestamp':
      return '2026-07-20T12:00:00Z'
    case 'category':
      return column.options[0]?.id ?? '<category-option-uuid>'
    default:
      return 'example'
  }
}
