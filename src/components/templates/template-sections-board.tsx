import { useMemo } from 'react'
import type * as React from 'react'

import { Icon } from '#/components/icons'
import { FieldChangeList } from '#/components/models/field-changes'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { LinkedText } from '#/components/ui/linked-text'
import { TableBox } from '#/components/ui/table'
import { AddSheetColumnButton } from './add-sheet-column'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { formatDate } from '#/lib/notebook-data'
import { formatInstant } from '#/lib/display-time-zone'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { NotebookTemplatePlacement } from '#/lib/notebook-template'
import { useUserNames } from '#/lib/user-names'
import {
  useSheetDefinitions,
  useTemplateUsers,
} from '#/components/templates/templates-data'
import {
  diffTemplatePlacements,
  modelLabel,
  placementName,
  sheetColumnRows,
} from './template-structure'
import { t } from '#/copy'

/**
 * What the template inspector reads about a version: the version before it,
 * what changed since, which older versions experiments still use, and what
 * the template is built on.
 */
export function useTemplateVersionFacts(
  version: NotebookTemplateVersion,
  versions: NotebookTemplateVersion[],
) {
  const sheets = useSheetDefinitions(versions)
  const users = useTemplateUsers(versions.map((v) => v.id))

  const names = useUserNames(
    [version.updatedByUserId, version.publishedByUserId].filter(
      (id): id is string => Boolean(id),
    ),
  )

  const previous = useMemo(
    () =>
      [...versions]
        .filter((v) => v.lifecycle !== 'draft' && v.version < version.version)
        .sort((a, b) => b.version - a.version)
        .at(0) ?? null,
    [versions, version.version],
  )

  const changes = useMemo(
    () =>
      diffTemplatePlacements(
        previous?.configuration.placements ?? null,
        version.configuration.placements,
        sheets.versionsById,
      ),
    [previous, version.configuration.placements, sheets.versionsById],
  )

  const recordCounts = useMemo(() => {
    const counts = new Map<string, number>()

    for (const record of users.data ?? []) {
      const id = record.source_notebook_template_version_id

      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }

    return counts
  }, [users.data])

  const olderInUse = [...versions]
    .filter((v) => v.lifecycle === 'published' && v.version < version.version)
    .filter((v) => (recordCounts.get(v.id) ?? 0) > 0)
    .sort((a, b) => b.version - a.version)
    .slice(0, 2)
    .reverse()

  const protocolEntry = version.configuration.placements.find(
    (p) => p.kind === 'narrative' && p.blockType === 'protocol_reference',
  )

  const protocolLabel =
    protocolEntry?.kind === 'narrative' &&
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- Permissive narrative payloads retain the original native first-read discriminator; it does not validate the second getter read.
    typeof protocolEntry.payload.protocol === 'string'
      ? // eslint-disable-next-line typescript/no-base-to-string -- Preserve the permissive native version value's String coercion after the second protocol getter read.
        `${protocolEntry.payload.protocol} v${String(protocolEntry.payload.version ?? '')}`.trim()
      : null

  const referencedModels = useMemo(() => {
    const labels = new Set<string>()

    for (const placement of version.configuration.placements) {
      if (placement.kind !== 'sheet') continue
      const sheet = sheets.versionsById.get(placement.definitionVersionId)

      for (const column of sheet?.configuration.columns ?? []) {
        const target = column.field.relationship?.target

        if (target?.kind === 'model') labels.add(target.modelKey)
      }
    }

    return [...labels]
  }, [version.configuration.placements, sheets.versionsById])

  const editedBy = version.updatedByUserId
    ? names.userLabel(version.updatedByUserId)
    : null

  const editedAt = version.updatedAt
    ? formatInstant(version.updatedAt, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null

  return {
    sheets,
    users,
    previous,
    changes,
    recordCounts,
    olderInUse,
    protocolLabel,
    referencedModels,
    editedBy,
    editedAt,
  }
}

/**
 * The version's side of the template page: which version is shown, what
 * changed since the one before, what publishing does to notebooks already
 * made, and what the template is built on. The page adds its own sections
 * underneath.
 */
export function TemplateVersionInspector({
  version,
  versions,
  children,
}: {
  version: NotebookTemplateVersion
  versions: NotebookTemplateVersion[]
  children?: React.ReactNode
}) {
  const facts = useTemplateVersionFacts(version, versions)

  return (
    <VersionInspector
      version={version}
      previous={facts.previous}
      changes={facts.changes}
      isDraft={version.lifecycle === 'draft'}
      editedBy={facts.editedBy}
      editedAt={facts.editedAt}
      olderInUse={facts.olderInUse}
      recordCounts={facts.recordCounts}
      referencedModels={facts.referencedModels}
      protocolLabel={facts.protocolLabel}
    >
      {children}
    </VersionInspector>
  )
}

function VersionHeading({
  version,
  previous,
  isDraft,
  editedBy,
  editedAt,
}: {
  version: NotebookTemplateVersion
  previous: NotebookTemplateVersion | null
  isDraft: boolean
  editedBy: string | null
  editedAt: string | null
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-heading text-doc font-semibold">
        {isDraft
          ? t('library.templates.templateSectionsBoard.draft')
          : t('library.templates.templateSectionsBoard.published')}{' '}
        v{version.version}
      </div>
      <span className="text-label text-fg-muted">
        {[
          previous
            ? t('library.templates.templateSectionsBoard.basedOnV', {
                version: previous.version,
              })
            : '',
          isDraft && editedBy
            ? t(
                editedAt
                  ? 'library.templates.templateSectionsBoard.editedByAt'
                  : 'library.templates.templateSectionsBoard.editedBy',
                { editedBy, editedAt: editedAt ?? '' },
              )
            : version.publishedAt
              ? t('library.templates.templateSectionsBoard.publishedOn', {
                  date: formatDate(version.publishedAt),
                })
              : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  )
}

function VersionInspector({
  version,
  previous,
  changes,
  isDraft,
  editedBy,
  editedAt,
  olderInUse,
  recordCounts,
  referencedModels,
  protocolLabel,
  children,
}: {
  version: NotebookTemplateVersion
  previous: NotebookTemplateVersion | null
  changes: ReturnType<typeof diffTemplatePlacements>
  isDraft: boolean
  editedBy: string | null
  editedAt: string | null
  olderInUse: NotebookTemplateVersion[]
  recordCounts: Map<string, number>
  referencedModels: string[]
  protocolLabel: string | null
  children?: React.ReactNode
}) {
  return (
    <Inspector
      label={t('library.templates.templateSectionsBoard.version')}
      width={320}
    >
      <VersionHeading
        version={version}
        previous={previous}
        isDraft={isDraft}
        editedBy={editedBy}
        editedAt={editedAt}
      />
      {children}
      <InspectorSection
        title={
          previous
            ? t('library.templates.templateSectionsBoard.changesSinceV', {
                version: previous.version,
              })
            : t('library.templates.templateSectionsBoard.firstVersion')
        }
      >
        {changes.length && previous ? (
          <FieldChangeList
            changes={changes}
            label={t('library.templates.templateSectionsBoard.changesSinceV', {
              version: previous.version,
            })}
          />
        ) : (
          <Muted>
            {previous
              ? t('library.templates.templateSectionsBoard.nothingChanged')
              : t('library.templates.templateSectionsBoard.everySectionIsNew')}
          </Muted>
        )}
      </InspectorSection>

      {isDraft ? (
        <InspectorSection
          title={t('library.templates.templateSectionsBoard.whenYouPublish')}
        >
          <Muted>
            {t(
              'library.templates.templateSectionsBoard.nothingAlreadyMadeChanges',
            )}{' '}
            {olderInUse.length
              ? t(
                  'library.templates.templateSectionsBoard.areToldVExistsEach',
                  {
                    join: olderInUse
                      .map((v, i) => {
                        const n = recordCounts.get(v.id) ?? 0

                        return t(
                          i === 0
                            ? 'library.templates.templateSectionsBoard.notebooksOnV'
                            : 'library.templates.templateSectionsBoard.countOnV',
                          { count: n, version: v.version },
                        )
                      })
                      .join(' and '),
                    version: version.version,
                  },
                )
              : ''}{' '}
            {t(
              'library.templates.templateSectionsBoard.newNotebooksStartFromV',
              { version: version.version },
            )}
          </Muted>
        </InspectorSection>
      ) : null}

      {protocolLabel || referencedModels.length ? (
        <InspectorSection
          title={t('library.templates.templateSectionsBoard.builtOn')}
        >
          <DescriptionList
            labelWidth={72}
            items={[
              ...(protocolLabel
                ? [
                    [
                      t('library.templates.templateSectionsBoard.protocol'),
                      <LinkedText key="protocol" text={protocolLabel} />,
                    ] satisfies [React.ReactNode, React.ReactNode],
                  ]
                : []),
              ...(referencedModels.length
                ? [
                    [
                      t('library.templates.templateSectionsBoard.models'),
                      referencedModels.map(modelLabel).join(', '),
                    ] satisfies [React.ReactNode, React.ReactNode],
                  ]
                : []),
            ]}
          />
        </InspectorSection>
      ) : null}
    </Inspector>
  )
}

const SOURCE_ICONS = {
  record: 'link',
  dataset: 'database',
  calculated: 'code',
  local: 'edit',
} as const

/** Where a sheet column's values come from: a small mark and the source's name. */
function SourceChip({ row }: { row: SheetColumnRowData }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-fg-muted">
      <Icon name={SOURCE_ICONS[row.sourceKind]} size={10} />
      {row.calculated ? <span className="mono">ƒx</span> : row.source}
    </span>
  )
}

type SheetColumnRowData = ReturnType<typeof sheetColumnRows>[number]

/** The columns a sheet section fills in, with a v-badge on any a newer version added. */
function SheetColumnsTable({
  name,
  rows,
  previousColumnIds,
  versionNumber,
  showVersionBadge,
}: {
  name: string
  rows: SheetColumnRowData[]
  previousColumnIds: Set<string>
  versionNumber: number
  showVersionBadge: boolean
}) {
  const columns = useMemo<RegistryColumn<SheetColumnRowData>[]>(
    () => [
      {
        id: 'column',
        header: t('library.templates.templateSectionsBoard.column'),
        accessorFn: (row) => row.label,
        cell: ({ row }) => {
          const isNew =
            showVersionBadge &&
            previousColumnIds.size > 0 &&
            !previousColumnIds.has(row.original.id)

          return (
            <>
              {row.original.label}
              {isNew ? (
                <span className="ml-1.5 rounded-[3px] bg-success-wash px-1 text-caption text-success-text">
                  v{versionNumber}
                </span>
              ) : null}
            </>
          )
        },
      },
      {
        id: 'source',
        header: t('library.templates.templateSectionsBoard.source'),
        accessorFn: (row) => (row.calculated ? 'ƒx' : row.source),
        cell: ({ row }) => <SourceChip row={row.original} />,
        meta: { cellClassName: 'text-label text-fg-muted' },
      },
      {
        id: 'type',
        header: t('library.templates.templateSectionsBoard.type'),
        accessorFn: (row) => row.type,
      },
      {
        id: 'unit',
        header: t('library.templates.templateSectionsBoard.unit'),
        accessorFn: (row) => row.unit ?? '—',
      },
      {
        id: 'required',
        header: t('common.states.required'),
        accessorFn: (row) => (row.required ? 1 : 0),
        cell: ({ row }) =>
          row.original.required
            ? t('library.templates.templateSectionsBoard.yes')
            : '—',
      },
      {
        id: 'rule',
        header: t('library.templates.templateSectionsBoard.rule'),
        accessorFn: (row) =>
          row.calculated ? `= ${row.rule}` : (row.rule ?? '—'),
        meta: { cellClassName: 'min-w-[200px]! whitespace-normal!' },
        cell: ({ row }) =>
          row.original.calculated ? (
            <span className="text-label">= {row.original.rule}</span>
          ) : (
            (row.original.rule ?? '—')
          ),
      },
    ],
    [previousColumnIds, showVersionBadge, versionNumber],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={`${name} columns`}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        selectable={false}
      />
    </TableBox>
  )
}

/**
 * A sheet the template places, drawn where it sits in the notebook: its
 * title, the columns each experiment fills in, and the note it starts with.
 * A draft version can take another column.
 */
export function TemplateSheetBlock({
  placement,
  sheets,
  draftVersion,
}: {
  placement: Extract<NotebookTemplatePlacement, { kind: 'sheet' }>
  sheets: ReturnType<typeof useSheetDefinitions>
  /** The template version shown when it is a saved draft, which a column can be added to. */
  draftVersion: NotebookTemplateVersion | null
}) {
  const sheet = sheets.versionsById.get(placement.definitionVersionId)

  const definition = sheet
    ? sheets.definitionsById.get(sheet.definitionId)
    : undefined

  const rows = sheet ? sheetColumnRows(sheet.configuration) : []
  const name = placementName(placement)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Icon
          name="table"
          size={14}
          aria-hidden="true"
          className="self-center text-fg-muted"
        />
        <span className="font-semibold">{name}</span>
        <span className="text-label text-fg-muted">
          {t('library.templates.notebook.sheetColumns', {
            count: rows.length,
          })}
        </span>
      </div>
      {definition?.description ? (
        <p className="m-0 text-label text-fg-muted">
          <LinkedText text={definition.description} />
        </p>
      ) : null}
      {rows.length ? (
        <SheetColumnsTable
          name={name}
          rows={rows}
          previousColumnIds={new Set()}
          versionNumber={draftVersion?.version ?? 0}
          showVersionBadge={false}
        />
      ) : (
        <Muted>{t('library.templates.notebook.sheetLoading')}</Muted>
      )}
      {draftVersion && sheet && definition ? (
        <div>
          <AddSheetColumnButton
            templateVersion={draftVersion}
            placementId={placement.id}
            sectionName={name}
            sheet={sheet}
            definition={definition}
          />
        </div>
      ) : null}
    </div>
  )
}

/** An empty section each experiment fills in, drawn as its heading and a dashed space. */
export function TemplateSectionBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="m-0 font-heading text-doc font-semibold">{label}</h2>
      <div className="rounded-md border border-dashed border-border-strong px-3 py-3 text-label text-fg-muted">
        {t(
          'library.templates.templateSectionsBoard.anEmptySectionEachNotebook',
        )}
      </div>
    </div>
  )
}
