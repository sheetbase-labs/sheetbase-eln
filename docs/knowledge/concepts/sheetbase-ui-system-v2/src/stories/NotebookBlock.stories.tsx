import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { NotebookBlock } from '#/components/sheetbase/notebook-block'

const meta = { title: 'Scientific/Notebook block', component: NotebookBlock, tags: ['autodocs'], args: { title: 'Objective', children: <p className="text-sm">Evaluate stability over 28 days.</p> } } satisfies Meta<typeof NotebookBlock>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
