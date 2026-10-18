import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { BlockEditor } from '#/components/notebook/block-editor'
import { EMPTY_RICH_TEXT_PAYLOAD } from '#/lib/blocks/rich-text'
import type { SaveResult } from '#/components/notebook/use-autosave'
import type { NotebookBlock } from '#/lib/notebook-data'

/**
 * The per-block editor. It owns the autosave state machine and writes only
 * through `save`, so the stories supply a save that resolves — the one input
 * the editor cannot supply itself. `onStatusChange` reports the machine's
 * state, which the stories show beside the block.
 */
function prose(text: string): NotebookBlock {
  return {
    id: '0198d970-e266-4000-8000-0000000000b1',
    recordId: '0198d970-e266-4000-8000-0000000000a1',
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    },
    payloadSchemaVersion: 1,
    order: 0,
    version: 1,
  }
}

async function save(): Promise<SaveResult<Record<string, unknown>>> {
  return { ok: true }
}

const meta = {
  title: 'Notebook/Block editor',
  component: BlockEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full rounded-md border border-border p-3">
        <Story />
      </div>
    ),
  ],
  args: { block: prose('Cells were incubated at 37 °C for 24 hours.'), save },
} satisfies Meta<typeof BlockEditor>
export default meta
type Story = StoryObj<typeof meta>

/** A prose block, editing in place. */
export const RichText: Story = {}

/** The first editable row of a document takes focus with a caret hint. */
export const AutoFocus: Story = {
  args: { autoFocus: true, caretHint: 'start' },
}

/** An empty row invites writing through its placeholder. The payload is the
 * registry's own empty document, so the editor treats it as writable rather
 * than falling back to the read-only preview. */
export const EmptyBlock: Story = {
  args: { block: { ...prose(''), payload: { ...EMPTY_RICH_TEXT_PAYLOAD } } },
}

/** Offline holds saves; the block says so rather than losing the edit. */
export const Offline: Story = { args: { offline: true } }

/** Read-only: the block renders its content, uneditable. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** A save that fails is reported by the editor's own state machine. */
export const SaveFails: Story = {
  args: {
    save: async () => ({
      ok: false,
      kind: 'transient',
      message: 'The save could not reach the server.',
    }),
  },
}
