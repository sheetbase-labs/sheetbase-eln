import { Suspense, useState, useTransition } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { useCommittedRef } from './use-committed-ref'

afterEach(cleanup)

it('keeps callbacks on committed inputs when a later render suspends', async () => {
  const save = vi.fn<(value: string) => void>()
  const pending = new Promise<void>(() => {})

  function Editor({ value }: { value: string }) {
    const latest = useCommittedRef(value)

    if (value === 'unfinished') throw pending

    return <button onClick={() => save(latest.current)}>Save</button>
  }

  function Notebook() {
    const [value, setValue] = useState('original')
    const [waiting, startTransition] = useTransition()

    return (
      <>
        <button onClick={() => startTransition(() => setValue('unfinished'))}>
          Start unfinished render
        </button>
        <button onClick={() => setValue('committed update')}>
          Finish edit
        </button>
        {waiting ? <p>Rendering</p> : null}
        <Suspense fallback={<p>Loading editor</p>}>
          <Editor value={value} />
        </Suspense>
      </>
    )
  }

  const user = userEvent.setup()
  render(<Notebook />)
  await user.click(
    screen.getByRole('button', { name: 'Start unfinished render' }),
  )
  expect(screen.getByText('Rendering')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(save).toHaveBeenLastCalledWith('original')

  await user.click(screen.getByRole('button', { name: 'Finish edit' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(save).toHaveBeenLastCalledWith('committed update')
})
