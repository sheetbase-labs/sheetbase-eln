import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ListLoadError, listFailed } from './list-load-error'

afterEach(cleanup)

describe('ListLoadError', () => {
  it('says the list did not load and retries on request', () => {
    const onRetry = vi.fn()

    const { getByRole, getByText } = render(
      <ListLoadError list="experiments" onRetry={onRetry} />,
    )

    expect(getByText('Couldn’t load experiments')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('listFailed', () => {
  it('is true only when the read failed and nothing earlier is on screen', () => {
    expect(listFailed({ isError: true, data: undefined })).toBe(true)
    expect(listFailed({ isError: true, data: [] })).toBe(false)
    expect(listFailed({ isError: false, data: undefined })).toBe(false)
  })
})
