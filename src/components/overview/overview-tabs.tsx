import { useQuery } from '@tanstack/react-query'
import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import type { FileObjectSummary, NotebookBlock } from '#/lib/notebook-data'
import {
  fetchFileObjectsByRecordIds,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { formatFileSize } from '#/lib/format-numbers'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui'
import { ObjectHistoryTimeline } from '#/components/audit'
import {
  fetchRecordTimeline,
  sign002DataClient,
  sign002QueryKeys,
} from '#/lib/sign-002'
import { timelineToAuditEvents } from '#/lib/audit-history'
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
            <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
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
      <TabsContent value="activity">
        <RecordActivityView recordId={recordId} />
      </TabsContent>
      <TabsContent value="files">
        <FilesView blocks={fileBlocks} />
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
  // Collect file record ids once; the batch fetch issues a single PostgREST
  // `in.(...)` query instead of one request per file block (N+1 → 1).
  const fileRecordIds = blocks
    .map((b) => b.payload.fileRecordId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const fileObjectsQuery = useQuery({
    queryKey: notebookQueryKeys.fileObjects(fileRecordIds),
    queryFn: () =>
      fetchFileObjectsByRecordIds(notebookDataClient, fileRecordIds),
    enabled: fileRecordIds.length > 0,
  })

  const fileMap = fileObjectsQuery.data ?? new Map<string, FileObjectSummary>()

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

  const loading = fileObjectsQuery.isLoading
  return (
    <ul
      className="divide-y divide-border rounded-lg border bg-card"
      aria-busy={loading}
    >
      {blocks.map((block) => {
        const payload = block.payload
        const draftName =
          typeof payload.displayName === 'string' ? payload.displayName : ''
        const draftMediaType =
          typeof payload.mediaType === 'string' ? payload.mediaType : ''
        const draftByteSize =
          typeof payload.byteSize === 'number' ? payload.byteSize : 0
        const fileRecordId =
          typeof payload.fileRecordId === 'string' ? payload.fileRecordId : ''

        const fileObj = fileRecordId ? fileMap.get(fileRecordId) : undefined
        const name = fileObj?.displayName ?? (draftName || 'File')
        const mediaType = fileObj?.mediaType ?? draftMediaType
        const byteSize = fileObj?.byteSize ?? draftByteSize
        const status = fileObj?.status ?? null
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

/**
 * Activity tab — GOV-03 object history for the notebook. Renders the
 * authoritative SIGN-002 `record_timeline` aggregate (edits, revisions,
 * submissions, decisions, checks, signatures, comments) through the shared
 * semantic history component. Historical, read-only: live discussion stays
 * in the Discussion surfaces.
 */
function RecordActivityView({ recordId }: { recordId: string }) {
  const timelineQuery = useQuery({
    queryKey: sign002QueryKeys.timeline(recordId),
    queryFn: () => fetchRecordTimeline(sign002DataClient, recordId),
  })

  const permissionDenied =
    timelineQuery.error instanceof Error &&
    /denied|permission/i.test(timelineQuery.error.message)

  return (
    <ObjectHistoryTimeline
      events={timelineToAuditEvents(timelineQuery.data ?? [])}
      loading={timelineQuery.isLoading}
      error={
        timelineQuery.isError
          ? permissionDenied
            ? 'History is not available for this record.'
            : 'History could not be loaded.'
          : null
      }
      maxHeight='40rem'
    />
  )
}
