import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LayoutGlyph, WorkspaceBar } from '#/components/workspace/workspace-bar'
import { WorkspaceLayoutMenu } from '#/components/workspace/workspace-layout-menu'
import { WorkspacePresets } from '#/components/workspace/workspace-presets'
import { WorkspaceTabStrip } from '#/components/workspace/workspace-tabs'
import type { LayoutPreset } from '#/lib/pane-tree'
import { LAYOUTS, TABS } from './workspace-fixtures'

/**
 * The workspace's tab strip: one tab per arrangement of panes, a layout preset
 * picker, the shelf toggle and saved or team layouts. Double-click a tab to
 * rename it.
 */
const meta = {
  title: 'Workspace/Bar',
  component: WorkspaceBar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    tabs: TABS,
    activeTabId: 'tab-1',
    preset: 'columns-2',
    maximized: false,
    shelfOpen: false,
    shelfCount: 2,
    layouts: LAYOUTS,
    teamLayouts: [],
    onShareLayout: () => {},
    onRemoveTeamLayout: () => {},
    onSwitch: () => {},
    onClose: () => {},
    onNew: () => {},
    onRename: () => {},
    onPreset: () => {},
    onShelf: () => {},
    onSave: () => {},
    onOpenLayout: () => {},
    onDeleteLayout: () => {},
  },
} satisfies Meta<typeof WorkspaceBar>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SingleTab: Story = { args: { tabs: TABS.slice(0, 1) } }

export const ShelfOpen: Story = { args: { shelfOpen: true, shelfCount: 3 } }

export const TeamLayouts: Story = { args: { teamLayouts: LAYOUTS } }

/** Every preset the layout menu offers. */
const GLYPH_PRESETS: readonly LayoutPreset[] = [
  'single',
  'columns-2',
  'columns-3',
  'primary-context',
  'rows-2',
]

/** The 14px glyph that shows how each preset tiles its panes. */
export const Glyphs: Story = {
  render: () => (
    <div className="flex gap-3">
      {GLYPH_PRESETS.map((preset) => (
        <LayoutGlyph key={preset} preset={preset} />
      ))}
    </div>
  ),
}

const noop = () => {}

/** The tab strip on its own: an active tab, a dirty tab and its close button. */
export const TabStrip: Story = {
  render: () => (
    <div className="mx-wsbar">
      <WorkspaceTabStrip
        tabs={TABS}
        activeTabId="tab-2"
        editingId={null}
        savingId={null}
        onSwitch={noop}
        onClose={noop}
        onStartRename={noop}
        onFinishRename={noop}
        onCancelRename={noop}
      />
    </div>
  ),
}

/** A tab renamed in place; the bar opens this state on double-click. */
export const RenameTab: Story = {
  render: () => (
    <div className="mx-wsbar">
      <WorkspaceTabStrip
        tabs={TABS}
        activeTabId="tab-1"
        editingId="tab-1"
        savingId={null}
        onSwitch={noop}
        onClose={noop}
        onStartRename={noop}
        onFinishRename={noop}
        onCancelRename={noop}
      />
    </div>
  ),
}

/** The saved and team layouts menu, opened from its trigger. */
export const LayoutMenu: Story = {
  render: () => (
    <div className="mx-wsbar">
      <WorkspaceLayoutMenu
        layouts={LAYOUTS}
        teamLayouts={LAYOUTS}
        layoutId="layout-1"
        layoutName="Review and data"
        onOpenLayout={noop}
        onShareLayout={noop}
        onRemoveTeamLayout={noop}
        onDeleteLayout={noop}
      />
    </div>
  ),
}

/** The preset picker with the two-column tiling pressed. */
export const Presets: Story = {
  render: () => (
    <div className="mx-wsbar">
      <WorkspacePresets preset="columns-2" maximized={false} onPreset={noop} />
    </div>
  ),
}
