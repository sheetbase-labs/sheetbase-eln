import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  StatusBadge,
  experimentStatusVocabulary,
  reviewStatusVocabulary,
  sampleStatusVocabulary,
  statusVocabularies,
} from './status-badge'
import type { StatusVocabulary } from './status-badge'

afterEach(() => cleanup())

describe('StatusBadge', () => {
  it('renders the human label, not the raw key, for a known domain status', () => {
    render(<StatusBadge domain="experiment" status="in-progress" />)
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.queryByText('in-progress')).toBeNull()
  })

  it('falls back to the raw text when the status is unknown to the vocabulary', () => {
    render(<StatusBadge domain="experiment" status="supercalifragilistic" />)
    expect(screen.getByText('supercalifragilistic')).toBeTruthy()
    expect(screen.getByText('status: unknown')).toBeTruthy() // sr-only
  })

  it('communicates tone to screen readers in addition to colour', () => {
    render(<StatusBadge domain="experiment" status="failed" />)
    expect(screen.getByText('status: danger')).toBeTruthy() // sr-only
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('keeps warning statuses legible in both themes', () => {
    render(<StatusBadge domain="sample" status="quarantined" />)
    expect(
      screen.getByText('Quarantined').closest('[data-slot="badge"]')?.className,
    ).toContain('text-warning-text')
  })

  it('uses a custom vocabulary when provided', () => {
    const vocab: StatusVocabulary = {
      queued: {
        label: 'Queued',
        tone: 'info',
        icon: statusVocabularies.experiment['draft'].icon,
      },
    }
    render(<StatusBadge vocabulary={vocab} status="queued" />)
    expect(screen.getByText('Queued')).toBeTruthy()
  })

  it('defines separate vocabularies per domain (no single state machine)', () => {
    expect(experimentStatusVocabulary['in-progress']).toBeDefined()
    expect(reviewStatusVocabulary['pending']).toBeDefined()
    expect(sampleStatusVocabulary['quarantined']).toBeDefined()
    // The same key can mean different things across domains.
    expect(experimentStatusVocabulary['approved'].label).toBe('Approved')
    expect(reviewStatusVocabulary['approved'].label).toBe('Approved')
    // Sample has statuses experiment does not.
    expect(experimentStatusVocabulary['frozen']).toBeUndefined()
    expect(sampleStatusVocabulary['frozen']).toBeDefined()
    // LAB-02: disposed is a terminal sample state and renders, not raw text.
    expect(sampleStatusVocabulary['disposed'].label).toBe('Disposed')
  })

  it('renders the disposed sample state with a label, not the raw key', () => {
    render(<StatusBadge domain="sample" status="disposed" />)
    expect(screen.getByText('Disposed')).toBeTruthy()
    expect(screen.queryByText('disposed')).toBeNull()
  })

  it('exposes a data-status attribute for selectors and a11y audits', () => {
    render(<StatusBadge domain="review" status="rejected" />)
    const badge = screen.getByText('Rejected').closest('[data-status]')
    expect(badge?.getAttribute('data-status')).toBe('rejected')
  })
})
