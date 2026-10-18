import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RichTextEditor } from '#/components/notebook/rich-text-editor'
import { EMPTY_RICH_TEXT_PAYLOAD } from '#/lib/blocks/rich-text'
import type { RichTextPayload } from '#/lib/blocks/rich-text'

/**
 * The canonical rich-text editor. It is controlled by its payload and does
 * not persist anything itself (`onChange` hands the payload back), so the
 * wrapper keeps the document in state and typing works in the canvas.
 */
function payload(text: string): RichTextPayload {
  return {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  }
}

const blocksPayload: RichTextPayload = {
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Method' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Cells were incubated at 37 °C for 24 hours, then harvested.',
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Prepare the plate' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Read at 600 nm' }],
              },
            ],
          },
        ],
      },
    ],
  },
}

const meta = {
  title: 'Notebook/Rich text editor',
  component: RichTextEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full rounded-md border border-border p-3">
        <Story />
      </div>
    ),
  ],
  args: {
    payload: payload('Cells were incubated at 37 °C for 24 hours.'),
    onChange: () => {},
    onBlur: () => {},
  },
} satisfies Meta<typeof RichTextEditor>
export default meta
type Story = StoryObj<typeof meta>

/** A paragraph, editable in place with the floating toolbar on selection. */
export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.payload)
    return (
      <RichTextEditor
        {...args}
        payload={value}
        onChange={setValue}
        onBlur={() => {}}
      />
    )
  },
}

/** Headings and lists render as the document's own structure. */
export const StructuredContent: Story = {
  args: { payload: blocksPayload },
}

/** An empty block invites writing through its placeholder. */
export const Empty: Story = {
  args: { payload: { ...EMPTY_RICH_TEXT_PAYLOAD } },
}

/** A prose run's inner rows take no placeholder — the paragraph continues. */
export const NoPlaceholder: Story = {
  args: {
    payload: payload('Continued from the block above.'),
    placeholder: undefined,
  },
}

/** Slash commands are offered inside the editor and reported to the host. */
export const SlashCommands: Story = {
  args: { onSlashCommand: () => {} },
}

/** A collapsed section hides node indexes but keeps them in the payload. */
export const HiddenNodes: Story = {
  args: { payload: blocksPayload, hiddenNodeIndexes: new Set([1, 2]) },
}

/** The editor is not the only writer: the host may open it focused. */
export const AutoFocus: Story = {
  args: { payload: payload(''), autoFocus: true },
}
