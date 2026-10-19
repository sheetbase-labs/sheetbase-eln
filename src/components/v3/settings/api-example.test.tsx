import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ApiExample, apiExampleCommand } from './api-example'

afterEach(cleanup)

describe('ApiExample', () => {
  it('builds a curl request against the given origin with the token by variable', () => {
    const command = apiExampleCommand('https://eln.example')
    expect(command).toContain('https://eln.example/api/db/projects')
    expect(command).toContain('Bearer $SHEETBASE_TOKEN')
    expect(command).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
  })

  it('shows the request for this origin with a copy control', () => {
    render(<ApiExample />)
    expect(
      screen.getByRole('button', { name: 'Copy example request' }),
    ).toBeTruthy()
    expect(screen.getByText(/api\/db\/projects/).textContent).toContain(
      window.location.origin,
    )
  })
})
