import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Dialog, DialogContent } from '#/components/ui/dialog'
import { Spinner } from '#/components/ui/spinner'
import { editableExtension } from '#/lib/office-editor'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { fileVersionsKey } from './office-preview/use-file-versions'

const editorSession = z
  .object({
    actionUrl: z.url({ protocol: /^https?$/ }),
    accessToken: z.string(),
    accessTokenTtl: z.number(),
    canEdit: z.boolean(),
    lockedReason: z.enum(['signed', 'archived']).nullable(),
    fileName: z.string(),
  })
  .transform((session) => ({
    ...session,
    editorOrigin: new URL(session.actionUrl).origin,
  }))

type EditorSession = z.output<typeof editorSession>

const editorStatus = z.object({
  enabled: z.boolean(),
  reachable: z.boolean().optional(),
})

const statusKey = ['office-editor', 'status'] as const

/** Whether the workspace has switched the browser editor on. */
export function useOfficeEditorEnabled(): boolean {
  const status = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const res = await fetch('/api/office-editor/status')

      if (!res.ok) return { enabled: false }

      return editorStatus.parse(await res.json())
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  return status.data?.enabled === true
}

/**
 * Whether the editor is switched on and answering: 'pending' until the app has
 * asked, then 'on' or 'off'. A block that can show the real Office view waits
 * on this rather than drawing its own preview first.
 */
export function useOfficeEditorLive(): 'pending' | 'on' | 'off' {
  const status = useQuery({
    queryKey: [...statusKey, 'live'],
    queryFn: async () => {
      const res = await fetch('/api/office-editor/status?check=1')

      if (!res.ok) return false

      const body = editorStatus.parse(await res.json())

      return body.enabled && body.reachable !== false
    },
    staleTime: 60_000,
    retry: false,
  })

  if (status.isPending) return 'pending'

  return status.data === true ? 'on' : 'off'
}

async function startSession(
  fileRecordId: string,
  recordId: string | undefined,
  mode?: 'view',
): Promise<EditorSession> {
  const res = await fetch('/api/office-editor/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileRecordId, recordId, mode }),
  })

  if (!res.ok) {
    const body = z
      .object({
        error: z.object({ message: z.string().optional() }).optional(),
      })
      .safeParse(await res.json().catch(() => null))

    throw new Error(
      (body.success ? body.data.error?.message : null) ??
        t('notebook.officeEditor.failed'),
    )
  }

  const session = editorSession.parse(await res.json())

  // CODE needs scripts and its origin, so never embed it on the app's own origin.
  if (session.editorOrigin === window.location.origin) {
    throw new Error(t('notebook.officeEditor.failed'))
  }

  return session
}

/**
 * Edit button for an Office file in a notebook. Renders nothing unless the
 * workspace runs the optional browser editor and the file is one it opens.
 * The editor fills the window; closing it returns to the notebook, where the
 * file now has a newer version if anything was saved.
 */
export function OfficeEditButton({
  fileRecordId,
  fileName,
  recordId,
}: {
  fileRecordId: string
  fileName: string
  recordId?: string
}) {
  const enabled = useOfficeEditorEnabled()
  const queryClient = useQueryClient()
  const [session, setSession] = React.useState<EditorSession | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!enabled || !editableExtension(fileName)) return null

  async function open() {
    setBusy(true)
    setError(null)

    try {
      setSession(await startSession(fileRecordId, recordId))
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t('notebook.officeEditor.failed'),
      )
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setSession(null)

    // Collabora can finish its last save just after the window closes, so
    // refresh the file and its versions now and again a moment later; the
    // block then offers the newer version.
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.fileObject(fileRecordId),
      })
      void queryClient.invalidateQueries({
        queryKey: fileVersionsKey(fileRecordId),
      })
    }

    refresh()
    window.setTimeout(refresh, 3000)
  }

  return (
    <>
      {/* Pressing the button must not turn the block into its editor, which
          would drop the press and this component with it. */}
      <span
        data-keep-preview
        className="inline-flex"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          icon="edit"
          disabled={busy}
          onClick={() => void open()}
        >
          {busy
            ? t('notebook.officeEditor.opening')
            : t('notebook.officeEditor.edit')}
        </Button>
      </span>
      {error ? (
        <span role="alert" className="text-xs text-danger-text">
          {error}
        </span>
      ) : null}
      <Dialog open={session !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="inset-0 top-0 h-dvh max-h-none w-screen! translate-x-0 rounded-none max-md:h-dvh">
          {session ? <EditorFrame session={session} onClose={close} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The editor in a frame: a form posts the access token into it, as the WOPI
 * protocol asks, so the token never appears in an address. */
function EditorFrame({
  session,
  onClose,
}: {
  session: EditorSession
  onClose: () => void
}) {
  const reason =
    session.lockedReason === 'signed'
      ? t('notebook.officeEditor.signedViewOnly')
      : session.lockedReason === 'archived'
        ? t('notebook.officeEditor.archivedViewOnly')
        : null

  return (
    // React events from a dialog bubble to the notebook block that holds it;
    // keep them here so the block does not react to focus inside the editor.
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      onFocus={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {session.fileName}
        </p>
        {reason ? <Badge variant="chg">{reason}</Badge> : null}
        <p className="hidden text-caption text-fg-muted md:block">
          {session.canEdit ? t('notebook.officeEditor.savesAsVersions') : null}
        </p>
        <Button size="sm" variant="primary" onClick={onClose}>
          {t('notebook.officeEditor.done')}
        </Button>
      </div>
      <WopiFrame
        session={session}
        className="min-h-0 w-full flex-1 border-0 bg-surface"
      />
    </div>
  )
}

/** The editor's page in a frame, entered by a form post so the access token
 * never appears in an address. */
function WopiFrame({
  session,
  className,
  onLoad,
}: {
  session: EditorSession
  className?: string
  onLoad?: () => void
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const frameName = React.useId()
  React.useEffect(() => {
    formRef.current?.submit()
  }, [session.actionUrl])

  // The editor follows the app's light or dark theme.
  const dark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark'

  const action = dark
    ? `${session.actionUrl}&darkTheme=true`
    : session.actionUrl

  return (
    <>
      <form
        ref={formRef}
        method="post"
        action={action}
        target={frameName}
        className="hidden"
      >
        <input type="hidden" name="access_token" value={session.accessToken} />
        <input
          type="hidden"
          name="access_token_ttl"
          value={String(session.accessTokenTtl)}
        />
      </form>
      <iframe
        name={frameName}
        title={session.fileName}
        className={className}
        // react-doctor-disable-next-line react-doctor/iframe-missing-sandbox -- CODE requires scripts, its own origin and welcome-form POSTs; startSession refuses an initial action on the app's origin before rendering or posting tokens. Redirect/production-header security is not established here.
        sandbox="allow-scripts allow-same-origin allow-forms"
        // The named frame starts at about:blank; shorthand 'src' would not delegate to its POST destination.
        allow={`clipboard-read ${session.editorOrigin}; clipboard-write ${session.editorOrigin}`}
        onLoad={onLoad}
      />
    </>
  )
}

/**
 * The real Office view of a file, in place in the block: Collabora draws the
 * document, sheet or slides exactly as the application would. Read-only; Edit
 * opens the full editor. The frame starts only when the block is near the
 * screen, so a long notebook does not open every document at once.
 */
export function OfficeViewer({
  fileRecordId,
  version,
  tall = false,
  onUnavailable,
}: {
  fileRecordId: string
  /** Changes when the file does, so the view reloads after a new version. */
  version: number | null
  tall?: boolean
  /** Called when the editor cannot show this file, so the caller can fall back. */
  onUnavailable?: () => void
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const [near, setNear] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  React.useEffect(() => {
    const el = box.current

    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)

      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px' },
    )

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const session = useQuery({
    queryKey: ['office-editor', 'view', fileRecordId, version],
    queryFn: () => startSession(fileRecordId, undefined, 'view'),
    enabled: near,
    staleTime: 30 * 60_000,
    retry: false,
  })

  const failed = session.isError
  React.useEffect(() => {
    if (failed) onUnavailable?.()
  }, [failed, onUnavailable])

  return (
    // The frame takes focus without any React event; marking it keeps the
    // notebook from swapping the block for its editor mid-click.
    <div
      ref={box}
      data-keep-preview
      data-testid="office-viewer"
      className={`relative overflow-hidden rounded-lg border border-border bg-surface ${
        tall ? 'h-[76vh]' : 'h-[620px]'
      }`}
    >
      {session.data ? (
        <WopiFrame
          key={`${session.data.accessToken}`}
          session={session.data}
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
      {!loaded && !failed ? (
        <div
          role="status"
          className="absolute inset-0 flex items-start gap-2 bg-surface p-4 text-sm text-fg-muted"
        >
          <Spinner />
          {t('notebook.officeFiles.loading')}
        </div>
      ) : null}
    </div>
  )
}
