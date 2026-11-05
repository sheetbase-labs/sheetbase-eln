import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileDrop } from './file-drop'

/**
 * The field's own contract, which the four call sites rely on: a dropped file
 * reaches the caller's transport (the shipped surfaces had no drop handler at
 * all), the transport's failure is shown on the file's row with a retry that
 * runs it again, a refused file is not handed on, and removing a row clears the
 * caller's selection.
 *
 * The pick path through the input is covered by the screens' own tests
 * (`src/components/import/import-flow.test.tsx`,
 * `src/components/notebook/file-block.test.tsx`), which address it by label.
 */

afterEach(cleanup)

function csv(name = 'plate-01.csv'): File {
  return new File(['sample,value\nA,1.2\n'], name, { type: 'text/csv' })
}

/** Drop `file` on the field's drop target, as a pointer drag would. */
function drop(file: File) {
  fireEvent.drop(screen.getByLabelText('Laboratory file').closest('div')!, {
    dataTransfer: { files: [file] },
  })
}

function setup(
  transport: (file: File | null) => void | Promise<void> = () => {},
  props: Partial<React.ComponentProps<typeof FileDrop>> = {},
) {
  const onFile = vi.fn(transport)
  render(
    <FileDrop
      label="Laboratory file"
      inputLabel="Laboratory file"
      {...props}
      onFile={onFile}
    />,
  )
  return { onFile }
}

describe('FileDrop', () => {
  it('hands a dropped file to the caller and holds the row open while it runs', async () => {
    const settle: Array<() => void> = []
    const { onFile } = setup(
      () => new Promise<void>((resolve) => settle.push(resolve)),
    )

    drop(csv())

    expect(onFile).toHaveBeenCalledTimes(1)
    const [handed] = onFile.mock.calls[0] ?? []
    expect(handed?.name).toBe('plate-01.csv')
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe(
      'Uploading plate-01.csv',
    )
    expect(screen.getByText('Uploading…')).toBeTruthy()
    expect(screen.queryByText('Uploaded')).toBeNull()

    settle[0]()
    expect(await screen.findByText('Uploaded')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('reports the transport’s failure on the row and retries it from there', async () => {
    const attempts: number[] = []
    const { onFile } = setup(() => {
      attempts.push(1)
      return attempts.length === 1
        ? Promise.reject(new Error('The file store refused this file.'))
        : Promise.resolve()
    })

    drop(csv())

    expect(
      await screen.findByText('The file store refused this file.'),
    ).toBeTruthy()
    // The shipped surfaces had no retry: a failure meant picking again.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Try plate-01.csv again' }))

    expect(onFile).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Uploaded')).toBeTruthy()
  })

  it('refuses a pick the caller’s validation rejects, and hands nothing on', async () => {
    const { onFile } = setup(undefined, {
      validate: () => ({
        ok: false,
        message: 'Files of type "x" are not allowed.',
      }),
    })

    drop(csv('evil.exe'))

    expect(await screen.findByText(/not allowed/)).toBeTruthy()
    expect(onFile).not.toHaveBeenCalled()
    // A refusal is permanent, so the row offers no retry — only removal.
    expect(screen.queryByRole('button', { name: /^Try / })).toBeNull()
  })

  it('clears the caller’s selection when the row is removed', async () => {
    const { onFile } = setup()

    drop(csv())

    expect(await screen.findByText('Selected')).toBeTruthy()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Remove plate-01.csv' }))

    expect(onFile).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('plate-01.csv')).toBeNull()
  })
})
