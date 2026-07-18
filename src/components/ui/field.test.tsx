import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from './field'
import { Input } from './input'

afterEach(() => {
  cleanup()
})

describe('Field primitives', () => {
  it('associates a label with an input via htmlFor/id', () => {
    render(
      <Field>
        <FieldLabel htmlFor="title">Project title</FieldLabel>
        <Input id="title" aria-describedby="title-help title-err" />
        <FieldDescription id="title-help">
          Shown in the workspace list.
        </FieldDescription>
        <FieldError id="title-err">Title is required.</FieldError>
      </Field>,
    )
    const label = screen.getByText('Project title')
    const input = screen.getByLabelText('Project title')
    expect(label.tagName).toBe('LABEL')
    expect(label.getAttribute('for')).toBe('title')
    expect(input.tagName).toBe('INPUT')
  })

  it('exposes FieldDescription as a paragraph a screen reader announces', () => {
    render(
      <Field>
        <FieldLabel htmlFor="x">X</FieldLabel>
        <Input id="x" aria-describedby="x-help" />
        <FieldDescription id="x-help">Helpful text.</FieldDescription>
      </Field>,
    )
    const help = screen.getByText('Helpful text.')
    expect(help.tagName).toBe('P')
  })

  it('exposes FieldError with role=alert so it is announced on change', () => {
    render(
      <Field>
        <FieldLabel htmlFor="y">Y</FieldLabel>
        <Input id="y" aria-describedby="y-err" aria-invalid="true" />
        <FieldError id="y-err">Cannot be empty.</FieldError>
      </Field>,
    )
    const err = screen.getByRole('alert')
    expect(err.textContent).toBe('Cannot be empty.')
  })

  it('renders FieldGroup as a grid container', () => {
    const { container } = render(
      <FieldGroup>
        <Field>one</Field>
        <Field>two</Field>
      </FieldGroup>,
    )
    expect(container.firstElementChild?.className).toContain('grid')
  })
})
