import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Tree, TreeItem } from '#/components/v3/ui/tree'

/**
 * Folders inside a project: two levels at most, and the current folder carries
 * `aria-current="page"` like the main navigation. `Tree` is the labelled `nav`,
 * `TreeItem` a folder that is either a destination (`link`) or a toggle
 * (`onClick`).
 */
const meta = {
  title: 'v3 kit/Tree',
  component: Tree,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: null },
} satisfies Meta<typeof Tree>
export default meta
type Story = StoryObj<typeof meta>

/** The project outline as the left rail renders it, one folder current. */
export const Default: Story = {
  render: () => (
    <div className="w-[260px]">
      <Tree>
        <TreeItem link={{ to: '/projects' }} count={12}>
          Overview
        </TreeItem>
        <TreeItem current link={{ to: '/projects' }} count={84}>
          Notebooks
        </TreeItem>
        <TreeItem link={{ to: '/projects' }} icon="flask" count={7}>
          Experiments
        </TreeItem>
        <TreeItem link={{ to: '/projects' }} icon="table" count={19}>
          Datasets
        </TreeItem>
      </Tree>
    </div>
  ),
}

/** A second level, indented, for the folders inside the current one. */
export const Nested: Story = {
  render: () => (
    <div className="w-[260px]">
      <Tree label="Notebook folders">
        <TreeItem current link={{ to: '/projects' }} count={4}>
          Notebooks
        </TreeItem>
        <TreeItem depth={1} link={{ to: '/projects' }} count={2}>
          Assays
        </TreeItem>
        <TreeItem depth={1} current link={{ to: '/projects' }} count={1}>
          Process development
        </TreeItem>
        <TreeItem depth={1} link={{ to: '/projects' }} count={1}>
          Scale-up
        </TreeItem>
      </Tree>
    </div>
  ),
}

/** A folder that filters the list in place is a button, not a destination. */
export const ToggleItem: Story = {
  render: () => (
    <div className="w-[260px]">
      <Tree label="Saved views">
        <TreeItem icon="filter" count={6} onClick={() => {}}>
          Mine
        </TreeItem>
        <TreeItem icon="clock" count={3} onClick={() => {}}>
          Recently updated
        </TreeItem>
        <TreeItem icon="archive" count={41} onClick={() => {}}>
          Archived
        </TreeItem>
      </Tree>
    </div>
  ),
}
