/**
 * The shared Checkbox. Every call site wraps it in a `<label>` that carries the
 * visible text, so the control must be the element that label labels — Base
 * UI's default `<span>` left the label pointing at the visually hidden input
 * and the control with no accessible name.
 */
import { readFileSync } from 'node:fs'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { contrastRatio, oklchToSrgb } from '#/lib/contrast'
import type { Oklch } from '#/lib/contrast'
import { Checkbox } from './checkbox'

afterEach(cleanup)

describe('Checkbox', () => {
  it('is the control its wrapping label labels', () => {
    render(
      <label>
        <Checkbox />
        Start the experiment now
      </label>,
    )

    const box = screen.getByRole('checkbox')
    expect(box.closest('label')?.control).toBe(box)
    expect(
      screen.getByRole('checkbox', { name: 'Start the experiment now' }),
    ).toBe(box)
  })

  it('toggles from the control and from the label text', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <label>
        <Checkbox onCheckedChange={onCheckedChange} />
        Start the experiment now
      </label>,
    )

    await user.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())

    await user.click(screen.getByText('Start the experiment now'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(false, expect.anything())
  })

  it('toggles with the keyboard when it has focus', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox onCheckedChange={onCheckedChange} aria-label="Approve" />)

    await user.tab()
    const box = screen.getByRole('checkbox')
    expect(document.activeElement).toBe(box)
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
  })
})

// --- What the mixed state paints -------------------------------------------
// The bug this guards was paint, not structure: the control reported
// `aria-checked="mixed"` and rendered its tick, but the box kept `bg-surface`
// while the tick inherited `text-on-accent`, so a white mark sat on a white box
// and a partly selected grid's header checkbox looked empty.
//
// jsdom does not run Tailwind, so the colours are resolved the way the cascade
// would resolve them. Every rule for every state is in the class list at once,
// and a `data-*` variant applies when the element carries that attribute, which
// is the attribute Base UI sets; the last applicable class wins, because
// Tailwind emits variant classes after the utility they refine. The values come
// from `src/styles.css`: `@theme inline` maps the utility to a token, and
// `:root` (or `.dark`) declares that token.

const styles = readFileSync('src/styles.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Every declaration in every block of that selector, later blocks winning. */
function declarations(selector: string): Map<string, string> {
  const found = new Map<string, string>()
  let from = 0
  for (;;) {
    const start = styles.indexOf(`${selector} {`, from)
    if (start === -1) break
    const end = styles.indexOf('}', start)
    for (const match of styles
      .slice(start, end)
      .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      found.set(match[1], match[2].trim())
    }
    from = end
  }
  expect(
    found.size,
    `${selector} declarations in src/styles.css`,
  ).toBeGreaterThan(0)
  return found
}

/** The colour one utility paints in one theme, through its `var()` hops. */
function utilityColour(utility: string, theme: 'light' | 'dark'): Oklch {
  const themeVars = declarations('@theme inline')
  const rootVars = declarations(':root')
  const darkVars = declarations('.dark')
  const vars = new Map([...rootVars, ...(theme === 'dark' ? darkVars : [])])

  let value = themeVars.get(`--color-${utility}`)
  expect(value, `--color-${utility} in the @theme inline block`).toBeTruthy()
  for (let hop = 0; hop < 4 && value?.startsWith('var('); hop += 1) {
    value = vars.get(value.slice('var('.length, value.indexOf(')')))
  }
  const channels = value?.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/)
  expect(channels, `an oklch value for ${utility}`).toBeTruthy()
  return {
    L: Number(channels![1]),
    C: Number(channels![2]),
    h: Number(channels![3]),
  }
}

/**
 * The colour an element paints as its background (`bg`) or its ink (`text`):
 * the class that wins the cascade among the ones the element's own attributes
 * select. The winner is the highest specificity (most variant selectors), then
 * the last such class, which is how Tailwind's own output resolves — a
 * `data-*` variant adds its attribute selector, so `data-disabled:data-checked:`
 * beats a plain `data-disabled:` rule whatever order Tailwind emits them in.
 */
function painted(
  element: Element,
  property: 'bg' | 'text',
  theme: 'light' | 'dark',
): Oklch | null {
  const themeVars = declarations('@theme inline')
  const candidates = [...element.classList].flatMap((name) => {
    const parts = name.split(':')
    const utility = parts.at(-1) ?? ''
    const variants = parts.slice(0, -1)
    if (!variants.every((variant) => element.hasAttribute(variant))) return []
    if (!utility.startsWith(`${property}-`)) return []
    const token = utility.slice(property.length + 1)
    if (!themeVars.has(`--color-${token}`)) return []
    return [{ token, specificity: variants.length + 1 }]
  })
  if (!candidates.length) return null
  const winner = candidates.reduce((best, candidate) =>
    candidate.specificity >= best.specificity ? candidate : best,
  )
  return utilityColour(winner.token, theme)
}

describe('Checkbox — the mixed state paints a visible mark', () => {
  it.each(['light', 'dark'] as const)(
    'fills the box and paints the tick against it (%s)',
    (theme) => {
      render(<Checkbox indeterminate aria-label="Select all rows" />)
      const box = screen.getByRole('checkbox')
      // The state itself, before the paint: Base UI marks it mixed, and not
      // mixed with the checked fill.
      expect(box.getAttribute('aria-checked')).toBe('mixed')
      expect(box.hasAttribute('data-indeterminate')).toBe(true)

      const fill = painted(box, 'bg', theme)
      const ink = painted(box, 'text', theme)
      expect(fill, 'a background colour for the mixed box').not.toBeNull()
      expect(ink, 'an ink colour for the mark').not.toBeNull()

      // The defect was this pair being the same colour.
      expect(
        contrastRatio(oklchToSrgb(ink!), oklchToSrgb(fill!)),
      ).toBeGreaterThanOrEqual(3)
      // And it is a fill, not the unfilled box the mixed state used to keep.
      expect(oklchToSrgb(fill!)).not.toEqual(
        oklchToSrgb(utilityColour('surface', theme)),
      )
    },
  )

  it('keeps the fill and the mark on a set box that is also disabled', () => {
    // The same defect in its other half: a disabled checked box kept the
    // disabled surface while the tick stayed `on-accent`, so it was invisible
    // too. Both set states must be filled and visible when disabled.
    render(
      <div>
        <Checkbox defaultChecked disabled aria-label="Checked and disabled" />
        <Checkbox indeterminate disabled aria-label="Mixed and disabled" />
      </div>,
    )
    const [checked, mixed] = screen.getAllByRole('checkbox')
    expect(checked.hasAttribute('data-disabled')).toBe(true)
    expect(mixed.hasAttribute('data-disabled')).toBe(true)

    const primary = utilityColour('primary', 'light')
    for (const box of [checked, mixed]) {
      const fill = painted(box, 'bg', 'light')
      const ink = painted(box, 'text', 'light')
      expect(oklchToSrgb(fill!)).toEqual(oklchToSrgb(primary))
      expect(
        contrastRatio(oklchToSrgb(ink!), oklchToSrgb(fill!)),
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('leaves the unchecked and checked paint as they were', () => {
    const unchecked = render(<Checkbox aria-label="Unchecked" />)
    const uncheckedBox = screen.getByRole('checkbox')
    expect(oklchToSrgb(painted(uncheckedBox, 'bg', 'light')!)).toEqual(
      oklchToSrgb(utilityColour('surface', 'light')),
    )
    unchecked.unmount()

    render(<Checkbox defaultChecked aria-label="Checked" />)
    expect(
      oklchToSrgb(painted(screen.getByRole('checkbox'), 'bg', 'light')!),
    ).toEqual(oklchToSrgb(utilityColour('primary', 'light')))
  })

  it('still fades a disabled box that has nothing set', () => {
    render(<Checkbox disabled aria-label="Disabled" />)
    expect(
      oklchToSrgb(painted(screen.getByRole('checkbox'), 'bg', 'light')!),
    ).toEqual(oklchToSrgb(utilityColour('surface-disabled', 'light')))
  })
})
