// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Sheet, SheetContent } from './sheet'

/**
 * On an iPhone a bottom sheet sits on the home indicator, so it must pad by the
 * safe area (or by `--kb-safe-bottom` while the keyboard hook is running). The
 * assistant's message box has been covered twice when this padding went
 * missing.
 */
describe('SheetContent bottom edge', () => {
  afterEach(cleanup)

  it.each(['auto', 'bottom'] as const)(
    'pads a %s sheet clear of the home indicator',
    (side) => {
      render(
        <Sheet open>
          <SheetContent side={side} title="Panel" data-testid="sheet">
            body
          </SheetContent>
        </Sheet>,
      )
      expect(screen.getByTestId('sheet').className).toContain(
        'pb-[var(--kb-safe-bottom,env(safe-area-inset-bottom))]',
      )
    },
  )
})
