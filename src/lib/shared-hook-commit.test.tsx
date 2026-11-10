import { Suspense, useRef, useState, useTransition } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { pendingEditsFor, usePendingEdit } from './pending-edits'
import { useSettledValue } from './settled-value'
import { useAnchoredPlacement } from './use-anchored-placement'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('keeps leave actions, queued search and floating anchors on committed inputs', async () => {
  vi.useFakeTimers()
  const observed: string[] = []
  const measuredInputs: string[] = []
  const pending = new Promise<void>(() => {})

  function Editor({ phase }: { phase: string }) {
    usePendingEdit({
      dirty: true,
      paneId: 'commit-check',
      label: 'Analysis',
      save: () => {
        observed.push(`save:${phase}`)

        return Promise.resolve(true)
      },
      discard: () => {
        observed.push(`discard:${phase}`)
      },
    })

    const search = useSettledValue('', 200, (next) => {
      observed.push(`search:${phase}:${next}`)
    })

    const ref = useRef<HTMLDivElement>(null)

    const placement = useAnchoredPlacement({
      open: true,
      ref,
      maxHeight: 200,
      getAnchor: () => {
        measuredInputs.push(phase)

        return {
          top: phase === 'original' ? 100 : 400,
          bottom: phase === 'original' ? 120 : 420,
          left: 20,
        }
      },
    })

    if (phase === 'unfinished') throw pending

    return (
      <>
        <input
          aria-label="Search"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
        />
        <div ref={ref} data-testid="floating" style={placement.style} />
      </>
    )
  }

  function Page() {
    const [phase, setPhase] = useState('original')
    const [waiting, startTransition] = useTransition()

    return (
      <>
        <button onClick={() => startTransition(() => setPhase('unfinished'))}>
          Start unfinished render
        </button>
        <button onClick={() => setPhase('committed')}>Finish render</button>
        {waiting ? <p>Rendering</p> : null}
        <Suspense fallback={<p>Loading</p>}>
          <Editor phase={phase} />
        </Suspense>
      </>
    )
  }

  render(<Page />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
    target: { value: 'plasma' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Start unfinished render' }),
  )
  expect(screen.getByText('Rendering')).toBeTruthy()

  const [edit] = pendingEditsFor('commit-check')
  await edit.save()
  edit.discard()
  act(() => {
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
  })

  expect({
    callbacks: observed,
    top: screen.getByTestId('floating').style.top,
  }).toEqual({
    callbacks: ['save:original', 'discard:original', 'search:original:plasma'],
    top: '126px',
  })
  expect(measuredInputs).not.toContain('unfinished')

  fireEvent.click(screen.getByRole('button', { name: 'Finish render' }))
  const [committed] = pendingEditsFor('commit-check')
  await committed.save()
  committed.discard()
  expect(observed.slice(-2)).toEqual(['save:committed', 'discard:committed'])
  expect(screen.getByTestId('floating').style.top).toBe('426px')
})
