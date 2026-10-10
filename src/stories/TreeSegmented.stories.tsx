import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Segmented } from '#/components/ui/segmented'
import { Tree, TreeItem } from '#/components/ui/tree'

const meta = {
  title: 'UI/TreeSegmented',
  component: Tree,
  tags: ['autodocs'],
} satisfies Meta<typeof Tree>

export default meta
type Story = StoryObj<typeof meta>

export const Set: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-6">
      <Tree aria-label="Projects" className="rounded-md border p-1">
        <TreeItem icon="folder" count={4}>
          Projects
        </TreeItem>
        <TreeItem depth={1} icon="folder" current href="#">
          AAV9 process transfer
        </TreeItem>
        <TreeItem depth={1} icon="folder" count={2} href="#">
          LVV stability
        </TreeItem>
        <TreeItem icon="folder">Archive</TreeItem>
      </Tree>
      <Segmented
        aria-label="Appearance"
        options={['System', 'Light', 'Dark']}
        icons="monitor|sun|moon"
        value="System"
        onChange={() => {}}
      />
    </div>
  ),
}
