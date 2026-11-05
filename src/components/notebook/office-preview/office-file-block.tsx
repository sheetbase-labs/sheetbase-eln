import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
} from '#/components/ui/dialog'
import { Spinner } from '#/components/ui/spinner'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { OfficeViewer, useOfficeEditorLive } from '../office-editor'
import { editableExtension } from '#/lib/office-editor'
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

const DocumentView = React.lazy(() =>
  import('./document-view').then((m) => ({ default: m.DocumentView })),
)
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
  onSettled,
}: {
  fileRecordId: string
  version: number | null
  kind: PreviewKind
  mediaType: string
  name: string
  expanded?: boolean
  /** Called once the preview has loaded (or failed) and its height is final. */
  onSettled?: () => void
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
  const settled = !query.isLoading
  React.useEffect(() => {
    if (settled) onSettled?.()
  }, [settled])
  if (query.isLoading) {
    return (
      // Held at about the height a preview settles to, so a notebook opened
      // at an anchor below it does not jump when the file finishes loading.
      <div
        role="status"
        className="flex min-h-80 items-start gap-2 text-sm text-fg-muted"
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
  actions,
}: {
  payload: Record<string, unknown>
  save?: SaveFn
  readOnly?: boolean
  /** More buttons for the block's toolbar, such as "Make a sheet". */
  actions?: React.ReactNode
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

  const [open, setOpen] = React.useState(() => byteSize <= PREVIEW_AUTO_BYTES)
  // When the workspace runs the browser editor, the block shows the file as
  // Office itself draws it. The built-in preview stays for installs without
  // it, for older versions the editor cannot show, and if it fails to answer.
  const editor = useOfficeEditorLive()
  const [viewerFailed, setViewerFailed] = React.useState(false)
  const wantsViewer =
    editableExtension(shownName) !== null && !resolved.newer && !viewerFailed
  const viewer = wantsViewer && editor === 'on'
  const viewerPending = wantsViewer && editor === 'pending'
  const canExpand = viewer || (kind !== null && open)
  const [expanded, setExpanded] = useExpanded(fileRecordId)
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const root = React.useRef<HTMLDivElement>(null)
  const mountedAt = React.useRef(Date.now())

  // A link such as a search result opens the notebook at this block, and the
  // browser scrolls before the files above it have loaded. Once this one has
  // settled, bring the block back to the top if that is where the link pointed.
  function keepAnchor() {
    if (Date.now() - mountedAt.current > 20_000) return
    const row = root.current?.closest('[id^="block-"]')
    if (row && window.location.hash === `#${row.id}`) {
      row.scrollIntoView({ block: 'start' })
    }
  }

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
      throw new Error(
        result.message ?? t('notebook.officeFiles.versions.useFailed'),
      )
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
      const { version } = await uploadFileVersion({
        fileId: fileRecordId,
        file,
      })
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
    <div ref={root} className="space-y-2" data-testid="office-file-block">
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
          {canExpand ? (
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
          {actions}
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
      {viewerPending ? (
        <div
          role="status"
          className="flex min-h-80 items-start gap-2 text-sm text-fg-muted"
        >
          <Spinner />
          {t('notebook.officeFiles.loading')}
        </div>
      ) : viewer ? (
        <OfficeViewer
          fileRecordId={fileRecordId}
          version={shown?.version ?? null}
          onUnavailable={() => setViewerFailed(true)}
        />
      ) : kind ? (
        open ? (
          <FilePreview
            fileRecordId={fileRecordId}
            version={addressed}
            kind={kind}
            mediaType={mediaType}
            name={shownName}
            onSettled={keepAnchor}
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
      {kind || viewer ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="top-[5vh] max-h-[90vh] w-[min(1100px,calc(100vw-32px))]">
            <DialogHeader title={shownName} />
            <DialogBody>
              {expanded && viewer ? (
                <OfficeViewer
                  fileRecordId={fileRecordId}
                  version={shown?.version ?? null}
                  tall
                  onUnavailable={() => setViewerFailed(true)}
                />
              ) : expanded && kind ? (
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
