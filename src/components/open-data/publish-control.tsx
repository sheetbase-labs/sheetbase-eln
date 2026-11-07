import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import {
  discardPublication,
  fetchPublicationTargets,
  fetchPublications,
  openDataKeys,
  publishPublication,
  requestPublication,
  retryPublication,
  describeOpenDataError,
} from '#/lib/open-data/client'
import type { Publication, PublicationStatus } from '#/lib/open-data/client'
import { PUBLICATION_LICENSES, licenseById } from '#/lib/publishing/licenses'
import { t } from '#/copy'

const dataClient = createDataClient()

const TONE: Record<
  PublicationStatus,
  'ok' | 'warn' | 'bad' | 'progress' | 'draft'
> = {
  queued: 'progress',
  sending: 'progress',
  draft: 'warn',
  publishing: 'progress',
  published: 'ok',
  failed: 'bad',
  discarded: 'draft',
}

const LABEL: Record<PublicationStatus, string> = {
  queued: t('openData.publish.statusQueued'),
  sending: t('openData.publish.statusSending'),
  draft: t('openData.publish.statusDraft'),
  publishing: t('openData.publish.statusPublishing'),
  published: t('openData.publish.statusPublished'),
  failed: t('openData.publish.statusFailed'),
  discarded: t('openData.publish.statusDiscarded'),
}

const BUSY: readonly PublicationStatus[] = ['queued', 'sending', 'publishing']

function formatBytes(n: number | null): string {
  if (n == null) return ''
  return n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`
}

/**
 * The Publish action for an experiment or a dataset version, and the DOI of
 * whatever was already published. Publishing is two steps: a draft is prepared
 * at the repository, then a person makes it public. The second step can't be
 * undone, so it asks first.
 */
export function PublishControl({
  workspaceId,
  kind,
  objectId,
  defaultTitle,
  canPublish,
}: {
  workspaceId: string
  kind: Publication['object_kind']
  objectId: string
  defaultTitle: string
  canPublish: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  const [license, setLicense] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Publication | null>(null)

  const targets = useQuery({
    queryKey: openDataKeys.targets(workspaceId),
    queryFn: () => fetchPublicationTargets(dataClient),
  })
  const publications = useQuery({
    queryKey: openDataKeys.publications(kind, objectId),
    queryFn: () => fetchPublications(dataClient, kind, objectId),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((p) => BUSY.includes(p.status)) ? 3_000 : false,
  })
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: openDataKeys.publications(kind, objectId),
    })

  const usable = (targets.data ?? []).filter((x) => x.enabled && x.token_set)
  const chosen = usable.find((x) => x.id === targetId) ?? usable.at(0)
  const rows = publications.data ?? []
  const published = rows.find((p) => p.status === 'published')

  const start = useMutation({
    mutationFn: () => {
      if (!chosen) throw new Error(t('openData.publish.noRepositories'))
      return requestPublication(dataClient, {
        targetId: chosen.id,
        kind,
        objectId,
        title: (title ?? defaultTitle).trim(),
        license: license ?? chosen.license,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast(t('openData.publish.queued'))
    },
  })
  const act = useMutation({
    mutationFn: (input: { op: 'publish' | 'discard' | 'retry'; id: string }) =>
      input.op === 'publish'
        ? publishPublication(dataClient, input.id)
        : input.op === 'discard'
          ? discardPublication(dataClient, input.id)
          : retryPublication(dataClient, input.id),
    onSuccess: () => void invalidate(),
    onError: (e) =>
      toast(`${t('openData.publish.failed')}: ${describeOpenDataError(e)}`),
  })

  // Nothing to offer: no repository is ready and nothing was published.
  if (!published && !(canPublish && (usable.length > 0 || rows.length > 0)))
    return null

  return (
    <>
      {published?.doi ? (
        <a
          href={published.record_url ?? `https://doi.org/${published.doi}`}
          target="_blank"
          rel="noreferrer"
          title={t('openData.publish.doi')}
        >
          {/* copy-ignore-next-line */}
          <Badge>DOI {published.doi}</Badge>
        </a>
      ) : null}
      {canPublish ? (
        <Button size="sm" icon="upload" onClick={() => setOpen(true)}>
          {t('openData.publish.action')}
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(640px,calc(100vw-32px))]">
          <DialogHeader
            title={t('openData.publish.title')}
            description={
              kind === 'experiment'
                ? t('openData.publish.experimentDescription')
                : t('openData.publish.versionDescription')
            }
          />
          <DialogBody>
            {usable.length === 0 ? (
              <Notice tone="info">
                {t('openData.publish.noRepositories')}
              </Notice>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (chosen && (title ?? defaultTitle).trim()) start.mutate()
                }}
              >
                <Field label={t('openData.publish.repository')}>
                  <Select
                    aria-label={t('openData.publish.repository')}
                    value={chosen?.id ?? ''}
                    onChange={(e) => {
                      setTargetId(e.target.value)
                      setLicense(null)
                    }}
                  >
                    {usable.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('openData.publish.titleField')} required>
                  <Input
                    value={title ?? defaultTitle}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('openData.publish.licence')}>
                  <Select
                    aria-label={t('openData.publish.licence')}
                    value={license ?? chosen?.license ?? 'cc-by-4.0'}
                    onChange={(e) => setLicense(e.target.value)}
                  >
                    {PUBLICATION_LICENSES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {start.error ? (
                  <Notice tone="bad">
                    {describeOpenDataError(start.error)}
                  </Notice>
                ) : null}
                <div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={start.isPending}
                  >
                    {t('openData.publish.send')}
                  </Button>
                </div>
              </form>
            )}

            {rows.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                <h3 className="text-label font-medium">
                  {t('openData.publish.list')}
                </h3>
                <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle p-0">
                  {rows.map((p) => (
                    <li key={p.id} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Status tone={TONE[p.status]}>{LABEL[p.status]}</Status>
                        <span className="font-medium">{p.title}</span>
                        <span className="text-label text-fg-muted">
                          {formatDate(p.created_at)} ·{' '}
                          {licenseById(p.license).name}
                        </span>
                      </div>
                      {p.package_name ? (
                        <Muted>
                          {t('openData.publish.previewTitle')}: {p.package_name}
                          {p.package_bytes
                            ? ` (${formatBytes(p.package_bytes)})`
                            : ''}
                          {p.includes_run_crate
                            ? ` · ${t('openData.publish.includesRun')}`
                            : ''}
                        </Muted>
                      ) : null}
                      {p.status === 'draft' ? (
                        <Muted>{t('openData.publish.draftReady')}</Muted>
                      ) : null}
                      {p.last_error &&
                      (p.status === 'failed' || p.status === 'draft') ? (
                        <Notice tone="bad">{p.last_error}</Notice>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {p.doi ? (
                          <a
                            href={p.record_url ?? `https://doi.org/${p.doi}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {/* copy-ignore-next-line */}
                            DOI {p.doi}
                          </a>
                        ) : null}
                        {p.status === 'draft' && p.draft_url ? (
                          <a
                            href={p.draft_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('openData.publish.openDraft')}
                          </a>
                        ) : null}
                        <span className="ml-auto flex gap-2">
                          {p.status === 'draft' ? (
                            <>
                              <Button
                                size="sm"
                                variant="quiet"
                                onClick={() =>
                                  act.mutate({ op: 'discard', id: p.id })
                                }
                              >
                                {t('openData.publish.discard')}
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setConfirming(p)}
                              >
                                {t('openData.publish.publishNow')}
                              </Button>
                            </>
                          ) : null}
                          {p.status === 'failed' ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                act.mutate({ op: 'retry', id: p.id })
                              }
                            >
                              {t('openData.publish.retry')}
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.close')}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => (o ? null : setConfirming(null))}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('openData.publish.confirmTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('openData.publish.confirmBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                if (confirming) act.mutate({ op: 'publish', id: confirming.id })
                setConfirming(null)
              }}
            >
              {t('openData.publish.publishNow')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}
