import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { Badge } from '#/components/v3/ui/badge'
import { Dialog, DialogContent } from '#/components/v3/ui/dialog'
import { editableExtension } from '#/lib/office-editor'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { fileVersionsKey } from './office-preview/use-file-versions'

interface EditorSession {
  actionUrl: string
  accessToken: string
  accessTokenTtl: number
  canEdit: boolean
  lockedReason: 'signed' | 'archived' | null
  fileName: string
}

const statusKey = ['office-editor', 'status'] as const

/** Whether the workspace has switched the browser editor on. */
export function useOfficeEditorEnabled(): boolean {
  const status = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const res = await fetch('/api/office-editor/status')
      if (!res.ok) return { enabled: false }
      return (await res.json()) as { enabled: boolean }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
  return status.data?.enabled === true
}

async function startSession(
  fileRecordId: string,
  recordId: string | undefined,
): Promise<EditorSession> {
  const res = await fetch('/api/office-editor/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileRecordId, recordId }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(body?.error?.message ?? t('notebook.officeEditor.failed'))
  }
  return (await res.json()) as EditorSession
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
  const formRef = React.useRef<HTMLFormElement>(null)
  const frameName = React.useId()
  React.useEffect(() => {
    formRef.current?.submit()
  }, [session.actionUrl])
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
      <form
        ref={formRef}
        method="post"
        action={session.actionUrl}
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
        className="min-h-0 w-full flex-1 border-0 bg-surface"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}
