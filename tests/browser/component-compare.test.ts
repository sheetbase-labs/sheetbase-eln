import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import axe from 'axe-core'
import { expect, test } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

import { DESIGN_USER_IDS } from '../visual/design-states'
import { signInAsDesignUser } from '../visual/sign-in'

/**
 * ADR-0055: the behavioural checklist and the automated evidence, run against
 * both columns of every registered pair on the development-only
 * `/component-compare` route.
 *
 * What this file is:
 * - the axe gate, in a real browser and therefore with colour contrast on,
 *   against both columns in both themes;
 * - the keyboard and pointer reorder checks, per column;
 * - the state checks (empty, loading, error, permission-restricted);
 * - the density checks at 1440x900 and 390x844;
 * - the screenshots of each column in both themes, as the appearance evidence.
 *
 * The fixed checklist lives in `src/components/component-compare/checklist.ts`;
 * what it means for a pair is written up in
 * `docs/knowledge/design/component-comparison-record.md`, and this file is the
 * automated half of it. Appearance is evidence, not the verdict.
 *
 * Screenshots land in the Playwright test output. Set
 * `COMPONENT_COMPARE_SHOTS=<dir>` to write them somewhere durable instead.
 */

const ROUTE = '/component-compare'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const COLUMNS = ['ours', 'theirs'] as const
type ColumnId = (typeof COLUMNS)[number]

/**
 * The pairs the generic checks below run against — axe, appearance, Tab order,
 * the three screen states and density. A pair is added here when it is
 * registered; the reorder, pointer and 5,000-row tests stay on the pair they
 * were written for. `every registered pair is covered` fails the spec when the
 * page offers a pair id this list does not know, so a new pair cannot ship
 * unchecked.
 */
const PAIRS = ['notebook-sortable', 'quantity-field', 'shortcut-keys'] as const
type PairId = (typeof PAIRS)[number]

/** A pair whose components reorder rows: the drag and drop tests are its own. */
const REORDERABLE_PAIR: PairId = 'notebook-sortable'

test.use({ viewport: DESKTOP, deviceScaleFactor: 1, locale: 'en-GB' })

/** Pin the theme the way the parity driver does: the server reads the cookie. */
async function openHarness(
  page: Page,
  options: {
    theme: 'light' | 'dark'
    fixture?: string
    state?: string
    pair?: PairId
  } = {
    theme: 'light',
  },
) {
  await page.context().addCookies([
    {
      name: 'sb-theme',
      value: options.theme,
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  await page.goto(ROUTE)
  await expect(page.getByTestId('component-compare')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(
    new RegExp(options.theme === 'dark' ? 'dark' : '^(?!.*dark)'),
  )
  await waitForInteractive(page)
  if (options.pair) {
    await page.getByTestId('comparison-pair').selectOption(options.pair)
  }
  if (options.fixture) {
    await page.getByTestId('comparison-fixture').selectOption(options.fixture)
    for (const id of COLUMNS) {
      await expect(column(page, id)).toHaveAttribute(
        'data-fixture-id',
        options.fixture,
      )
    }
  }
  if (options.state) {
    await page.getByTestId('comparison-state').selectOption(options.state)
    for (const id of COLUMNS) {
      await expect(column(page, id)).toHaveAttribute(
        'data-scenario-state',
        options.state,
      )
    }
  }
}

/**
 * Wait until the page is hydrated and interactive.
 *
 * The harness is server-rendered, so its markup is on screen before React
 * attaches anything; a select or a click that lands in that window is lost. The
 * probe is a real interaction with a visible result — narrow to one column and
 * widen again — so it also proves the view toggle works, and it re-tries while
 * a cold dev server finishes transforming modules.
 */
async function waitForInteractive(page: Page) {
  await expect(async () => {
    await page.getByTestId('comparison-view-ours').click()
    await expect(page.locator('[data-comparison-column]')).toHaveCount(1, {
      timeout: 500,
    })
  }).toPass({ timeout: 30_000 })
  await page.getByTestId('comparison-view-both').click()
  await expect(page.locator('[data-comparison-column]')).toHaveCount(2)
}

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
})

function column(page: Page, id: ColumnId): Locator {
  return page.locator(`[data-comparison-column="${id}"]`)
}

/** Row ids in one column, in rendered order. */
async function rowIds(page: Page, id: ColumnId): Promise<string[]> {
  return column(page, id)
    .locator('[data-row-id]')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).dataset.rowId ?? ''),
    )
}

async function shot(
  target: Locator,
  testInfo: { outputPath: (name: string) => string },
  name: string,
) {
  const configured = process.env.COMPONENT_COMPARE_SHOTS
  const file = configured
    ? join(configured, `${name}.png`)
    : testInfo.outputPath(`${name}.png`)
  await mkdir(dirname(file), { recursive: true })
  await target.screenshot({ path: file, animations: 'disabled' })
  return file
}

test.describe('axe', () => {
  // `long-labels`, not `bulk`: one axe pass over the 5,000-row fixture walks
  // ~25,000 nodes per column and takes minutes in both engines, without
  // exercising a rule that the smaller fixture of the same component does not
  // already exercise. That fixture is measured for rendering and overflow
  // instead (see `density and overflow`), and the exclusion is stated in
  // docs/development/component-compare.md and in the comparison record.
  for (const pair of PAIRS) {
    for (const theme of ['light', 'dark'] as const) {
      for (const fixture of ['long-labels'] as const) {
        for (const id of COLUMNS) {
          test(`${pair} — ${id} column has no axe violations — ${fixture}, ${theme}`, async ({
            page,
          }) => {
            await openHarness(page, { theme, fixture, pair })
            // Real layout, real colours: colour contrast stays on, unlike the
            // jsdom check, which cannot measure it.
            await page.addScriptTag({ content: axe.source })
            const violations = await page.evaluate(async (selector: string) => {
              const target = document.querySelector(selector)
              if (!target) throw new Error(`no ${selector}`)
              // The injected axe global is not part of the DOM lib types; the
              // cast is the injection boundary, and it is checked before use.
              const runner = (
                globalThis as {
                  axe?: {
                    run: (context: Element) => Promise<{
                      violations: Array<{
                        id: string
                        impact: string | null
                        nodes: Array<{ html: string }>
                      }>
                    }>
                  }
                }
              ).axe
              if (!runner) throw new Error('axe was not injected')
              const results = await runner.run(target)
              return results.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                nodes: violation.nodes.map((node) => node.html).slice(0, 3),
              }))
            }, `[data-comparison-column="${id}"]`)

            expect(violations).toEqual([])
          })
        }
      }
    }
  }
})

test.describe('appearance evidence', () => {
  for (const pair of PAIRS) {
    for (const theme of ['light', 'dark'] as const) {
      for (const id of COLUMNS) {
        test(`screenshot of the ${pair} ${id} column — ${theme}`, async ({
          page,
        }, testInfo) => {
          await openHarness(page, { theme, fixture: 'long-labels', pair })
          const name = `${pair}-${id}-${theme}`
          const file = await shot(column(page, id), testInfo, name)
          expect(file.endsWith(`${name}.png`)).toBe(true)
          await expect(column(page, id)).toBeVisible()
        })
      }
    }
  }
})

test.describe('the harness lists only pairs this spec covers', () => {
  test('every registered pair is covered', async ({ page }) => {
    await openHarness(page, { theme: 'light' })
    const registered = await page
      .getByTestId('comparison-pair')
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      )
    expect([...registered].sort()).toEqual([...PAIRS].sort())
  })
})

test.describe('keyboard', () => {
  /**
   * What each pair's columns put on the keyboard path, as `[column, tag, slot,
   * accessible name]` prefixes. The Tab walk below asserts these are reached.
   */
  const CONTROL_PATH: Record<PairId, readonly string[]> = {
    'notebook-sortable': [
      'ours|BUTTON||Drag block',
      'theirs|BUTTON|sortable-item-handle|Reorder',
    ],
    'quantity-field': [
      'ours|INPUT|input|',
      // The item's accessible name comes from its own scrub-area `<label>`, so
      // the input carries no `aria-label` for this probe to read.
      'theirs|INPUT|number-field-input|',
    ],
    // Neither side puts anything on the keyboard path: a key cap is not an
    // interactive control, and the chord is read as text.
    'shortcut-keys': [],
  }

  for (const pair of PAIRS) {
    test(`${pair} — reaches every control by Tab, with a visible focus indicator`, async ({
      page,
    }) => {
      await openHarness(page, { theme: 'light', fixture: 'long-labels', pair })

      const reached: string[] = []
      for (let press = 0; press < 40; press += 1) {
        await page.keyboard.press('Tab')
        const step = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null
          if (!element || element === document.body) return null
          const style = getComputedStyle(element)
          const outlined =
            style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
          const ringed = style.boxShadow !== 'none'
          const column = element.closest('[data-comparison-column]')
          return {
            key: [
              column?.getAttribute('data-comparison-column'),
              element.tagName,
              element.dataset.slot ?? '',
              element.getAttribute('aria-label') ?? element.textContent?.trim(),
            ].join('|'),
            visible: outlined || ringed,
            inColumn: column !== null,
          }
        })
        if (!step) continue
        if (!step.inColumn) continue
        reached.push(step.key)
        expect(step.visible, `focus indicator for ${step.key}`).toBe(true)
      }

      // The controls each column offers, reached from the page's own order: the
      // notebook's grip handle (which also opens the block menu) and its
      // keyboard-reachable rows in ours, the ReUI handle in theirs; and for the
      // numeric pair, one input per column per row.
      const focused = reached.join('\n')
      for (const expected of CONTROL_PATH[pair]) {
        expect(focused).toContain(expected)
      }
      // The notebook's rows are keyboard-reachable in their own right; the
      // numeric pair's rows are not widgets, so it has no equivalent.
      if (pair === REORDERABLE_PAIR) {
        const oursRows = reached.filter((key) =>
          key.startsWith('ours|DIV||'),
        ).length
        expect(oursRows).toBeGreaterThan(2)
      }
    })
  }

  test(`${REORDERABLE_PAIR} — reorders by keyboard in both columns`, async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      fixture: 'long-labels',
      pair: REORDERABLE_PAIR,
    })

    const oursBefore = await rowIds(page, 'ours')
    const oursRow = column(page, 'ours').locator(
      `[data-row-id="${oursBefore[0]}"]`,
    )
    await oursRow.focus()
    await page.keyboard.press('Alt+ArrowDown')

    await expect
      .poll(async () => (await rowIds(page, 'ours'))[0])
      .toBe(oursBefore[1])

    const theirsBefore = await rowIds(page, 'theirs')
    const handle = column(page, 'theirs').locator(
      `[data-row-id="${theirsBefore[0]}"] [data-slot="sortable-item-handle"]`,
    )
    await handle.focus()
    // Space/Enter lifts, arrows move, Space/Enter drops. Each key is waited
    // for rather than burst: `@dnd-kit` installs its move listener after the
    // lift, and announces the drop target it is over, so the announcement is
    // the evidence that the arrow was registered.
    await page.keyboard.press('Enter')
    await expect(
      column(page, 'theirs').locator(
        '[data-slot="sortable-item"][data-dragging="true"]',
      ),
    ).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await expect(column(page, 'theirs').getByRole('status')).toContainText(
      theirsBefore[1]!,
    )
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await rowIds(page, 'theirs'))[0])
      .toBe(theirsBefore[1])
  })
})

test.describe('mouse', () => {
  test(`${REORDERABLE_PAIR} — reorders by pointer drag in both columns`, async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      fixture: 'long-labels',
      pair: REORDERABLE_PAIR,
    })

    // Ours: native HTML5 drag from the notebook's grip handle onto a row. The
    // handle sits in the row's left gutter, so it is grabbed from its own box.
    const oursBefore = await rowIds(page, 'ours')
    await column(page, 'ours')
      .locator(
        `[data-row-id="${oursBefore[0]}"] button[aria-label="Drag block"]`,
      )
      .dragTo(column(page, 'ours').locator(`[data-row-id="${oursBefore[2]}"]`))
    await expect
      .poll(async () => (await rowIds(page, 'ours')).slice(0, 3))
      .toEqual([oursBefore[1], oursBefore[2], oursBefore[0]])

    // Theirs: @dnd-kit's pointer sensor, which activates after 10px of
    // movement and resolves the drop by hit-testing the rows. Each step is
    // waited for — the candidate announces the row it is over, which is the
    // evidence that the pointer move was registered — rather than slept on.
    const theirsBefore = await rowIds(page, 'theirs')
    const from = await column(page, 'theirs')
      .locator(
        `[data-row-id="${theirsBefore[0]}"] [data-slot="sortable-item-handle"]`,
      )
      .boundingBox()
    const to = await column(page, 'theirs')
      .locator(`[data-row-id="${theirsBefore[2]}"]`)
      .boundingBox()
    if (!from || !to) throw new Error('no bounding box for the drag')

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      from.x + from.width / 2,
      from.y + from.height / 2 + 20,
      { steps: 5 },
    )
    await expect(
      column(page, 'theirs').locator(
        '[data-slot="sortable-item"][data-dragging="true"]',
      ),
    ).toHaveCount(1)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    })
    await expect(column(page, 'theirs').getByRole('status')).toContainText(
      theirsBefore[2]!,
    )
    await page.mouse.up()

    // Both mechanisms must agree on where a drop between rows lands.
    await expect
      .poll(async () => (await rowIds(page, 'theirs')).slice(0, 3))
      .toEqual([theirsBefore[1], theirsBefore[2], theirsBefore[0]])
    expect(await rowIds(page, 'ours')).toEqual(await rowIds(page, 'theirs'))
  })
})

test.describe('states', () => {
  // The empty, loading and error states are the harness's own and apply to
  // every pair; `restricted` is component-specific and is checked on the pair
  // whose components reorder.
  for (const pair of PAIRS) {
    test(`${pair} — says "no rows" and keeps its controls for the empty fixture`, async ({
      page,
    }) => {
      await openHarness(page, { theme: 'light', fixture: 'empty', pair })
      for (const id of COLUMNS) {
        await expect(
          column(page, id).getByRole('heading', { name: 'No rows' }),
        ).toBeVisible()
        await expect(column(page, id).locator('[data-row-id]')).toHaveCount(0)
      }
    })

    test(`${pair} — announces loading`, async ({ page }) => {
      await openHarness(page, { theme: 'light', fixture: 'long-labels', pair })
      await page.getByTestId('comparison-state').selectOption('loading')
      for (const id of COLUMNS) {
        await expect(
          column(page, id).locator('[data-comparison-state="loading"]'),
        ).toHaveAttribute('aria-busy', 'true')
        await expect(column(page, id).locator('[data-row-id]')).toHaveCount(0)
      }
    })

    test(`${pair} — reports an error and returns to ready through the retry`, async ({
      page,
    }) => {
      await openHarness(page, { theme: 'light', fixture: 'long-labels', pair })
      await page.getByTestId('comparison-state').selectOption('error')
      const alerts = page.locator('[data-comparison-column] [role="alert"]')
      await expect(alerts).toHaveCount(2)

      const retry = page.getByRole('button', { name: 'Retry' }).first()
      await retry.focus()
      await page.keyboard.press('Enter')
      for (const id of COLUMNS) {
        await expect(column(page, id)).toHaveAttribute(
          'data-scenario-state',
          'ready',
        )
      }
    })
  }

  test(`${REORDERABLE_PAIR} — refuses reordering and states why when permission is restricted`, async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      fixture: 'long-labels',
      pair: REORDERABLE_PAIR,
    })
    await page.getByTestId('comparison-state').selectOption('restricted')

    for (const id of COLUMNS) {
      await expect(column(page, id).getByText('View only')).toBeVisible()
    }

    // Ours: the reason is text, and alt+arrow can no longer move a row.
    const oursBefore = await rowIds(page, 'ours')
    await column(page, 'ours')
      .locator(`[data-row-id="${oursBefore[0]}"]`)
      .focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect(await rowIds(page, 'ours')).toEqual(oursBefore)

    // Theirs: the item is aria-disabled and carries no drag listeners.
    const theirsBefore = await rowIds(page, 'theirs')
    await expect(
      column(page, 'theirs').locator('[data-slot="sortable-item"]').first(),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(await rowIds(page, 'theirs')).toEqual(theirsBefore)
  })
})

test.describe('density and overflow', () => {
  for (const pair of PAIRS) {
    for (const [label, size] of [
      ['desktop 1440x900', DESKTOP],
      ['phone 390x844', PHONE],
    ] as const) {
      test(`${pair} — holds at ${label}`, async ({ page }) => {
        await page.setViewportSize(size)
        await openHarness(page, {
          theme: 'light',
          fixture: 'long-labels',
          pair,
        })

        const overflow = await page.evaluate(() => ({
          document:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        }))
        expect(overflow.document).toBeLessThanOrEqual(1)

        for (const id of COLUMNS) {
          const box = await column(page, id).boundingBox()
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1)
          // No control is pushed off the side of the column.
          const clipped = await column(page, id)
            .locator('[data-row-id]')
            .evaluateAll(
              (elements) =>
                elements
                  .map((element) => element.getBoundingClientRect())
                  .filter(
                    (rect) =>
                      rect.width < 1 || rect.right > window.innerWidth + 1,
                  ).length,
            )
          expect(clipped).toBe(0)
        }

        if (pair !== REORDERABLE_PAIR) return

        // The notebook's grip handle is desktop-only (`hidden lg:flex`); the
        // ReUI handle is not. That difference is the point of this check, so it
        // is asserted per column rather than averaged away.
        const oursHandles = column(page, 'ours').locator(
          'button[aria-label="Drag block"]',
        )
        const theirsHandles = column(page, 'theirs').locator(
          '[data-slot="sortable-item-handle"]',
        )
        if (size.width >= 1024) {
          await expect(oursHandles.first()).toBeVisible()
          await expect(theirsHandles.first()).toBeVisible()
        } else {
          await expect(oursHandles.first()).toBeHidden()
          await expect(theirsHandles.first()).toBeVisible()

          // Below 1024px our grip handle is not rendered at all, so pointer
          // reordering is unavailable on our side; the keyboard path still works
          // and the candidate keeps both. This is the density finding the record
          // cites, so it is asserted rather than described.
          const before = await rowIds(page, 'ours')
          await column(page, 'ours')
            .locator(`[data-row-id="${before[0]}"]`)
            .focus()
          await page.keyboard.press('Alt+ArrowDown')
          await expect
            .poll(async () => (await rowIds(page, 'ours'))[0])
            .toBe(before[1])

          const theirsBefore = await rowIds(page, 'theirs')
          const handleBox = await theirsHandles.first().boundingBox()
          expect(handleBox).not.toBeNull()
          expect(handleBox!.width).toBeGreaterThanOrEqual(16)
        }
      })
    }
  }

  test(`${REORDERABLE_PAIR} — renders the 5,000-row fixture without horizontal growth`, async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      fixture: 'bulk',
      pair: REORDERABLE_PAIR,
    })
    for (const id of COLUMNS) {
      await expect(column(page, id).locator('[data-row-id]')).toHaveCount(5000)
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
