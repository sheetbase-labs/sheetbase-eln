import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  Button,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'

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
  tabs: InspectorTab[]
  defaultTab?: string
  state?: InspectorState
  onClose?: () => void
  className?: string
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
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Inspector({
  recordType,
  title,
  tabs,
  defaultTab,
  state = 'loaded',
  onClose,
  className,
}: InspectorProps) {
  const initial = defaultTab ?? tabs[0]?.id
  const showTabs = state === 'loaded' && tabs.length > 0

  return (
    <div
      className={cn('flex h-full flex-col bg-background', className)}
      aria-label="Inspector"
    >
      {/* Identity header — always visible */}
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {recordType ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {recordType}
              </p>
            ) : null}
            <h2 className="truncate text-sm font-semibold text-foreground">
              {title}
            </h2>
          </div>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close inspector"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <Separator className="my-3 shrink-0" />

      {/* Scroll region: tabs + content scroll together but the identity
          header above stays pinned. Within it, the TabsList is sticky so it
          remains visible while content scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === 'skeleton' ? (
          <div className="space-y-3 px-4 pb-4">
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
            <div className="sticky top-0 z-10 bg-background px-2 pt-1">
              <TabsList className="w-full justify-start">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    {tab.label}
                    {tab.badge !== undefined ? (
                      <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                        {tab.badge}
                      </span>
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {tabs.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className="mt-0 px-4 pb-6"
              >
                {tab.content}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
      </div>
    </div>
  )
}
