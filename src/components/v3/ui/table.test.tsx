import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

afterEach(cleanup)

function renderTable(body: React.ReactNode) {
  return render(
    <Table caption="Members">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      {body}
    </Table>,
  )
}

describe('Table', () => {
  it('names the table from its caption', () => {
    const { getByRole } = renderTable(
      <TableBody>
        <TableRow>
          <TableCell>Ada</TableCell>
        </TableRow>
      </TableBody>,
    )

    expect(getByRole('table', { name: 'Members' })).toBeTruthy()
  })

  it('states an empty body instead of leaving a header-only table', () => {
    const { getByText, getAllByRole } = renderTable(
      <TableBody empty="No members yet" colSpan={1} />,
    )

    expect(getByText('No members yet')).toBeTruthy()
    // The header row and the one state row: never a body with nothing in it.
    expect(getAllByRole('row')).toHaveLength(2)
  })

  it('shows a loading body instead of the rows it has not got yet', () => {
    const { queryByText, getAllByRole } = renderTable(
      <TableBody loading colSpan={1}>
        <TableRow>
          <TableCell>Ada</TableCell>
        </TableRow>
      </TableBody>,
    )

    expect(queryByText('Ada')).toBeNull()
    expect(getAllByRole('row')).toHaveLength(2)
  })

  it('renders the rows it is given when no state is asked for', () => {
    const { getByText } = renderTable(
      <TableBody>
        <TableRow>
          <TableCell>Ada</TableCell>
        </TableRow>
      </TableBody>,
    )

    expect(getByText('Ada')).toBeTruthy()
  })
})
