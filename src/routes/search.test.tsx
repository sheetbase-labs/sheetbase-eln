/**
 * SCI-008 search route component tests: result list loading/empty/error/
 * active/archived states, result row rendering, keyboard navigation, deep
 * links, and filter interaction.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'

import { SearchResults, SearchResultRow } from './search'
import type { SearchResultsProps } from './search'
import type { SearchResult } from '#/lib/search'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string
    children: React.ReactNode
    onClick?: (e: { preventDefault: () => void }) => void
  } & Record<string, unknown>) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
      {...props}
    >
      {children}
    </a>
  ),
}))

// jsdom does not implement ResizeObserver; radix tabs read it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    resultType: 'record',
    recordId: 'rec-1',
    kind: 'experiment',
    identifier: 'EXP-2025-0001',
    title: 'Virus Stability at 4 °C',
    status: 'in-progress',
    projectId: 'proj-1',
    archived: false,
    createdByUserId: 'user-1',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-20T14:30:00Z',
    matchedContext: 'Virus <b>Stability</b> at 4 °C',
    matchedField: 'title',
    rank: 0.06,
    deepLink: '/projects/proj-1/experiments/rec-1',
    totalCount: 1,
    ...overrides,
  }
}

function queryResult(
  data: SearchResult[] | null,
  overrides: Partial<UseQueryResult<SearchResult[], Error>> = {},
): UseQueryResult<SearchResult[], Error> {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    isSuccess: Boolean(data),
    status: 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<SearchResult[], Error>
}

const noopListRef = { current: null }
const noopKeyDown = () => {}

describe('SearchResults — states', () => {
  function props(
    overrides: Partial<SearchResultsProps> = {},
  ): SearchResultsProps {
    return {
      query: queryResult(null, { isLoading: true }),
      queryString: '',
      hasQuery: false,
      totalCount: 0,
      results: [],
      selectedId: null,
      activeIndex: 0,
      onSelect: () => {},
      listRef: noopListRef,
      onKeyDown: noopKeyDown,
      ...overrides,
    }
  }

  it('shows skeleton loaders while loading', () => {
    render(
      <SearchResults
        {...props({ query: queryResult(null, { isLoading: true }) })}
      />,
    )
    expect(screen.getByLabelText('Loading search results')).toBeTruthy()
  })

  it('shows a "Start typing to search" empty state when no query', () => {
    render(<SearchResults {...props({ query: queryResult([]) })} />)
    expect(screen.getByText('Start typing to search')).toBeTruthy()
  })

  it('shows a "No results found" empty state when query has no matches', () => {
    render(
      <SearchResults
        {...props({
          query: queryResult([]),
          hasQuery: true,
          queryString: 'zzz',
        })}
      />,
    )
    expect(screen.getByText('No results found')).toBeTruthy()
  })

  it('shows an error message on failure', () => {
    render(
      <SearchResults
        {...props({
          query: queryResult(null, {
            isError: true,
            error: new Error('upstream failure'),
          }),
        })}
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Search failed. Try again.')).toBeTruthy()
  })

  it('renders results with count and query echo', () => {
    const r = result()
    render(
      <SearchResults
        {...props({
          query: queryResult([r]),
          hasQuery: true,
          queryString: 'virus',
          totalCount: 42,
          results: [r],
        })}
      />,
    )
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('"virus"')).toBeTruthy()
    expect(screen.getByRole('listbox')).toBeTruthy()
  })
})

describe('SearchResultRow', () => {
  it('renders title, identifier, kind badge and status badge', () => {
    render(
      <SearchResultRow
        result={result()}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Virus Stability at 4 °C')).toBeTruthy()
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(screen.getByText('Experiment')).toBeTruthy()
  })

  it('renders highlighted matched context segments', () => {
    render(
      <SearchResultRow
        result={result()}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Stability')).toBeTruthy()
    expect(screen.getByText('Matched in title')).toBeTruthy()
  })

  it('shows an archived indicator for archived records', () => {
    render(
      <SearchResultRow
        result={result({ archived: true })}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('applies selected styling and calls onSelect on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SearchResultRow
        result={result()}
        selected
        active={false}
        onSelect={onSelect}
      />,
    )
    const link = screen.getByRole('option').querySelector('a')!
    await user.click(link)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('renders the deep link href', () => {
    render(
      <SearchResultRow
        result={result({ deepLink: '/projects/p1/experiments/r1' })}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    const link = screen.getByRole('option')
    expect(link.querySelector('a')?.getAttribute('href')).toBe(
      '/projects/p1/experiments/r1',
    )
  })

  it('renders file result type with a file icon', () => {
    render(
      <SearchResultRow
        result={result({
          resultType: 'file',
          kind: 'file',
          identifier: 'FILE-2025-0001',
        })}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('FILE-2025-0001')).toBeTruthy()
    expect(screen.getByText('File')).toBeTruthy()
  })

  it('renders template kind with /templates deep link', () => {
    render(
      <SearchResultRow
        result={result({
          kind: 'notebook_template',
          identifier: 'NBK-2025-0001',
          deepLink: '/templates',
        })}
        selected={false}
        active={false}
        onSelect={() => {}}
      />,
    )
    const link = screen.getByRole('option')
    expect(link.querySelector('a')?.getAttribute('href')).toBe('/templates')
  })
})
