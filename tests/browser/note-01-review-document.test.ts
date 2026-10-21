/**
 * R5-NOTE-01 browser check: the annotated document at phone width.
 *
 * The review workspace's data is mocked at the same-origin `/api/db` boundary
 * so the check is deterministic: one frozen revision with an insertion, a
 * deletion, unchanged content and one comment anchored to a block. The check
 * asserts the review reading surface does not overflow the phone width and that
 * the comment anchors stay usable there.
 */
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/** The design's workspace owner; the review read below is mocked at /api/db. */
const DESIGN_USER = '00000000-0000-4000-8000-000000000310'

const WORKSPACE = '00000000-0000-4000-8000-0000000000aa'
const USER = '00000000-0000-4000-8000-0000000000bb'
const RECORD = '00000000-0000-4000-8000-0000000000cc'
const REVISION = '00000000-0000-4000-8000-0000000000dd'
const EARLIER_REVISION = '00000000-0000-4000-8000-0000000000ee'
const SUBMISSION = '00000000-0000-4000-8000-0000000000ff'
const COMMENT = '00000000-0000-4000-8000-000000000101'
const PHONE_WIDTH = 390

function richText(id: string, order: number, paragraph: string) {
  return {
    id,
    type: 'rich_text',
    order,
    version: 1,
    payloadSchemaVersion: 1,
    payload: {
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: paragraph }] },
        ],
      },
    },
  }
}

function snapshot(blocks: unknown[]) {
  return {
    formatVersion: 1,
    record: {
      id: RECORD,
      identifier: 'EXP-2026-001',
      title: 'Virus stability at 4 °C',
      status: 'completed',
      metadataVersion: 1,
    },
    blocks,
    links: [],
    scientificTables: [],
    formulas: [],
    files: [],
  }
}

const BEFORE_SNAPSHOT = snapshot([
  richText('block-objective', 0, 'Measure virus stability at 4 °C.'),
  richText('block-method', 1, 'Cells were seeded at 2.0 × 10⁶ cells/mL.'),
  richText('block-removed', 2, 'Remove after review.'),
])

const AFTER_SNAPSHOT = snapshot([
  richText('block-objective', 0, 'Measure virus stability at 4 °C.'),
  richText(
    'block-method',
    1,
    'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
  ),
  richText('block-added', 3, 'Harvest at 72 h and measure genome titre.'),
])

function revisionWire(
  id: string,
  createdAt: string,
  canonical: unknown,
  supersededBy: string | null,
) {
  return {
    id,
    workspace_id: WORKSPACE,
    record_id: RECORD,
    structure_version: 1,
    metadata_version: 1,
    metadata_snapshot: {
      title: 'Virus stability at 4 °C',
      status: 'completed',
    },
    block_snapshot: [],
    canonical_snapshot: canonical,
    integrity_algorithm: 'sha256',
    integrity_digest: 'a'.repeat(64),
    reason: 'submit',
    superseded_by_revision_id: supersededBy,
    created_at: createdAt,
    created_by_user_id: USER,
  }
}

const SUBMITTED_REVISION = revisionWire(
  REVISION,
  '2026-10-01T09:00:00Z',
  AFTER_SNAPSHOT,
  null,
)
const COMPARISON_REVISION = revisionWire(
  EARLIER_REVISION,
  '2026-09-20T09:00:00Z',
  BEFORE_SNAPSHOT,
  REVISION,
)

const SUBMISSION_WIRE = {
  id: SUBMISSION,
  workspace_id: WORKSPACE,
  record_id: RECORD,
  revision_id: REVISION,
  state: 'submitted',
  workflow_definition_key: 'default-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: [USER],
  submitted_by_user_id: USER,
  submitted_session_id: 'session-1',
  submitted_role: 'member',
  submitted_at: '2026-10-01T09:00:00Z',
  due_at: null,
  idempotency_key: 'idem-1',
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-01T09:00:00Z',
}

const BLOCK_COMMENT = {
  id: COMMENT,
  workspace_id: WORKSPACE,
  revision_id: REVISION,
  record_id: RECORD,
  sheet_instance_id: null,
  root_id: COMMENT,
  parent_id: null,
  target_kind: 'block',
  target: { blockId: 'block-method' },
  body: 'This seeding density needs a citation.',
  mentions: [],
  state: 'open',
  resolved_at: null,
  resolved_by_user_id: null,
  author_user_id: USER,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
}

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER)
})

test('the annotated document fits the phone width and keeps its comment anchors usable', async ({
  page,
}) => {
  await page.route('**/api/db/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const query = url.search
    let body: unknown = []
    if (path.endsWith('/revisions')) {
      body = query.includes(`id=eq.${EARLIER_REVISION}`)
        ? [COMPARISON_REVISION]
        : query.includes('record_id=eq.')
          ? [SUBMITTED_REVISION, COMPARISON_REVISION]
          : [SUBMITTED_REVISION]
    } else if (path.endsWith('/review_submissions')) {
      body = [SUBMISSION_WIRE]
    } else if (path.endsWith('/comments')) {
      body = [BLOCK_COMMENT]
    } else if (path.endsWith('/records')) {
      body = [
        {
          id: RECORD,
          workspace_id: WORKSPACE,
          project_id: null,
          kind: 'experiment',
          identifier: 'EXP-2026-001',
          title: 'Virus stability at 4 °C',
          status: 'completed',
          created_at: '2026-09-01T09:00:00Z',
          updated_at: '2026-10-01T09:00:00Z',
          archived_at: null,
          deleted_at: null,
          created_by_user_id: USER,
          structure_version: 1,
          metadata_version: 1,
          tags: [],
          properties: {},
          updated_by_user_id: USER,
          locked_at: null,
          locked_by_revision_id: null,
        },
      ]
    } else if (path.endsWith('/rpc/record_comments')) {
      body = [BLOCK_COMMENT]
    } else if (path.endsWith('/rpc/record_timeline')) {
      body = []
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.goto(`/review/${REVISION}`)

  const document = page.getByRole('region', {
    name: 'Submitted revision document',
  })
  await expect(document).toBeVisible()
  await expect(document.locator('ins').first()).toBeVisible()
  await expect(document.locator('del').first()).toBeVisible()
  await expect(document.locator('[data-doc-gutter]')).toHaveCount(3)

  // Comment ↔ location at desktop width.
  await page.getByRole('button', { name: /Show 1 comment on/ }).click()
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.commentId,
    ),
  ).toBe(COMMENT)
  await page
    .getByRole('button', { name: /Show the place this comment/ })
    .click()
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.docLocation,
    ),
  ).toBe('block-method')

  await page.setViewportSize({ width: PHONE_WIDTH, height: 844 })

  // No horizontal overflow anywhere on the page, and none inside the document.
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
  }))
  expect(overflow.body).toBeLessThanOrEqual(PHONE_WIDTH + 1)
  expect(overflow.root).toBeLessThanOrEqual(PHONE_WIDTH + 1)
  const documentOverflow = await document.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  )
  expect(documentOverflow).toBeLessThanOrEqual(1)

  // The anchors stay usable at phone width.
  const card = page.locator(`[data-comment-id="${COMMENT}"]`)
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: /Show 1 comment on/ }).click()
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.commentId,
    ),
  ).toBe(COMMENT)
  await page
    .getByRole('button', { name: /Show the place this comment/ })
    .click()
  expect(
    await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.docLocation,
    ),
  ).toBe('block-method')
  await page.screenshot({ path: '/tmp/note-01-review-document-phone.png' })

  // The change list stays available as the other reading of the same diff.
  await page.getByRole('tab', { name: 'Change list' }).click()
  await expect(
    page.getByRole('region', { name: 'Revision comparison' }),
  ).toBeVisible()
  await expect(page.getByText('Compare revisions')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Document' })).toHaveAttribute(
    'aria-selected',
    'false',
  )
})
