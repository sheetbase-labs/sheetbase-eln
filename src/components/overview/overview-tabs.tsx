import { useQueries } from '@tanstack/react-query'
import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import {
  fetchFileObjectByRecordId,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { formatFileSize } from '#/lib/format-numbers'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui'
import { OverviewBlock, OverviewView } from './overview-view'
import type {
  OverviewMode,
  OverviewRevision,
  OverviewSection,
} from '#/lib/overview'

/**
 * Tabbed sub-nav for the experiment overview (SCI-007, overview mockup).
 *
 * Wraps the composed `OverviewView` (the "Overview" tab) with three
 * read-oriented views:
 * - **Results** — data-heavy blocks (tables, sheets, charts, plate maps,
 *   metrics) rendered full-width without section grouping.
 * - **Files** — file blocks rendered as a clean file list with icons, names,
 *   sizes and download links.
 * - **Activity** — placeholder empty state.
 *
 * The tabs sit at the top of the overview content area, below the record
 * header. All tabs are read-only — no editing, block picker or save status.
 */

/** Block types shown on the Results tab. */
const RESULTS_BLOCK_TYPES = new Set([
  'table',
  'sheet',
  'chart',
  'plate_map',
  'metric',
])

export interface OverviewTabsProps {
  /** Composed sections for the Overview tab. */
  sections: OverviewSection[]
  /** All visible blocks (used to derive Results / Files tab contents). */
  blocks: NotebookBlock[]
  mode: OverviewMode
  revision?: OverviewRevision | null
  excludedBlockIds: readonly string[]
  onToggleBlock?: (blockId: string, exclude: boolean) => void
  projectId: string
  recordId: string
  className?: string
}

export function OverviewTabs({
  sections,
  blocks,
  mode,
  revision,
  excludedBlockIds,
  onToggleBlock,
  projectId,
  recordId,
  className,
}: OverviewTabsProps) {
  const fileBlocks = blocks.filter((b) => b.type === 'file')
  return (
    <Tabs defaultValue="overview" className={cn('space-y-4', className)}>
      <TabsList aria-label="Overview sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="results">Results</TabsTrigger>
        <TabsTrigger value="files">
          Files
          {fileBlocks.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {fileBlocks.length}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewView
          sections={sections}
          mode={mode}
          revision={revision}
          excludedBlockIds={excludedBlockIds}
          onToggleBlock={onToggleBlock}
          projectId={projectId}
          recordId={recordId}
        />
      </TabsContent>

      <TabsContent value="results">
        <ResultsView
          blocks={blocks}
          excludedBlockIds={excludedBlockIds}
          projectId={projectId}
          recordId={recordId}
        />
      </TabsContent>

      <TabsContent value="files">
        <FilesView blocks={fileBlocks} />
      </TabsContent>

      <TabsContent value="activity">
        <ActivityPlaceholder />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------

/**
 * Results tab: data-heavy blocks rendered full-width, in notebook order,
 * without section grouping. Each block reuses the read-only `OverviewBlock`
 * so expand / open-in-notebook affordances stay consistent with the Overview
 * tab.
 */
function ResultsView({
  blocks,
  excludedBlockIds,
  projectId,
  recordId,
}: {
  blocks: NotebookBlock[]
  excludedBlockIds: readonly string[]
  projectId: string
  recordId: string
}) {
  const excluded = new Set(excludedBlockIds)
  const dataBlocks = blocks.filter((b) => RESULTS_BLOCK_TYPES.has(b.type))
  if (dataBlocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">
          No results yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Tables, sheets, charts, plate maps and metrics from this notebook will
          appear here.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {dataBlocks.map((block) => (
        <OverviewBlock
          key={block.id}
          block={block}
          excluded={excluded.has(block.id)}
          showToggle={false}
          projectId={projectId}
          recordId={recordId}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Files tab: file blocks rendered as a clean list with icon, name, size and
 * download link. Resolves the live `file_objects` metadata through the same
 * data client the notebook uses, so status is never stale.
 */
function FilesView({ blocks }: { blocks: NotebookBlock[] }) {
  const fileQueries = useQueries({
    queries: blocks.map((block) => {
      const payload = block.payload
      const fileRecordId =
        typeof payload.fileRecordId === 'string' ? payload.fileRecordId : ''
      return {
        queryKey: notebookQueryKeys.fileObject(fileRecordId || 'unresolved'),
        queryFn: () =>
          fetchFileObjectByRecordId(notebookDataClient, fileRecordId),
        enabled: Boolean(fileRecordId),
        staleTime: 0,
      }
    }),
  })

  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">No files</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Files attached to this notebook will appear here.
        </p>
      </div>
    )
  }

  const loading = fileQueries.some((q) => q.isLoading)
  return (
    <ul
      className="divide-y divide-border rounded-lg border bg-card"
      aria-busy={loading}
    >
      {blocks.map((block, i) => {
        const query = fileQueries[i]
        const payload = block.payload
        const draftName =
          typeof payload.displayName === 'string' ? payload.displayName : ''
        const draftMediaType =
          typeof payload.mediaType === 'string' ? payload.mediaType : ''
        const draftByteSize =
          typeof payload.byteSize === 'number' ? payload.byteSize : 0
        const fileRecordId =
          typeof payload.fileRecordId === 'string' ? payload.fileRecordId : ''

        const name = query.data?.displayName ?? (draftName || 'File')
        const mediaType = query.data?.mediaType ?? draftMediaType
        const byteSize = query.data?.byteSize ?? draftByteSize
        const status = query.data?.status ?? null
        const Icon = fileIconForType(mediaType)

        const body = (
          <>
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            >
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {name}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {mediaType || 'unknown'} · {formatFileSize(byteSize)}
                {status && status !== 'active' ? ` · ${status}` : ''}
              </span>
            </span>
          </>
        )

        return (
          <li key={block.id} className="p-3">
            {fileRecordId && status === 'active' ? (
              <a
                href={`/api/files/${fileRecordId}/download`}
                download
                className="flex items-center gap-3 no-underline transition-colors hover:bg-muted/40 -m-3 p-3"
              >
                {body}
              </a>
            ) : (
              <div className="flex items-center gap-3">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function fileIconForType(mediaType: string): LucideIcon {
  if (mediaType.startsWith('image/')) return FileImage
  if (mediaType === 'application/pdf') return FileText
  if (mediaType.includes('spreadsheet') || mediaType === 'text/csv') {
    return FileSpreadsheet
  }
  if (mediaType.includes('wordprocessing')) return FileText
  return FileIcon
}

// ---------------------------------------------------------------------------

function ActivityPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Paperclip className="size-5" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-foreground">
        Activity feed coming soon
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        A timeline of edits, comments and status changes for this notebook will
        appear here.
      </p>
    </div>
  )
}
