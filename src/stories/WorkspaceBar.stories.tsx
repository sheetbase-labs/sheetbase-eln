import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LayoutGlyph, WorkspaceBar } from '#/components/workspace/workspace-bar'
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

/** The 14px glyph that shows how each preset tiles its panes. */
export const Glyphs: Story = {
  render: () => (
    <div className="flex gap-3">
      {(
        [
          'single',
          'columns-2',
          'columns-3',
          'primary-context',
          'rows-2',
        ] as LayoutPreset[]
      ).map((preset) => (
        <LayoutGlyph key={preset} preset={preset} />
      ))}
    </div>
  ),
}
