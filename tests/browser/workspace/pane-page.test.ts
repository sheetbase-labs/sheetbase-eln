import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { serverFixtures } from '../settings/transport'
import type { PanePageFixture } from './pane-page-fixture'

const checks = new WeakMap<Page, () => void>()

test.afterEach(({ page }) => {
  checks.get(page)?.()
})

async function setup(page: Page, blockers = false) {
  const unexpected: string[] = []
  page.on('pageerror', (error) => unexpected.push(error.message))

  const server = await serverFixtures(page, [
    {
      file: 'lib/identifier-resolution.ts',
      name: 'resolveIdentifierFn',
      result: null,
    },
  ])

  checks.set(page, () => {
    server.assertExpected()
    expect(unexpected).toEqual([])
  })
  await page.routeWebSocket(
    /^ws:\/\/(?:127\.0\.0\.1|localhost):3100\/\?token=/,
    (socket) => socket.send(JSON.stringify({ type: 'connected' })),
  )

  const empty = new Set([
    'reagent_movements',
    'record_links',
    'material_safety',
    'material_ingredients',
    'label_templates',
    'record_models',
    'record_field_definitions',
    'record_model_versions',
    'user_favourites',
    'projects',
  ])

  await page.route('**/api/db/**', async (route) => {
    const url = new URL(route.request().url())
    const resource = url.pathname.slice('/api/db/'.length)

    if (route.request().method() !== 'GET') {
      unexpected.push(`${route.request().method()} ${url.pathname}`)
      await route.abort('blockedbyclient')

      return
    }

    if (resource === 'records') {
      const key = (
        url.searchParams.get('identifier') ??
        url.searchParams.get('id') ??
        ''
      )
        .replace(/^eq\./, '')
        .replace(/^MAT-/, '')

      if (!['alpha', 'beta', 'gamma', 'delta'].includes(key)) {
        unexpected.push(`Unexpected records query ${url.search}`)
        await route.abort('blockedbyclient')

        return
      }

      await route.fulfill({
        json: [
          {
            id: key,
            workspace_id: 'w',
            project_id: null,
            folder_id: null,
            kind: 'material',
            identifier: `MAT-${key}`,
            title: `Buffer ${key}`,
            status: 'available',
            tags: [],
            structure_version: 1,
            metadata_version: 1,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-01T00:00:00Z',
            archived_at: null,
            deleted_at: null,
            created_by_user_id: 'u',
            updated_by_user_id: null,
            locked_at: null,
            locked_by_revision_id: null,
            properties: { quantity: 5, unit: 'mL', lot: key },
            custom_fields: { initial_quantity: 6 },
          },
        ],
      })

      return
    }

    if (!empty.has(resource)) {
      unexpected.push(`Unexpected resource ${url.pathname}`)
      await route.abort('blockedbyclient')

      return
    }

    await route.fulfill({ json: [] })
  })
  await page.route('**/pane-page-fixture?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module" src="/@vite/client"></script>
    <script type="module" src="/tests/browser/workspace/pane-page-fixture.tsx"></script>
    </body></html>`,
    }),
  )
  await page.goto(`/pane-page-fixture?blockers=${blockers}`)
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Buffer beta', exact: true }),
  ).toBeAttached()
  await expect
    .poll(
      async () =>
        (await snapshot(page)).events.filter(
          (event) => event.kind === 'ready' && event.value === true,
        ).length,
    )
    .toBe(2)

  return {
    first: page.getByRole('region', { name: 'first', exact: true }),
    second: page.getByRole('region', { name: 'second', exact: true }),
  }
}

function snapshot(
  page: Page,
): Promise<ReturnType<PanePageFixture['snapshot']>> {
  return page.evaluate(() => window.panePageFixture.snapshot())
}

test('renders two real parameterised pages independently and keeps initial href stable', async ({
  page,
}) => {
  const { first, second } = await setup(page)
  await expect(page.locator('html')).toHaveCount(1)
  // Only the three fixture bootstrap scripts exist; neither pane mounts document scripts.
  await expect(page.locator('script')).toHaveCount(3)
  await page.evaluate(() =>
    window.panePageFixture.rerender({ href: '/materials/ignored' }),
  )
  await expect(
    first.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.panePageFixture.navigate('/materials/gamma?source=split#ledger'),
  )
  await expect(
    first.getByRole('heading', { name: 'Buffer gamma' }),
  ).toBeVisible()
  await expect(
    second.getByRole('heading', { name: 'Buffer beta' }),
  ).toBeAttached()
  expect((await snapshot(page)).events).toContainEqual({
    generation: 'old',
    pane: 'first',
    kind: 'location',
    value: '/materials/gamma?source=split#ledger',
  })
  expect((await snapshot(page)).scrolls).toBe(0)
  expect((await snapshot(page)).betaCached).toBe(true)
  await page.evaluate(() => window.panePageFixture.unmount())
  expect((await snapshot(page)).betaCached).toBe(true)
})

test('refuses close and navigation while an existing spreadsheet unload guard is dirty', async ({
  page,
}) => {
  await setup(page)
  await page.evaluate(() => {
    window.panePageFixture.guard(true)
    window.panePageFixture.startClose('dirty')
  })
  await expect
    .poll(async () => (await snapshot(page)).outcomes.dirty)
    .toBe(false)
  await page.evaluate(() => window.panePageFixture.navigate('/materials/gamma'))
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() => {
    window.panePageFixture.guard(false)
    window.panePageFixture.startClose('clean')
  })
  await expect
    .poll(async () => (await snapshot(page)).outcomes.clean)
    .toBe(true)
})

test('asks Save, Discard or Cancel when its own page holds unsaved edits', async ({
  page,
}) => {
  await setup(page)
  await page.evaluate(() => {
    window.panePageFixture.pendingEdit(true)
    window.panePageFixture.startClose('second', 'second')
  })
  await expect
    .poll(async () => (await snapshot(page)).outcomes.second)
    .toBe(true)
  await page.evaluate(() => window.panePageFixture.startClose('cancel'))
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes.cancel)
    .toBe(false)
  expect((await snapshot(page)).discarded).toBe(0)
  await page.evaluate(() => window.panePageFixture.startClose('discard'))
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes.discard)
    .toBe(true)
  expect((await snapshot(page)).discarded).toBe(1)
  await page.evaluate(() => window.panePageFixture.startClose('save'))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).outcomes.save).toBe(true)
  expect((await snapshot(page)).saved).toBe(1)
  await page.evaluate(() => window.panePageFixture.pendingEdit(false))
})

test('sends authentication destinations to the outer router, not a pane document', async ({
  page,
}) => {
  await setup(page)
  await page.evaluate(() =>
    window.panePageFixture.navigate('/sign-in?next=%2Fmaterials'),
  )
  expect((await snapshot(page)).outerHref).toBe('/sign-in?next=%2Fmaterials')
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
})

test('refreshes inherited permission context without remounting or reporting unchanged locations', async ({
  page,
}) => {
  await setup(page)
  expect(await page.getByLabel('Role').allTextContents()).toEqual([
    'member',
    'member',
  ])

  const notifications = (await snapshot(page)).events.filter(
    (event) => event.kind === 'location',
  ).length

  await page.evaluate(() => window.panePageFixture.rerender({ role: 'admin' }))
  await expect
    .poll(() => page.getByLabel('Role').allTextContents())
    .toEqual(['admin', 'admin'])
  expect((await snapshot(page)).sameHandles).toBe(true)
  expect(
    (await snapshot(page)).events.filter((event) => event.kind === 'location'),
  ).toHaveLength(notifications)
  await page.evaluate(() => window.panePageFixture.rerender({ role: 'admin' }))
  expect(
    (await snapshot(page)).events.filter((event) => event.kind === 'location'),
  ).toHaveLength(notifications)
})

test('protects Studio-style raw history pushes with unload guards and real resolver approval', async ({
  page,
}) => {
  const { first, second } = await setup(page, true)
  await page.evaluate(() => window.panePageFixture.guard(true))
  await first.getByRole('button', { name: 'Studio hand-off' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    first.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() => window.panePageFixture.guard(false))
  await first.getByRole('button', { name: 'Studio hand-off' }).click()
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    first.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await first.getByRole('button', { name: 'Studio hand-off' }).click()
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect(
    first.getByRole('heading', { name: 'Buffer gamma' }),
  ).toBeVisible()
  await expect(
    second.getByRole('heading', { name: 'Buffer beta' }),
  ).toBeAttached()
  await expect
    .poll(async () => (await snapshot(page)).events)
    .toContainEqual({
      generation: 'old',
      pane: 'first',
      kind: 'location',
      value: '/materials/gamma?source=studio#result',
    })
})

test('runs real resolver blockers for close and settles refused navigation without changing the page', async ({
  page,
}) => {
  await setup(page, true)
  await page.evaluate(() => window.panePageFixture.startClose('close-stay'))
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes['close-stay'])
    .toBe(false)
  await page.evaluate(() =>
    window.panePageFixture.startNavigate('navigate-stay', '/materials/gamma'),
  )
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes['navigate-stay'])
    .toBe('done')
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() => window.panePageFixture.startClose('close-leave'))
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes['close-leave'])
    .toBe(true)
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.panePageFixture.startNavigate('navigate-leave', '/materials/gamma'),
  )
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect
    .poll(async () => (await snapshot(page)).outcomes['navigate-leave'])
    .toBe('done')
  await expect(
    page.getByRole('heading', { name: 'Buffer gamma' }),
  ).toBeVisible()
})

test('settles an in-flight close on unmount and stops location callbacks', async ({
  page,
}) => {
  await setup(page, true)
  await page.evaluate(() => window.panePageFixture.startClose('closing'))
  await expect(
    page.getByRole('dialog', { name: 'Unsaved notebook' }),
  ).toBeVisible()
  await page.evaluate(() => window.panePageFixture.unmount())
  await expect
    .poll(async () => (await snapshot(page)).outcomes.closing)
    .toBe(false)

  const count = (await snapshot(page)).events.filter(
    (event) => event.kind === 'location',
  ).length

  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 10)))
  expect(
    (await snapshot(page)).events.filter((event) => event.kind === 'location'),
  ).toHaveLength(count)
})

test('settles a superseded navigation and a navigation cancelled by unmount', async ({
  page,
}) => {
  await setup(page, true)
  await page.evaluate(() =>
    window.panePageFixture.startNavigate('first', '/materials/gamma'),
  )
  await expect(
    page.getByRole('dialog', { name: 'Unsaved notebook' }),
  ).toBeVisible()
  await page.evaluate(() =>
    window.panePageFixture.startNavigate('second', '/materials/delta'),
  )
  await expect
    .poll(async () => (await snapshot(page)).outcomes.first)
    .toBe('done')
  await expect(
    page.getByRole('heading', { name: 'Buffer alpha' }),
  ).toBeVisible()
  await page.evaluate(() => window.panePageFixture.unmount())
  await expect
    .poll(async () => (await snapshot(page)).outcomes.second)
    .toBe('done')
})

test('uses latest committed pane reports and onReady cleanup without replacing router handles', async ({
  page,
}) => {
  const { first } = await setup(page)
  await page.evaluate(() =>
    window.panePageFixture.rerender({ generation: 'current' }),
  )
  await expect(page.getByLabel('Callback generation')).toHaveText('current')
  const beforeReports = (await snapshot(page)).events.length

  await first.getByRole('button', { name: 'Publish pane reports' }).click()

  const reports = (await snapshot(page)).events
    .slice(beforeReports)
    .filter((event) =>
      ['newer', 'select', 'frozen', 'missing', 'primary'].includes(event.kind),
    )

  expect(reports).toEqual([
    {
      generation: 'current',
      pane: 'first',
      kind: 'newer',
      value: 'revision-2',
    },
    { generation: 'current', pane: 'first', kind: 'select', value: 'row-b' },
    { generation: 'current', pane: 'first', kind: 'frozen', value: 'approved' },
    { generation: 'current', pane: 'first', kind: 'missing', value: true },
    { generation: 'current', pane: 'first', kind: 'primary', value: null },
  ])
  await page.evaluate(() => window.panePageFixture.navigate('/materials/gamma'))
  expect((await snapshot(page)).events).toContainEqual({
    generation: 'current',
    pane: 'first',
    kind: 'location',
    value: '/materials/gamma',
  })
  expect((await snapshot(page)).sameHandles).toBe(true)
  expect(
    (await snapshot(page)).events.filter(
      (event) => event.kind === 'ready' && event.value === true,
    ),
  ).toHaveLength(2)
  await page.evaluate(() => window.panePageFixture.unmount())
  expect(
    (await snapshot(page)).events.filter(
      (event) => event.kind === 'ready' && event.value === false,
    ),
  ).toEqual([
    { generation: 'current', pane: 'first', kind: 'ready', value: false },
    { generation: 'current', pane: 'second', kind: 'ready', value: false },
  ])
})

test('rejects callback publication from an abandoned suspended render', async ({
  page,
}) => {
  const { first } = await setup(page)
  await page.evaluate(() =>
    window.panePageFixture.rerender(
      { generation: 'abandoned', pending: true },
      true,
    ),
  )
  await expect
    .poll(async () => (await snapshot(page)).suspensions)
    .toBeGreaterThan(0)
  await expect(page.getByLabel('Callback generation')).toHaveText('old')
  const beforeReports = (await snapshot(page)).events.length

  await first.getByRole('button', { name: 'Publish pane reports' }).click()

  const reports = (await snapshot(page)).events
    .slice(beforeReports)
    .filter((event) =>
      ['newer', 'select', 'frozen', 'missing', 'primary'].includes(event.kind),
    )

  expect(reports.map((event) => event.generation)).toEqual([
    'old',
    'old',
    'old',
    'old',
    'old',
  ])
  await page.evaluate(() => window.panePageFixture.navigate('/materials/gamma'))
  await expect(
    first.getByRole('heading', { name: 'Buffer gamma' }),
  ).toBeVisible()
  expect((await snapshot(page)).events).toContainEqual({
    generation: 'old',
    pane: 'first',
    kind: 'location',
    value: '/materials/gamma',
  })
  expect((await snapshot(page)).sameHandles).toBe(true)
  await page.evaluate(() => window.panePageFixture.unmount())
  expect(
    (await snapshot(page)).events.filter(
      (event) => event.generation === 'abandoned',
    ),
  ).toEqual([])
})

test('preserves read-only, editing-pane and linked selection context through rerenders', async ({
  page,
}) => {
  const { first } = await setup(page)
  await page.evaluate(() =>
    window.panePageFixture.rerender({
      readOnly: true,
      editingPane: { identifier: 'MAT-primary', sameRecord: true },
      followedSelection: 'row-c',
    }),
  )
  await expect(first.getByLabel('Pane access')).toHaveText('read-only')
  await expect(
    first.getByRole('button', { name: 'Fixture edit action' }),
  ).toBeDisabled()
  await expect(first.getByLabel('Editing pane')).toHaveText('MAT-primary:true')
  await expect(first.getByLabel('Followed selection')).toHaveText('row-c')
  await page.evaluate(() =>
    window.panePageFixture.rerender({
      editingPane: { identifier: 'MAT-other', sameRecord: false },
    }),
  )
  await expect(first.getByLabel('Editing pane')).toHaveText('MAT-other:false')
  await page.evaluate(() =>
    window.panePageFixture.rerender({
      readOnly: false,
      editingPane: undefined,
      followedSelection: undefined,
    }),
  )
  await expect(first.getByLabel('Pane access')).toHaveText('editable')
  await expect(
    first.getByRole('button', { name: 'Fixture edit action' }),
  ).toBeEnabled()
  await expect(first.getByLabel('Editing pane')).toHaveText(':undefined')
  await expect(first.getByLabel('Followed selection')).toHaveText('')
  expect((await snapshot(page)).sameHandles).toBe(true)
})

test('builds typed route options without href while retaining query-independent pane state', async ({
  page,
}) => {
  const { first, second } = await setup(page)
  await first
    .getByRole('button', { name: 'Navigate with typed options' })
    .click()
  await expect(
    first.getByRole('heading', { name: 'Buffer gamma' }),
  ).toBeVisible()
  await expect(
    second.getByRole('heading', { name: 'Buffer beta' }),
  ).toBeAttached()
  await expect
    .poll(async () => (await snapshot(page)).events)
    .toContainEqual({
      generation: 'old',
      pane: 'first',
      kind: 'location',
      value: '/materials/gamma#details',
    })
  expect((await snapshot(page)).sameHandles).toBe(true)
})
