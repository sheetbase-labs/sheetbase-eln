import * as React from 'react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Tabs, TabsList, TabsPanel, TabsTab } from '#/components/v3/ui/tabs'
import { Icon } from '#/components/v3/icons'

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
 * Width and the narrow-screen Sheet conversion are handled by AppShell; the
 * inspector itself is a plain column so it works in tests and in any slot.
 */

export type InspectorState =
  'loaded' | 'skeleton' | 'no-selection' | 'unavailable' | 'permission-denied'

export interface InspectorTab {
  id: string
  label: string
  /** Optional count/label rendered as a badge suffix, e.g. "Members 6". */
  badge?: string | number
  content: React.ReactNode
}

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

function StateBlock({
  icon,
  title,
  hint,
}: {
  icon?: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      {icon}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
    </div>
  )
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
  const showTabs = state === 'loaded' && tabs.length > 0

  return (
    <div
      className={cn('flex h-full min-w-0 flex-col bg-surface', className)}
      aria-label="Inspector"
    >
      {/* Identity header — omitted when hideHeader is set (e.g. notebook
          inspector where the title is already in the sticky record header) */}
      {!hideHeader ? (
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-semibold leading-snug text-fg">
                {title}
              </h2>
              {recordType || status ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
                  {recordType ? <span>{recordType}</span> : null}
                  {status}
                </div>
              ) : null}
            </div>
            {onClose ? (
              <Button
                variant="quiet"
                size="icon"
                className="mt-0.5 shrink-0"
                aria-label="Close inspector"
                onClick={onClose}
              >
                <Icon name="x" size={16} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The inspector owns the only scroll region; identity and tabs remain pinned. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === 'skeleton' ? (
          <div className="space-y-3 px-4 pb-4 pt-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : state === 'no-selection' ? (
          <StateBlock
            title="Nothing selected"
            hint="Choose a record to see its details here."
          />
        ) : state === 'unavailable' ? (
          <StateBlock
            title="Record unavailable"
            hint="It may have been deleted or moved."
          />
        ) : state === 'permission-denied' ? (
          <StateBlock
            title="Permission denied"
            hint="You do not have access to view this record."
          />
        ) : showTabs ? (
          <Tabs defaultValue={initial} className="flex flex-col gap-0">
            <div className="sticky top-0 z-10 flex items-center border-b border-border bg-surface px-5">
              <TabsList className="h-auto w-full justify-start">
                {tabs.map((tab) => (
                  <TabsTab key={tab.id} value={tab.id}>
                    {tab.label}
                    {tab.badge !== undefined ? (
                      <span className="num text-label text-fg-muted">
                        {tab.badge}
                      </span>
                    ) : null}
                  </TabsTab>
                ))}
              </TabsList>
              {hideHeader && onClose ? (
                <Button
                  variant="quiet"
                  size="icon"
                  className="ml-auto shrink-0"
                  aria-label="Close inspector"
                  onClick={onClose}
                >
                  <Icon name="x" size={16} />
                </Button>
              ) : null}
            </div>
            {tabs.map((tab) => (
              <TabsPanel key={tab.id} value={tab.id} className="px-5 pb-6 pt-4">
                {tab.content}
              </TabsPanel>
            ))}
          </Tabs>
        ) : null}
      </div>
    </div>
  )
}
