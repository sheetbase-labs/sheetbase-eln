import * as React from 'react'

import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { useFileUpload } from '#/components/reui/use-file-upload'
import type { FileWithPreview } from '#/components/reui/use-file-upload'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'
import { formatFileSize } from '#/lib/format-numbers'
import { cn } from '#/lib/utils'

/**
 * Pair 2 — the file pick.
 *
 * The job: pick or drop a file, watch that file's upload, and retry a failure.
 *
 * Ours, frozen: this change deletes the product's copy, so the column is the
 * shipped shape kept here as the record's baseline — the notebook's dashed box
 * that looked like a drop target and had no drop handler, with the import
 * flow's `<input type="file">`, its boolean progress line ("Storing and reading
 * the file…") and its single error string. It holds one file, renders no file
 * row and offers no retry, and a drop does nothing to it. The fixture's queue
 * is therefore not representable on this side, which the column states rather
 * than pretends.
 *
 * Theirs: the registry item `@reui/use-file-upload` composed the way the
 * shipping `src/components/v3/ui/file-drop.tsx` composes it — the hook's drag
 * handlers, hidden input and `isDragging`, with Sheetbase tokens and the
 * vendor's progress-row anatomy (name, size, progress bar, retry, remove). The
 * column composes the item rather than the field because the field takes one
 * file at a time, and the queue is what the fixtures measure here.
 *
 * Both columns are handed files built from the same fixture and the same
 * stand-in transport, and each keeps its own attempt count per file: the first
 * attempt at any file fails once, so the retry a reader clicks does something
 * real rather than animate. Seeded rows carry the status a first attempt leaves.
 */

/** What a row is doing. Both columns use these three words. */
type FileStatus = 'uploaded' | 'uploading' | 'failed'

interface QueueEntry {
  readonly id: string
  readonly file: File
  /** How many attempts this column has made at this file. */
  readonly attempt: number
}

/**
 * How many files a column lists. The 5,000-row fixture would render 5,000
 * one-line rows in each column, which measures nothing the smaller fixtures do
 * not already measure; the count is still stated, so a capped column does not
 * quietly under-report the fixture.
 */
const MAX_FILES = 12

/** The harness's stand-in for the transport, which stays with the call sites. */
async function transport(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (attempt <= 1) throw new Error('The file store refused this file.')
}

/** A fixture row as the file it stands in for: name length is the hostile axis. */
function fileFor(row: ComparisonRow, index: number): File {
  return new File(
    [`# ${row.name}\n# ${row.unit}\n`, 'x'.repeat((index % 7) * 900)],
    `${row.name.replace(/\s+/g, '-').slice(0, 140)}.csv`,
    { type: 'text/csv' },
  )
}

/**
 * The fixture's files. Every fourth one has been tried once and refused, so the
 * record can show a failure and its retry without a reader having to make one;
 * the rest have been tried twice and landed.
 */
function queueFor(rows: readonly ComparisonRow[]): readonly QueueEntry[] {
  return rows.slice(0, MAX_FILES).map((row, index) => ({
    id: row.id,
    file: fileFor(row, index),
    attempt: index % 4 === 3 ? 1 : 2,
  }))
}

/** "4,988 more files in this fixture are not listed." */
function MoreFiles({ hidden }: { hidden: number }) {
  if (hidden <= 0) return null
  return (
    <p className="m-0 text-caption text-fg-muted" data-comparison-note="capped">
      {hidden.toLocaleString('en-GB')} more files in this fixture are not
      listed.
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* Ours — the shipped picker, frozen                                          */
/* -------------------------------------------------------------------------- */

/**
 * The pre-adoption picker, as the four call sites had it. Kept only as this
 * comparison's baseline: the change that adopts ReUI's item deletes the
 * product's copy. It runs the same transport a live pick would, so its boolean
 * progress line and its one error string are real states of the old surface.
 */
function HandRolledPickerColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [state, setState] = React.useState<'idle' | 'busy' | 'failed'>('idle')
  const [message, setMessage] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  const restricted = scenario.state === 'restricted'

  async function pick() {
    const next = attempt + 1
    setAttempt(next)
    setState('busy')
    setMessage('')
    try {
      await transport(next)
      setState('idle')
    } catch (cause) {
      // The old surface had nowhere to put one file's state, so a failure is a
      // single string, and its retry is the person picking the file again.
      setState('failed')
      setMessage(
        cause instanceof Error ? cause.message : 'Could not upload the file.',
      )
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-comparison-list="ours"
      data-picker="hand-rolled"
    >
      {restricted ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {/* The notebook's dashed box: it looked like a drop target and had no
          drop handler, which is the whole reason the candidate is here. */}
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-muted/20 p-6 text-center">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-md bg-surface text-fg-muted shadow-xs"
        >
          <Icon name="protocol" className="size-5" />
        </span>
        <label className="grid justify-items-center gap-1 text-body font-medium text-fg">
          Laboratory file
          <input
            type="file"
            aria-label="Laboratory file"
            disabled={restricted}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void pick()
              event.target.value = ''
            }}
            className="mx-auto h-auto w-full max-w-xs rounded-none border-0 bg-transparent p-0 text-body shadow-none file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-body file:font-medium hover:file:bg-accent"
          />
        </label>
      </div>
      {state === 'busy' ? (
        <p role="status" className="m-0 text-label text-fg-muted">
          Storing and reading the file…
        </p>
      ) : null}
      {state === 'failed' ? (
        <p role="status" className="m-0 text-label text-danger-text">
          {message}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <p
          className="m-0 text-caption text-fg-muted"
          data-comparison-note="no-queue"
        >
          One file at a time: the shipped picker renders no queue, so this
          fixture&rsquo;s {rows.length.toLocaleString('en-GB')}{' '}
          {rows.length === 1 ? 'file is' : 'files are'} not listed here.
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Theirs — the registry item, composed and restyled                          */
/* -------------------------------------------------------------------------- */

function ReuiFileUploadColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [entries, setEntries] = React.useState<readonly QueueEntry[]>(() =>
    queueFor(rows),
  )
  const [status, setStatus] = React.useState<Record<string, FileStatus>>({})
  const [messages, setMessages] = React.useState<Record<string, string>>({})

  const run = React.useCallback(async (entry: QueueEntry) => {
    setStatus((current) => ({ ...current, [entry.id]: 'uploading' }))
    try {
      await transport(entry.attempt)
      setStatus((current) => ({ ...current, [entry.id]: 'uploaded' }))
      setMessages((current) => ({ ...current, [entry.id]: '' }))
    } catch (cause) {
      setStatus((current) => ({ ...current, [entry.id]: 'failed' }))
      setMessages((current) => ({
        ...current,
        [entry.id]:
          cause instanceof Error ? cause.message : 'Could not upload the file.',
      }))
    }
  }, [])

  const add = React.useCallback(
    (added: readonly FileWithPreview[]) => {
      const files = added.flatMap((entry) =>
        entry.file instanceof File ? [entry.file] : [],
      )
      const queued = files.map((file) => ({
        id: `picked-${file.name}-${String(file.size)}`,
        file,
        attempt: 1,
      }))
      setEntries((current) => [...queued, ...current])
      for (const entry of queued) void run(entry)
    },
    [run],
  )

  const [upload, actions] = useFileUpload({
    multiple: true,
    onFilesAdded: add,
  })

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  const restricted = scenario.state === 'restricted'
  const hidden = Math.max(0, rows.length - MAX_FILES)
  /** Seeded rows carry what a first attempt leaves; live runs write the map. */
  const statusOf = (entry: QueueEntry): FileStatus =>
    status[entry.id] ?? (entry.attempt === 1 ? 'failed' : 'uploaded')

  return (
    <div
      className="flex flex-col gap-2"
      data-comparison-list="theirs"
      data-picker="reui-use-file-upload"
    >
      {restricted ? <ComparisonRestrictedNotice /> : null}
      <div
        data-slot="file-drop"
        data-dragging={upload.isDragging ? 'true' : undefined}
        onDragEnter={actions.handleDragEnter}
        onDragLeave={actions.handleDragLeave}
        onDragOver={actions.handleDragOver}
        onDrop={actions.handleDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-muted/20 p-6 text-center',
          upload.isDragging && 'border-focus bg-surface-muted',
          restricted && 'opacity-70',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-md bg-surface text-fg-muted shadow-xs"
        >
          <Icon name="upload" className="size-5" />
        </span>
        <span className="text-body font-medium text-fg">Laboratory file</span>
        <span className="text-caption text-fg-muted">
          Drop a file here, or choose one. CSV, TSV, Excel, JSON or plain text.
        </span>
        <Button
          size="sm"
          icon="upload"
          disabled={restricted}
          aria-haspopup="dialog"
          onClick={actions.openFileDialog}
        >
          Choose file
        </Button>
        <input
          {...actions.getInputProps({
            disabled: restricted,
            'aria-label': 'Laboratory file',
          })}
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {entries.length === 0 ? (
        <p role="status" className="m-0 text-caption text-fg-muted">
          No files picked yet.
        </p>
      ) : null}

      <ul className="m-0 grid list-none gap-2 p-0">
        {entries.map((entry) => {
          const fileStatus = statusOf(entry)
          return (
            <li
              key={entry.id}
              data-file-id={entry.id}
              data-file-status={fileStatus}
              // `min-w-0`: the list is a grid, and a grid item's automatic
              // minimum size is its content's, so a long file name would keep
              // the row at the name's full width and push the controls out.
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
                    className={
                      fileStatus === 'failed'
                        ? 'text-danger-text'
                        : 'text-fg-muted'
                    }
                  >
                    {messages[entry.id] ||
                      (fileStatus === 'uploading'
                        ? 'Uploading…'
                        : fileStatus === 'uploaded'
                          ? 'Uploaded'
                          : 'Failed')}
                  </span>
                </p>
                {fileStatus === 'uploading' ? (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${entry.file.name}`}
                    className="mt-1.5 h-1 overflow-hidden rounded-full bg-skeleton"
                  >
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-fg-muted" />
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {fileStatus === 'failed' ? (
                  <Button
                    size="sm"
                    disabled={restricted}
                    aria-label={`Retry ${entry.file.name}`}
                    onClick={() => {
                      const next = { ...entry, attempt: entry.attempt + 1 }
                      setEntries((current) =>
                        current.map((item) =>
                          item.id === entry.id ? next : item,
                        ),
                      )
                      void run(next)
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={restricted}
                  aria-label={`Remove ${entry.file.name}`}
                  onClick={() => {
                    actions.removeFile(entry.id)
                    setEntries((current) =>
                      current.filter((item) => item.id !== entry.id),
                    )
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <MoreFiles hidden={hidden} />
    </div>
  )
}

export const fileUploadPair: ComparisonPair = {
  id: 'import-file-upload',
  title: 'File pick and drop',
  job: 'Pick or drop a file, watch its upload, and retry a failure',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — hand-rolled file input (frozen pre-adoption)',
    source:
      'src/components/import/import-flow.tsx, src/components/v3/integrations/ingest-panel.tsx, src/components/v3/settings/parser-settings.tsx, src/components/notebook/block-editor.tsx — deleted by this change; kept here as the baseline',
    Column: HandRolledPickerColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI use-file-upload (base-nova)',
    source:
      'src/components/reui/use-file-upload.ts (registry: @reui/use-file-upload); shipping integration: src/components/v3/ui/file-drop.tsx',
    Column: ReuiFileUploadColumn,
  },
}
