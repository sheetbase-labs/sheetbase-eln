import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PluginRunList } from './plugin-logs-dialog'

describe('PluginRunList', () => {
  it('shows how a run ended, its error and what it printed', () => {
    render(
      <PluginRunList
        runs={[
          {
            id: '1',
            kind: 'operation',
            entry: 'search',
            ok: false,
            duration_ms: 1500,
            error: 'PluginError: refused',
            output: ['first line', 'second line'],
            created_at: new Date().toISOString(),
          },
        ]}
      />,
    )
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('PluginError: refused')).toBeTruthy()
    expect(screen.getByLabelText('Printed').textContent).toBe(
      'first line\nsecond line',
    )
    expect(screen.getByText(/1\.5 s/)).toBeTruthy()
  })

  it('says so when nothing has run', () => {
    render(<PluginRunList runs={[]} />)
    expect(screen.getByText('No runs yet.')).toBeTruthy()
  })
})
