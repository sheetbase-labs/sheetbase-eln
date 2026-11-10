import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { extensionQueryKeys } from '#/lib/extensions/client'
import { isRichTextPayload } from '#/lib/blocks/rich-text-data'
import type { RichTextPayload } from '#/lib/blocks/rich-text-data'
import { RichTextEditor } from './rich-text-editor'

beforeAll(() => {
  // jsdom has no caret geometry; ProseMirror's DOM interactions still need these APIs.
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(cleanup)

it('keeps the standalone editor mounted while committed content changes', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])

  const payload = (text: string): RichTextPayload => ({
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  })

  const onChange = vi.fn()
  const onBlur = vi.fn()

  const view = (text: string) => (
    <QueryClientProvider client={client}>
      <RichTextEditor
        payload={payload(text)}
        onChange={onChange}
        onBlur={onBlur}
      />
    </QueryClientProvider>
  )

  const { rerender } = render(view('Original observation'))
  const editor = await screen.findByRole('textbox', { name: 'Text content' })
  expect(editor.textContent).toBe('Original observation')

  rerender(view('Updated observation'))
  await waitFor(() => expect(editor.textContent).toBe('Updated observation'))
  expect(screen.getByRole('textbox', { name: 'Text content' })).toBe(editor)
  expect(onChange).not.toHaveBeenCalled()
})

it('keeps keyboard formatting inside the persisted rich-text contract', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])
  const onChange = vi.fn<(payload: RichTextPayload) => void>()
  const user = userEvent.setup()

  render(
    <QueryClientProvider client={client}>
      <RichTextEditor
        payload={{
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Observation' }],
              },
            ],
          },
        }}
        onChange={onChange}
        onBlur={() => {}}
      />
    </QueryClientProvider>,
  )

  const editor = await screen.findByRole('textbox', { name: 'Text content' })
  editor.focus()
  await user.keyboard('{Control>}a{/Control}{Control>}u{/Control}')
  await user.click(screen.getByRole('button', { name: 'Bold' }))

  const saved = onChange.mock.lastCall?.[0]
  expect(saved).toBeDefined()
  expect(isRichTextPayload(saved)).toBe(true)
  expect(editor.textContent).toBe('Observation')
  expect(editor.querySelector('strong')?.textContent).toBe('Observation')
  expect(editor.querySelector('u')).toBeNull()
})
