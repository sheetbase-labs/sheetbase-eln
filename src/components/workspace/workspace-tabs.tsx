import { useEffect, useRef } from 'react'
import { Icon } from '#/components/icons'
import { detectPreset } from '#/lib/pane-tree'
import type { LayoutPreset } from '#/lib/pane-tree'
import type { WorkspaceTab } from '#/lib/workspace-state'
import { t } from '#/copy'

import { LayoutGlyph } from './workspace-presets'

/**
 * The tab strip: one tab per arrangement of panes, each renamed in place when
 * the bar hands down the id being edited.
 */
export function WorkspaceTabStrip({
  tabs,
  activeTabId,
  editingId,
  savingId,
  onSwitch,
  onClose,
  onStartRename,
  onFinishRename,
  onCancelRename,
}: {
  tabs: WorkspaceTab[]
  activeTabId: string
  editingId: string | null
  /** The tab id being renamed to save its layout rather than to rename it. */
  savingId: string | null
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onStartRename: (id: string) => void
  onFinishRename: (id: string, name: string) => void
  onCancelRename: () => void
}) {
  return (
    <div
      className="mx-tabs"
      role="tablist"
      aria-label={t('projects.workspaceBar.workspaces')}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={isActive ? 'mx-tab is-active' : 'mx-tab'}
            data-workspace-tab={tab.id}
          >
            {editingId === tab.id ? (
              <RenameInput
                initial={tab.name}
                label={
                  savingId === tab.id
                    ? t('projects.workspaceBar.nameLayout')
                    : t('projects.workspaceBar.workspaceName')
                }
                onDone={(name) => onFinishRename(tab.id, name)}
                onCancel={onCancelRename}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="mx-tab-main"
                title={isActive ? t('projects.workspaceBar.rename') : undefined}
                onClick={() => onSwitch(tab.id)}
                onDoubleClick={() => onStartRename(tab.id)}
              >
                <LayoutGlyph preset={tabPreset(tab)} />
                {tab.name}
                {tab.dirty ? (
                  <>
                    <span className="mx-dirty" aria-hidden="true" />
                    <span className="sr-only">
                      {t('projects.workspaceBar.unsaved')}
                    </span>
                  </>
                ) : null}
              </button>
            )}
            {tabs.length > 1 ? (
              <button
                type="button"
                className="mx-tab-x"
                aria-label={t('projects.workspaceBar.closeWorkspace', {
                  name: tab.name,
                })}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="x" size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function tabPreset(tab: WorkspaceTab): LayoutPreset {
  return detectPreset(tab.tree) ?? 'columns-2'
}

function RenameInput({
  initial,
  label,
  onDone,
  onCancel,
}: {
  initial: string
  label: string
  onDone: (name: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  const done = (name: string) => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={initial}
      className="h-6 w-36 rounded-sm border border-border-strong bg-surface px-1.5 text-[12px] outline-none focus:border-primary"
      onBlur={(event) => done(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') done(event.currentTarget.value)

        if (event.key === 'Escape') {
          finished.current = true
          onCancel()
        }
      }}
    />
  )
}
