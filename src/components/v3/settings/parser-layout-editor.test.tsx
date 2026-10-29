import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParserLayoutEditor, tidyLayout } from './parser-layout-editor'
import type { ParserLayout } from '#/lib/import/parser-layout'

afterEach(cleanup)

const FILE = [
  'Serial: SP9-0042',
  'Sample;Conc (mg/mL)',
  'S1;1,5',
  'S2;2,5',
].join('\n')

function Harness({ onUseColumns }: { onUseColumns?: (h: string[]) => void }) {
  const [layout, setLayout] = useState<ParserLayout>({})
  return (
    <>
      <ParserLayoutEditor
        value={layout}
        onChange={setLayout}
        onUseColumns={onUseColumns}
      />
      <output data-testid="layout">{JSON.stringify(tidyLayout(layout))}</output>
    </>
  )
}

describe('ParserLayoutEditor', () => {
  it('shows how a sample file reads as options change', async () => {
    const user = userEvent.setup()
    const onUseColumns = vi.fn()
    render(<Harness onUseColumns={onUseColumns} />)
    expect(
      screen.getByText('Drop a sample file to see how it reads'),
    ).toBeTruthy()

    await user.upload(
      screen.getByLabelText('Try it on a sample file'),
      new File([FILE], 'sp9.csv', { type: 'text/csv' }),
    )
    // Read as a plain table the first line is the only column name.
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader')).toHaveLength(1),
    )

    await user.click(screen.getByLabelText('Keep the details above the table'))
    await user.selectOptions(screen.getByLabelText('Units'), 'header')
    await user.click(
      screen.getByLabelText('Numbers use a decimal comma, like 1,5'),
    )
    await user.selectOptions(
      screen.getByLabelText('The table starts at'),
      'text',
    )
    await user.type(screen.getByLabelText('Line starts with'), 'Sample')

    await waitFor(() =>
      expect(
        screen.getAllByRole('columnheader').map((h) => h.textContent),
      ).toEqual(['Sample', 'Conc']),
    )
    expect(screen.getByText('1.5')).toBeTruthy()
    expect(screen.getByText(/Serial SP9-0042/)).toBeTruthy()
    expect(JSON.parse(screen.getByTestId('layout').textContent!)).toEqual({
      headerStartsWith: 'Sample',
      readDetails: true,
      units: 'header',
      decimalComma: true,
    })

    await user.click(
      screen.getByRole('button', { name: 'Match files with these columns' }),
    )
    expect(onUseColumns).toHaveBeenCalledWith(['Sample', 'Conc'])
  })

  it('says why a sample can’t be read', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(
      screen.getByLabelText('Try it on a sample file'),
      new File(['a,b\n1,2\n'], 'x.csv', { type: 'text/csv' }),
    )
    await user.selectOptions(
      screen.getByLabelText('The table starts at'),
      'text',
    )
    await user.type(screen.getByLabelText('Line starts with'), 'Sample')
    expect(
      await screen.findByText(
        /Couldn’t find a header line starting with “Sample”/,
      ),
    ).toBeTruthy()
  })
})

describe('tidyLayout', () => {
  it('keeps only what was chosen', () => {
    expect(
      tidyLayout({
        delimiter: 'auto',
        headerStartsWith: '  ',
        headerLine: 3,
        ignoreLines: [],
        units: 'none',
        stopAt: '',
      }),
    ).toEqual({ headerLine: 3 })
  })
})
