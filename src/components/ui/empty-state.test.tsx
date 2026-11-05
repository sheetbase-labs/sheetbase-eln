import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EmptyState } from './empty-state'

/**
 * The empty state's contract (DESIGN.md, Application states): it says what is
 * absent and offers one relevant next action. The action and the description
 * are the point of the component; the deprecated `body` alias was deleted once
 * the sweep landed and nothing but this test used it.
 */
afterEach(cleanup)

describe('EmptyState', () => {
  it('renders the title as a heading, the description, and the action', () => {
    const { getByRole, getByText } = render(
      <EmptyState
        icon="search"
        title="No samples match “HL-0943”"
        description="Search looks at ID, name, type and location."
        action={<button type="button">Clear search</button>}
      />,
    )

    expect(
      getByRole('heading', { name: 'No samples match “HL-0943”' }),
    ).toBeTruthy()
    expect(
      getByText('Search looks at ID, name, type and location.'),
    ).toBeTruthy()
    expect(getByRole('button', { name: 'Clear search' })).toBeTruthy()
  })

  it('renders the action row when only children are given', () => {
    const { getByRole } = render(
      <EmptyState title="Nothing here yet">
        <button type="button">Add the first row</button>
      </EmptyState>,
    )

    expect(getByRole('button', { name: 'Add the first row' })).toBeTruthy()
  })
})
