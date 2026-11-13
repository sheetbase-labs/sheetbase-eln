import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from './dialog'

afterEach(() => {
  cleanup()
})

function Sample({
  onSave,
  disabled = false,
  insideForm = false,
}: {
  onSave: () => void
  disabled?: boolean
  insideForm?: boolean
}) {
  const field = <input aria-label="Name" type="text" />

  return (
    <Dialog open>
      <DialogContent>
        <DialogBody>
          {insideForm ? <form>{field}</form> : field}
          <textarea aria-label="Notes" />
        </DialogBody>
        <DialogFooter>
          <Button>Cancel</Button>
          <Button variant="primary" disabled={disabled} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog Enter', () => {
  it('presses the one primary button from a one-line field', () => {
    const onSave = vi.fn()

    render(<Sample onSave={onSave} />)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    expect(onSave).toHaveBeenCalledOnce()
  })

  it('leaves a text area alone so Enter still starts a new line', () => {
    const onSave = vi.fn()

    render(<Sample onSave={onSave} />)
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('does nothing while the primary button is disabled', () => {
    const onSave = vi.fn()

    render(<Sample onSave={onSave} disabled />)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('leaves a field inside a form to the form', () => {
    const onSave = vi.fn()

    render(<Sample onSave={onSave} insideForm />)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })
})
