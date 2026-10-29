import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Plus, X } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { detectPreset } from '#/lib/pane-tree'
import type { LayoutPreset } from '#/lib/pane-tree'
import type { SavedLayout, WorkspaceTab } from '#/lib/workspace-state'
import { t } from '#/copy'

const shortcut = (binding: string) => formatShortcut(binding, currentPlatform())

/** A 14px picture of how a preset tiles its panes. */
export function LayoutGlyph({ preset }: { preset: LayoutPreset }) {
  const frame = <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
  const lines: Record<LayoutPreset, string> = {
    single: '',
    'columns-2': 'M7 2.5v9',
    'columns-3': 'M5.2 2.5v9M8.8 2.5v9',
    'primary-context': 'M8.5 2.5v9M8.5 7h4',
    'rows-2': 'M1.5 7h11',
  }
  return (
    <svg
      className="mx-glyph"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      {frame}
      {lines[preset] ? <path d={lines[preset]} /> : null}
    </svg>
  )
}

const PRESETS: {
  preset: LayoutPreset
  label: string
  binding?: string
}[] = [
  {
    preset: 'single',
    label: t('projects.workspaceBar.presets.single'),
    binding: 'mod+shift+enter',
  },
  {
    preset: 'columns-2',
    label: t('projects.workspaceBar.presets.columns2'),
    binding: 'mod+\\',
  },
  {
    preset: 'columns-3',
    label: t('projects.workspaceBar.presets.columns3'),
  },
  {
    preset: 'primary-context',
    label: t('projects.workspaceBar.presets.primaryContext'),
  },
  {
    preset: 'rows-2',
    label: t('projects.workspaceBar.presets.rows2'),
    binding: 'mod+shift+\\',
  },
]

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

  return (
    <div
      className="mx-wsbar"
      role="toolbar"
      aria-label={t('projects.workspaceBar.tabs')}
    >
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
              {editing === tab.id ? (
                <RenameInput
                  initial={tab.name}
                  label={
                    saving === tab.id
                      ? t('projects.workspaceBar.nameLayout')
                      : t('projects.workspaceBar.workspaceName')
                  }
                  onDone={(name) => finish(tab.id, name)}
                  onCancel={() => {
                    setEditing(null)
                    setSaving(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="mx-tab-main"
                  title={
                    isActive ? t('projects.workspaceBar.rename') : undefined
                  }
                  onClick={() => onSwitch(tab.id)}
                  onDoubleClick={() => setEditing(tab.id)}
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
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
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
          <Plus size={14} aria-hidden="true" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mx-ib"
            aria-label={t('projects.workspaceBar.workspaces')}
            title={t('projects.workspaceBar.myLayouts')}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t('projects.workspaceBar.myLayouts')}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {layouts.length === 0 ? (
              <div className="px-2 py-1.5 text-label text-fg-muted">
                {t('projects.workspaceBar.noLayouts')}
              </div>
            ) : (
              layouts.map((layout) => (
                <DropdownMenuItem
                  key={layout.id}
                  onClick={() => onOpenLayout(layout.id)}
                  hint={t('projects.workspaceBar.paneCount', {
                    count: layout.panes.length,
                  })}
                >
                  {layout.name}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t('projects.workspaceBar.teamLayouts')}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {teamLayouts.length === 0 ? (
              <div className="px-2 py-1.5 text-label text-fg-muted">
                {t('projects.workspaceBar.noTeamLayouts')}
              </div>
            ) : (
              teamLayouts.map((layout) => (
                <DropdownMenuItem
                  key={layout.id}
                  onClick={() => onOpenLayout(layout.id)}
                  hint={t('projects.workspaceBar.paneCount', {
                    count: layout.panes.length,
                  })}
                >
                  {layout.name}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onShareLayout}>
              {t('projects.workspaceBar.share', { name: active.name })}
            </DropdownMenuItem>
            {active.layoutId &&
            teamLayouts.some((layout) => layout.id === active.layoutId) ? (
              <DropdownMenuItem
                danger
                onClick={() => onRemoveTeamLayout(active.layoutId!)}
              >
                {t('projects.workspaceBar.unshare', { name: active.name })}
              </DropdownMenuItem>
            ) : null}
            {active.layoutId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  onClick={() => onDeleteLayout(active.layoutId!)}
                >
                  {t('projects.workspaceBar.deleteLayout', {
                    name: active.name,
                  })}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {paneChips}
      <div className="mx-wsr">
        <span
          className="mx-presets"
          role="group"
          aria-label={t('projects.workspaceBar.layoutPresets')}
        >
          {PRESETS.map((item) => {
            const pressed =
              item.preset === 'single'
                ? maximized
                : !maximized && preset === item.preset
            return (
              <button
                key={item.preset}
                type="button"
                className="mx-preset"
                aria-pressed={pressed}
                aria-label={item.label}
                title={
                  item.binding
                    ? t('projects.workspaceBar.shortcutTitle', {
                        label: item.label,
                        shortcut: shortcut(item.binding),
                      })
                    : item.label
                }
                onClick={() => onPreset(item.preset)}
              >
                <LayoutGlyph preset={item.preset} />
              </button>
            )
          })}
        </span>
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
          <Bookmark size={14} aria-hidden="true" />
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
