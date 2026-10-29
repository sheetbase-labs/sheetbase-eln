import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/v3/icons'
import { FieldChangeList } from '#/components/v3/models/field-changes'
import { Button } from '#/components/v3/ui/button'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/notebook-data'
import { formatInstant } from '#/lib/display-time-zone'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { countTemplateUse } from '#/lib/notebook-template-usage'
import { useUserNames } from '#/lib/user-names'
import {
  useSheetDefinitions,
  useTemplateUsers,
} from '#/components/v3/templates/templates-data'
import {
  describeSections,
  diffTemplatePlacements,
  modelLabel,
  placementName,
  sheetColumnRows,
} from './template-structure'
import type { SectionEntry } from './template-structure'
import { t } from '#/copy'

/**
 * The TemplateEditor board: the template's sections down the left, the
 * selected section in the middle (a sheet shows its columns, source, type,
 * unit, required and rule), and the version's state on the right: what
 * changed since the version before, what publishing does to notebooks already
 * made, and what the template is built on. Columns belong to the pinned sheet
 * definition version, so they are read here; the sections themselves are
 * edited through "Add section" and a new version.
 */
export function TemplateSectionsBoard({
  templateId,
  templateKey,
  displayId,
  version,
  versions,
  onEditSections,
}: {
  templateId: string
  templateKey: string
  displayId: string | null
  version: NotebookTemplateVersion
  versions: NotebookTemplateVersion[]
  onEditSections: () => void
}) {
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
  const entries = useMemo(
    () =>
      describeSections(version.configuration.placements, sheets.versionsById),
    [version.configuration.placements, sheets.versionsById],
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
  const [pickedId, setPickedId] = useState<string | null>(null)
  const selected: SectionEntry | undefined =
    entries.find((e) => e.placement.id === pickedId) ??
    entries.find((e) => e.placement.kind === 'sheet') ??
    entries.at(0)

  const previousColumnIds = useMemo(() => {
    if (!selected || selected.placement.kind !== 'sheet')
      return new Set<string>()
    const sheetPlacement = selected.placement
    const earlier = previous?.configuration.placements.find(
      (p) => p.id === sheetPlacement.id,
    )
    if (!earlier || earlier.kind !== 'sheet') return new Set<string>()
    const old = sheets.versionsById.get(earlier.definitionVersionId)
    if (!old) return new Set<string>()
    return new Set(old.configuration.columns.map((c) => c.id))
  }, [selected, previous, sheets.versionsById])

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
    typeof protocolEntry.payload.protocol === 'string'
      ? `${protocolEntry.payload.protocol} v${String(protocolEntry.payload.version ?? '')}`.trim()
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

  const isDraft = version.lifecycle === 'draft'
  const params = { templateId }
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav
        aria-label={t('library.templates.templateSectionsBoard.sections')}
        className="w-[236px] shrink-0 overflow-auto border-r border-border px-3 py-4"
      >
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-label text-fg-muted">
            {t('library.templates.templateSectionsBoard.sections')}
          </span>
          <Button
            size="sm"
            variant="quiet"
            icon="edit"
            onClick={onEditSections}
          >
            {t('common.actions.edit')}
          </Button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {entries.map((entry) => {
            const active = entry.placement.id === selected?.placement.id
            return (
              <li key={entry.placement.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setPickedId(entry.placement.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left',
                    active ? 'bg-selected' : 'hover:bg-hover',
                  )}
                >
                  <Icon
                    name={
                      entry.placement.kind === 'sheet' ? 'table' : 'protocol'
                    }
                    size={14}
                    className="mt-[3px] text-fg-muted"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body">{entry.name}</span>
                    <span className="truncate text-label text-fg-muted">
                      {entry.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={onEditSections}
          className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-body text-fg-muted hover:bg-hover"
        >
          <Icon name="plus" size={14} />{' '}
          {t('library.templates.templateSectionsBoard.addSection')}
        </button>
      </nav>

      <div className="min-w-0 flex-1 overflow-auto px-6 py-5">
        {selected ? (
          <SectionDetail
            entry={selected}
            sheets={sheets}
            previousColumnIds={previousColumnIds}
            versionNumber={version.version}
            showVersionBadge={Boolean(previous)}
          />
        ) : (
          <Muted>
            {t(
              'library.templates.templateSectionsBoard.noSectionsInThisVersion',
            )}
          </Muted>
        )}
      </div>

      <Inspector
        label={t('library.templates.templateSectionsBoard.version')}
        width={300}
      >
        <div className="flex flex-col gap-0.5">
          <span className="mono text-label text-fg-muted">
            {displayId ?? templateKey}
          </span>
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
        {isDraft ? (
          <div className="flex gap-2">
            <Button
              variant="primary"
              render={
                <Link
                  to="/templates/$templateId/versions"
                  params={params}
                  search={{ v: version.id }}
                />
              }
            >
              {t('library.templates.templateSectionsBoard.publishV', {
                version: version.version,
              })}
            </Button>
          </div>
        ) : null}

        <InspectorSection
          title={
            previous
              ? t('library.templates.templateSectionsBoard.changesSinceV', {
                  version: previous.version,
                })
              : t('library.templates.templateSectionsBoard.firstVersion')
          }
        >
          {changes.length ? (
            <FieldChangeList
              changes={changes}
              label={t(
                'library.templates.templateSectionsBoard.changesSinceV',
                { version: previous?.version ?? 0 },
              )}
            />
          ) : (
            <Muted>
              {previous
                ? t('library.templates.templateSectionsBoard.nothingChanged')
                : t(
                    'library.templates.templateSectionsBoard.everySectionIsNew',
                  )}
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
                : ''}
              {t(
                'library.templates.templateSectionsBoard.newNotebooksStartFromV',
                { version: version.version },
              )}
            </Muted>
          </InspectorSection>
        ) : null}

        <InspectorSection
          title={t('library.templates.templateSectionsBoard.builtOn')}
        >
          <DescriptionList
            labelWidth={72}
            items={[
              [
                t('library.templates.templateSectionsBoard.protocol'),
                protocolLabel ?? '—',
              ],
              [
                t('library.templates.templateSectionsBoard.models'),
                referencedModels.length
                  ? referencedModels.map(modelLabel).join(', ')
                  : '—',
              ],
              [
                t('library.templates.templateSectionsBoard.review'),
                isDraft
                  ? t('library.templates.templateSectionsBoard.needs1Approver')
                  : `${countTemplateUse((users.data ?? []).filter((r) => r.source_notebook_template_version_id === version.id)).total} records`,
              ],
            ]}
          />
        </InspectorSection>
      </Inspector>
    </div>
  )
}

function SectionDetail({
  entry,
  sheets,
  previousColumnIds,
  versionNumber,
  showVersionBadge,
}: {
  entry: SectionEntry
  sheets: ReturnType<typeof useSheetDefinitions>
  previousColumnIds: Set<string>
  versionNumber: number
  showVersionBadge: boolean
}) {
  const { placement } = entry
  if (placement.kind === 'sheet') {
    const sheet = sheets.versionsById.get(placement.definitionVersionId)
    const definition = sheet
      ? sheets.definitionsById.get(sheet.definitionId)
      : undefined
    const rows = sheet ? sheetColumnRows(sheet.configuration) : []
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 font-heading text-doc font-semibold">
            {entry.name}
          </h2>
          <span className="text-label text-fg-muted">
            {t(
              'library.templates.templateSectionsBoard.sheetSectionRowsFilledIn',
            )}
          </span>
        </div>
        <Table aria-label={`${entry.name} columns`}>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t('library.templates.templateSectionsBoard.column')}
              </TableHead>
              <TableHead>
                {t('library.templates.templateSectionsBoard.source')}
              </TableHead>
              <TableHead>
                {t('library.templates.templateSectionsBoard.type')}
              </TableHead>
              <TableHead>
                {t('library.templates.templateSectionsBoard.unit')}
              </TableHead>
              <TableHead>{t('common.states.required')}</TableHead>
              <TableHead>
                {t('library.templates.templateSectionsBoard.rule')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isNew =
                showVersionBadge &&
                previousColumnIds.size > 0 &&
                !previousColumnIds.has(row.id)
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.label}
                    {isNew ? (
                      <span className="ml-1.5 rounded-[3px] bg-success-wash px-1 text-caption text-success-text">
                        v{versionNumber}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-label text-fg-muted">
                    {row.calculated ? (
                      <span className="mono">ƒx</span>
                    ) : (
                      row.source
                    )}
                  </TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>{row.unit ?? '—'}</TableCell>
                  <TableCell>
                    {row.required
                      ? t('library.templates.templateSectionsBoard.yes')
                      : '—'}
                  </TableCell>
                  <TableCell
                    className={row.calculated ? 'mono text-label' : undefined}
                  >
                    {row.calculated ? `= ${row.rule}` : (row.rule ?? '—')}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {definition?.description ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 font-heading text-doc font-semibold">
              {t('library.templates.templateSectionsBoard.placeholderText')}
            </h3>
            <div className="rounded-md border border-dashed border-border-strong px-3 py-3 text-fg-muted">
              {definition.description}
            </div>
          </div>
        ) : null}
      </div>
    )
  }
  const payload = placement.kind === 'narrative' ? placement.payload : {}
  const fields = Array.isArray(payload.fields)
    ? (payload.fields as string[])
    : null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 font-heading text-doc font-semibold">
          {placementName(placement)}
        </h2>
        <span className="text-label text-fg-muted">{entry.subtitle}</span>
      </div>
      {fields ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {fields.map((field) => (
            <li
              key={field}
              className="rounded-md border border-border px-3 py-1.5"
            >
              {field}
            </li>
          ))}
        </ul>
      ) : (
        <Muted>
          {placement.kind === 'section_placeholder'
            ? t(
                'library.templates.templateSectionsBoard.anEmptySectionEachNotebook',
              )
            : t(
                'library.templates.templateSectionsBoard.theContentANewNotebook',
              )}
        </Muted>
      )}
    </div>
  )
}
