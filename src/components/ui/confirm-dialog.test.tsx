import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfirmDialog, ConfirmDialogTrigger } from './confirm-dialog'

afterEach(cleanup)

describe('ConfirmDialogTrigger', () => {
  it('renders the child element as the trigger when asChild is set', () => {
    render(
      <ConfirmDialog>
        <ConfirmDialogTrigger asChild>
          <button type="button" className="my-own-trigger">
            Delete record
          </button>
        </ConfirmDialogTrigger>
      </ConfirmDialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Delete record' })
    // The caller's element, not a button rendered around it.
    expect(trigger.className).toContain('my-own-trigger')
  })

  it('renders its own trigger button when asChild is off', () => {
    // `asChild` used to be accepted and ignored, so this asked for a button and
    // silently got something else.
    render(
      <ConfirmDialog>
        <ConfirmDialogTrigger asChild={false}>
          Delete record
        </ConfirmDialogTrigger>
      </ConfirmDialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Delete record' })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.textContent).toBe('Delete record')
  })
})
