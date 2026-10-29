import { formatDate, formatNotebookDateTime } from '#/lib/notebook-data'
import { formatInstant } from '#/lib/display-time-zone'
import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
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
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { DataClientError } from '#/lib/data-client'
import { useUserNames } from '#/lib/user-names'
import {
  publishNotebookTemplateVersion,
  retireNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { changeSetFromVersions } from '#/lib/notebook-template-change-set'
import type { TemplateChangeSetEntry } from '#/lib/notebook-template-change-set'
import { countTemplateUse } from '#/lib/notebook-template-usage'
import {
  publishedTemplateVersion,
  templateLifecycle,
  useSheetDefinitions,
  useTemplateApprovals,
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'
import { Icon } from '#/components/v3/icons'
import { FieldChangeList } from '#/components/v3/models/field-changes'
import {
  diffTemplatePlacements,
  summariseTemplateChanges,
} from '#/components/v3/templates/template-structure'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { t } from '#/copy'

/**
 * UI port (roadmap-4/ui-app3): the Versions tab. Publish and Retire run the
 * CORE-06 RPCs, so the revision checks, the reason, the retire e-signature
 * (the caller must be signature-certified) and the unsigned-records block all
 * stay server-side. R5-CONFIG-04 adds the per-version change set read from the
 * stored definitions, the signature list, and the stale-publish refusal. With
 * `?state=denied` the screen is view-only.
 */
export const Route = createFileRoute('/templates/$templateId/versions')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { v?: string; compare?: string; state?: 'denied' } => ({
    v: typeof search.v === 'string' ? search.v : undefined,
    compare: typeof search.compare === 'string' ? search.compare : undefined,
    state: search.state === 'denied' ? 'denied' : undefined,
  }),
  component: TemplateVersions,
})

const TAG_LABEL: Record<TemplateChangeSetEntry['tag'], string> = {
  added: t('library.templates.versions.added'),
  removed: t('library.templates.versions.removed'),
  changed: t('library.templates.versions.changed'),
}

const TAG_TONE: Record<TemplateChangeSetEntry['tag'], Tone> = {
  added: 'ok',
  removed: 'bad',
  changed: 'review',
}

/** The server refuses a publish when the draft revision moved (SB001); the
 * screen must show that refusal as a reload, not as a generic failure. */
function isStaleRevisionError(error: unknown): boolean {
  if (error instanceof DataClientError && error.code === 'SB001') return true
  return error instanceof Error && /stale .*revision/i.test(error.message)
}

/** "09:50" in the workspace's display zone. */
function formatClock(iso: string): string {
  return formatInstant(iso, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function ChangeValue({ value }: { value: string | undefined }) {
  if (value === undefined || value === '') {
    return <span className="text-fg-muted">—</span>
  }
  return (
    <span className="mono block max-w-[180px] truncate" title={value}>
      {value}
    </span>
  )
}

const changeSetColumns: RegistryColumn<TemplateChangeSetEntry>[] = [
  {
    id: 'change',
    header: t('library.templates.versions.change'),
    meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
    cell: ({ row }) => (
      <Status tone={TAG_TONE[row.original.tag]}>
        {TAG_LABEL[row.original.tag]}
      </Status>
    ),
  },
  {
    id: 'target',
    header: t('library.templates.versions.target'),
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) =>
      `${row.original.label}${row.original.field ? ` · ${row.original.field}` : ''}`,
  },
  {
    id: 'before',
    header: t('library.templates.versions.before'),
    cell: ({ row }) => <ChangeValue value={row.original.before} />,
  },
  {
    id: 'after',
    header: t('library.templates.versions.after'),
    meta: { headerClassName: 'pr-3!', cellClassName: 'pr-3!' },
    cell: ({ row }) => <ChangeValue value={row.original.after} />,
  },
]

function ChangeSetTable({
  entries,
  label,
}: {
  entries: TemplateChangeSetEntry[]
  label: string
}) {
  if (!entries.length) {
    return (
      <Muted>
        {t('library.templates.versions.noDefinitionChangesRecordedBetween')}
      </Muted>
    )
  }
  return (
    <TableBox>
      <RegistryGrid
        label={label}
        rows={entries}
        columns={changeSetColumns}
        getRowId={(entry) =>
          `${entry.tag}-${entry.kind}-${entry.id}-${entry.field ?? ''}`
        }
        selectable={false}
      />
    </TableBox>
  )
}

/** The versions table's columns; `records` counts the notebooks on each
 * version, read from the usage matrix. */
function versionColumns(
  ownerLabel: (userId: string) => string,
  records: Map<string, number>,
  currentId: string | undefined,
  approvals: Map<string, ApprovalRequest[]>,
  changeText: Map<string, string>,
): RegistryColumn<NotebookTemplateVersion>[] {
  const stateOf = (version: NotebookTemplateVersion) => {
    if (version.lifecycle === 'draft')
      return {
        tone: 'draft' as const,
        label: t('library.templates.versions.draft'),
      }
    if (version.lifecycle === 'retired')
      return {
        tone: 'stored' as const,
        label: t('library.templates.versions.retired'),
      }
    if (version.id === currentId)
      return {
        tone: 'progress' as const,
        label: t('library.templates.versions.current'),
      }
    return (records.get(version.id) ?? 0) > 0
      ? {
          tone: 'ok' as const,
          label: t('library.templates.versions.publishedStillInUse'),
        }
      : {
          tone: 'stored' as const,
          label: t('library.templates.versions.published'),
        }
  }
  return [
    {
      id: 'version',
      header: t('library.templates.versions.version'),
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) => `v${row.original.version}`,
    },
    {
      id: 'status',
      header: t('library.templates.versions.status'),
      cell: ({ row }) => {
        const state = stateOf(row.original)
        return <Status tone={state.tone}>{state.label}</Status>
      },
    },
    {
      id: 'published',
      header: t('library.templates.versions.published'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) =>
        row.original.publishedAt
          ? formatDate(row.original.publishedAt)
          : `Rev. ${row.original.revision}${
              row.original.updatedAt
                ? ` · ${formatClock(row.original.updatedAt)}`
                : ''
            }`,
    },
    {
      id: 'by',
      header: t('library.templates.versions.by'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => {
        const id =
          row.original.publishedByUserId ?? row.original.updatedByUserId
        return id ? ownerLabel(id) : '—'
      },
    },
    {
      id: 'approved',
      header: t('library.templates.versions.approvedBy'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => {
        const approved = (approvals.get(row.original.id) ?? []).find(
          (r) => r.state === 'approved',
        )
        const ids = approved?.approved_by_user_ids ?? []
        if (!ids.length) return '—'
        return (
          <span className="inline-flex items-center gap-1">
            <Icon name="lock" size={12} />
            {ids.map(ownerLabel).join(', ')}
          </span>
        )
      },
    },
    {
      id: 'change',
      header: t('library.templates.versions.change'),
      meta: { cellClassName: 'max-w-[320px] whitespace-normal' },
      cell: ({ row }) => changeText.get(row.original.id) ?? '',
    },
    {
      id: 'records',
      header: t('library.templates.versions.records'),
      meta: rightAligned<NotebookTemplateVersion>().meta,
      cell: ({ row }) =>
        row.original.lifecycle === 'draft'
          ? '—'
          : (records.get(row.original.id) ?? 0),
    },
  ]
}

interface StalePublish {
  versionId: string
  version: number
  attemptedRevision: number
}

function TemplateVersions() {
  const { templateId } = Route.useParams()
  const search = Route.useSearch()
  const denied = search.state === 'denied'
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const versions = useTemplateVersions(templateId)
  const rows = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)
  const current = publishedTemplateVersion(rows)
  const users = useTemplateUsers(rows.map((v) => v.id))
  const approvals = useTemplateApprovals(rows.map((v) => v.id))
  const sheets = useSheetDefinitions(rows)
  const names = useUserNames(
    [
      ...rows.flatMap((v) => [
        v.publishedByUserId,
        v.signedByUserId,
        v.updatedByUserId,
      ]),
      ...[...approvals.values()].flatMap((list) =>
        list.flatMap((r) => r.approved_by_user_ids),
      ),
    ].filter((id): id is string => Boolean(id)),
  )
  const [dialog, setDialog] = useState<{
    kind: 'publish' | 'retire'
    version: NotebookTemplateVersion
  } | null>(null)
  const [stalePublish, setStalePublish] = useState<StalePublish | null>(null)

  const selected = rows.find((v) => v.id === search.v) ?? rows.at(0)
  const compareVersion = rows.find((v) => v.id === search.compare)
  const recordsByVersion = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of users.data ?? []) {
      const key = r.source_notebook_template_version_id ?? ''
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [users.data])

  const changeGroups = useMemo(() => {
    const ordered = [...rows].sort((a, b) => a.version - b.version)
    const previousOf = (version: NotebookTemplateVersion) =>
      ordered.filter((row) => row.version < version.version).at(-1)
    if (!selected) return []
    const low = compareVersion
      ? Math.min(compareVersion.version, selected.version)
      : (previousOf(selected)?.version ?? 0)
    const high = compareVersion
      ? Math.max(compareVersion.version, selected.version)
      : selected.version
    return ordered
      .filter((row) => row.version > low && row.version <= high)
      .map((row) => ({
        version: row,
        previous: previousOf(row),
        entries: changeSetFromVersions(
          previousOf(row)?.configuration,
          row.configuration,
        ),
        changes: diffTemplatePlacements(
          previousOf(row)?.configuration.placements ?? null,
          row.configuration.placements,
          sheets.versionsById,
        ),
      }))
  }, [rows, selected, compareVersion, sheets.versionsById])

  const changeText = useMemo(() => {
    const ordered = [...rows].sort((a, b) => a.version - b.version)
    const map = new Map<string, string>()
    ordered.forEach((row, index) => {
      const previous = ordered.find((_, i) => i === index - 1)
      map.set(
        row.id,
        summariseTemplateChanges(
          diffTemplatePlacements(
            previous?.configuration.placements ?? null,
            row.configuration.placements,
            sheets.versionsById,
          ),
          row.reason,
          !previous,
          row.configuration.placements.length,
        ),
      )
    })
    return map
  }, [rows, sheets.versionsById])

  const selectedCounts = useMemo(
    () =>
      countTemplateUse(
        (users.data ?? []).filter(
          (r) => r.source_notebook_template_version_id === selected?.id,
        ),
      ),
    [users.data, selected?.id],
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })

  const reload = () => {
    setStalePublish(null)
    setDialog(null)
    void versions.refetch()
  }

  if (!rows.length || !selected) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title={t('library.templates.versions.noVersionsYet')}
          description={t('library.templates.versions.aTemplateNeedsAVersion')}
        />
      </div>
    )
  }

  const firstChange = changeGroups.at(0)
  const staleSelected = stalePublish?.versionId === selected.id

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {denied ? (
          <Notice tone="info" className="mb-3" icon="lock">
            {t('library.templates.versions.viewOnlyOnlyTemplateOwners')}
          </Notice>
        ) : null}
        {stalePublish ? (
          <Notice
            tone="warn"
            className="mb-3"
            icon="warn"
            action={
              <Button size="sm" onClick={reload}>
                {t('library.templates.versions.reload')}
              </Button>
            }
          >
            {t('library.templates.versions.draftVChangedSinceYou', {
              version: stalePublish.version,
              attemptedRevision: stalePublish.attemptedRevision,
            })}
          </Notice>
        ) : null}
        {compareVersion ? (
          <Notice
            tone="info"
            className="mb-3"
            action={
              <Button
                size="sm"
                onClick={() =>
                  void navigate({
                    to: '/templates/$templateId/versions',
                    params: { templateId },
                    search: { v: search.v },
                    replace: true,
                  })
                }
              >
                {t('common.actions.clear')}
              </Button>
            }
          >
            {t('library.templates.versions.comparingVVTheChange', {
              version: compareVersion.version,
              version2: selected.version,
            })}
          </Notice>
        ) : null}
        <TableBox>
          <RegistryGrid
            label={t('library.templates.versions.templateVersions')}
            rows={rows}
            columns={versionColumns(
              names.userLabel,
              recordsByVersion,
              current?.id,
              approvals,
              changeText,
            )}
            getRowId={(version) => version.id}
            rowSelection={{ [selected.id]: true }}
            onRowClick={(version) =>
              void navigate({
                to: '/templates/$templateId/versions',
                params: { templateId },
                search: (s) => ({ ...s, v: version.id }),
                replace: true,
              })
            }
            selectable={false}
          />
        </TableBox>
        <Muted className="mt-3">
          {t(
            'library.templates.versions.publishingKeepsEarlierVersionsReadable',
          )}
        </Muted>
      </div>

      <Inspector
        label={t('library.templates.versions.versionDetails', {
          version: selected.version,
        })}
        width={320}
      >
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            {t('library.templates.versions.vSections', {
              version: selected.version,
              placements: selected.configuration.placements.length,
            })}
          </span>
          <div className="font-heading text-doc font-semibold">
            {templateLifecycle(selected.lifecycle).label}
          </div>
        </div>

        {!denied && selected.lifecycle === 'draft' ? (
          <Button
            variant="primary"
            disabled={staleSelected}
            title={
              staleSelected
                ? t('library.templates.versions.reloadTheDraftBeforeYou')
                : undefined
            }
            onClick={() => setDialog({ kind: 'publish', version: selected })}
          >
            {t('library.templates.versions.publishV', {
              version: selected.version,
            })}
          </Button>
        ) : null}
        {staleSelected ? (
          <Muted>
            {t('library.templates.versions.reloadTheDraftBeforeYou')}
          </Muted>
        ) : null}
        {!denied &&
        selected.lifecycle === 'published' &&
        current?.id !== selected.id ? (
          <Button
            variant="danger"
            onClick={() => setDialog({ kind: 'retire', version: selected })}
          >
            {t('library.templates.versions.retireV', {
              version: selected.version,
            })}
          </Button>
        ) : null}
        {!denied &&
        selected.lifecycle === 'published' &&
        current?.id === selected.id ? (
          <Muted>
            {t('library.templates.versions.theCurrentVersionCantBe')}
          </Muted>
        ) : null}

        <InspectorSection
          title={
            compareVersion
              ? t('library.templates.versions.changesFromVToV', {
                  Math: Math.min(compareVersion.version, selected.version),
                  Math2: Math.max(compareVersion.version, selected.version),
                })
              : firstChange?.previous
                ? t('library.templates.versions.changesSinceV', {
                    version: firstChange.previous.version,
                  })
                : t('library.templates.versions.firstVersion')
          }
        >
          <div className="flex flex-col gap-3">
            {changeGroups.length ? (
              changeGroups.map((group) => (
                <div key={group.version.id} className="flex flex-col gap-1">
                  {changeGroups.length > 1 ? (
                    <h3 className="text-label font-medium">
                      v{group.version.version}
                    </h3>
                  ) : null}
                  {group.changes.length ? (
                    <FieldChangeList
                      changes={group.changes}
                      label={t('library.templates.versions.changesInVersion', {
                        version: group.version.version,
                      })}
                    />
                  ) : (
                    <ChangeSetTable
                      entries={group.entries}
                      label={t('library.templates.versions.changesInVersion', {
                        version: group.version.version,
                      })}
                    />
                  )}
                </div>
              ))
            ) : (
              <Muted>
                {t(
                  'library.templates.versions.nothingChangedBetweenTheseVersions',
                )}
              </Muted>
            )}
          </div>
        </InspectorSection>

        <InspectorSection title={t('library.templates.versions.signatures')}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
            <li>
              <span className="font-medium">
                {t('library.templates.versions.published')}
              </span>
              <span className="block text-fg-muted">
                {selected.publishedAt
                  ? `${selected.publishedByUserId ? names.userLabel(selected.publishedByUserId) : '—'} · ${formatNotebookDateTime(selected.publishedAt, { zone: true })}`
                  : t('library.templates.versions.notPublishedYet')}
              </span>
            </li>
            {selected.signedAt ? (
              <li>
                <span className="font-medium">
                  {t('library.templates.versions.retiredESigned')}
                </span>
                <span className="block text-fg-muted">
                  {selected.signedByUserId
                    ? names.userLabel(selected.signedByUserId)
                    : '—'}{' '}
                  · {selected.signedMeaning ?? '—'} ·{' '}
                  {formatNotebookDateTime(selected.signedAt, { zone: true })}
                </span>
              </li>
            ) : (
              <li className="text-fg-muted">
                {t(
                  'library.templates.versions.noSignatureRecordedPublishingRecords',
                )}
              </li>
            )}
          </ul>
        </InspectorSection>

        <InspectorSection
          title={t('library.templates.versions.recordsOnThisVersion')}
        >
          <div className="flex flex-col gap-2">
            <DescriptionList
              labelWidth={88}
              items={[
                [
                  t('library.templates.versions.inProgress'),
                  String(selectedCounts.inProgress),
                ],
                [
                  t('library.templates.versions.inReview'),
                  String(selectedCounts.inReview),
                ],
                [
                  t('library.templates.versions.signed'),
                  String(selectedCounts.signed),
                ],
                [
                  t('library.templates.versions.total'),
                  String(selectedCounts.total),
                ],
              ]}
            />
            <Link
              to="/templates/$templateId/in-use"
              params={{ templateId }}
              search={{ version: selected.id }}
              className="text-label"
            >
              {t('library.templates.versions.seeRecordsOnV', {
                version: selected.version,
              })}
            </Link>
          </div>
        </InspectorSection>

        <InspectorSection title={t('library.templates.versions.governance')}>
          <DescriptionList
            labelWidth={96}
            items={[
              [t('library.templates.versions.reason'), selected.reason ?? '—'],
              [
                t('library.templates.versions.signed'),
                selected.signedAt
                  ? `${selected.signedByUserId ? names.userLabel(selected.signedByUserId) : '—'} · ${selected.signedMeaning ?? '—'}`
                  : t('library.templates.versions.notSigned'),
              ],
            ]}
          />
        </InspectorSection>

        <InspectorSection title={t('library.templates.versions.compare')}>
          <Field label={t('library.templates.versions.compareWith')}>
            <Select
              aria-label={t(
                'library.templates.versions.compareWithAnotherVersion',
              )}
              value={search.compare ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/templates/$templateId/versions',
                  params: { templateId },
                  search: (s) => ({
                    ...s,
                    compare: e.target.value || undefined,
                  }),
                  replace: true,
                })
              }
            >
              <option value="">
                {t('library.templates.versions.previousVersionOnly')}
              </option>
              {rows
                .filter((v) => v.id !== selected.id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                  </option>
                ))}
            </Select>
          </Field>
        </InspectorSection>
      </Inspector>

      {dialog ? (
        <GovernanceDialog
          templateId={templateId}
          kind={dialog.kind}
          version={dialog.version}
          onClose={() => setDialog(null)}
          onDone={() => {
            void invalidate()
            setDialog(null)
          }}
          onStale={(version) => {
            setDialog(null)
            setStalePublish({
              versionId: version.id,
              version: version.version,
              attemptedRevision: version.revision,
            })
          }}
        />
      ) : null}
    </div>
  )
}

function GovernanceDialog({
  kind,
  version,
  onClose,
  onDone,
  onStale,
}: {
  templateId: string
  kind: 'publish' | 'retire'
  version: NotebookTemplateVersion
  onClose: () => void
  onDone: () => void
  onStale: (version: NotebookTemplateVersion, error: unknown) => void
}) {
  const [reason, setReason] = useState('')
  const [meaning, setMeaning] = useState(
    t('library.templates.versions.retiredNoLongerForNew'),
  )
  const [error, setError] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () =>
      publishNotebookTemplateVersion(
        version.id,
        version.revision,
        reason.trim(),
      ),
    onSuccess: () => {
      toast(
        t('library.templates.versions.vPublished', {
          version: version.version,
        }),
        {
          description: t('library.templates.versions.newNotebooksCanStartFrom'),
        },
      )
      onDone()
    },
    onError: (e) => {
      if (isStaleRevisionError(e)) {
        onStale(version, e)
        return
      }
      setError(errorMessage(e))
    },
  })
  const retire = useMutation({
    mutationFn: () =>
      retireNotebookTemplateVersion(
        version.id,
        version.revision,
        reason.trim(),
        meaning.trim(),
      ),
    onSuccess: () => {
      toast(
        t('library.templates.versions.vRetired', { version: version.version }),
      )
      onDone()
    },
    onError: (e) => {
      if (isStaleRevisionError(e)) {
        onStale(version, e)
        return
      }
      setError(errorMessage(e))
    },
  })
  const busy = publish.isPending || retire.isPending

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            kind === 'publish'
              ? t('library.templates.versions.publishV2', {
                  version: version.version,
                })
              : t('library.templates.versions.retireV2', {
                  version: version.version,
                })
          }
          description={
            kind === 'publish'
              ? t(
                  'library.templates.versions.publishingMakesThisVersionAvailable',
                )
              : t('library.templates.versions.retiringIsAnESignature')
          }
        />
        <DialogBody>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Field
            label={t('library.templates.versions.reasonForChange')}
            required
          >
            <Input
              autoFocus
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
              placeholder={t('library.templates.versions.eGAddsTheStability')}
            />
          </Field>
          {kind === 'retire' ? (
            <Field
              label={t('library.templates.versions.signatureMeaning')}
              required
              hint={t('library.templates.versions.youMustHaveCertifiedYour')}
            >
              <Input
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant={kind === 'retire' ? 'danger' : 'primary'}
            disabled={busy || reason.trim().length < 1}
            onClick={() => {
              setError(null)
              if (reason.trim().length < 1) {
                setError(t('library.templates.versions.giveAReasonForThe'))
                return
              }
              if (kind === 'publish') publish.mutate()
              else retire.mutate()
            }}
          >
            {busy
              ? t('common.states.saving')
              : kind === 'publish'
                ? t('library.templates.versions.publishV2', {
                    version: version.version,
                  })
                : t('library.templates.versions.signAndRetireV', {
                    version: version.version,
                  })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('certification')) {
    return t('library.templates.versions.youHaventCertifiedYourElectronic')
  }
  if (message.includes('unsigned records')) {
    return t('library.templates.versions.unsignedRecordsAreStillOn')
  }
  if (message.includes('reason'))
    return t('library.templates.versions.giveAReasonForThe')
  return message
}
