/**
 * FIND-03 — RelatedWorkPanel component tests.
 *
 * Rendering, destination links and the silent-empty contract, with the live
 * query hook mocked at the module boundary.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as RelatedWork from '#/lib/related-work'
import { RelatedWorkList, RelatedWorkPanel } from './related-work-panel'
import { useRelatedWork } from '#/lib/related-work'
import type { RelatedWorkItem } from '#/lib/related-work'

vi.mock('#/lib/related-work', async (importOriginal) => {
  const actual = await importOriginal<typeof RelatedWork>()
  return { ...actual, useRelatedWork: vi.fn() }
})

const mockedHook = vi.mocked(useRelatedWork)

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const items: RelatedWorkItem[] = [
  {
    kind: 'record',
    id: 'rec-2',
    recordKind: 'experiment',
    label: 'Second run',
    identifier: 'EXP-2',
    reason: 'Linked to EXP-2',
    destination: '/records/rec-2',
  },
  {
    kind: 'dataset',
    id: 'ds-1',
    recordKind: null,
    label: 'Assay data',
    identifier: null,
    reason: 'Derived from dataset Assay data',
    destination: '/datasets?dataset=ds-1',
  },
]

describe('RelatedWorkList', () => {
  it('renders kind labels, titles, reasons and destination links', () => {
    render(<RelatedWorkList items={items} />)
    expect(screen.getByText('Second run')).toBeTruthy()
    expect(screen.getByText(/Linked to EXP-2/)).toBeTruthy()
    expect(screen.getByText(/Derived from dataset Assay data/)).toBeTruthy()
    const recordLink = screen.getByRole('link', { name: /Second run/ })
    expect(recordLink.getAttribute('href')).toBe('/records/rec-2')
    const datasetLink = screen.getByRole('link', { name: /Assay data/ })
    expect(datasetLink.getAttribute('href')).toBe('/datasets?dataset=ds-1')
  })
})

describe('RelatedWorkPanel', () => {
  it('shows a loading hint while fetching', () => {
    mockedHook.mockReturnValue({ data: undefined, isLoading: true } as never)
    render(<RelatedWorkPanel kind="record" id="rec-1" />)
    expect(screen.getByText(/Loading related work/)).toBeTruthy()
  })

  it('stays silent when there is nothing related', () => {
    mockedHook.mockReturnValue({ data: [], isLoading: false } as never)
    const { container } = render(
      <RelatedWorkPanel kind="record" id="rec-1" />,
    )
    expect(container.textContent).toBe('')
  })

  it('renders the section once items resolve', () => {
    mockedHook.mockReturnValue({ data: items, isLoading: false } as never)
    render(<RelatedWorkPanel kind="record" id="rec-1" />)
    expect(screen.getByText('Related work')).toBeTruthy()
    expect(screen.getByText('Second run')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Assay data/ }).getAttribute('href'),
    ).toBe('/datasets?dataset=ds-1')
  })
})
