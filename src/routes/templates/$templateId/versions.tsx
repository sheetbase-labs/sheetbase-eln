import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
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
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'

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
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead className="first:pl-3">Change</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Before</TableHead>
            <TableHead className="pr-3">After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => (
            <TableRow
              key={`${entry.tag}-${entry.kind}-${entry.id}-${entry.field ?? ''}-${index}`}
            >
              <TableCell className="first:pl-3">
                <Status tone={TAG_TONE[entry.tag]}>
                  {TAG_LABEL[entry.tag]}
                </Status>
              </TableCell>
              <TableCell className="text-fg-muted">
                {entry.label}
                {entry.field ? ` · ${entry.field}` : ''}
              </TableCell>
              <TableCell>
                <ChangeValue value={entry.before} />
              </TableCell>
              <TableCell className="pr-3">
                <ChangeValue value={entry.after} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
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
  const names = useUserNames(
    rows
      .flatMap((v) => [v.publishedByUserId, v.signedByUserId])
      .filter((id): id is string => Boolean(id)),
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
      }))
  }, [rows, selected, compareVersion])

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
          body="A template needs a version before a notebook can be made from it."
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
          <Table aria-label="Template versions">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Published</TableHead>
                <TableHead>By</TableHead>
                <TableHead align="right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => {
                const lifecycle = templateLifecycle(v.lifecycle)
                return (
                  <TableRow
                    key={v.id}
                    selected={v.id === selected.id}
                    className="cursor-pointer"
                    onClick={() =>
                      void navigate({
                        to: '/templates/$templateId/versions',
                        params: { templateId },
                        search: (s) => ({ ...s, v: v.id }),
                        replace: true,
                      })
                    }
                  >
                    <TableCell className="font-medium">
                      v{v.version}
                      {current?.id === v.id ? (
                        <span className="ml-2 text-label text-fg-muted">
                          current
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Status tone={lifecycle.tone}>{lifecycle.label}</Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {v.publishedAt ? v.publishedAt.slice(0, 10) : '—'}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {v.publishedByUserId
                        ? names.userLabel(v.publishedByUserId)
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {recordsByVersion.get(v.id) ?? 0}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
                    <h4 className="text-label font-medium">
                      v{group.version.version}
                    </h4>
                  ) : null}
                  <ChangeSetTable
                    entries={group.entries}
                    label={`Changes in version ${group.version.version}`}
                  />
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
                  ? `${selected.publishedByUserId ? names.userLabel(selected.publishedByUserId) : '—'} · ${selected.publishedAt.slice(0, 16).replace('T', ' ')}`
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
                  {selected.signedAt.slice(0, 16).replace('T', ' ')}
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
            <select
              aria-label="Compare with another version"
              className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
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
            </select>
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
