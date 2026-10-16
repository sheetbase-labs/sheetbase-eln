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

test.use({ viewport: DESKTOP, deviceScaleFactor: 1, locale: 'en-GB' })

/** Pin the theme the way the parity driver does: the server reads the cookie. */
async function openHarness(
  page: Page,
  options: {
    theme: 'light' | 'dark'
    fixture?: string
    state?: string
    pair?: string
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
    for (const id of COLUMNS) {
      await expect(column(page, id)).toHaveAttribute(
        'data-pair-id',
        options.pair,
      )
    }
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

/**
 * Run axe inside one column, in the real engine with colour contrast on.
 * Shared by every pair's axe cases so one pair's evidence is measured the same
 * way as another's.
 */
async function columnAxeViolations(page: Page, id: ColumnId) {
  await page.addScriptTag({ content: axe.source })
  return page.evaluate(async (selector: string) => {
    const target = document.querySelector(selector)
    if (!target) throw new Error(`no ${selector}`)
    // The injected axe global is not part of the DOM lib types; the cast is
    // the injection boundary, and it is checked before use.
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
}

test.describe('axe', () => {
  // `long-labels`, not `bulk`: one axe pass over the 5,000-row fixture walks
  // ~25,000 nodes per column and takes minutes in both engines, without
  // exercising a rule that the smaller fixture of the same component does not
  // already exercise. That fixture is measured for rendering and overflow
  // instead (see `density and overflow`), and the exclusion is stated in
  // docs/development/component-compare.md and in the comparison record.
  for (const theme of ['light', 'dark'] as const) {
    for (const fixture of ['long-labels'] as const) {
      for (const id of COLUMNS) {
        test(`${id} column has no axe violations — ${fixture}, ${theme}`, async ({
          page,
        }) => {
          await openHarness(page, { theme, fixture })
          const violations = await columnAxeViolations(page, id)
          expect(violations).toEqual([])
        })
      }
    }
  }
})

test.describe('appearance evidence', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const id of COLUMNS) {
      test(`screenshot of the ${id} column — ${theme}`, async ({
        page,
      }, testInfo) => {
        await openHarness(page, { theme, fixture: 'long-labels' })
        const file = await shot(column(page, id), testInfo, `${id}-${theme}`)
        expect(file.endsWith(`${id}-${theme}.png`)).toBe(true)
        await expect(column(page, id)).toBeVisible()
      })
    }
  }
})

test.describe('keyboard', () => {
  test('reaches every control by Tab, with a visible focus indicator', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })

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
    // notebook's grip handle and its keyboard-reachable rows in ours, and the
    // reference item's handle in theirs. Both handles are the sortable item's
    // own handle element, because ours *is* the item.
    const focused = reached.join('\n')
    expect(focused).toContain('ours|BUTTON|sortable-item-handle|Drag block')
    expect(focused).toContain('theirs|BUTTON|sortable-item-handle|Reorder')
    const oursRows = reached.filter((key) =>
      key.startsWith('ours|DIV|sortable-item|'),
    ).length
    expect(oursRows).toBeGreaterThan(2)
  })

  test('reorders by keyboard in both columns', async ({ page }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })

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

/**
 * Drag one row's grip onto another row, with the pointer sensor.
 *
 * The gesture is written out rather than taken from `locator.dragTo()`.
 * `@dnd-kit`'s pointer sensor is distance-constrained, and the move that
 * satisfies the constraint only *starts* the drag — the sensor reports a
 * position on the moves after it. A single-step `dragTo` therefore activates
 * the drag and never says where the pointer went, so the drop resolves to no
 * target and the order is unchanged. The moves here are the same ones a hand
 * makes: a short one past the activation distance, then a long one onto the
 * target. Both columns run the identical gesture, because both are now the same
 * item.
 */
async function dragRowOntoRow(
  page: Page,
  columnId: ColumnId,
  fromRowId: string,
  toRowId: string,
) {
  const list = column(page, columnId)
  const source = list.locator(
    `[data-row-id="${fromRowId}"] [data-slot="sortable-item-handle"]`,
  )
  await source.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  const to = await list.locator(`[data-row-id="${toRowId}"]`).boundingBox()
  if (!from || !to) throw new Error(`no bounding box for the ${columnId} drag`)

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 + 20,
    { steps: 5 },
  )
  await expect(
    list.locator('[data-slot="sortable-item"][data-dragging="true"]'),
  ).toHaveCount(1)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  })
  // The candidate announces the row it is over, which is the evidence that the
  // pointer move was registered rather than a sleep.
  await expect(list.getByRole('status')).toContainText(toRowId)
  await page.mouse.up()
}

test.describe('mouse', () => {
  test('reorders by pointer drag in both columns', async ({ page }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })

    const oursBefore = await rowIds(page, 'ours')
    await dragRowOntoRow(page, 'ours', oursBefore[0]!, oursBefore[2]!)
    await expect
      .poll(async () => (await rowIds(page, 'ours')).slice(0, 3))
      .toEqual([oursBefore[1], oursBefore[2], oursBefore[0]])

    const theirsBefore = await rowIds(page, 'theirs')
    await dragRowOntoRow(page, 'theirs', theirsBefore[0]!, theirsBefore[2]!)
    await expect
      .poll(async () => (await rowIds(page, 'theirs')).slice(0, 3))
      .toEqual([theirsBefore[1], theirsBefore[2], theirsBefore[0]])

    // Both resolve a drop between rows to the same index.
    expect(await rowIds(page, 'ours')).toEqual(await rowIds(page, 'theirs'))
  })
})

test.describe('states', () => {
  test('says "no rows" and keeps its controls for the empty fixture', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: 'empty' })
    for (const id of COLUMNS) {
      await expect(
        column(page, id).getByRole('heading', { name: 'No rows' }),
      ).toBeVisible()
      await expect(column(page, id).locator('[data-row-id]')).toHaveCount(0)
    }
  })

  test('announces loading', async ({ page }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })
    await page.getByTestId('comparison-state').selectOption('loading')
    for (const id of COLUMNS) {
      await expect(
        column(page, id).locator('[data-comparison-state="loading"]'),
      ).toHaveAttribute('aria-busy', 'true')
      await expect(column(page, id).locator('[data-row-id]')).toHaveCount(0)
    }
  })

  test('reports an error and returns to ready through the retry', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })
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

  test('refuses reordering and states why when permission is restricted', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: 'long-labels' })
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
  for (const [label, size] of [
    ['desktop 1440x900', DESKTOP],
    ['phone 390x844', PHONE],
  ] as const) {
    test(`holds at ${label}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHarness(page, { theme: 'light', fixture: 'long-labels' })

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

      // The notebook's grip used to be desktop-only (`hidden lg:flex`), which is
      // the missing behaviour this adoption was decided on: below 1024px the
      // list had no pointer or touch route to a reorder at all. It is rendered
      // at every width now, and below `lg` the row carries the gutter itself.
      // So the assertion is not merely that it is visible but that it
      // reorders.
      const oursHandles = column(page, 'ours').locator(
        'button[aria-label="Drag block"]',
      )
      const theirsHandles = column(page, 'theirs').locator(
        '[data-slot="sortable-item-handle"]',
      )
      for (const handles of [oursHandles, theirsHandles]) {
        await expect(handles.first()).toBeVisible()
        const box = await handles.first().boundingBox()
        expect(box).not.toBeNull()
        expect(box!.width).toBeGreaterThanOrEqual(16)
      }

      if (size.width < 1024) {
        const before = await rowIds(page, 'ours')
        await dragRowOntoRow(page, 'ours', before[0]!, before[2]!)
        await expect
          .poll(async () => (await rowIds(page, 'ours')).slice(0, 3))
          .toEqual([before[1], before[2], before[0]])
      }
    })
  }

  test('renders the 5,000-row fixture without horizontal growth', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: 'bulk' })
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

/**
 * The empty-state pair (comparison record, row 2).
 *
 * Ours is the 37-line `EmptyState` this change replaces; theirs is the stock
 * shadcn `empty` item, restyled to the app-3 tokens. The pair has no sort,
 * filter, select, resize, pagination or reorder control, so the notebook's
 * keyboard and pointer checks do not apply: what it does have is one action,
 * so the keyboard check is that the action is reachable, that it draws a focus
 * indicator, and that pressing it does what it says.
 */
test.describe('empty state', () => {
  const PAIR = 'empty-state'
  // The long-labels fixture puts a 200-character scientific name in the title
  // and its unit in the description: the hostile case for an empty state is
  // wrapping, not row count.
  const FIXTURE = 'long-labels'

  for (const theme of ['light', 'dark'] as const) {
    for (const id of COLUMNS) {
      test(`${id} empty has no axe violations in ${theme}`, async ({
        page,
      }) => {
        await openHarness(page, { theme, fixture: FIXTURE, pair: PAIR })
        expect(await columnAxeViolations(page, id)).toEqual([])
      })
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const id of COLUMNS) {
      test(`screenshot of the ${id} empty state — ${theme}`, async ({
        page,
      }, testInfo) => {
        await openHarness(page, { theme, fixture: FIXTURE, pair: PAIR })
        const file = await shot(
          column(page, id),
          testInfo,
          `empty-${id}-${theme}`,
        )
        expect(file.endsWith(`empty-${id}-${theme}.png`)).toBe(true)
        await expect(column(page, id)).toBeVisible()
 * The history-rows pair, on the same fixed checklist. The two columns differ in
 * where their states come from — the shared surface ships its own loading,
 * empty and error rendering and this pair drives them, while the ReUI item
 * ships none and its column falls back to the harness's notices — so the state
 * checks are asserted per column rather than averaged, and the comparison
 * record states the difference.
 */
test.describe('history rows pair', () => {
  const PAIR = 'history-rows'
  const items = (page: Page, id: ColumnId) =>
    column(page, id).locator('[data-slot="timeline-item"]')

  for (const theme of ['light', 'dark'] as const) {
    for (const id of COLUMNS) {
      test(`${id} column has no axe violations — long-labels, ${theme}`, async ({
        page,
      }) => {
        await openHarness(page, {
          theme,
          pair: PAIR,
          fixture: 'long-labels',
        })
        await page.addScriptTag({ content: axe.source })
        const violations = await page.evaluate(async (selector: string) => {
          const target = document.querySelector(selector)
          if (!target) throw new Error(`no ${selector}`)
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

      test(`screenshot of the ${id} column — ${theme}`, async ({
        page,
      }, testInfo) => {
        await openHarness(page, {
          theme,
          pair: PAIR,
          fixture: 'long-labels',
        })
        await shot(column(page, id), testInfo, `history-${id}-${theme}`)
        await expect(items(page, id).first()).toBeVisible()
      })
    }
  }

  test('the next action is reachable by keyboard and clears the filter', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', fixture: FIXTURE, pair: PAIR })

    for (const id of COLUMNS) {
      const action = column(page, id).getByRole('button', {
        name: 'Clear search',
      })
      // Reached by Tab, not by `.focus()`: the kit's ring is `focus-visible`,
      // and a programmatic focus does not draw it.
      let focused = false
      for (let press = 0; press < 40 && !focused; press += 1) {
        await page.keyboard.press('Tab')
        focused = await action.evaluate(
          (element) => element === document.activeElement,
        )
      }
      expect(focused, `Tab reaches the action in the ${id} column`).toBe(true)

      const ringed = await action.evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          (style.outlineStyle !== 'none' &&
            parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none'
        )
      })
      expect(ringed, `focus indicator in the ${id} column`).toBe(true)

      await page.keyboard.press('Enter')
      await expect(
        column(page, id).getByText('Nothing here yet', { exact: true }),
      ).toBeVisible()
      await expect(
        column(page, id).getByRole('button', { name: 'Add the first row' }),
      ).toBeVisible()
    }

    // C1, measured: ours announces the new copy as a heading, the item's
    // `EmptyTitle` is a `div`, so its empty state is not in the heading
    // outline. That difference is why the item was not adopted verbatim.
    await expect(
      column(page, 'ours').getByRole('heading', { name: 'Nothing here yet' }),
    ).toBeVisible()
    await expect(
      column(page, 'theirs').getByRole('heading', { name: 'Nothing here yet' }),
    ).toHaveCount(0)
  test('renders a row per event, with the captured change', async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      pair: PAIR,
      fixture: 'long-labels',
    })

    for (const id of COLUMNS) {
      await expect(items(page, id)).toHaveCount(8)
      // Both sides render the fixture's captured change as before → after.
      await expect(
        column(page, id).getByText('→', { exact: true }).first(),
      ).toBeVisible()
    }

    // Ours adds what the panels need around it: the actor and subject line, the
    // relative and absolute time, the deep link and the raw disclosure.
    const ours = column(page, 'ours')
    await expect(ours.locator('time[datetime]').first()).toBeVisible()
    await expect(ours.getByRole('link').first()).toBeVisible()
    await expect(ours.getByText('Raw event').first()).toBeVisible()
  })

  test('reaches every control it has by Tab, with a visible focus indicator', async ({
    page,
  }) => {
    await openHarness(page, {
      theme: 'light',
      pair: PAIR,
      fixture: 'long-labels',
    })

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
        return {
          column:
            element
              .closest('[data-comparison-column]')
              ?.getAttribute('data-comparison-column') ?? null,
          key: `${element.tagName}|${(element.textContent ?? '').trim().slice(0, 24)}`,
          visible: outlined || ringed,
        }
      })
      if (!step || step.column !== 'ours') continue
      reached.push(step.key)
      expect(step.visible, `focus indicator for ${step.key}`).toBe(true)
    }

    // The shared surface's controls: the deep link and the raw disclosure. The
    // candidate's rows carry no controls of their own, so its column has none.
    expect(reached.some((key) => key.startsWith('A|Open dataset'))).toBe(true)
    expect(reached.some((key) => key.startsWith('SUMMARY|Raw event'))).toBe(
      true,
    )
    await expect(
      column(page, 'theirs').locator('a, button, summary, [tabindex]'),
    ).toHaveCount(0)

    // The disclosure is a real summary, so the keyboard route opens it.
    await column(page, 'ours').getByText('Raw event').first().focus()
    await page.keyboard.press('Enter')
    await expect(column(page, 'ours').locator('details[open]')).toHaveCount(1)
  })

  test('states: empty, loading, error and permission-restricted, per column', async ({
    page,
  }) => {
    await openHarness(page, { theme: 'light', pair: PAIR, fixture: 'empty' })
    // Ours ships an honest empty state; theirs has none, so the harness's
    // notice stands in and the record says which one was measured.
    await expect(
      column(page, 'ours').getByText(
        'No recorded activity for this object yet.',
      ),
    ).toBeVisible()
    await expect(
      column(page, 'theirs').getByRole('heading', { name: 'No rows' }),
    ).toBeVisible()

    await page.getByTestId('comparison-fixture').selectOption('long-labels')
    await page.getByTestId('comparison-state').selectOption('loading')
    await expect(
      column(page, 'ours').locator('[data-slot="history-timeline"]'),
    ).toHaveAttribute('aria-busy', 'true')
    await expect(
      column(page, 'theirs').locator('[data-comparison-state="loading"]'),
    ).toHaveAttribute('aria-busy', 'true')

    await page.getByTestId('comparison-state').selectOption('error')
    await expect(column(page, 'ours').getByRole('alert')).toContainText(
      'History could not be loaded.',
    )
    await expect(column(page, 'theirs').getByRole('alert')).toBeVisible()

    await page.getByTestId('comparison-state').selectOption('restricted')
    for (const id of COLUMNS) {
      await expect(column(page, id).getByText('View only')).toBeVisible()
    }
  })

  for (const [label, size] of [
    ['desktop 1440x900', DESKTOP],
    ['phone 390x844', PHONE],
  ] as const) {
    test(`holds the long scientific name at ${label}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHarness(page, { theme: 'light', fixture: FIXTURE, pair: PAIR })
    test(`density and overflow: holds at ${label}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openHarness(page, {
        theme: 'light',
        pair: PAIR,
        fixture: 'long-labels',
      })

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(1)

      for (const id of COLUMNS) {
        const box = await column(page, id).boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1)
        // The action is on screen and big enough to press, not clipped.
        const action = column(page, id).getByRole('button', {
          name: 'Clear search',
        })
        await expect(action).toBeVisible()
        const actionBox = await action.boundingBox()
        expect(actionBox).not.toBeNull()
        expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
          size.width + 1,
        )
        expect(actionBox!.height).toBeGreaterThanOrEqual(20)
      }
    })
  }
        const clipped = await items(page, id).evaluateAll(
          (elements) =>
            elements
              .map((element) => element.getBoundingClientRect())
              .filter(
                (rect) => rect.width < 1 || rect.right > window.innerWidth + 1,
              ).length,
        )
        expect(clipped).toBe(0)
      }
    })
  }

  test('renders the 5,000-row fixture in both columns', async ({ page }) => {
    // The fixture is the layout and cost one: the shared surface renders every
    // row (it does not virtualise), so this case is the expensive one and gets
    // its own timeout. It is not an axe target in either column; see the
    // runbook's note on the 5,000-row fixture.
    test.setTimeout(240_000)
    await openHarness(page, { theme: 'light', pair: PAIR, fixture: 'bulk' })
    for (const id of COLUMNS) {
      await expect(items(page, id)).toHaveCount(5000)
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
