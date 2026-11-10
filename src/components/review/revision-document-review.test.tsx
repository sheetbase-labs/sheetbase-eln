import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Suspense, startTransition, useState } from 'react'
import type { ReactNode } from 'react'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { CanonicalRevisionEnvelope } from '#/lib/revision-diff'
import { buildRevisionDocument } from '#/lib/revision-document'
import {
  DOCUMENT_REVISION_ID,
  EARLIER_REVISION_ID,
  commentFixture,
  documentFixtures,
} from '#/lib/revision-document.test-fixtures'

import { RevisionDocumentReview } from './revision-document-review'

// Production notebook clients capture fetch at import time. Control only their
// HTTP transport; the real notebook previews and DataClient still run.
const transport = vi.hoisted(() => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)

  return fetcher
})

beforeEach(() => {
  transport.mockReset()
  transport.mockImplementation(() =>
    Promise.reject(new Error('Unexpected live read from a frozen revision')),
  )
})

afterEach(() => {
  cleanup()
  expect(transport).not.toHaveBeenCalled()
})

afterAll(() => vi.unstubAllGlobals())

function renderDocument(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

function blockSection(container: HTMLElement, blockId: string) {
  const section = container.querySelector<HTMLElement>(
    `[data-doc-block="${blockId}"]`,
  )

  if (!section) throw new Error(`no document block ${blockId}`)

  return section
}

describe('RevisionDocumentReview', () => {
  it('marks insertions and deletions inline and leaves unchanged content unmarked', () => {
    const { before, after } = documentFixtures()

    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
      />,
    )

    // Insertion: the added block reads inside <ins>.
    const inserted = screen.getByText(
      'Harvest at 72 h and measure genome titre.',
    )

    expect(inserted.closest('ins')).not.toBeNull()

    // Deletion: the removed block keeps its frozen text inside <del>.
    const deleted = screen.getByText('Remove after review.')
    expect(deleted.closest('del')).not.toBeNull()

    // Inline marks for the changed sentence.
    expect(screen.getByLabelText('Removed text').textContent).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    )
    expect(screen.getByLabelText('Inserted text').textContent).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
    )

    // Unchanged content renders plainly: no marks, no change gutter.
    const unchanged = blockSection(container, 'block-objective')
    expect(unchanged.querySelector('ins, del, [data-doc-gutter]')).toBeNull()
    expect(screen.getByText('Measure virus stability at 4 °C.')).toBeTruthy()

    // One Δ per changed block, and the change card sits inside the block.
    expect(container.querySelectorAll('[data-doc-gutter]')).toHaveLength(3)
    expect(
      blockSection(container, 'block-method').querySelector(
        '[data-doc-location]',
      ),
    ).not.toBeNull()
    expect(screen.getAllByText('Δ').length).toBe(3)
  })

  it('anchors a comment to its block and keeps it navigable both ways', () => {
    const { before, after } = documentFixtures()

    const comment = commentFixture({
      id: 'comment-block',
      target_kind: 'block',
      target: { blockId: 'block-method' },
      body: 'This seeding density needs a citation.',
    })

    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[comment]}
      />,
    )

    // Location → comment: the block's marker focuses the comment card.
    const marker = screen.getByRole('button', {
      name: /Show 1 comment on/,
    })

    fireEvent.click(marker)
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'comment-block',
    )

    // Comment → location: the card's action focuses the block it is about.
    fireEvent.click(
      screen.getByRole('button', { name: /Show the place this comment/ }),
    )
    expect(document.activeElement?.getAttribute('data-doc-location')).toBe(
      'block-method',
    )
    expect(blockSection(container, 'block-method').className).toContain(
      'ring-2',
    )
  })

  it('reports a comment that no longer applies instead of re-anchoring it', () => {
    const { before, after } = documentFixtures()

    const textChange = buildRevisionDocument(before, after).diff.changes.find(
      (change) => change.area === 'text',
    )!

    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-earlier-round',
            revision_id: 'rev-first-round',
            target_kind: 'block',
            target: { blockId: 'block-method' },
            body: 'Reword this method line.',
          }),
          commentFixture({
            id: 'comment-other-comparison',
            target_kind: 'diff',
            target: {
              comparisonRevisionId: 'rev-third-round',
              changeId: textChange.id,
            },
            body: 'This change is too large.',
          }),
        ]}
      />,
    )

    const region = screen.getByRole('region', {
      name: 'Comments that no longer apply to this revision',
    })

    expect(region.textContent).toContain('Reword this method line.')
    expect(region.textContent).toContain('This change is too large.')
    expect(region.textContent).toContain(
      'Anchored to an earlier revision of this record.',
    )
    expect(region.textContent).toContain(
      'Written against a different comparison revision.',
    )
    // Nothing is re-anchored: neither thread renders beside the block or change
    // it was originally written against.
    expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(2)
    expect(
      blockSection(container, 'block-method').querySelector(
        '[data-comment-id]',
      ),
    ).toBeNull()
    expect(screen.queryByRole('group', { name: /Comments on/ })).toBeNull()
  })

  it('reads a change-anchored comment beside the change it was written against', () => {
    const { before, after } = documentFixtures()

    const textChange = buildRevisionDocument(before, after).diff.changes.find(
      (change) => change.area === 'text',
    )!

    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-change',
            target_kind: 'diff',
            target: {
              comparisonRevisionId: EARLIER_REVISION_ID,
              changeId: textChange.id,
              area: textChange.area,
              identity: textChange.identity,
            },
            body: 'Name the transfection reagent here.',
          }),
        ]}
      />,
    )

    const change = container.querySelector<HTMLElement>(
      `[data-doc-location="${textChange.id}"]`,
    )

    expect(change).not.toBeNull()
    expect(change?.querySelector('[data-comment-id]')).not.toBeNull()
    expect(
      screen.getByRole('group', { name: 'Comments on this change' })
        .textContent,
    ).toContain('Name the transfection reagent here.')
  })

  it('keeps a comment on an unmarked part of the revision instead of dropping it', () => {
    const { before, after } = documentFixtures()
    renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-table',
            target_kind: 'table_region',
            target: { tableId: 'table-1', columnId: 'col-1' },
            body: 'Confirm the titre unit.',
          }),
        ]}
      />,
    )

    const region = screen.getByRole('region', {
      name: 'Comments anchored to unmarked parts of this revision',
    })

    expect(region.textContent).toContain('Confirm the titre unit.')
    expect(
      screen.queryByRole('region', {
        name: 'Comments that no longer apply to this revision',
      }),
    ).toBeNull()
  })

  it('renders frozen facts instead of reading live content', () => {
    const { after } = documentFixtures()

    const frozen: CanonicalRevisionEnvelope = {
      ...after,
      blocks: [
        ...after.blocks,
        {
          id: 'block-sheet',
          type: 'sheet',
          order: 5,
          version: 1,
          payloadSchemaVersion: 1,
          payload: { instanceId: 'instance-1' },
        },
        {
          id: 'block-file',
          type: 'file',
          order: 6,
          version: 1,
          payloadSchemaVersion: 1,
          payload: {
            fileRecordId: 'file-1',
            displayName: 'raw-data.csv',
            mediaType: 'text/csv',
            byteSize: 2048,
          },
        },
      ],
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderDocument(<RevisionDocumentReview after={frozen} before={after} />)

    expect(
      screen.getByText(/no frozen Sheet evidence for this block/i),
    ).toBeTruthy()
    expect(screen.getByText('Media type')).toBeTruthy()
    expect(screen.getByText('text/csv')).toBeTruthy()
    expect(
      screen.getAllByText(/A frozen revision never loads live content/i).length,
    ).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
    [0, '0'],
    [-0, '0'],
    [false, 'false'],
    [true, 'true'],
    ['  frozen size  ', 'frozen size'],
  ])('keeps the native frozen scalar %s readable', (byteSize, expected) => {
    const { after } = documentFixtures()

    renderDocument(
      <RevisionDocumentReview
        after={{
          ...after,
          blocks: [{ id: 'file-native', type: 'file', payload: { byteSize } }],
        }}
      />,
    )

    expect(screen.getByText(String(expected))).toBeTruthy()
  })

  it('accepts inherited frozen facts without reading live content', () => {
    const { after } = documentFixtures()

    class FrozenFileFacts {
      get mediaType() {
        return 'application/x-frozen'
      }
    }

    renderDocument(
      <RevisionDocumentReview
        after={{
          ...after,
          blocks: [
            {
              id: 'file-inherited',
              type: 'file',
              payload: new FrozenFileFacts(),
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('application/x-frozen')).toBeTruthy()
  })

  it('keeps repeated frozen preview getter reads in native evaluation order', () => {
    const { after } = documentFixtures()
    const source = after.blocks.find((block) => block.id === 'block-objective')

    if (!source) throw new Error('Missing objective fixture')

    const reads: string[] = []

    const block = {
      get id() {
        reads.push('id')

        return source.id
      },
      get payload() {
        reads.push('payload')

        return source.payload
      },
      get type() {
        reads.push('type')

        return source.type
      },
      get payloadSchemaVersion() {
        reads.push('payloadSchemaVersion')

        return 1
      },
      get order() {
        reads.push('order')

        return NaN
      },
      get version() {
        reads.push('version')

        return Infinity
      },
    }

    renderDocument(
      <RevisionDocumentReview after={{ ...after, blocks: [block] }} />,
    )

    expect(screen.getByText('Measure virus stability at 4 °C.')).toBeTruthy()
    expect(reads.slice(-11)).toEqual([
      'payload',
      'payload',
      'id',
      'type',
      'type',
      'payloadSchemaVersion',
      'payloadSchemaVersion',
      'order',
      'order',
      'version',
      'version',
    ])
  })

  it('preserves native record identity string coercion', () => {
    const { after } = documentFixtures()
    const hints: string[] = []

    const id = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint)

        return 'record-native'
      },
    }

    renderDocument(
      <RevisionDocumentReview
        after={{ ...after, record: { ...after.record, id } }}
      />,
    )

    // The diff owner reads the identity first; the preview adapter reads it next.
    expect(hints).toEqual(['string', 'string'])
    expect(screen.getByText('Measure virus stability at 4 °C.')).toBeTruthy()
  })

  it('does not swallow native record identity coercion exceptions', () => {
    const { after } = documentFixtures()
    const failure = new Error('Frozen identity cannot be stringified')

    const id = {
      [Symbol.toPrimitive]() {
        throw failure
      },
    }

    expect(() =>
      renderDocument(
        <RevisionDocumentReview
          after={{ ...after, record: { ...after.record, id } }}
        />,
      ),
    ).toThrow(failure)
  })

  it('renders production notebook links with the actual router provider', () => {
    const { after } = documentFixtures()

    renderDocument(
      <RevisionDocumentReview
        after={{
          ...after,
          blocks: [
            {
              id: 'linked-dataset',
              type: 'linked_record',
              payloadSchemaVersion: 1,
              payload: {
                targetKind: 'dataset',
                targetId: 'dataset-frozen',
                targetIdentifier: 'DATA-1',
              },
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/datasets/dataset-frozen',
    )
    expect(screen.getByText('DATA-1')).toBeTruthy()
  })

  it('focuses a deep-linked comment and preserves two-way navigation after prop changes', () => {
    const { before, after } = documentFixtures()

    const comments = [
      commentFixture({
        id: 'first',
        target_kind: 'block',
        target: { blockId: 'block-method' },
      }),
      commentFixture({
        id: 'second',
        target_kind: 'block',
        target: { blockId: 'block-objective' },
      }),
    ]

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })

    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    function review(focusCommentId: string) {
      return (
        <QueryClientProvider client={client}>
          <RouterContextProvider router={router}>
            <RevisionDocumentReview
              after={after}
              before={before}
              revisionId={DOCUMENT_REVISION_ID}
              comments={comments}
              focusCommentId={focusCommentId}
            />
          </RouterContextProvider>
        </QueryClientProvider>
      )
    }

    const { container, rerender } = render(review('first'))
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'first',
    )
    expect(
      container.querySelector('[data-comment-id="first"]')?.className,
    ).toContain('ring-2')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show the place this comment is about, first',
      }),
    )
    expect(document.activeElement?.getAttribute('data-doc-location')).toBe(
      'block-method',
    )
    rerender(review('second'))
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'second',
    )
    expect(
      container.querySelector('[data-comment-id="second"]')?.className,
    ).toContain('ring-2')
  })

  it('resets manual highlighting when anchors change and ignores unmatched focus requests', () => {
    const { before, after } = documentFixtures()

    const comment = commentFixture({
      id: 'anchor-focus',
      target_kind: 'block',
      target: { blockId: 'block-method' },
    })

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })

    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    function review(
      comments: readonly ReturnType<typeof commentFixture>[],
      focusCommentId = 'anchor-focus',
    ) {
      return (
        <QueryClientProvider client={client}>
          <RouterContextProvider router={router}>
            <RevisionDocumentReview
              after={after}
              before={before}
              revisionId={DOCUMENT_REVISION_ID}
              comments={comments}
              focusCommentId={focusCommentId}
            />
          </RouterContextProvider>
        </QueryClientProvider>
      )
    }

    const comments = [comment]
    const { container, rerender } = render(review(comments))
    const location = blockSection(container, 'block-method')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show the place this comment is about, anchor-focus',
      }),
    )
    expect(location.className).toContain('ring-2')
    rerender(review(comments, 'not-available'))
    expect(document.activeElement).toBe(location)
    expect(location.className).toContain('ring-2')
    rerender(review([...comments]))
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'anchor-focus',
    )
    expect(location.className).not.toContain('ring-2')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show the place this comment is about, anchor-focus',
      }),
    )
    rerender(review([...comments]))
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'anchor-focus',
    )
    expect(
      container.querySelector('[data-comment-id="anchor-focus"]')?.className,
    ).toContain('ring-2')
  })

  it('does not commit highlight or focus from an abandoned Suspense render', async () => {
    const { before, after } = documentFixtures()

    const comments = [
      commentFixture({
        id: 'first',
        target_kind: 'block',
        target: { blockId: 'block-method' },
      }),
      commentFixture({
        id: 'second',
        target_kind: 'block',
        target: { blockId: 'block-objective' },
      }),
    ]

    const identityReads: string[] = []

    const observedAfter = {
      ...after,
      record: {
        ...after.record,
        get id() {
          identityReads.push('read')

          return after.record.id
        },
      },
    }

    const pending = new Promise<never>(() => undefined)

    function PendingDocument({ suspend }: { suspend: boolean }) {
      if (suspend) throw pending

      return null
    }

    function ConcurrentReview() {
      const [request, setRequest] = useState({
        focusCommentId: 'first',
        suspend: false,
      })

      return (
        <>
          <button
            onClick={() =>
              startTransition(() =>
                setRequest({ focusCommentId: 'second', suspend: true }),
              )
            }
          >
            Review second later
          </button>
          <button
            onClick={() =>
              setRequest({ focusCommentId: 'first', suspend: false })
            }
          >
            Cancel pending review
          </button>
          <button
            onClick={() =>
              setRequest({ focusCommentId: 'second', suspend: false })
            }
          >
            Commit second review
          </button>
          <Suspense fallback={<p>Waiting for revision</p>}>
            <RevisionDocumentReview
              after={observedAfter}
              before={before}
              revisionId={DOCUMENT_REVISION_ID}
              comments={comments}
              focusCommentId={request.focusCommentId}
            />
            <PendingDocument suspend={request.suspend} />
          </Suspense>
        </>
      )
    }

    const { container } = renderDocument(<ConcurrentReview />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show the place this comment is about, first',
      }),
    )
    const location = blockSection(container, 'block-method')
    const readsBeforeTransition = identityReads.length
    expect(document.activeElement).toBe(location)
    expect(location.className).toContain('ring-2')
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Review second later' }),
      )
    })
    expect(identityReads.length).toBeGreaterThan(readsBeforeTransition)
    expect(screen.queryByText('Waiting for revision')).toBeNull()
    expect(document.activeElement).toBe(location)
    expect(location.className).toContain('ring-2')
    expect(
      container.querySelector('[data-comment-id="second"]')?.className,
    ).not.toContain('ring-2')
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel pending review' }),
    )
    expect(document.activeElement).toBe(location)
    expect(location.className).toContain('ring-2')
    expect(
      container.querySelector('[data-comment-id="first"]')?.className,
    ).not.toContain('ring-2')
    fireEvent.click(
      screen.getByRole('button', { name: 'Commit second review' }),
    )
    expect(document.activeElement?.getAttribute('data-comment-id')).toBe(
      'second',
    )
    expect(
      container.querySelector('[data-comment-id="second"]')?.className,
    ).toContain('ring-2')
    expect(location.className).not.toContain('ring-2')
  })

  it('hides the change marks on request but keeps the anchored comments', () => {
    const { before, after } = documentFixtures()

    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-block',
            target_kind: 'block',
            target: { blockId: 'block-method' },
          }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide change marks' }))

    expect(container.querySelectorAll('[data-doc-gutter]')).toHaveLength(0)
    expect(container.querySelector('ins')).toBeNull()
    expect(screen.queryByLabelText('Removed text')).toBeNull()
    expect(container.querySelector('[data-comment-id]')).not.toBeNull()
  })
})
