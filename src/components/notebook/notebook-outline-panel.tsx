/**
 * NOTE-02 — Notebook outline: jump-to-section navigation over the document's
 * H2/H3 structure. Purely a projection of rich_text heading nodes; collapsing
 * is presentation state owned by the route, never persisted block data.
 */
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Icon } from '#/components/v3/icons'
import { InspectorSection } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import type { NotebookOutlineEntry } from '#/lib/notebook-outline'
import {
  SIGNATURE_REQUEST_STATE_LABEL,
  requestedSignatureRows,
} from '#/lib/notebook-action-blocks'
import type {
  ActionBlockContext,
  RequiredSectionEntry,
  RequestedSignatureRow,
} from '#/lib/notebook-action-blocks'
import { SIGNATURE_MEANING_LABEL } from '#/lib/signatures'
import type { NotebookBlock } from '#/lib/notebook-data'

export interface NotebookOutlineControls {
  collapsedSections: ReadonlySet<string>
  onToggleSection: (anchorId: string) => void
  onExpandAllSections: () => void
  onCollapseAllSections: () => void
}

const REQUESTED_TONE: Record<RequestedSignatureRow['state'], Tone> = {
  unassigned: 'warn',
  awaiting: 'none',
  requested: 'none',
  signed: 'ok',
  changed: 'warn',
  superseded: 'warn',
}

export function NotebookOutlinePanel({
  entries,
  controls,
  blocks,
  actionContext,
  requiredSections,
}: {
  entries: NotebookOutlineEntry[]
  /** Present when the document supports section collapse (live authoring). */
  controls?: NotebookOutlineControls
  /**
   * R5-NOTE-02: the same block rows the document renders, so the
   * requested-signature table can never drift from the blocks it describes.
   */
  blocks?: ReadonlyArray<NotebookBlock>
  actionContext?: ActionBlockContext
  /** R5-NOTE-02: the record type's named sections, checked against the blocks. */
  requiredSections?: RequiredSectionEntry[]
}) {
  const requested = blocks ? requestedSignatureRows(blocks, actionContext) : []
  return (
    <div className="space-y-4" data-testid="notebook-outline">
      {controls ? (
        <div className="flex items-center justify-end gap-1 pb-1">
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={controls.onExpandAllSections}
            aria-label="Expand all sections"
          >
            <Icon name="chevronDown" size={14} aria-hidden="true" />
            Expand all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={controls.onCollapseAllSections}
            aria-label="Collapse all sections"
          >
            <Icon
              name="chevronDown"
              size={14}
              className="rotate-180"
              aria-hidden="true"
            />
            Collapse all
          </Button>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState
          icon="schema"
          className="py-2"
          title="No sections yet"
          description="Use Heading 2 / Heading 3 in a text block to build an outline; sections appear here for jumping and collapsing."
        />
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
                    className="block truncate rounded px-1.5 py-1 text-xs text-fg underline-offset-2 hover:bg-surface-hover hover:underline"
                    title={entry.text}
                  >
                    {entry.text}
                  </a>
                  {collapsed ? (
                    <p
                      className="px-1.5 pb-1 text-[0.65rem] text-fg-muted"
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
      {requiredSections && requiredSections.length > 0 ? (
        <InspectorSection title="Required by this record type">
          <ul
            className="m-0 flex list-none flex-col gap-1 p-0 text-label"
            data-testid="required-section-checklist"
          >
            {requiredSections.map((section) => (
              <li
                key={section.label}
                data-section={section.label}
                data-state={section.state}
                className="flex items-center gap-1.5"
              >
                <Icon
                  name={section.state === 'present' ? 'check' : 'x'}
                  size={12}
                  className={
                    section.state === 'present'
                      ? 'text-success-text'
                      : 'text-danger-text'
                  }
                  aria-hidden="true"
                />
                {section.label}
                {section.state === 'missing' ? (
                  <span className="text-danger-text">· missing</span>
                ) : null}
              </li>
            ))}
          </ul>
        </InspectorSection>
      ) : null}
      {blocks ? (
        <InspectorSection
          title={
            requested.length > 0
              ? `Requested signatures (${requested.length})`
              : 'Requested signatures'
          }
        >
          {requested.length === 0 ? (
            <p
              className="m-0 text-label text-fg-muted"
              data-testid="requested-signatures-empty"
            >
              No signature requests. Add a Signature request block to ask
              someone to sign this record.
            </p>
          ) : (
            <ul
              className="m-0 flex list-none flex-col gap-1.5 p-0"
              data-testid="requested-signatures"
            >
              {requested.map((row) => (
                <li
                  key={row.blockId}
                  data-state={row.state}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label"
                >
                  <span className="font-medium">{row.signerLabel}</span>
                  <span className="text-fg-muted">
                    · {SIGNATURE_MEANING_LABEL[row.meaning]}
                  </span>
                  <Status tone={REQUESTED_TONE[row.state]}>
                    {SIGNATURE_REQUEST_STATE_LABEL[row.state]}
                  </Status>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>
      ) : null}
    </div>
  )
}
