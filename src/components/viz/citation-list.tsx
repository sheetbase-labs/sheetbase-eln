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
import { Link } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import type { AnalysisViewCitation } from '#/lib/analysis-studio-data'
import { formatDate } from '#/lib/format-date'

export interface CitationListProps {
  citations: AnalysisViewCitation[]
  loading?: boolean
  error?: string | null
  /** Body for the empty state; callers state why nothing cites the analysis. */
  emptyBody?: string
}

function citationState(citation: AnalysisViewCitation): {
  tone: 'ok' | 'warn' | 'draft'
  label: string
} {
  if (citation.signed) return { tone: 'ok', label: 'Signed' }
  if (citation.locked) return { tone: 'warn', label: 'Locked' }
  return { tone: 'draft', label: 'Draft' }
}

export function CitationList({
  citations,
  loading = false,
  error = null,
  emptyBody = 'No record cites this analysis yet.',
}: CitationListProps) {
  if (loading) {
    return (
      <p role="status" className="text-label text-fg-muted">
        Reading citations…
      </p>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-label text-warning-text">
        Citations could not be read: {error}
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
  return (
    <Table aria-label="Records citing this analysis" data-density="compact">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Citing record</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Cited</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {citations.map((citation) => {
          const state = citationState(citation)
          return (
            <TableRow key={citation.linkId} data-citation-id={citation.linkId}>
              <TableCell>
                <Link
                  to="/records/$recordId"
                  params={{ recordId: citation.sourceRecordId }}
                  className="text-link"
                >
                  <span className="mono">{citation.identifier}</span>{' '}
                  {citation.title}
                </Link>
              </TableCell>
              <TableCell>
                <Status tone={state.tone}>{state.label}</Status>
              </TableCell>
              <TableCell className="text-fg-muted">
                {formatDate(citation.linkedAt)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
