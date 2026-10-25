import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Plus, X } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { detectPreset } from '#/lib/pane-tree'
import type { LayoutPreset } from '#/lib/pane-tree'
import type { SavedLayout, WorkspaceTab } from '#/lib/workspace-state'

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
  { preset: 'single', label: 'Single pane', binding: 'mod+shift+enter' },
  { preset: 'columns-2', label: 'Two columns', binding: 'mod+\\' },
  { preset: 'columns-3', label: 'Three columns' },
  { preset: 'primary-context', label: 'Primary + context' },
  { preset: 'rows-2', label: 'Two rows', binding: 'mod+shift+\\' },
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
  paneChips,
}: {
  tabs: WorkspaceTab[]
  activeTabId: string
  preset: LayoutPreset | null
  maximized: boolean
  shelfOpen: boolean
  shelfCount: number
  layouts: SavedLayout[]
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
    <div className="mx-wsbar" role="toolbar" aria-label="Workspace tabs">
      <div className="mx-tabs" role="tablist" aria-label="Workspaces">
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
                    saving === tab.id ? 'Name this layout' : 'Workspace name'
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
                  title={isActive ? 'Double-click to rename' : undefined}
                  onClick={() => onSwitch(tab.id)}
                  onDoubleClick={() => setEditing(tab.id)}
                >
                  <LayoutGlyph preset={tabPreset(tab)} />
                  {tab.name}
                  {tab.dirty ? (
                    <>
                      <span className="mx-dirty" aria-hidden="true" />
                      <span className="sr-only">, unsaved changes</span>
                    </>
                  ) : null}
                </button>
              )}
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className="mx-tab-x"
                  aria-label={`Close workspace ${tab.name}`}
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
          aria-label="New workspace"
          title={`New workspace (${shortcut('mod+t')})`}
          onClick={onNew}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mx-ib"
            aria-label="Workspaces"
            title="My layouts"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            <DropdownMenuLabel>My layouts</DropdownMenuLabel>
            {layouts.length === 0 ? (
              <div className="px-2 py-1.5 text-label text-fg-muted">
                Save a layout to open it again here.
              </div>
            ) : (
              layouts.map((layout) => (
                <DropdownMenuItem
                  key={layout.id}
                  onClick={() => onOpenLayout(layout.id)}
                  hint={`${layout.panes.length} ${layout.panes.length === 1 ? 'pane' : 'panes'}`}
                >
                  {layout.name}
                </DropdownMenuItem>
              ))
            )}
            {active.layoutId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  onClick={() => onDeleteLayout(active.layoutId!)}
                >
                  Delete saved layout “{active.name}”
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {paneChips}
      <div className="mx-wsr">
        <span className="mx-presets" role="group" aria-label="Layout presets">
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
                    ? `${item.label} (${shortcut(item.binding)})`
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
          aria-label={shelfOpen ? 'Hide the shelf' : 'Show the shelf'}
          onClick={onShelf}
        >
          <Bookmark size={14} aria-hidden="true" />
          Shelf
          {shelfCount > 0 ? (
            <span className="mx-count">{shelfCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="mx-ib"
          title={`Save layout (${shortcut('mod+s')})`}
          onClick={() => {
            if (active.layoutId) {
              onSave()
            } else {
              setSaving(active.id)
              setEditing(active.id)
            }
          }}
        >
          Save layout
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
