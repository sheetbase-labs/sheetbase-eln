import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ImageAnnotation } from '#/lib/image-annotations'
import { ImageAnnotator } from './image-annotator'

afterEach(cleanup)

it('preserves an open draft across refreshes and resets to the latest marks on reopening', () => {
  const mark = (id: string, text: string): ImageAnnotation => ({
    id,
    text,
    kind: 'label',
    x: 0.2,
    y: 0.7,
    color: 'yellow',
  })

  const original = [mark('original', 'Original')]
  const refreshed = [mark('refreshed', 'Refreshed')]
  const save = vi.fn(async () => {})

  const ui = (open: boolean, initial: ImageAnnotation[]) => (
    <ImageAnnotator
      open={open}
      onOpenChange={vi.fn()}
      src="/image.png"
      name="Plate"
      initial={initial}
      onSave={save}
    />
  )

  const { rerender } = render(ui(true, original))

  const originalRow = screen
    .getByRole('button', { name: /Remove.*Original/ })
    .closest('li')

  if (!(originalRow instanceof HTMLElement))
    throw new Error('Missing annotation row')
  fireEvent.click(within(originalRow).getByRole('button'))
  rerender(ui(true, refreshed))
  expect(screen.queryByRole('button', { name: /Remove.*Original/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Remove.*Refreshed/ })).toBeNull()

  rerender(ui(false, refreshed))
  rerender(ui(true, refreshed))
  expect(screen.getByRole('button', { name: /Remove.*Refreshed/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Save annotations/ }))
  expect(save).toHaveBeenCalledWith(refreshed)
})
