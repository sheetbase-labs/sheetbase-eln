import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Home } from './index'

describe('Home', () => {
  it('identifies the project foundation', () => {
    render(<Home />)

    expect(
      screen.getByRole('heading', { name: 'Product foundation ready' }),
    ).toBeTruthy()
  })
})
