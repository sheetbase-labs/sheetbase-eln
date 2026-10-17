import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { CodeBlock } from '#/components/v3/ui/code-block'

/**
 * A code or payload block: statement, JSON, log — text shown as text. The
 * payload is placed in the tree as a text node and is never interpreted; the
 * language chip names the syntax rather than colouring it, and the copy control
 * hands the payload over.
 */
const meta = {
  title: 'UI/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  args: {
    label: 'Transform statement',
    language: 'sql',
    code: 'select id, mean(value) as mean\nfrom input\nwhere n > 1\ngroup by id',
  },
} satisfies Meta<typeof CodeBlock>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** With no language recorded, the chip is absent rather than guessed. */
export const NoLanguage: Story = {
  args: { language: undefined, label: 'Server response' },
}

/** JSON, bounded: the payload a person pastes into a bug report. */
export const BoundedJson: Story = {
  args: {
    language: 'json',
    label: 'Technical result payload',
    maxHeight: 'sm',
    code: JSON.stringify(
      {
        kind: 'csv',
        rowCount: 3142,
        source: { kind: 's3_object', bucket: 'sheetbase-intake' },
        fileSha256:
          '9f2c1a4b7e8d05f36c1b9a8e7d6c5b4a39281f0e7d6c5b4a39281f0e7d6c5b4a',
      },
      null,
      2,
    ),
  },
}

/** A long single line stays whole and scrolls; the region is focusable. */
export const LongLine: Story = {
  args: {
    label: 'Wide statement',
    code: `select '${'x'.repeat(240)}' as wide`,
  },
}

/** A payload with nothing in it says so instead of showing an empty box. */
export const Empty: Story = { args: { code: '   ' } }

/** Nothing is interpreted: markup in the payload stays text. */
export const MarkupIsText: Story = {
  args: {
    label: 'Untrusted statement',
    code: "select '<script>alert(1)</script>' as {notJsx}",
  },
}
