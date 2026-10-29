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
import { useInheritedFieldGroups } from './model-subtype-ui'
import {
  InheritedLabel,
  inheritedRows,
  isInherited,
} from './inherited-fields-table'
import type { InheritedRow } from './inherited-fields-table'
import { formatDate } from '#/lib/format-date'
import { useDataAccess } from '#/lib/data-access'
import { useReportingNames } from '#/lib/data-access-names'
import { reportingColumnName } from '#/lib/data-access-handles'
import { t } from '#/copy'

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
  const inherited = useInheritedFieldGroups(modelKey)
  const above = inheritedRows(inherited.groups)
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

  // Below inherited fields, the model's own get a band even when unsectioned.
  const ownName =
    model.data?.name ?? t('library.models.recordModelFieldsTab.thisModel')
  const rows: RegistryRow<ModelVersionField | InheritedRow>[] = [
    ...above,
    ...groups.flatMap((group) => [
      ...(groups.length > 1
        ? [bandRow(`${group.name} · ${group.fields.length}`)]
        : above.length
          ? [bandRow(ownName, group.fields.length)]
          : []),
      ...group.fields,
    ]),
  ]

  const dataAccess = useDataAccess()
  const names = useReportingNames()
  const muted = (value: string | null) => (
    <span className="text-fg-muted">{value ?? '—'}</span>
  )
  const columns: RegistryColumn<ModelVersionField | InheritedRow>[] = [
    {
      id: 'field',
      header: t('library.models.recordModelFieldsTab.field'),
      cell: ({ row }) =>
        isInherited(row.original) ? (
          <InheritedLabel row={row.original} />
        ) : (
          row.original.label
        ),
    },
    {
      id: 'key',
      header: t('library.models.recordModelFieldsTab.key'),
      cell: ({ row }) => {
        const key = isInherited(row.original)
          ? row.original.key
          : row.original.field_name
        return key ? (
          <span className="mono text-fg-muted">{key}</span>
        ) : (
          muted(null)
        )
      },
    },
    ...(dataAccess
      ? [
          {
            id: 'column',
            header: t('library.models.recordModelFieldsTab.postgresColumn'),
            cell: ({ row }) => {
              const key = isInherited(row.original)
                ? row.original.key
                : row.original.field_name
              return key ? (
                <span className="mono text-fg-muted">
                  {reportingColumnName(modelKey, key, names)}
                </span>
              ) : (
                muted(null)
              )
            },
          } satisfies RegistryColumn<ModelVersionField | InheritedRow>,
        ]
      : []),
    {
      id: 'type',
      header: t('library.models.recordModelFieldsTab.type'),
      cell: ({ row }) =>
        isInherited(row.original)
          ? muted(row.original.type)
          : fieldTypeLabel(row.original),
    },
    {
      id: 'unit',
      header: t('library.models.recordModelFieldsTab.unit'),
      cell: ({ row }) =>
        muted(
          isInherited(row.original)
            ? row.original.unit
            : fieldUnit(row.original),
        ),
    },
    {
      id: 'required',
      header: t('common.states.required'),
      cell: ({ row }) =>
        isInherited(row.original)
          ? muted(row.original.required)
          : fieldRequiredLabel(row.original),
    },
    {
      id: 'rule',
      header: t('library.models.recordModelFieldsTab.rule'),
      cell: ({ row }) =>
        muted(isInherited(row.original) ? null : fieldRule(row.original)),
    },
    {
      id: 'since',
      header: t('library.models.recordModelFieldsTab.since'),
      cell: ({ row }) => {
        if (isInherited(row.original)) return muted(null)
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
          title={t('library.models.recordModelFieldsTab.noVersionYet')}
          description={t(
            'library.models.recordModelFieldsTab.openEditFieldsChooseStart',
          )}
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
              {t('library.models.recordModelFieldsTab.editFields')}
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
            label={t('library.models.recordModelFieldsTab.modelFields')}
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
            {t('library.models.recordModelFieldsTab.showingPublishedVDraftV', {
              version: version.version,
              version2: draft.version,
            })}
          </Muted>
        ) : null}
      </div>
      {sel ? (
        <Inspector
          aria-label={t('library.models.recordModelFieldsTab.fieldDetails')}
          className="w-[340px]"
        >
          <InspectorSection title={sel.label}>
            <span className="mono text-fg-muted">
              {t('library.models.recordModelFieldsTab.addedInV', {
                fieldName: sel.field_name,
                version: since(sel) ?? version.version,
              })}
              {version.published_at
                ? `, ${formatDate(version.published_at)}`
                : ''}
            </span>
          </InspectorSection>
          <InspectorSection
            title={t('library.models.recordModelFieldsTab.definition')}
          >
            <DescriptionList
              labelWidth={90}
              items={[
                [
                  t('library.models.recordModelFieldsTab.type'),
                  fieldTypeLabel(sel).split(' · ')[0],
                ],
                ...(sel.logical_type === 'category'
                  ? [
                      [
                        t('library.models.recordModelFieldsTab.options'),
                        (sel.options ?? [])
                          .filter((o) => o.lifecycle !== 'retired')
                          .map((o) => o.label)
                          .join(', ') || '—',
                      ] as [string, string],
                    ]
                  : []),
                [t('common.states.required'), fieldRequiredLabel(sel)],
                [
                  t('library.models.recordModelFieldsTab.rule'),
                  fieldRule(sel) ?? '—',
                ],
                [
                  t('library.models.recordModelFieldsTab.source'),
                  fieldSource(sel),
                ],
              ]}
            />
          </InspectorSection>
          <InspectorSection
            title={t('library.models.recordModelFieldsTab.inRecords')}
          >
            <Muted>
              {t('library.models.recordModelFieldsTab.ofRecordsAreOnV', {
                recordsOnVersion,
                recordsTotal,
                version: version.version,
              })}
            </Muted>
          </InspectorSection>
          <InspectorSection
            title={t('library.models.recordModelFieldsTab.changingAField')}
          >
            <Muted>
              {t('library.models.recordModelFieldsTab.editsGoIntoADraft')}
              {draft ? ` (v${draft.version})` : ''}
              {t('library.models.recordModelFieldsTab.publishedVStaysInUse', {
                version: version.version,
              })}
            </Muted>
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}
