import { rich, t } from '#/copy'
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
      title: t('notebook.scientificApiInspector.title'),
      method: 'GET' as const,
      path: `${base}?select=${select}&order=created_at.asc,id.asc&limit=50`,
    },
    {
      id: 'filter' as const,
      title: t('notebook.scientificApiInspector.filterRowsTitle'),
      method: 'GET' as const,
      path: `${base}?select=${select}&${first}=not.is.null&limit=50`,
    },
    {
      id: 'insert' as const,
      title: t('notebook.scientificApiInspector.insertARowTitle'),
      method: 'POST' as const,
      path: base,
      body: insertBody,
    },
    {
      id: 'update' as const,
      title: t('notebook.scientificApiInspector.updateTheSelectedRowTitle'),
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
  reference: 'uuid',
}

const restType: Record<ScientificColumnWire['logical_type'], string> = {
  text: t('notebook.scientificApiInspector.jsonString'),
  integer: t('notebook.scientificApiInspector.jsonInteger'),
  decimal: t('notebook.scientificApiInspector.jsonNumber'),
  boolean: t('notebook.scientificApiInspector.jsonBoolean'),
  date: t('notebook.scientificApiInspector.yyyyMmDdString'),
  timestamp: t('notebook.scientificApiInspector.iso8601String'),
  category: t('notebook.scientificApiInspector.optionUuidString'),
  reference: t('notebook.scientificApiInspector.referencedRowUuidString'),
}

function describeUnit(unit: unknown) {
  if (!unit || typeof unit !== 'object') return t('common.states.none')
  const value = unit as { symbol?: unknown; code?: unknown }
  const symbol = typeof value.symbol === 'string' ? value.symbol : null
  const code = typeof value.code === 'string' ? value.code : null
  return symbol && code && symbol !== code
    ? `${symbol} (${code})`
    : (symbol ?? code ?? t('common.states.none'))
}

function describeValidation(column: ScientificColumnWire) {
  const rules = Object.entries(column.validation)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
  if (column.logical_type === 'category')
    return `${column.options.length} allowed option${column.options.length === 1 ? '' : 's'}`
  return (
    rules || t('notebook.scientificApiInspector.databaseTypeValidationOnly')
  )
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
        {t('notebook.scientificApiInspector.apiInspector')}
      </summary>
      <div className="space-y-5 border-t px-3 py-4">
        <section aria-labelledby={`api-identity-${table.id}`}>
          <h3 id={`api-identity-${table.id}`} className="font-semibold">
            {t('notebook.scientificApiInspector.sheetIdentity')}
          </h3>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-2">
            <dt className="text-muted-foreground">
              {t('notebook.scientificApiInspector.displayName')}
            </dt>
            <dd>{table.name}</dd>
            <dt className="text-muted-foreground">
              {t('notebook.scientificApiInspector.restResource')}
            </dt>
            <dd className="break-all font-mono">
              /api/db/{table.resource_name}
            </dd>
            <dt className="text-muted-foreground">
              {t('notebook.scientificApiInspector.stableTableId')}
            </dt>
            <dd className="break-all font-mono">{table.id}</dd>
            <dt className="text-muted-foreground">
              {t('notebook.scientificApiInspector.schemaVersion')}
            </dt>
            <dd>{table.schema_version}</dd>
            {selectedRowId ? (
              <>
                <dt className="text-muted-foreground">
                  {t('notebook.scientificApiInspector.selectedRow')}
                </dt>
                <dd className="break-all font-mono">
                  {t(
                    'notebook.scientificApiInspector.selectedrowidVersionSelectedrowversion',
                    {
                      selectedRowId,
                      selectedRowVersion: selectedRowVersion ?? '',
                    },
                  )}
                </dd>
              </>
            ) : null}
            {selectedColumn ? (
              <>
                <dt className="text-muted-foreground">
                  {t('notebook.scientificApiInspector.selectedColumn')}
                </dt>
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
            {t('notebook.scientificApiInspector.fields')}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pr-3 pb-2">
                    {t('notebook.scientificApiInspector.gridApiIdentity')}
                  </th>
                  <th className="pr-3 pb-2">
                    {t('notebook.scientificApiInspector.types')}
                  </th>
                  <th className="pr-3 pb-2">
                    {t('notebook.scientificApiInspector.unit')}
                  </th>
                  <th className="pb-2">
                    {t('notebook.scientificApiInspector.rules')}
                  </th>
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
                        {t(
                          'notebook.scientificApiInspector.postgresqlPostgrestype',
                          { postgresType: postgresType[column.logical_type] },
                        )}
                      </span>
                      <span className="block text-muted-foreground">
                        {t('notebook.scientificApiInspector.restResttype', {
                          restType: restType[column.logical_type],
                        })}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{describeUnit(column.unit)}</td>
                    <td className="py-2">
                      {column.nullable
                        ? t('notebook.scientificApiInspector.mayBeEmpty')
                        : t('common.states.required')}{' '}
                      · {describeValidation(column)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby={`api-access-${table.id}`}>
          <h3 id={`api-access-${table.id}`} className="font-semibold">
            {t('notebook.scientificApiInspector.authentication')}
          </h3>
          <p className="mt-2">
            {rich('notebook.scientificApiInspector.browserCode', {
              resource: table.resource_name,
              code: (text) => <code>{text}</code>,
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {rich('notebook.scientificApiInspector.externalIntegrations', {
              code: (text) => <code>{text}</code>,
            })}
          </p>
        </section>

        <section aria-labelledby={`api-examples-${table.id}`}>
          <h3 id={`api-examples-${table.id}`} className="font-semibold">
            {t('notebook.scientificApiInspector.authenticatedRequestExamples')}
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
                    {copied === example.id
                      ? t('common.states.copied')
                      : t('common.actions.copy')}
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {example.code}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby={`api-formulas-${table.id}`}>
          <h3 id={`api-formulas-${table.id}`} className="font-semibold">
            {t('notebook.scientificApiInspector.formulasAndCalculatedResults')}
          </h3>
          <p className="mt-2">
            {rich('notebook.scientificApiInspector.formulaStorage', {
              code: (text) => <code>{text}</code>,
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {rich('notebook.scientificApiInspector.calculatedValues', {
              code: (text) => <code>{text}</code>,
            })}
          </p>
        </section>
      </div>
    </details>
  )
}
