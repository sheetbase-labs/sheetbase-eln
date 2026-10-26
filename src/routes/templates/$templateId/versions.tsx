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
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
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
    header: 'Change',
    meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
    cell: ({ row }) => (
      <Status tone={TAG_TONE[row.original.tag]}>
        {TAG_LABEL[row.original.tag]}
      </Status>
    ),
  },
  {
    id: 'target',
    header: 'Target',
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) =>
      `${row.original.label}${row.original.field ? ` · ${row.original.field}` : ''}`,
  },
  {
    id: 'before',
    header: 'Before',
    cell: ({ row }) => <ChangeValue value={row.original.before} />,
  },
  {
    id: 'after',
    header: 'After',
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
    return <Muted>No definition changes recorded between these versions.</Muted>
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
      return { tone: 'draft' as const, label: 'Draft' }
    if (version.lifecycle === 'retired')
      return { tone: 'stored' as const, label: 'Retired' }
    if (version.id === currentId)
      return { tone: 'progress' as const, label: 'Current' }
    return (records.get(version.id) ?? 0) > 0
      ? { tone: 'ok' as const, label: 'Published, still in use' }
      : { tone: 'stored' as const, label: 'Published' }
  }
  return [
    {
      id: 'version',
      header: 'Version',
      meta: { cellClassName: 'font-medium' },
      cell: ({ row }) => `v${row.original.version}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const state = stateOf(row.original)
        return <Status tone={state.tone}>{state.label}</Status>
      },
    },
    {
      id: 'published',
      header: 'Published',
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
      header: 'By',
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => {
        const id =
          row.original.publishedByUserId ?? row.original.updatedByUserId
        return id ? ownerLabel(id) : '—'
      },
    },
    {
      id: 'approved',
      header: 'Approved by',
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
      header: 'Change',
      meta: { cellClassName: 'max-w-[320px] whitespace-normal' },
      cell: ({ row }) => changeText.get(row.original.id) ?? '',
    },
    {
      id: 'records',
      header: 'Records',
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
          title="No versions yet"
          description="A template needs a version before a notebook can be made from it."
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
            View only. Only template owners and QA can publish or retire
            versions.
          </Notice>
        ) : null}
        {stalePublish ? (
          <Notice
            tone="warn"
            className="mb-3"
            icon="warn"
            action={
              <Button size="sm" onClick={reload}>
                Reload
              </Button>
            }
          >
            Draft v{stalePublish.version} changed since you opened it: the
            publish was refused because you had revision{' '}
            {stalePublish.attemptedRevision}. Reload before you publish, so you
            sign what’s really there. Nothing was published.
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
                Clear
              </Button>
            }
          >
            Comparing v{compareVersion.version} → v{selected.version}. The
            change set for each version in between is listed in the details
            panel.
          </Notice>
        ) : null}
        <TableBox>
          <RegistryGrid
            label="Template versions"
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
          Publishing keeps earlier versions readable for the notebooks that used
          them; retiring stops new notebooks from starting on that version and
          is blocked while unsigned records are still on it.
        </Muted>
      </div>

      <Inspector label={`Version ${selected.version} details`} width={320}>
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            v{selected.version} · {selected.configuration.placements.length}{' '}
            sections
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
              staleSelected ? 'Reload the draft before you publish.' : undefined
            }
            onClick={() => setDialog({ kind: 'publish', version: selected })}
          >
            Publish v{selected.version}…
          </Button>
        ) : null}
        {staleSelected ? (
          <Muted>Reload the draft before you publish.</Muted>
        ) : null}
        {!denied &&
        selected.lifecycle === 'published' &&
        current?.id !== selected.id ? (
          <Button
            variant="danger"
            onClick={() => setDialog({ kind: 'retire', version: selected })}
          >
            Retire v{selected.version}…
          </Button>
        ) : null}
        {!denied &&
        selected.lifecycle === 'published' &&
        current?.id === selected.id ? (
          <Muted>
            The current version can’t be retired. Publish a new version first.
          </Muted>
        ) : null}

        <InspectorSection
          title={
            compareVersion
              ? `Changes from v${Math.min(compareVersion.version, selected.version)} to v${Math.max(compareVersion.version, selected.version)}`
              : firstChange?.previous
                ? `Changes since v${firstChange.previous.version}`
                : 'First version'
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
                      label={`Changes in version ${group.version.version}`}
                    />
                  ) : (
                    <ChangeSetTable
                      entries={group.entries}
                      label={`Changes in version ${group.version.version}`}
                    />
                  )}
                </div>
              ))
            ) : (
              <Muted>Nothing changed between these versions.</Muted>
            )}
          </div>
        </InspectorSection>

        <InspectorSection title="Signatures">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
            <li>
              <span className="font-medium">Published</span>
              <span className="block text-fg-muted">
                {selected.publishedAt
                  ? `${selected.publishedByUserId ? names.userLabel(selected.publishedByUserId) : '—'} · ${formatNotebookDateTime(selected.publishedAt, { zone: true })}`
                  : 'Not published yet.'}
              </span>
            </li>
            {selected.signedAt ? (
              <li>
                <span className="font-medium">Retired · e-signed</span>
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
                No signature recorded. Publishing records the author and the
                reason; retiring records the e-signature.
              </li>
            )}
          </ul>
        </InspectorSection>

        <InspectorSection title="Records on this version">
          <div className="flex flex-col gap-2">
            <DescriptionList
              labelWidth={88}
              items={[
                ['In progress', String(selectedCounts.inProgress)],
                ['In review', String(selectedCounts.inReview)],
                ['Signed', String(selectedCounts.signed)],
                ['Total', String(selectedCounts.total)],
              ]}
            />
            <Link
              to="/templates/$templateId/in-use"
              params={{ templateId }}
              search={{ version: selected.id }}
              className="text-label"
            >
              See records on v{selected.version}
            </Link>
          </div>
        </InspectorSection>

        <InspectorSection title="Governance">
          <DescriptionList
            labelWidth={96}
            items={[
              ['Reason', selected.reason ?? '—'],
              [
                'Signed',
                selected.signedAt
                  ? `${selected.signedByUserId ? names.userLabel(selected.signedByUserId) : '—'} · ${selected.signedMeaning ?? '—'}`
                  : 'Not signed',
              ],
            ]}
          />
        </InspectorSection>

        <InspectorSection title="Compare">
          <Field label="Compare with">
            <Select
              aria-label="Compare with another version"
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
              <option value="">Previous version only</option>
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
  const [meaning, setMeaning] = useState('Retired — no longer for new records')
  const [error, setError] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () =>
      publishNotebookTemplateVersion(
        version.id,
        version.revision,
        reason.trim(),
      ),
    onSuccess: () => {
      toast(`v${version.version} published`, {
        description:
          'New notebooks can start from it; existing ones are not changed.',
      })
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
      toast(`v${version.version} retired`)
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
              ? `Publish v${version.version}`
              : `Retire v${version.version}`
          }
          description={
            kind === 'publish'
              ? 'Publishing makes this version available to new notebooks. Existing notebooks are not changed.'
              : 'Retiring is an e-signature. It is blocked while unsigned records are still on this version.'
          }
        />
        <DialogBody>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Field label="Reason for change" required>
            <Input
              autoFocus
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
              placeholder="e.g. Adds the stability timepoints"
            />
          </Field>
          {kind === 'retire' ? (
            <Field
              label="Signature meaning"
              required
              hint="You must have certified your electronic signature in Settings › Electronic signatures."
            >
              <Input
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant={kind === 'retire' ? 'danger' : 'primary'}
            disabled={busy || reason.trim().length < 1}
            onClick={() => {
              setError(null)
              if (reason.trim().length < 1) {
                setError('Give a reason for the change.')
                return
              }
              if (kind === 'publish') publish.mutate()
              else retire.mutate()
            }}
          >
            {busy
              ? 'Saving…'
              : kind === 'publish'
                ? `Publish v${version.version}`
                : `Sign and retire v${version.version}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('certification')) {
    return 'You haven’t certified your electronic signature. Set it up in Settings › Electronic signatures, then sign again.'
  }
  if (message.includes('unsigned records')) {
    return 'Unsigned records are still on this version. Ask their owners to update them or finish and sign them, then retire.'
  }
  if (message.includes('reason')) return 'Give a reason for the change.'
  return message
}
