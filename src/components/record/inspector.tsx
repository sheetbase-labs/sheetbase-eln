import { t } from '#/copy'
import * as React from 'react'

import { cn } from '#/lib/utils'

import { InspectorContent } from './inspector-content'
import type { InspectorState } from './inspector-content'
import { InspectorHeader } from './inspector-header'
import type { InspectorTab } from './inspector-tabs'

/** The four honest states, and their words, are the content's own. */
export type { InspectorState } from './inspector-content'

/** A tab's shape belongs to the strip that renders it. */
export type { InspectorTab } from './inspector-tabs'

/**
 * Contextual inspector — the right-hand panel that shows properties, linked
 * records, files, checks, activity and comments for the selected record.
 *
 * The inspector is a content container only; it does not fetch data. Routes
 * pass typed tab content. It owns:
 *   - a stable identity header (record type + title) that stays visible;
 *   - a close control;
 *   - independently scrolling tab content (the header and tabs stay pinned);
 *   - four honest states: skeleton, no-selection, unavailable-record and
 *     permission-denied.
 *
 * Width and the narrow-screen Sheet conversion belong to the surface that
 * renders the column; the inspector itself is a plain column so it works in
 * tests and in any slot. The three parts it is made of live beside it:
 * `inspector-header.tsx`, `inspector-content.tsx` (the states) and
 * `inspector-tabs.tsx`.
 */

export interface InspectorProps {
  /** Record kind shown above the title. */
  recordType?: string
  title: string
  /** Semantic detail shown beside the title, typically a status Badge. */
  status?: React.ReactNode
  tabs: InspectorTab[]
  defaultTab?: string
  state?: InspectorState
  onClose?: () => void
  className?: string
  /** Skip the identity header entirely — tabs are the first element.
   * Used by the notebook inspector where the title is already in the
   * sticky record header above the canvas. */
  hideHeader?: boolean
}

export function Inspector({
  recordType,
  title,
  status,
  tabs,
  defaultTab,
  state = 'loaded',
  onClose,
  className,
  hideHeader = false,
}: InspectorProps) {
  const initial = defaultTab ?? tabs[0]?.id
  const [chosenTab, setActiveTab] = React.useState(initial)

  const activeTab =
    tabs.length === 0
      ? ''
      : (tabs.find((tab) => tab.id === chosenTab) ?? tabs[0]).id

  const showTabs = state === 'loaded' && tabs.length > 0

  return (
    <div
      className={cn('flex h-full min-w-0 flex-col bg-surface', className)}
      aria-label={t('notebook.inspector.ariaLabel')}
    >
      {/* Identity header — omitted when hideHeader is set (e.g. notebook
          inspector where the title is already in the sticky record header) */}
      {!hideHeader ? (
        <InspectorHeader
          recordType={recordType}
          title={title}
          status={status}
          onClose={onClose}
        />
      ) : null}

      {/* The inspector owns the only scroll region; identity and tabs remain pinned. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorContent
          state={state}
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showTabs={showTabs}
          onClose={onClose}
          hideHeader={hideHeader}
        />
      </div>
    </div>
  )
}
