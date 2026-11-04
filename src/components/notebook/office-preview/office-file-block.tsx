import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Spinner } from '#/components/v3/ui/spinner'
import { toast } from '#/components/v3/ui/sonner'
import { t } from '#/copy'
import { uploadFileVersion } from '#/lib/experiment-files'
import { formatFileSize } from '#/lib/format-numbers'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { previewKindOf, PREVIEW_AUTO_BYTES } from '#/lib/office-preview/kinds'
import type { PreviewKind } from '#/lib/office-preview/kinds'
import { downloadUrl, loadPreview } from './load-preview'
import { SheetView } from './sheet-view'
import { SlidesView } from './slides-view'
import {
  fetchFileVersions,
  fileVersionsKey,
  pinnedVersionOf,
  resolveBlockVersion,
  useFileVersions,
} from './use-file-versions'
import type { StoredFileVersion } from './use-file-versions'

const DocumentView = React.lazy(() => import('./document-view').then((m) => ({ default: m.DocumentView })))
const PdfView = React.lazy(() => import('./pdf-view'))

// Pressing a button on a block also selects it, and a selected block swaps this
// view for the editor's, which would drop local state and close the full-size
// view. So whether it is open lives outside the component.
const expandedFiles = new Set<string>()
const expandedListeners = new Set<() => void>()

function useExpanded(fileRecordId: string): [boolean, (open: boolean) => void] {
  const open = React.useSyncExternalStore(
    (listener) => {
      expandedListeners.add(listener)
      return () => expandedListeners.delete(listener)
    },
    () => expandedFiles.has(fileRecordId),
    () => false,
  )
  const set = React.useCallback(
    (next: boolean) => {
      if (next) expandedFiles.add(fileRecordId)
      else expandedFiles.delete(fileRecordId)
      for (const listener of expandedListeners) listener()
    },
    [fileRecordId],
  )
  return [open, set]
}

type SaveFn = (
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; message?: string }>

/** "Open in Word" and its siblings: what downloading this kind is for. */
function openLabel(kind: PreviewKind | null): string {
  switch (kind) {
    case 'document':
      return t('notebook.officeFiles.openIn.word')
    case 'sheet':
    case 'csv':
      return t('notebook.officeFiles.openIn.excel')
    case 'slides':
      return t('notebook.officeFiles.openIn.powerpoint')
    case 'pdf':
      return t('notebook.officeFiles.openIn.reader')
    default:
      return t('notebook.officeFiles.openIn.generic')
  }
}

/** The preview of one stored version, in the shape its type calls for. */
export function FilePreview({
  fileRecordId,
  version,
  kind,
  mediaType,
  name,
  expanded = false,
}: {
  fileRecordId: string
  version: number | null
  kind: PreviewKind
  mediaType: string
  name: string
  expanded?: boolean
}) {
  const query = useQuery({
    queryKey: [
      'notebook',
      'file-preview',
      fileRecordId,
      version,
      expanded ? 'full' : 'inline',
    ],
    queryFn: () =>
      loadPreview({ fileRecordId, version, kind, mediaType, name, expanded }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    retry: false,
  })
  if (query.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-fg-muted"
      >
        <Spinner />
        {t('notebook.officeFiles.loading')}
      </div>
    )
  }
  if (query.error || !query.data) {
    return (
      <p role="alert" className="text-sm text-fg-muted">
        {t('notebook.officeFiles.couldNotOpen')}
      </p>
    )
  }
  const loaded = query.data
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner />
          {t('notebook.officeFiles.loading')}
        </div>
      }
    >
      {loaded.kind === 'sheets' ? (
        <SheetView sheets={loaded.sheets} name={name} tall={expanded} />
      ) : loaded.kind === 'slides' ? (
        <SlidesView slides={loaded.slides} />
      ) : loaded.kind === 'html' ? (
        <DocumentView html={loaded.html} tall={expanded} />
      ) : (
        <PdfView bytes={loaded.bytes} name={name} tall={expanded} />
      )}
    </React.Suspense>
  )
}

/**
 * What a file block shows under its name for a file that is not an image:
 * the version bar and, for the types we can open, the preview with an
 * Expand button. Pass `save` (and not `readOnly`) to let the block switch to
 * a newer version or take a new upload; without it the block only reports.
 */
export function OfficeFileBlock({
  payload,
  save,
  readOnly = false,
}: {
  payload: Record<string, unknown>
  save?: SaveFn
  readOnly?: boolean
}) {
  const fileRecordId = String(payload.fileRecordId ?? '')
  const name = String(payload.displayName ?? '')
  const queryClient = useQueryClient()
  const versions = useFileVersions(fileRecordId)
  const pinned = pinnedVersionOf(payload)
  const resolved = resolveBlockVersion(versions.data ?? [], pinned)
  const shown = resolved.shown
  const mediaType = shown?.mediaType ?? String(payload.mediaType ?? '')
  const shownName = shown?.displayName ?? name
  const byteSize = shown?.byteSize ?? Number(payload.byteSize ?? 0)
  const kind = previewKindOf(mediaType, shownName)
  const canChange = Boolean(save) && !readOnly
  // The version the preview and download address. A block that never pinned
  // one follows the latest, exactly as it did before versions were pinned.
  const addressed = pinned === null ? null : (shown?.version ?? pinned)

  const [open, setOpen] = React.useState(
    () => byteSize <= PREVIEW_AUTO_BYTES,
  )
  const [expanded, setExpanded] = useExpanded(fileRecordId)
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  async function pinTo(row: StoredFileVersion, message: string) {
    if (!save) return
    const result = await save({
      ...payload,
      fileVersion: row.version,
      displayName: row.displayName,
      mediaType: row.mediaType,
      byteSize: row.byteSize,
    })
    if (!result.ok) {
      throw new Error(result.message ?? t('notebook.officeFiles.versions.useFailed'))
    }
    await queryClient.invalidateQueries({
      queryKey: notebookQueryKeys.fileObject(fileRecordId),
    })
    toast(message)
  }

  async function useNewer() {
    if (!resolved.newer) return
    setBusy(true)
    try {
      await pinTo(
        resolved.newer,
        t('notebook.officeFiles.versions.using', {
          number: resolved.count,
        }),
      )
    } catch (cause) {
      toast(t('notebook.officeFiles.versions.useFailed'), {
        description: cause instanceof Error ? cause.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  async function uploadNew(file: File) {
    setBusy(true)
    try {
      const { version } = await uploadFileVersion({ fileId: fileRecordId, file })
      const fresh = await queryClient.fetchQuery({
        queryKey: fileVersionsKey(fileRecordId),
        queryFn: () => fetchFileVersions(fileRecordId),
        staleTime: 0,
      })
      const row = fresh.find((v) => v.version === version)
      if (!row) throw new Error(t('notebook.officeFiles.versions.uploadFailed'))
      await pinTo(row, t('notebook.officeFiles.versions.uploaded'))
    } catch (cause) {
      toast(t('notebook.officeFiles.versions.uploadFailed'), {
        description: cause instanceof Error ? cause.message : undefined,
      })
    } finally {
      setBusy(false)
      await queryClient.invalidateQueries({
        queryKey: fileVersionsKey(fileRecordId),
      })
    }
  }

  const href = downloadUrl(fileRecordId, addressed)

  return (
    <div className="space-y-2" data-testid="office-file-block">
      <div
        data-keep-preview
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-muted"
      >
        {resolved.count > 1 ? (
          <span className="num">
            {resolved.newer || pinned !== null
              ? t('notebook.officeFiles.versions.pinned', {
                  number: resolved.position,
                  count: resolved.count,
                })
              : t('notebook.officeFiles.versions.latest')}
          </span>
        ) : null}
        {resolved.newer ? (
          <span className="flex flex-wrap items-center gap-2 text-fg">
            <span>{t('notebook.officeFiles.versions.newer')}</span>
            {canChange ? (
              <Button size="sm" disabled={busy} onClick={() => void useNewer()}>
                {t('notebook.officeFiles.versions.useNewer')}
              </Button>
            ) : readOnly ? (
              <span className="text-fg-muted">
                {t('notebook.officeFiles.versions.useNewerSigned')}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {kind && open ? (
            <Button size="sm" icon="expand" onClick={() => setExpanded(true)}>
              {t('notebook.officeFiles.expand')}
            </Button>
          ) : null}
          <a
            href={href}
            download
            title={t('notebook.officeFiles.openIn.hint')}
            className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-label font-medium text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline max-md:h-8"
          >
            {openLabel(kind)}
          </a>
          {canChange ? (
            <>
              <Button
                size="sm"
                icon="upload"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {busy
                  ? t('notebook.officeFiles.versions.uploading')
                  : t('notebook.officeFiles.versions.upload')}
              </Button>
              <input
                ref={input}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void uploadNew(file)
                }}
              />
            </>
          ) : null}
        </span>
      </div>
      {kind ? (
        open ? (
          <FilePreview
            fileRecordId={fileRecordId}
            version={addressed}
            kind={kind}
            mediaType={mediaType}
            name={shownName}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              {t('notebook.officeFiles.open')}
            </Button>
            <span className="text-caption text-fg-muted">
              {t('notebook.officeFiles.largeFile', {
                size: formatFileSize(byteSize),
              })}
            </span>
          </div>
        )
      ) : null}
      {kind ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="top-[5vh] max-h-[90vh] w-[min(1100px,calc(100vw-32px))]">
            <DialogHeader title={shownName} />
            <DialogBody>
              {expanded ? (
                <FilePreview
                  fileRecordId={fileRecordId}
                  version={addressed}
                  kind={kind}
                  mediaType={mediaType}
                  name={shownName}
                  expanded
                />
              ) : null}
              <div className="flex justify-end gap-2">
                <a
                  href={href}
                  download
                  className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-body font-medium text-fg no-underline hover:bg-surface-hover hover:no-underline"
                >
                  {t('notebook.officeFiles.download')}
                </a>
                <DialogClose render={<Button />}>
                  {t('notebook.officeFiles.close')}
                </DialogClose>
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
