import { useState } from 'react'
import { Icon } from '#/components/icons'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import type { LayoutPreset } from '#/lib/pane-tree'
import type { SavedLayout, WorkspaceTab } from '#/lib/workspace-state'
import { t } from '#/copy'

import { WorkspaceLayoutMenu } from './workspace-layout-menu'
import { WorkspacePresets } from './workspace-presets'
import { WorkspaceTabStrip } from './workspace-tabs'

export { LayoutGlyph } from './workspace-presets'

const shortcut = (binding: string) => formatShortcut(binding, currentPlatform())

export function WorkspaceBar({
  tabs,
  activeTabId,
  preset,
  maximized,
  shelfOpen,
  shelfCount,
  layouts,
  onSwitch,
  onClose,
  onNew,
  onRename,
  onPreset,
  onShelf,
  onSave,
  onOpenLayout,
  onDeleteLayout,
  teamLayouts,
  onShareLayout,
  onRemoveTeamLayout,
  paneChips,
}: {
  tabs: WorkspaceTab[]
  activeTabId: string
  preset: LayoutPreset | null
  maximized: boolean
  shelfOpen: boolean
  shelfCount: number
  layouts: SavedLayout[]
  /** Layouts every member of the workspace can open. */
  teamLayouts: SavedLayout[]
  onShareLayout: () => void
  onRemoveTeamLayout: (id: string) => void
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  onPreset: (preset: LayoutPreset) => void
  onShelf: () => void
  onSave: (naming?: string) => void
  onOpenLayout: (id: string) => void
  onDeleteLayout: (id: string) => void
  /** Narrow screens show one pane at a time; chips pick which. */
  paneChips?: React.ReactNode
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const finish = (id: string, name: string) => {
    if (name.trim()) onRename(id, name)

    if (saving === id) onSave(name.trim() || undefined)
    setEditing(null)
    setSaving(null)
  }

  const cancel = () => {
    setEditing(null)
    setSaving(null)
  }

  return (
    <div
      className="mx-wsbar"
      role="toolbar"
      aria-label={t('projects.workspaceBar.tabs')}
    >
      <WorkspaceTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        editingId={editing}
        savingId={saving}
        onSwitch={onSwitch}
        onClose={onClose}
        onStartRename={setEditing}
        onFinishRename={finish}
        onCancelRename={cancel}
      />
      <div className="mx-wsl">
        <button
          type="button"
          className="mx-ib"
          aria-label={t('projects.workspaceBar.newWorkspace')}
          title={t('projects.workspaceBar.newWorkspaceTitle', {
            shortcut: shortcut('mod+t'),
          })}
          onClick={onNew}
        >
          <Icon name="plus" size={14} aria-hidden="true" />
        </button>
        <WorkspaceLayoutMenu
          layouts={layouts}
          teamLayouts={teamLayouts}
          layoutId={active.layoutId}
          layoutName={active.name}
          onOpenLayout={onOpenLayout}
          onShareLayout={onShareLayout}
          onRemoveTeamLayout={onRemoveTeamLayout}
          onDeleteLayout={onDeleteLayout}
        />
      </div>
      {paneChips}
      <div className="mx-wsr">
        <WorkspacePresets
          preset={preset}
          maximized={maximized}
          onPreset={onPreset}
        />
        <span className="mx-vsep" aria-hidden="true" />
        <button
          type="button"
          className="mx-ib"
          aria-pressed={shelfOpen}
          aria-label={
            shelfOpen
              ? t('projects.workspaceBar.hideShelf')
              : t('projects.workspaceBar.showShelf')
          }
          onClick={onShelf}
        >
          <Icon name="bookmark" size={14} aria-hidden="true" />
          {t('projects.workspaceBar.shelf')}
          {shelfCount > 0 ? (
            <span className="mx-count">{shelfCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="mx-ib"
          title={t('projects.workspaceBar.shortcutTitle', {
            label: t('projects.workspaceBar.saveLayout'),
            shortcut: shortcut('mod+s'),
          })}
          onClick={() => {
            if (active.layoutId) {
              onSave()
            } else {
              setSaving(active.id)
              setEditing(active.id)
            }
          }}
        >
          {t('projects.workspaceBar.saveLayout')}
          <span className="mx-kbd">{shortcut('mod+s')}</span>
        </button>
      </div>
    </div>
  )
}
