import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  useModelFields,
  useModelVersions,
} from '#/components/v3/models/models-data'
import type { CanonicalDatasetSchemaField } from '#/components/v3/models/models-data'

/** UI port (roadmap-4/ui-app3): the Fields tab reads the selected schema
 * version's field list. */
export const Route = createFileRoute('/models/$modelId/fields')({
  validateSearch: (search: Record<string, unknown>): { version?: string } => ({
    version: typeof search.version === 'string' ? search.version : undefined,
  }),
  component: ModelFields,
})

function fieldTypeLabel(field: CanonicalDatasetSchemaField): string {
  const quantity =
    field.quantity && typeof field.quantity === 'object'
      ? (field.quantity as { unit?: unknown }).unit
      : undefined
  const unit = typeof quantity === 'string' ? quantity : undefined
  return unit ? `${field.logical_type} · ${unit}` : field.logical_type
}

function ModelFields() {
  const { modelId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const versions = useModelVersions(modelId)
  const list = versions.data ?? []
  const version = list.find((v) => v.id === search.version) ?? list.at(0)
  const fields = useModelFields(version?.id)
  const [selected, setSelected] = useState<string | null>(null)
  const rows = fields.data ?? []
  const sel = rows.find((f) => f.field_id === selected) ?? rows.at(0)

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {list.length > 1 ? (
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6">
            <label className="text-label text-fg-muted" htmlFor="version">
              Version
            </label>
            <select
              id="version"
              className="h-[30px] rounded-md border border-border bg-surface px-2 text-body text-fg max-md:h-10"
              value={version?.id ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/models/$modelId/fields',
                  params: { modelId },
                  search: { version: e.target.value },
                  replace: true,
                })
              }
            >
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {v.lifecycle}
                </option>
              ))}
            </select>
            <Muted className="max-lg:hidden">
              {version?.published_at
                ? `Published ${version.published_at.slice(0, 10)}`
                : 'Not published'}
            </Muted>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 px-4 py-4 md:px-6">
          {!version ? (
            <EmptyState
              icon="table"
              title="No version yet"
              body="Start a version from the header, add fields, then publish it."
            />
          ) : rows.length ? (
            <TableBox>
              <Table aria-label="Model fields">
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((f) => (
                    <TableRow
                      key={f.field_id}
                      selected={f.field_id === sel?.field_id}
                      className="cursor-pointer"
                      onClick={() => setSelected(f.field_id)}
                    >
                      <TableCell className="mono">{f.key}</TableCell>
                      <TableCell>{f.label}</TableCell>
                      <TableCell>{fieldTypeLabel(f)}</TableCell>
                      <TableCell>{f.nullable ? 'Yes' : 'Required'}</TableCell>
                      <TableCell>
                        <Status
                          tone={f.lifecycle === 'active' ? 'ok' : 'stored'}
                        >
                          {f.lifecycle === 'active' ? 'Active' : 'Retired'}
                        </Status>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              icon="table"
              title="No fields on this version"
              body="Add fields to the draft version, then publish it for datasets to use."
            />
          )}
        </div>
      </div>

      {sel ? (
        <Inspector aria-label="Field details" className="w-[320px]">
          <InspectorSection title={sel.label}>
            <span className="mono text-fg-muted">{sel.key}</span>
            <DescriptionList
              labelWidth={90}
              items={[
                ['Type', sel.logical_type],
                ['Nullable', sel.nullable ? 'Yes' : 'Required'],
                ['Cardinality', sel.cardinality],
                ['Status', sel.lifecycle],
                ...(sel.default_value != null
                  ? [['Default', String(sel.default_value)] as [string, string]]
                  : []),
              ]}
            />
            {sel.description ? (
              <Muted className="mt-2">{sel.description}</Muted>
            ) : null}
          </InspectorSection>
          <InspectorSection title="Validation">
            {sel.validation && Object.keys(sel.validation).length ? (
              <DescriptionList
                labelWidth={90}
                items={Object.entries(sel.validation).map(([k, v]) => [
                  k,
                  String(v),
                ])}
              />
            ) : (
              <Muted>No validation rules on this field.</Muted>
            )}
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
