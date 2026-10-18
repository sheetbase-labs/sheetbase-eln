import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  OursShortcutColumn,
  TheirsShortcutColumn,
} from '#/components/component-compare/pairs/shortcut-keys'
import { findFixture } from '#/components/component-compare/fixtures'
import type { ComparisonColumnProps } from '#/components/component-compare/types'

/**
 * The shortcut-keys pair's structural facts, pinned.
 *
 * The comparison record
 * (`docs/knowledge/design/component-comparison-record.md`, row 4) declines this
 * candidate on "not materially worse" rather than on a missing behaviour, so
 * what is worth pinning is what the two sides actually are: both render
 * `<kbd>` elements, neither puts a cap on the keyboard path, and the candidate
 * adds a wrapping `<kbd data-slot="kbd-group">` around a chord — the only
 * structural difference between them.
 */

const scenario = (fixtureId: string): ComparisonColumnProps['scenario'] => ({
  fixture: findFixture(fixtureId),
  state: 'ready',
  onRetry: () => {},
})

function tabbables(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, a[href], [tabindex]',
    ),
  ].filter(
    (element) =>
      element.getAttribute('tabindex') !== '-1' &&
      !(element as HTMLInputElement).disabled &&
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  )
}

describe('ours: the v3 Kbd', () => {
  it('renders one plain <kbd> per key and nothing focusable', () => {
    const { container } = render(
      <OursShortcutColumn scenario={scenario('single')} />,
    )
    const caps = [...container.querySelectorAll('kbd')]
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.every((cap) => cap.tagName === 'KBD')).toBe(true)
    expect(caps.every((cap) => cap.getAttribute('data-slot') === null)).toBe(
      true,
    )
    expect(tabbables(container)).toEqual([])
  })
})

describe('theirs: the registry kbd', () => {
  it('wraps each chord in its own <kbd> group and adds nothing focusable', () => {
    const { container } = render(
      <TheirsShortcutColumn scenario={scenario('single')} />,
    )
    const groups = [...container.querySelectorAll('[data-slot="kbd-group"]')]
    const caps = [...container.querySelectorAll('[data-slot="kbd"]')]
    // One group per row, holding that row's caps.
    expect(groups).toHaveLength(1)
    expect(caps.length).toBeGreaterThanOrEqual(1)
    expect(groups[0]?.tagName).toBe('KBD')
    for (const cap of caps) {
      expect(cap.tagName).toBe('KBD')
      expect(cap.closest('[data-slot="kbd-group"]')).not.toBeNull()
    }
    expect(tabbables(container)).toEqual([])
  })
})

describe('both columns', () => {
  it('render one chord per fixture row, and nothing for the empty fixture', () => {
    for (const Column of [OursShortcutColumn, TheirsShortcutColumn]) {
      const single = render(<Column scenario={scenario('single')} />)
      expect(single.container.querySelectorAll('[data-row-id]')).toHaveLength(1)

      const longLabels = render(<Column scenario={scenario('long-labels')} />)
      expect(
        longLabels.container.querySelectorAll('[data-row-id]'),
      ).toHaveLength(8)

      const empty = render(<Column scenario={scenario('empty')} />)
      expect(empty.container.querySelectorAll('[data-row-id]')).toHaveLength(0)
    }
  })
})
