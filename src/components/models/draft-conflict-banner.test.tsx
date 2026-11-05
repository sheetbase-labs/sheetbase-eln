/**
 * R5-CONFIG-03 — the stale-draft banner.
 *
 * The conflict states the design asks for: a disjoint change offers Merge, an
 * overlapping one offers only an explicit Keep mine, and Use their version is
 * always available. No state resolves itself.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DraftConflictBanner } from './draft-conflict-banner'
import type { DraftConflict } from '#/lib/dataset-schema-draft'

afterEach(cleanup)

function conflict(overlap: boolean): DraftConflict {
  return {
    serverRows: [],
    serverRevision: 9,
    theirs: new Set(['row-a']),
    mine: overlap ? new Set(['row-a']) : new Set(['row-c']),
    overlap,
  }
}

describe('DraftConflictBanner', () => {
  it('offers Use their version and Merge when the two sides changed different fields', () => {
    const onReload = vi.fn()
    const onMerge = vi.fn()
    render(
      <DraftConflictBanner
        conflict={conflict(false)}
        onReload={onReload}
        onMerge={onMerge}
        onKeepMine={vi.fn()}
      />,
    )
    expect(
      screen.getByText('Someone else saved this draft while you were editing.'),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Keep mine' })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Merge and keep editing' }),
    )
    expect(onMerge).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Use their version' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit overwrite instead of a merge when a field overlaps', () => {
    const onKeepMine = vi.fn()
    render(
      <DraftConflictBanner
        conflict={conflict(true)}
        onReload={vi.fn()}
        onMerge={vi.fn()}
        onKeepMine={onKeepMine}
      />,
    )
    expect(
      screen.getByText('Someone else changed a field you also changed.'),
    ).toBeDefined()
    expect(
      screen.queryByRole('button', { name: 'Merge and keep editing' }),
    ).toBeNull()
    expect(
      screen.getByText(/Nothing is overwritten until you choose/),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(onKeepMine).toHaveBeenCalledTimes(1)
  })

  it('disables every resolution while a save is in flight', () => {
    render(
      <DraftConflictBanner
        conflict={conflict(false)}
        onReload={vi.fn()}
        onMerge={vi.fn()}
        onKeepMine={vi.fn()}
        busy
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Use their version' }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', { name: 'Merge and keep editing' }),
    ).toHaveProperty('disabled', true)
  })
})
