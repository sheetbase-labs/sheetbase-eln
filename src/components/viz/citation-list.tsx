/**
 * R5-STUDIO-03 — the list of records that cite a saved analysis.
 *
 * A citation is an existing citation record: a `record_links` row with
 * `link_type`/`target_kind` = 'analysis' whose `target_identifier` is the
 * analysis's stable `display_id`. The list is read through
 * `api.analysis_view_citations`, so the signed/locked state of each citing
 * record comes from the same canonical records the review surfaces use rather
 * than from a client-side guess.
 *
 * Honest states: an explicit empty state when nothing cites the analysis, a
 * loading state, a failed-read state, and — per row — signed, locked or draft.
 * A cited analysis cannot change the sources it cited; this panel is how a
 * reader sees why.
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { AnalysisViewCitation } from '#/lib/analysis-studio-data'
import { formatDate } from '#/lib/format-date'

export interface CitationListProps {
  citations: AnalysisViewCitation[]
  loading?: boolean
  error?: string | null
  /** Body for the empty state; callers state why nothing cites the analysis. */
  emptyBody?: string
}

function citationState(citation: AnalysisViewCitation) {
  if (citation.signed)
    return { tone: 'ok', label: t('data.citationList.signed') } satisfies {
      tone: Tone
      label: string
    }

  if (citation.locked)
    return { tone: 'warn', label: t('data.citationList.locked') } satisfies {
      tone: Tone
      label: string
    }

  return { tone: 'draft', label: t('data.citationList.draft') } satisfies {
    tone: Tone
    label: string
  }
}

function CitationGrid({ citations }: { citations: AnalysisViewCitation[] }) {
  const columns = useMemo<RegistryColumn<AnalysisViewCitation>[]>(
    () => [
      {
        id: 'citing',
        header: t('data.citationList.citingRecord'),
        accessorFn: (citation) => `${citation.identifier} ${citation.title}`,
        enableHiding: false,
        cell: ({ row }) => (
          <Link
            to="/records/$recordId"
            params={{ recordId: row.original.sourceRecordId }}
            className="text-link"
          >
            <span className="mono">{row.original.identifier}</span>{' '}
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'state',
        header: t('data.citationList.state'),
        accessorFn: (citation) => citationState(citation).label,
        cell: ({ row }) => {
          const state = citationState(row.original)

          return <Status tone={state.tone}>{state.label}</Status>
        },
      },
      {
        id: 'cited',
        header: t('data.citationList.cited'),
        accessorFn: (citation) => citation.linkedAt,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.linkedAt)}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <RegistryGrid
      label={t('data.citationList.ariaRecordsCitingAnalysis')}
      rows={citations}
      columns={columns}
      getRowId={(citation) => citation.linkId}
      selectable={false}
    />
  )
}

export function CitationList({
  citations,
  loading = false,
  error = null,
  emptyBody = t('data.citationList.recordCitesAnalysisYet'),
}: CitationListProps) {
  if (loading) {
    return (
      <p role="status" className="text-label text-fg-muted">
        {t('data.citationList.readingCitations')}
      </p>
    )
  }

  if (error) {
    return (
      <p role="alert" className="text-label text-warning-text">
        {t('data.citationList.citationsCouldRead', { error })}
      </p>
    )
  }

  if (citations.length === 0) {
    return (
      <p className="text-label text-fg-muted" data-citations-empty>
        {emptyBody}
      </p>
    )
  }

  return <CitationGrid citations={citations} />
}
