/**
 * COLLAB-02 CommentButton tests: unresolved-count badge rendering, the 9+
 * cap and the no-count state.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentButton } from './comment-button'

afterEach(() => cleanup())

describe('CommentButton', () => {
  it('renders the count badge for open comments', () => {
    render(<CommentButton count={3} label="Comments on block b1" />)
    expect(
      screen.getByRole('button', { name: 'Comments on block b1' }),
    ).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('caps the badge at 9+', () => {
    render(<CommentButton count={12} label="Comments" />)
    expect(screen.getByText('9+')).toBeTruthy()
    expect(screen.queryByText('12')).toBeNull()
  })

  it('shows no badge when there are no comments', () => {
    const onClick = vi.fn()
    render(<CommentButton count={0} onClick={onClick} />)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('keeps counting at exactly nine without capping', () => {
    render(<CommentButton count={9} label="Comments" />)
    expect(screen.getByText('9')).toBeTruthy()
  })
})
