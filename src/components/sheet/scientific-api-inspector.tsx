import { useState } from 'react'

import type {
  ScientificColumnWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

export interface ScientificApiRequestExample {
  id: 'list' | 'filter' | 'insert' | 'update'
  title: string
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  body?: Record<string, unknown>
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
  const insertBody = Object.fromEntries(
    table.columns
      .slice(0, 2)
      .map((column) => [column.field_name, exampleValue(column)]),
  )
  const updateBody = {
    [second]: exampleValue(table.columns[1] ?? table.columns[0]),
  }
  const definitions = [
    {
      id: 'list' as const,
      title: 'List rows',
      method: 'GET' as const,
      path: `${base}?select=${select}&order=created_at.asc,id.asc&limit=50`,
    },
    {
      id: 'filter' as const,
      title: 'Filter rows',
      method: 'GET' as const,
      path: `${base}?select=${select}&${first}=not.is.null&limit=50`,
    },
    {
      id: 'insert' as const,
      title: 'Insert a row',
      method: 'POST' as const,
      path: base,
      body: insertBody,
    },
    {
      id: 'update' as const,
      title: 'Update the selected row safely',
      method: 'PATCH' as const,
      path: `${base}?id=eq.${rowId}&version=eq.${rowVersion}`,
      body: updateBody,
    },
  ]
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

function exampleValue(column?: ScientificColumnWire): unknown {
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

const postgresType: Record<ScientificColumnWire['logical_type'], string> = {
  text: 'text',
  integer: 'bigint',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'timestamptz',
  category: 'uuid',
}

const restType: Record<ScientificColumnWire['logical_type'], string> = {
  text: 'JSON string',
  integer: 'JSON integer',
  decimal: 'JSON number',
  boolean: 'JSON boolean',
  date: 'YYYY-MM-DD string',
  timestamp: 'ISO 8601 string',
  category: 'option UUID string',
}

function describeUnit(unit: unknown) {
  if (!unit || typeof unit !== 'object') return 'None'
  const value = unit as { symbol?: unknown; code?: unknown }
  const symbol = typeof value.symbol === 'string' ? value.symbol : null
  const code = typeof value.code === 'string' ? value.code : null
  return symbol && code && symbol !== code
    ? `${symbol} (${code})`
    : (symbol ?? code ?? 'None')
}

function describeValidation(column: ScientificColumnWire) {
  const rules = Object.entries(column.validation)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
  if (column.logical_type === 'category')
    return `${column.options.length} allowed option${column.options.length === 1 ? '' : 's'}`
  return rules || 'Database type validation only'
}

export function ScientificApiInspector({
  table,
  selectedRowId,
  selectedRowVersion,
  selectedColumnId,
}: {
  table: ScientificTableWire
  selectedRowId?: string
  selectedRowVersion?: number
  selectedColumnId?: string
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const examples = buildScientificApiExamples(table, {
    rowId: selectedRowId,
    rowVersion: selectedRowVersion,
  })
  const selectedColumn = table.columns.find(
    (column) => column.id === selectedColumnId,
  )

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(id)
  }

  return (
    <details className="mt-3 rounded-md border bg-muted/20 text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        API inspector · {table.resource_name}
      </summary>
      <div className="space-y-5 border-t px-3 py-4">
        <section aria-labelledby={`api-identity-${table.id}`}>
          <h3 id={`api-identity-${table.id}`} className="font-semibold">
            Sheet identity
          </h3>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-2">
            <dt className="text-muted-foreground">Display name</dt>
            <dd>{table.name}</dd>
            <dt className="text-muted-foreground">REST resource</dt>
            <dd className="break-all font-mono">
              /api/db/{table.resource_name}
            </dd>
            <dt className="text-muted-foreground">Stable table ID</dt>
            <dd className="break-all font-mono">{table.id}</dd>
            <dt className="text-muted-foreground">Schema version</dt>
            <dd>{table.schema_version}</dd>
            {selectedRowId ? (
              <>
                <dt className="text-muted-foreground">Selected row</dt>
                <dd className="break-all font-mono">
                  {selectedRowId} · version {selectedRowVersion}
                </dd>
              </>
            ) : null}
            {selectedColumn ? (
              <>
                <dt className="text-muted-foreground">Selected column</dt>
                <dd>
                  {selectedColumn.label} ·{' '}
                  <span className="font-mono">{selectedColumn.field_name}</span>{' '}
                  · <span className="font-mono">{selectedColumn.id}</span>
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby={`api-fields-${table.id}`}>
          <h3 id={`api-fields-${table.id}`} className="font-semibold">
            Fields
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pr-3 pb-2">Grid / API identity</th>
                  <th className="pr-3 pb-2">Types</th>
                  <th className="pr-3 pb-2">Unit</th>
                  <th className="pb-2">Rules</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((column) => (
                  <tr key={column.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <span className="block font-medium">{column.label}</span>
                      <span className="block font-mono">
                        {column.field_name}
                      </span>
                      <span className="block break-all text-muted-foreground">
                        {column.id}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block">
                        PostgreSQL {postgresType[column.logical_type]}
                      </span>
                      <span className="block text-muted-foreground">
                        REST {restType[column.logical_type]}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{describeUnit(column.unit)}</td>
                    <td className="py-2">
                      {column.nullable ? 'May be empty' : 'Required'} ·{' '}
                      {describeValidation(column)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby={`api-access-${table.id}`}>
          <h3 id={`api-access-${table.id}`} className="font-semibold">
            Authentication
          </h3>
          <p className="mt-2">
            Browser code calls the same-origin resource with the signed-in
            session, for example{' '}
            <code>fetch('/api/db/{table.resource_name}?limit=50')</code>.
          </p>
          <p className="mt-1 text-muted-foreground">
            External integrations first exchange a stored API credential at{' '}
            <code>POST /api/token</code>, then put the short-lived token in{' '}
            <code>$TOKEN</code>. The examples contain placeholders only; this
            page never reads or displays a credential or token.
          </p>
        </section>

        <section aria-labelledby={`api-examples-${table.id}`}>
          <h3 id={`api-examples-${table.id}`} className="font-semibold">
            Authenticated request examples
          </h3>
          <div className="mt-2 space-y-3">
            {examples.map((example) => (
              <div
                key={example.id}
                className="rounded border bg-background p-2"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong>{example.title}</strong>
                  <button
                    type="button"
                    onClick={() => void copy(example.id, example.code)}
                  >
                    {copied === example.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                  {example.code}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby={`api-formulas-${table.id}`}>
          <h3 id={`api-formulas-${table.id}`} className="font-semibold">
            Formulas and calculated results
          </h3>
          <p className="mt-2">
            <code>/api/db/formula_definitions</code> stores durable formula
            source and stable target identities.{' '}
            <code>/api/db/formula_results</code> reports pending, current,
            stale, failed, or unavailable calculation state.
          </p>
          <p className="mt-1 text-muted-foreground">
            A calculated value is derived cache data, never the source value.
            Read it only when <code>calculation_status=current</code>; literals
            in this sheet and formula definitions remain authoritative.
          </p>
        </section>
      </div>
    </details>
  )
}
