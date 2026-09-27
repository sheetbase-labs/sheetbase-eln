import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Alert, Banner, Notice } from './alert'

afterEach(() => {
  cleanup()
})

describe('Banner', () => {
  it('renders a plain strip by default', () => {
    render(<Banner>Offline</Banner>)
    const banner = screen.getByText('Offline')
    expect(banner.getAttribute('data-slot')).toBe('banner')
    expect(banner.className).toContain('border-b')
  })

  it('uses a warning wash for the warn tone', () => {
    render(<Banner tone="warn">Saving is paused</Banner>)
    expect(screen.getByText('Saving is paused').className).toContain(
      'bg-warning-wash',
    )
  })

  it('uses a danger wash for the bad tone', () => {
    render(<Banner tone="bad">Signed and locked</Banner>)
    expect(screen.getByText('Signed and locked').className).toContain(
      'bg-danger-wash',
    )
  })
})

describe('Notice', () => {
  it('renders a local notice with the info surface by default', () => {
    render(<Notice>3 unsynced changes</Notice>)
    expect(screen.getByText('3 unsynced changes').className).toContain(
      'bg-muted',
    )
  })
})

describe('Alert alias', () => {
  it('maps the destructive variant to the danger wash', () => {
    render(<Alert variant="destructive">Failed to save</Alert>)
    expect(screen.getByText('Failed to save').className).toContain(
      'bg-danger-wash',
    )
  })
})
