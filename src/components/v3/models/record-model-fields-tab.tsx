import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  bandRow,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/v3/inventory/registry-grid'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import {
  fieldRequiredLabel,
  fieldRule,
  fieldSource,
  fieldTypeLabel,
  fieldUnit,
  groupFieldsBySection,
} from './record-model-fields'
import type { ModelVersionField } from './record-model-fields'
import {
  useRecordModelVersionList,
  useRecordModelVersionUsage,
} from './record-model-data'
import { useWorkspaceRecordModel } from './models-data'

/**
 * The record model's Fields tab (ModelFields board): the published version's
 * fields, grouped by section, with the first version each arrived in and a
 * panel for the selected one. Edits go to the draft, never here.
 */
export function RecordModelFields({ modelKey }: { modelKey: string }) {
  const model = useWorkspaceRecordModel(modelKey)
  const versions = useRecordModelVersionList(model.data?.id)
  const usage = useRecordModelVersionUsage(model.data?.id)
  const list = versions.data ?? []
  const published = list.find((v) => v.lifecycle === 'published')
  const version = published ?? list.at(0)
  const [selected, setSelected] = useState<string | null>(null)
  const fields = (version?.definition.fields ?? []).filter(
    (f) => f.lifecycle !== 'retired',
  )
  const groups = groupFieldsBySection(fields)
  const sel = fields.find((f) => f.id === selected) ?? fields.at(0)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    setSelected,
  )

  /** First published version that has the field. */
  const since = (field: ModelVersionField) =>
    [...list]
      .filter((v) => v.lifecycle === 'published')
      .sort((a, b) => a.version - b.version)
      .find((v) => v.definition.fields.some((f) => f.id === field.id))?.version

  const rows: RegistryRow<ModelVersionField>[] = groups.flatMap((group) => [
    ...(groups.length > 1
      ? [bandRow(`${group.name} · ${group.fields.length}`)]
      : []),
    ...group.fields,
  ])

  const columns: RegistryColumn<ModelVersionField>[] = [
    {
      id: 'field',
      header: 'Field',
      cell: ({ row }) => row.original.label,
    },
    {
      id: 'key',
      header: 'Key',
      cell: ({ row }) => (
        <span className="mono text-fg-muted">{row.original.field_name}</span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => fieldTypeLabel(row.original),
    },
    {
      id: 'unit',
      header: 'Unit',
      cell: ({ row }) => (
        <span className="text-fg-muted">{fieldUnit(row.original) ?? '—'}</span>
      ),
    },
    {
      id: 'required',
      header: 'Required',
      cell: ({ row }) => fieldRequiredLabel(row.original),
    },
    {
      id: 'rule',
      header: 'Rule',
      cell: ({ row }) => (
        <span className="text-fg-muted">{fieldRule(row.original) ?? '—'}</span>
      ),
    },
    {
      id: 'since',
      header: 'Since',
      cell: ({ row }) => {
        const first = since(row.original)
        return (
          <span
            className={
              first && first === version?.version
                ? 'font-medium text-success-text'
                : 'text-fg-muted'
            }
          >
            {first ? `v${first}` : '—'}
          </span>
        )
      },
    },
  ]

  if (!version)
    return (
      <div className="min-w-0 flex-1 px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title="No version yet"
          description="Open Edit fields, choose Start draft, add fields, then publish it. Only model owners and admins can."
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={
                <Link
                  to="/models/$modelId/edit"
                  params={{ modelId: modelKey }}
                />
              }
            >
              Edit fields
            </Button>
          }
        />
      </div>
    )

  const recordsOnVersion =
    usage.data?.find((row) => row.version_id === version.id)?.record_count ?? 0
  const recordsTotal = (usage.data ?? []).reduce(
    (sum, row) => sum + row.record_count,
    0,
  )
  const draft = list.find((v) => v.lifecycle === 'draft')

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6">
        <TableBox>
          <RegistryGrid
            label="Model fields"
            rows={rows}
            columns={columns}
            getRowId={(f) => f.id}
            rowSelection={rowSelection}
            onRowSelectionChange={onRowSelectionChange}
            selectable={false}
          />
        </TableBox>
        {draft ? (
          <Muted className="mt-3">
            Showing published v{version.version}. Draft v{draft.version} is open
            for editing and does not change these records until it is approved.
          </Muted>
        ) : null}
      </div>
      {sel ? (
        <Inspector aria-label="Field details" className="w-[340px]">
          <InspectorSection title={sel.label}>
            <span className="mono text-fg-muted">
              {sel.field_name} · added in v{since(sel) ?? version.version}
              {version.published_at
                ? `, ${formatNotebookDateTime(version.published_at).slice(0, 10)}`
                : ''}
            </span>
          </InspectorSection>
          <InspectorSection title="Definition">
            <DescriptionList
              labelWidth={90}
              items={[
                ['Type', fieldTypeLabel(sel).split(' · ')[0]],
                ...(sel.logical_type === 'category'
                  ? [
                      [
                        'Options',
                        (sel.options ?? [])
                          .filter((o) => o.lifecycle !== 'retired')
                          .map((o) => o.label)
                          .join(', ') || '—',
                      ] as [string, string],
                    ]
                  : []),
                ['Required', fieldRequiredLabel(sel)],
                ['Rule', fieldRule(sel) ?? '—'],
                ['Source', fieldSource(sel)],
              ]}
            />
          </InspectorSection>
          <InspectorSection title="In records">
            <Muted>
              {recordsOnVersion} of {recordsTotal} records are on v
              {version.version}. Records made before keep their own version
              until their owner updates them.
            </Muted>
          </InspectorSection>
          <InspectorSection title="Changing a field">
            <Muted>
              Edits go into a draft
              {draft ? ` (v${draft.version})` : ''}. Published v
              {version.version} stays in use until the draft is approved; values
              already recorded never change.
            </Muted>
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
