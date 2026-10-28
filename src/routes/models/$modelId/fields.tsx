import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { isUuid } from '#/lib/field-value-validation'
import { RecordModelFields } from '#/components/v3/models/record-model-fields-tab'
import { builtInModel } from '#/lib/built-in-models'
import type { BuiltInModel } from '#/lib/built-in-models'
import { BuiltInModelFieldsRoute } from '#/components/v3/models/built-in-model-layout'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Select } from '#/components/v3/ui/select'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  useModelFields,
  useModelVersions,
} from '#/components/v3/models/models-data'
import type { CanonicalDatasetSchemaField } from '#/components/v3/models/models-data'

/** UI port (roadmap-4/ui-app3): the Fields tab reads the selected schema
 * version's field list. */
export const Route = createFileRoute('/models/$modelId/fields')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { version?: string; add?: true } => ({
    version: typeof search.version === 'string' ? search.version : undefined,
    // The built-in model header's "Add field" opens the dialog here.
    add: search.add === true || search.add === 'true' ? true : undefined,
  }),
  component: ModelFieldsRoute,
})

/** A workspace record model (addressed by key) and a built-in model each
 * have their own fields view. */
function ModelFieldsRoute() {
  const { modelId } = Route.useParams()
  const builtIn = builtInModel(modelId)
  if (builtIn) return <BuiltInFields model={builtIn} />
  return isUuid(modelId) ? (
    <ModelFields />
  ) : (
    <RecordModelFields modelKey={modelId} />
  )
}

function BuiltInFields({ model }: { model: BuiltInModel }) {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { context } = Route.useRouteContext()
  return (
    <BuiltInModelFieldsRoute
      model={model}
      workspaceId={context.workspace?.id ?? null}
      role={context.workspace?.role}
      addOpen={search.add === true}
      onAddOpenChange={(open) =>
        void navigate({
          search: (s) => ({ ...s, add: open ? true : undefined }),
          replace: true,
        })
      }
    />
  )
}

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
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.field_id ?? null,
    setSelected,
  )
  const columns: RegistryColumn<CanonicalDatasetSchemaField>[] = [
    {
      id: 'key',
      header: 'Key',
      cell: ({ row }) => <span className="mono">{row.original.key}</span>,
    },
    { id: 'label', header: 'Label', cell: ({ row }) => row.original.label },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => fieldTypeLabel(row.original),
    },
    {
      id: 'required',
      header: 'Required',
      cell: ({ row }) => (row.original.nullable ? 'Optional' : 'Yes'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Status tone={row.original.lifecycle === 'active' ? 'ok' : 'stored'}>
          {row.original.lifecycle === 'active' ? 'Active' : 'Retired'}
        </Status>
      ),
    },
  ]

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {list.length > 1 ? (
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6">
            <label className="text-label text-fg-muted" htmlFor="version">
              Version
            </label>
            <Select
              id="version"
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
            </Select>
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
              description="Open Edit model, choose Start draft, add fields, then publish it. Only model owners and admins can."
              action={
                <Button
                  variant="primary"
                  nativeButton={false}
                  render={
                    <Link to="/models/$modelId/edit" params={{ modelId }} />
                  }
                >
                  Edit model
                </Button>
              }
            />
          ) : rows.length ? (
            <TableBox>
              <RegistryGrid
                label="Model fields"
                rows={rows}
                columns={columns}
                getRowId={(f) => f.field_id}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              icon="table"
              title="No fields on this version"
              description="Open Edit model to add fields to the draft version, then publish it for datasets to use. Only model owners and admins can."
              action={
                <Button
                  variant="primary"
                  nativeButton={false}
                  render={
                    <Link to="/models/$modelId/edit" params={{ modelId }} />
                  }
                >
                  Edit model
                </Button>
              }
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
                ['Required', sel.nullable ? 'Optional' : 'Yes'],
                ['Cardinality', sel.cardinality],
                [
                  'Status',
                  <Status
                    key="status"
                    tone={sel.lifecycle === 'active' ? 'ok' : 'stored'}
                  >
                    {sel.lifecycle === 'active' ? 'Active' : 'Retired'}
                  </Status>,
                ],
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
