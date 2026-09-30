import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { DescriptionList, Muted } from '#/components/v3/ui/layout'
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
import { useUserNames } from '#/lib/user-names'
import {
  publishNotebookTemplateVersion,
  retireNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
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
 * stay server-side.
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

  const selected = rows.find((v) => v.id === search.v) ?? rows[0]
  const compareVersion = rows.find((v) => v.id === search.compare)
  const recordsByVersion = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of users.data ?? []) {
      const key = r.source_notebook_template_version_id ?? ''
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [users.data])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })

  if (!rows.length) {
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

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {denied ? (
          <Notice tone="info" className="mb-3" icon="lock">
            View only. Only template owners and QA can publish or retire
            versions.
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
            Comparing v{compareVersion.version} → v{selected.version}. Change
            summaries are not recorded per version in this deployment.
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

      <aside
        aria-label={`Version ${selected.version} details`}
        className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"
      >
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">
            v{selected.version} · {selected.configuration.placements.length}{' '}
            sections
          </span>
          <div className="font-heading text-doc font-semibold">
            {templateLifecycle(selected.lifecycle).label}
          </div>
        </div>

        {selected.lifecycle === 'draft' ? (
          <Button
            variant="primary"
            onClick={() => setDialog({ kind: 'publish', version: selected })}
          >
            Publish v{selected.version}…
          </Button>
        ) : null}
        {selected.lifecycle === 'published' && current?.id !== selected.id ? (
          <Button
            variant="danger"
            onClick={() => setDialog({ kind: 'retire', version: selected })}
          >
            Retire v{selected.version}…
          </Button>
        ) : null}
        {selected.lifecycle === 'published' && current?.id === selected.id ? (
          <Muted>
            The current version can’t be retired. Publish a new version first.
          </Muted>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-fg-muted">Governance</h3>
          <DescriptionList
            labelWidth={96}
            items={[
              ['Reason', selected.reason ?? '—'],
              [
                'Signed',
                selected.signedAt ? (
                  <span>
                    {selected.signedByUserId
                      ? names.userLabel(selected.signedByUserId)
                      : '—'}{' '}
                    · {selected.signedMeaning ?? '—'} ·{' '}
                    {selected.signedAt.slice(0, 16).replace('T', ' ')}
                  </span>
                ) : (
                  'Not signed'
                ),
              ],
            ]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-fg-muted">Records</h3>
          <Muted>
            {recordsByVersion.get(selected.id) ?? 0} records are pinned to this
            version.
          </Muted>
          <Link
            to="/templates/$templateId/in-use"
            params={{ templateId }}
            search={{ version: selected.id }}
            className="text-label"
          >
            See records on v{selected.version}
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-fg-muted">Compare</h3>
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
        </div>
      </aside>

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
}: {
  templateId: string
  kind: 'publish' | 'retire'
  version: NotebookTemplateVersion
  onClose: () => void
  onDone: () => void
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
    onError: (e) => setError(errorMessage(e)),
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
    onError: (e) => setError(errorMessage(e)),
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
