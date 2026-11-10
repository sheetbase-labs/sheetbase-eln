import * as React from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { OverflowTabs } from '#/components/ui/overflow-tabs'
import { TabsRoot, TabsPanel } from '#/components/ui/tabs'

import { Icon } from '#/components/icons'

/** One tab of the inspector: its identity, its label and what it shows. */
export interface InspectorTab {
  id: string
  label: string
  /** Optional count/label rendered as a badge suffix, e.g. "Members 6". */
  badge?: string | number
  content: React.ReactNode
}

/**
 * The inspector's tab strip and panels. The strip is pinned to the top of the
 * scroll region so switching tabs never moves it, and the close control rides
 * with it when the identity header is not rendered.
 */
export function InspectorTabs({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  hideHeader,
}: {
  tabs: InspectorTab[]
  activeTab: string
  onTabChange: (tab: string) => void
  onClose?: () => void
  hideHeader: boolean
}) {
  return (
    <TabsRoot
      value={activeTab}
      onValueChange={(next) => onTabChange(String(next))}
      className="flex flex-col gap-0"
    >
      <div className="sticky top-0 z-10 flex items-center border-b border-border bg-surface px-4">
        <OverflowTabs
          items={tabs.map((tab) => ({
            value: tab.id,
            label: tab.label,
            count: tab.badge,
          }))}
          value={activeTab}
          onValueChange={onTabChange}
        />
        {hideHeader && onClose ? (
          <Button
            variant="quiet"
            size="icon"
            className="ml-auto shrink-0"
            aria-label={t('notebook.inspector.closeInspectorAriaLabel')}
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
    </TabsRoot>
  )
}
