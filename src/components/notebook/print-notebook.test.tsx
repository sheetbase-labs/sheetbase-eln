/**
 * The notebook's print stylesheet. The buttons that used to sit beside it are
 * items in the record header's overflow menu now, so only the stylesheet is
 * tested here.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NotebookPrintStyles } from './print-notebook'

afterEach(() => cleanup())

describe('NotebookPrintStyles', () => {
  it('hides chrome on paper and keeps a block from splitting across pages', () => {
    const { container } = render(<NotebookPrintStyles />)
    const css = container.querySelector('style')?.textContent ?? ''
    expect(css).toContain('@media print')
    // The inspector carries the record's provenance on screen, and print hides
    // it, which is why the header prints its own copy.
    expect(css).toContain('[data-slot="inspector"]')
    expect(css).toContain('[data-print-hide]')
    expect(css).toContain('break-inside: avoid')
  })
})
