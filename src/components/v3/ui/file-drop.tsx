import { useCallback, useState } from 'react'

import { useFileUpload } from '#/components/reui/use-file-upload'
import type { FileWithPreview } from '#/components/reui/use-file-upload'
import { Button } from './button'
import { Icon } from '#/components/v3/icons'
import { formatFileSize } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/**
 * The app's pick-and-drop file field (ADR-0055, workstream B5).
 *
 * The pick surface is ReUI's `@reui/use-file-upload` — installed from the pinned
 * base-nova registry at `src/components/reui/use-file-upload.ts` — composed here
 * with Sheetbase tokens. What the field owns is the part the registry item
 * cannot: the *transport contract*. `onFile` hands the picked file to the
 * caller's own request, the row shows that request's progress for as long as it
 * runs, and a rejection becomes the row's message with a Retry that runs it
 * again. ReUI's own note says no example sends a picked file anywhere, so the
 * transport, the validation policy (`validate`) and where the bytes are stored
 * all stay with the caller.
 *
 * The keyboard route is the "Choose file" button, which opens the same native
 * dialog the hidden input does; the input itself is `sr-only` and out of the tab
 * order, exactly as the vendor's examples render it, so the tab order is not
 * padded with an invisible control.
 *
 * Four screens pick a file today — the import flow's upload step, the parser
 * settings test-file upload, the instrument ingestion panel, and the notebook's
 * file block — and they picked it with a bare `<input type="file">`, two of them
 * inside a box that looked like a drop zone and had no drop handler.
 */

/** What a row is doing, as the row says it. */
type FileEntryStatus = 'busy' | 'done' | 'refused' | 'failed'

interface FileEntry {
  readonly id: string
  readonly file: File
  readonly status: FileEntryStatus
  /** Refusal or failure text, shown in place of the state word. */
  readonly message?: string
  /** A pick the caller transported asynchronously, so `done` reads as uploaded. */
  readonly uploaded: boolean
}

export interface FileDropProps {
  /** The field's label, shown in the drop zone. */
  readonly label: React.ReactNode
  /**
   * The accessible name of the file input. A test or a script that selects a
   * file by label addresses this, so it defaults to `label` only when that is a
   * plain string.
   */
  readonly inputLabel?: string
  readonly hint?: React.ReactNode
  /** The input's `accept`: a native dialog filter, not a validation policy. */
  readonly accept?: string
  /**
   * The caller's own validation. A refusal is shown against the file and the
   * pick is not handed on; the server re-validates whatever is.
   */
  readonly validate?: (
    file: File,
  ) => { ok: true } | { ok: false; message: string }
  readonly disabled?: boolean
  /**
   * Why the field is disabled. Shown as text, so a keyboard read finds the
   * reason rather than a hover tooltip.
   */
  readonly disabledReason?: React.ReactNode
  /**
   * The picked file, or `null` when the caller's selection is cleared. A
   * returned promise is the caller's transport: the row stays busy until it
   * settles, and a rejection shows the failure with a Retry. A call that
   * returns nothing is the caller's own selection to hold — the row says
   * "Selected" and there is no progress to show.
   */
  readonly onFile: (file: File | null) => void | Promise<void>
  readonly className?: string
}

function messageOf(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : t('settings.uiKit.fileDrop.fileCouldUploaded')
}

/**
 * Is the caller transporting this pick, or just holding it? The declared return
 * type is `void | Promise<void>`, which a check on `handed` alone cannot narrow,
 * so the probe is one `typeof` on the value as `unknown`.
 */
function isTransported(handed: unknown): handed is Promise<void> {
  return typeof (handed as { then?: unknown } | null)?.then === 'function'
}

export function FileDrop({
  label,
  inputLabel,
  hint,
  accept,
  validate,
  disabled,
  disabledReason,
  onFile,
  className,
}: FileDropProps) {
  const [entries, setEntries] = useState<readonly FileEntry[]>([])

  /** Replace one entry, leaving the rest alone. */
  const patch = useCallback((id: string, changes: Partial<FileEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...changes } : entry,
      ),
    )
  }, [])

  /**
   * Hand one file to the caller. A synchronous return is a selection the caller
   * holds; an awaited one is the transport, and its progress is the row's.
   */
  const hand = useCallback(
    async (entry: FileEntry) => {
      const refusal = validate?.(entry.file)
      if (refusal && !refusal.ok) {
        patch(entry.id, { status: 'refused', message: refusal.message })
        return
      }
      const handed = onFile(entry.file)
      if (!isTransported(handed)) {
        patch(entry.id, { status: 'done', message: undefined })
        return
      }
      patch(entry.id, { status: 'busy', message: undefined })
      try {
        await handed
        patch(entry.id, { status: 'done', uploaded: true })
      } catch (cause) {
        patch(entry.id, { status: 'failed', message: messageOf(cause) })
      }
    },
    [onFile, patch, validate],
  )

  const onFilesAdded = useCallback(
    (added: readonly FileWithPreview[]) => {
      const picked = added.flatMap((entry) =>
        entry.file instanceof File
          ? [
              {
                id: entry.id,
                file: entry.file,
                status: 'busy' as const,
                uploaded: false,
              },
            ]
          : [],
      )
      if (picked.length === 0) return
      // This field holds one file at a time, which is what every screen that
      // picks one needs; the registry hook holds the queue behind it.
      setEntries(picked)
      for (const entry of picked) void hand(entry)
    },
    [hand],
  )

  // The hook owns the pick surface — the hidden input, the native dialog and
  // the drag handlers — and reports every accepted file through `onFilesAdded`.
  const [state, actions] = useFileUpload({ onFilesAdded })

  const {
    getInputProps,
    openFileDialog,
    removeFile,
    handleDrop,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
  } = actions
  const busy = entries.some((entry) => entry.status === 'busy')
  const off = Boolean(disabled) || busy
  const inputName =
    inputLabel ?? (typeof label === 'string' ? label : undefined)

  return (
    <div className={cn('grid gap-2', className)}>
      <div
        data-slot="file-drop"
        data-disabled={off ? 'true' : undefined}
        data-dragging={state.isDragging ? 'true' : undefined}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-muted/20 p-6 text-center',
          state.isDragging && !off && 'border-focus bg-surface-muted',
          off && 'opacity-70',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-md bg-surface text-fg-muted shadow-xs"
        >
          <Icon name="upload" className="size-5" />
        </span>
        <span className="text-body font-medium text-fg">{label}</span>
        {hint ? (
          <span className="max-w-[420px] text-label text-fg-muted">{hint}</span>
        ) : null}
        <Button
          size="sm"
          icon="upload"
          disabled={off}
          aria-haspopup="dialog"
          onClick={openFileDialog}
        >
          {t('settings.uiKit.fileDrop.chooseFile')}
        </Button>
        <input
          {...getInputProps({
            disabled: off,
            'aria-label': inputName,
          })}
          // The registry hook puts its own `accept` default (`"*"`) on the
          // input; a value that matches no file type would filter every pick
          // out, in the dialog and in a test. Omitted when the caller gives
          // none, which is the honest "any file".
          accept={accept}
          className="sr-only"
          tabIndex={-1}
        />
        {off && disabledReason ? (
          <span className="text-label text-fg-muted">{disabledReason}</span>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {entries.map((entry) => {
            const stateWord =
              entry.status === 'busy'
                ? t('settings.uiKit.fileDrop.uploading')
                : entry.status === 'done'
                  ? entry.uploaded
                    ? t('settings.uiKit.fileDrop.uploaded')
                    : t('settings.uiKit.fileDrop.selected')
                  : entry.status === 'refused'
                    ? t('settings.uiKit.fileDrop.notUploaded')
                    : t('common.states.failed')
            const failure =
              entry.status === 'refused' || entry.status === 'failed'
            return (
              <li
                key={entry.id}
                data-file-id={entry.id}
                data-file-status={entry.status}
                // `min-w-0`: the list is a grid, and a grid item's automatic
                // minimum size is its content's — without it a long file name
                // keeps the row at the name's full width and pushes the row's
                // own controls out of the column.
                className="flex min-w-0 items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="mt-0.5 shrink-0 text-fg-muted">
                  <Icon name="protocol" size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="m-0 truncate text-body text-fg"
                    title={entry.file.name}
                  >
                    {entry.file.name}
                  </p>
                  <p className="m-0 text-label">
                    <span className="num text-fg-muted">
                      {formatFileSize(entry.file.size)}
                    </span>
                    {' · '}
                    <span
                      role="status"
                      className={failure ? 'text-danger-text' : 'text-fg-muted'}
                    >
                      {entry.message ?? stateWord}
                    </span>
                  </p>
                  {entry.status === 'busy' ? (
                    <div
                      role="progressbar"
                      aria-label={t('settings.uiKit.fileDrop.uploadingAria', {
                        name: entry.file.name,
                      })}
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-skeleton"
                    >
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-fg-muted" />
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {entry.status === 'failed' ? (
                    <Button
                      size="sm"
                      aria-label={t('settings.uiKit.fileDrop.retryAria', {
                        name: entry.file.name,
                      })}
                      onClick={() => void hand(entry)}
                    >
                      {t('common.actions.tryAgain')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={t('settings.uiKit.fileDrop.removeAria', {
                      name: entry.file.name,
                    })}
                    onClick={() => {
                      removeFile(entry.id)
                      setEntries((current) =>
                        current.filter((item) => item.id !== entry.id),
                      )
                      onFile(null)
                    }}
                  >
                    {t('common.actions.remove')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
