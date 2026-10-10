import { readFileSync } from 'node:fs'
import { expect, test } from 'playwright/test'
import { z } from 'zod'

import {
  DESIGN_PENDING,
  DESIGN_SCREEN_SIZES,
  DESIGN_STATES,
} from './design-states'
import { visitDesignState } from './state-driver'

/**
 * Visual parity suite (DSYS-06). Each mapped design screen opens its route as
 * the screen's seeded user, in the screen's state, theme and frame size, and
 * compares the result with the DSYS-01 render, which is the expected image
 * (`tests/visual/design-reference/<Screen>-<theme>.png`).
 *
 * The comparison is the gate: a migrated route that stops matching its design
 * fails here. Pending screens are reported, but do not satisfy coverage.
 * The gate passes only when every design screen is mapped in both themes.
 */
for (const state of DESIGN_STATES) {
  test(`${state.screen} — ${state.theme}`, async ({ page }) => {
    await visitDesignState(page, state)
    await expect(page).toHaveScreenshot(`${state.screen}-${state.theme}.png`)
  })
}

test('parity coverage', () => {
  const screens = Object.keys(DESIGN_SCREEN_SIZES)
  const canvas = z
    .object({
      boards: z.record(z.string(), z.object({ w: z.number(), h: z.number() })),
    })
    .parse(
      JSON.parse(
        readFileSync(
          'docs/knowledge/design/ui-system-v3/canvas/canvas.json',
          'utf8',
        ),
      ),
    )
  expect(
    DESIGN_SCREEN_SIZES,
    'registry must cover every vendored board at its original frame size',
  ).toEqual(
    Object.fromEntries(
      Object.entries(canvas.boards).map(([file, { w, h }]) => [
        file.replace(/\.dc\.html$/, ''),
        { width: w, height: h },
      ]),
    ),
  )
  const known = new Set(screens)

  const mapped = new Set(DESIGN_STATES.map((state) => state.screen))
  const mappedEntries = new Set(
    DESIGN_STATES.map((state) => `${state.screen}-${state.theme}`),
  )

  const pending = new Map<string, string>()
  for (const group of DESIGN_PENDING) {
    // A reason-free or screen-free group must never be a way to silence the
    // gate; the whitelist has to say what each screen is waiting on.
    if (group.reason.trim().length === 0 || group.screens.length === 0) {
      throw new Error(
        `DESIGN_PENDING has an empty reason or screen list: ${JSON.stringify(group)}`,
      )
    }
    for (const screen of group.screens) {
      const existing = pending.get(screen)
      if (existing) {
        throw new Error(
          `"${screen}" is listed as pending twice:\n  ${existing}\n  ${group.reason}`,
        )
      }
      pending.set(screen, group.reason)
    }
  }

  const unknown = [...mapped, ...pending.keys()].filter(
    (screen) => !known.has(screen),
  )
  const both = [...mapped].filter((screen) => pending.has(screen))
  const unlisted = screens.filter(
    (screen) => !mapped.has(screen) && !pending.has(screen),
  )

  expect(unknown, 'registry names that are not design screens').toEqual([])
  expect(both, 'screens mapped and pending at the same time').toEqual([])
  expect(
    unlisted,
    'screens neither mapped in DESIGN_STATES nor listed in DESIGN_PENDING',
  ).toEqual([])

  // A mapped screen must compare in both themes; a missing theme is a silent
  // gap in the gate.
  const missingThemes = DESIGN_STATES.flatMap((state) =>
    mappedEntries.has(`${state.screen}-light`) &&
    mappedEntries.has(`${state.screen}-dark`)
      ? []
      : [`${state.screen}-${state.theme === 'light' ? 'dark' : 'light'}`],
  )

  const total = screens.length * 2
  const mappedCount = mappedEntries.size
  const pendingCount = pending.size * 2

  // eslint-disable-next-line no-console -- the coverage report is the point
  console.log(
    [
      `parity coverage: ${mappedCount}/${total} comparisons mapped, ` +
        `${pendingCount} pending, ${screens.length} screens`,
      ...DESIGN_PENDING.map(
        (group) => `  pending (${group.screens.length}): ${group.reason}`,
      ),
    ].join('\n'),
  )

  expect(missingThemes, 'mapped screens missing a theme').toEqual([])
  expect(
    DESIGN_STATES.length,
    'duplicate screen/theme comparisons must not inflate coverage',
  ).toBe(mappedCount)
  expect(mappedCount + pendingCount).toBe(total)
  expect(
    [...pending.keys()],
    'DSYS-06 is incomplete while any design screen is pending',
  ).toEqual([])
  expect(mappedCount, 'every design screen must compare in both themes').toBe(
    total,
  )
})
