/**
 * NOTE-02: section collapse and the document-level unsaved-work signal.
 *
 * Both are presentation state owned by the route so the inspector's Outline tab
 * and the canvas stay in sync. Collapse resets when the record or the viewed
 * revision changes — never persisted.
 */
import { useState } from 'react'

import type { NotebookBlock as NotebookBlockDomain } from '#/lib/notebook-data'
import {
  notebookOutline,
  notebookSectionSpans,
  sectionSpanHidesContent,
} from '#/lib/notebook-outline'

export function useNotebookOutline({
  recordId,
  historicalRevisionId,
  canvasBlocks,
}: {
  recordId: string
  historicalRevisionId: string | undefined
  canvasBlocks: NotebookBlockDomain[]
}) {
  // NOTE-04: the document-level unsaved-work signal lives at the route so the
  // submit dialog's readiness checklist reflects unsaved drafts. It mirrors
  // NotebookDocument's own signal; the document re-emits on record change.
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)

  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>())

  const [viewIdentity, setViewIdentity] = useState({
    recordId,
    historicalRevisionId,
  })

  if (
    viewIdentity.recordId !== recordId ||
    viewIdentity.historicalRevisionId !== historicalRevisionId
  ) {
    setViewIdentity({ recordId, historicalRevisionId })
    setHasUnsavedWork(false)
    setCollapsedSections(new Set())
  }

  const toggleSection = (anchorId: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current)

      if (next.has(anchorId)) next.delete(anchorId)
      else next.add(anchorId)

      return next
    })
  }

  const outlineControls = {
    collapsedSections,
    onToggleSection: toggleSection,
    onExpandAllSections: () => setCollapsedSections(new Set()),
    onCollapseAllSections: () => {
      // Only sections that actually own something collapsible can usefully
      // collapse: later blocks (block-granular) or content inside their own
      // rich_text block (same-block node range). An empty span would render
      // a meaningless placeholder.
      const spans = notebookSectionSpans(canvasBlocks)
      setCollapsedSections(
        new Set(
          notebookOutline(canvasBlocks)
            .filter((entry) => {
              const span = spans.get(entry.anchorId)

              return !!span && sectionSpanHidesContent(span)
            })
            .map((entry) => entry.anchorId),
        ),
      )
    },
  }

  return {
    hasUnsavedWork,
    setHasUnsavedWork,
    collapsedSections,
    outlineControls,
  }
}
