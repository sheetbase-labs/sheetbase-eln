import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { OfficeSheet } from '#/lib/office-sheet'
import { MakeSheetFromFile } from './make-sheet-from-file'

afterEach(cleanup)

it('previews the chosen pinned worksheet and passes its cached values and formula provenance to creation', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  const sheets: OfficeSheet[] = [
    { name: 'Ignore', rows: [[{ value: 'Other' }], [{ value: 99 }]] },
    {
      name: 'Plate',
      rows: [
        [{ value: 'Recovery' }, { value: 'Accepted' }, { value: 'Calculated' }],
        [{ value: 5.75 }, { value: false }, { value: 6.25, formula: 'A2+0.5' }],
      ],
    },
  ]

  client.setQueryData(['office-workbook', 'file-1', 3], sheets)
  const make = vi.fn(async () => {})
  render(
    <QueryClientProvider client={client}>
      <MakeSheetFromFile
        fileRecordId="file-1"
        fileVersion={3}
        fileName="plate.xlsx"
        mediaType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onMake={make}
      />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Make a sheet' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
  const table = screen.getByRole('table')
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Recovery', 'Accepted', 'Calculated'])
  expect(
    within(table)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['5.75', 'FALSE', '6.25'])
  expect(screen.getByText(/A2\+0.5/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Make sheet' }))
  await waitFor(() =>
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Plate',
        made: expect.objectContaining({ rowCount: 1, columnCount: 3 }),
      }),
    ),
  )
})
