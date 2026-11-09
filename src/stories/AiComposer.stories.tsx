import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AiComposer } from '#/components/notebook/ai-composer'

import { screenQueryClient } from './screen-stories'

/**
 * "Write with AI" under a notebook text block. The composer works on the text
 * of a real editor, so each story mounts one. The assistant is never called:
 * the composer renders its idle state, with the quick actions a person starts
 * from, and every answer would need the workspace's assistant.
 */
const client = screenQueryClient()

function Composer({ selection }: { selection: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content:
      '<p>We incubated the plate at 37 °C for 18 hours and read absorbance at 600 nm.</p>',
    immediatelyRender: false,
  })

  if (!editor) return null

  return (
    <QueryClientProvider client={client}>
      <div className="w-[560px] max-w-full">
        <EditorContent editor={editor} className="rounded-md border p-3" />
        <AiComposer editor={editor} selection={selection} onClose={() => {}} />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/AI composer',
  component: Composer,
  tags: ['autodocs'],
  args: { selection: '' },
} satisfies Meta<typeof Composer>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing selected: the quick actions work on the whole block. */
export const WholeBlock: Story = {}

/** Text selected: rewriting acts on the selection only. */
export const WithSelection: Story = {
  args: { selection: 'read absorbance at 600 nm' },
}
