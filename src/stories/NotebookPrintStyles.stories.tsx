import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookPrintStyles } from '#/components/notebook/print-notebook'

/**
 * The print rules the notebook mounts once. It renders a single `<style>`
 * element (no visual output of its own), so the story shows the rules beside
 * a sheet that they act on: the sidebar, inspector and block toolbars are
 * hidden when printing, and page margins and break behaviour are set.
 */
const meta = {
  title: 'Notebook/Print styles',
  component: NotebookPrintStyles,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NotebookPrintStyles>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The rules in context: a printed document hides this chrome. */
export const Applied: Story = {
  render: () => (
    <div className="flex gap-4 p-4">
      <NotebookPrintStyles />
      <aside
        data-slot="sidebar"
        className="w-40 rounded border border-dashed border-border p-3"
      >
        <p className="text-xs text-fg-muted">Sidebar (hidden when printed)</p>
      </aside>
      <article className="flex-1 rounded border border-border p-3">
        <p className="text-sm text-fg">
          The document body prints; the sidebar, inspector and block toolbars do
          not.
        </p>
      </article>
      <aside
        data-slot="inspector"
        className="w-40 rounded border border-dashed border-border p-3"
      >
        <p className="text-xs text-fg-muted">Inspector (hidden when printed)</p>
      </aside>
    </div>
  ),
}
