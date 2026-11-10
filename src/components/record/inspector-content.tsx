import * as React from 'react'

import { t } from '#/copy'
import { Skeleton } from '#/components/ui/skeleton'

import { InspectorTabs } from './inspector-tabs'
import type { InspectorTab } from './inspector-tabs'

/**
 * What the inspector is showing, when there is nothing to tab through: a
 * skeleton while it loads, nothing selected, a record that is gone, or one this
 * person may not read. Each is a state with its own words rather than an empty
 * panel, and the panel says which.
 */
export type InspectorState =
  'loaded' | 'skeleton' | 'no-selection' | 'unavailable' | 'permission-denied'

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

export function InspectorContent({
  state,
  tabs,
  activeTab,
  onTabChange,
  showTabs,
  onClose,
  hideHeader,
}: {
  state: InspectorState
  tabs: InspectorTab[]
  activeTab: string
  onTabChange: (tab: string) => void
  showTabs: boolean
  onClose?: () => void
  hideHeader: boolean
}) {
  if (state === 'skeleton')
    return (
      <div className="space-y-3 px-4 pb-4 pt-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    )

  if (state === 'no-selection')
    return (
      <StateBlock
        title={t('common.states.nothingSelected')}
        hint={t('notebook.inspector.hint')}
      />
    )

  if (state === 'unavailable')
    return (
      <StateBlock
        title={t('notebook.inspector.title')}
        hint={t('notebook.inspector.itMayHaveBeenHint')}
      />
    )

  if (state === 'permission-denied')
    return (
      <StateBlock
        title={t('notebook.inspector.permissionDeniedTitle')}
        hint={t('notebook.inspector.youDoNotHaveHint')}
      />
    )

  if (!showTabs) return null

  return (
    <InspectorTabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      onClose={onClose}
      hideHeader={hideHeader}
    />
  )
}
