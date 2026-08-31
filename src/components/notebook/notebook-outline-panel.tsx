/**
 * NOTE-02 — Notebook outline: jump-to-section navigation over the document's
 * H2/H3 structure. Purely a projection of rich_text heading nodes; collapsing
 * is presentation state owned by the route, never persisted block data.
 */
import { ChevronsDown, ChevronsUp } from 'lucide-react'

import { Button } from '#/components/ui'
import type { NotebookOutlineEntry } from '#/lib/notebook-outline'

export interface NotebookOutlineControls {
  collapsedSections: ReadonlySet<string>
  onToggleSection: (anchorId: string) => void
  onExpandAllSections: () => void
  onCollapseAllSections: () => void
}

export function NotebookOutlinePanel({
  entries,
  controls,
}: {
  entries: NotebookOutlineEntry[]
  /** Present when the document supports section collapse (live authoring). */
  controls?: NotebookOutlineControls
}) {
  return (
    <div className="space-y-1" data-testid="notebook-outline">
      {controls ? (
        <div className="flex items-center justify-end gap-1 pb-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={controls.onExpandAllSections}
            aria-label="Expand all sections"
          >
            <ChevronsDown className="size-3.5" aria-hidden="true" />
            Expand all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={controls.onCollapseAllSections}
            aria-label="Collapse all sections"
          >
            <ChevronsUp className="size-3.5" aria-hidden="true" />
            Collapse all
          </Button>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          No sections yet. Use Heading 2 / Heading 3 in a text block to build an
          outline; sections appear here for jumping and collapsing.
        </p>
      ) : (
        <nav aria-label="Notebook outline">
          <ul className="space-y-0.5">
            {entries.map((entry) => {
              const collapsed = controls?.collapsedSections.has(entry.anchorId)
              return (
                <li
                  key={entry.anchorId}
                  className={entry.level === 3 ? 'pl-4' : undefined}
                >
                  <a
                    href={`#${entry.anchorId}`}
                    className="block truncate rounded px-1.5 py-1 text-xs text-foreground/90 underline-offset-2 hover:bg-muted hover:underline"
                    title={entry.text}
                  >
                    {entry.text}
                  </a>
                  {collapsed ? (
                    <p
                      className="px-1.5 pb-1 text-[0.65rem] text-muted-foreground"
                      role="status"
                    >
                      Section collapsed
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}
