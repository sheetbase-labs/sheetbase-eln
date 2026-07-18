import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkspaceSummary } from './index'

describe('WorkspaceSummary', () => {
  it('shows the signed-in identity, workspace and role', () => {
    render(
      <WorkspaceSummary
        context={{
          user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@sheetbase.test' },
          workspace: {
            id: 'w1',
            slug: 'ws-u1',
            name: "Ada Lovelace's workspace",
            role: 'owner',
          },
        }}
      />,
    )

    expect(
      screen.getByRole('heading', { name: "Ada Lovelace's workspace" }),
    ).toBeTruthy()
    expect(screen.getByText(/ada@sheetbase\.test/)).toBeTruthy()
    expect(screen.getByText('ws-u1')).toBeTruthy()
    expect(screen.getByText('owner')).toBeTruthy()
  })
})
