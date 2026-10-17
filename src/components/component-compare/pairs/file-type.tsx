import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { FileType, getFileType } from '#/components/reui/file-type'
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
 * Pair — file type icon and file row metadata.
 *
 * Ours (the before side): the resolver deleted by this change from
 * `src/components/record/inspector-sections.tsx` at `35423ec2` — MIME-first,
 * four shapes (`table`/`download`/`box`/`download`), colours from
 * `text-success-text`, `text-danger-text`, `text-link` and `text-fg-muted`, and
 * a bare Lucide-family icon whose type is never stated in words. It is kept
 * here only as this comparison's before column; product code no longer
 * imports or contains it.
 *
 * Theirs (the after side): the adopted `@reui/file-type` item
 * (`src/components/reui/file-type.tsx`, registry `@reui/file-type` at the
 * base-nova pin, palette classes restyled to app tokens), rendered through the
 * shipped row: `FileList` resolves the name first and the media type only when
 * the name carries no type, so `stability-run07.xlsx` no longer falls through
 * to a generic glyph because its stored MIME type is `application/octet-stream`.
 *
 * Both columns are handed the same fixture object. The fixture's rows are
 * scientific samples, not files, so the pair maps a row to a file
 * deterministically: the row's name is the file name with a fixed extension
 * cycle appended, its unit is the stored media type (long in the long-labels
 * fixture), and its value is the byte size. The cycle is the same for both
 * columns, so the comparison stays like-for-like; it exists because the fixed
 * fixture set has no file names in it, and it is stated here and in the
 * comparison record rather than hidden.
 */

const EXTENSION_CYCLE = [
  '.pdf',
  '.xlsx',
  '.png',
  '.csv',
  '.zip',
  '.docx',
  '.unknown-type',
] as const

interface FileRow {
  id: string
  name: string
  mediaType: string
  size?: string
}

/** One fixture row as a file row; the same object feeds both columns. */
function filesFor(rows: readonly ComparisonRow[]): FileRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    name: `${row.name}${EXTENSION_CYCLE[index % EXTENSION_CYCLE.length]}`,
    mediaType: row.unit,
    size:
      typeof row.value === 'number'
        ? formatFileSize(Math.abs(row.value))
        : row.value === null
          ? undefined
          : String(row.value),
  }))
}

/**
 * The deleted resolver, verbatim: MIME-or-extension to an icon and a colour.
 * Nothing outside this file imports it.
 */
function legacyFileTypeIcon(mediaType?: string): {
  icon: IconName
  className: string
} {
  const mt = (mediaType ?? '').toLowerCase()
  if (
    mt.includes('spreadsheet') ||
    mt.includes('excel') ||
    mt.includes('csv') ||
    mt.endsWith('.xlsx') ||
    mt.endsWith('.csv') ||
    mt.endsWith('.tsv')
  ) {
    return { icon: 'table', className: 'text-success-text' }
  }
  if (mt.includes('pdf') || mt.endsWith('.pdf')) {
    return { icon: 'download', className: 'text-danger-text' }
  }
  if (
    mt.includes('image') ||
    mt.endsWith('.png') ||
    mt.endsWith('.jpg') ||
    mt.endsWith('.jpeg') ||
    mt.endsWith('.gif') ||
    mt.endsWith('.webp') ||
    mt.endsWith('.svg')
  ) {
    return { icon: 'box', className: 'text-link' }
  }
  if (mt.includes('text') || mt.endsWith('.txt') || mt.endsWith('.md')) {
    return { icon: 'download', className: 'text-fg-muted' }
  }
  return { icon: 'download', className: 'text-fg-muted' }
}

/** Ours: the row as it read before this change. */
function LegacyFileRows({ scenario }: ComparisonColumnProps) {
  const files = filesFor(scenario.fixture.rows)
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {files.length === 0 ? <ComparisonEmptyState /> : null}
      <ul className="m-0 list-none space-y-0.5 p-0">
        {files.map((file) => {
          const { icon, className } = legacyFileTypeIcon(
            file.mediaType || file.name,
          )
          return (
            <li key={file.id} className="flex items-center gap-2 px-1.5 py-1">
              <Icon
                name={icon}
                size={14}
                className={cn('shrink-0', className)}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                {file.name}
              </span>
              {file.size ? (
                <span className="shrink-0 text-[0.65rem] tabular-nums text-fg-muted">
                  {file.size}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Theirs: the adopted item in the shipped row. */
function AdoptedFileRows({ scenario }: ComparisonColumnProps) {
  const files = filesFor(scenario.fixture.rows)
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {files.length === 0 ? <ComparisonEmptyState /> : null}
      <ul className="m-0 list-none space-y-0.5 p-0">
        {files.map((file) => (
          <li key={file.id} className="flex items-center gap-2 px-1.5 py-1">
            <FileType
              type={getFileType(file.name)}
              size="mini"
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
              {file.name}
            </span>
            {file.size ? (
              <span className="shrink-0 text-[0.65rem] tabular-nums text-fg-muted">
                {file.size}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export const fileTypePair: ComparisonPair = {
  id: 'file-type',
  title: 'File row: icon resolvers and file metadata',
  job: 'Resolve a file name or media type to a type icon, in a file row',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — the deleted inspector resolver (before)',
    source:
      'src/components/record/inspector-sections.tsx at 35423ec2 (deleted by this change)',
    Column: LegacyFileRows,
  },
  theirs: {
    id: 'theirs',
    label: "Theirs — @reui/file-type, as shipped in the inspector's file row",
    source: 'src/components/reui/file-type.tsx (registry: @reui/file-type)',
    Column: AdoptedFileRows,
  },
}
