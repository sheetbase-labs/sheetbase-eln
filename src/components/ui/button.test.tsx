import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from './button'

afterEach(() => {
  cleanup()
})

describe('Button', () => {
  it('renders a default button', () => {
    render(<Button>Create project</Button>)
    const button = screen.getByRole('button', { name: 'Create project' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('renders every documented variant without crashing', () => {
    const variants = [
      'secondary',
      'primary',
      'quiet',
      'danger',
      'danger-fill',
    ] as const
    variants.forEach((variant, i) => {
      render(<Button variant={variant}>v{i}</Button>)
      expect(screen.getByRole('button', { name: `v${i}` })).toBeTruthy()
      cleanup()
    })
  })

  it('renders every documented size', () => {
    const sizes = ['sm', 'md', 'lg', 'icon', 'icon-lg'] as const
    sizes.forEach((size, i) => {
      render(
        <Button size={size} aria-label={`s${i}`}>
          s{i}
        </Button>,
      )
      expect(screen.getByRole('button', { name: `s${i}` })).toBeTruthy()
      cleanup()
    })
  })

  it('disables the button when disabled is set', () => {
    render(<Button disabled>Save</Button>)
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('forwards onClick handlers', () => {
    let clicked = 0
    render(<Button onClick={() => (clicked += 1)}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(clicked).toBe(1)
  })

  it('uses the secondary surface for an unqualified button', () => {
    render(<Button>Neutral</Button>)
    expect(screen.getByRole('button', { name: 'Neutral' }).className).toContain(
      'bg-surface',
    )
  })

  it('uses the one decisive blue for a primary button', () => {
    render(<Button variant="primary">Submit</Button>)
    expect(screen.getByRole('button', { name: 'Submit' }).className).toContain(
      'bg-primary',
    )
  })

  it('supports an icon-only button when given an aria-label', () => {
    render(
      <Button size="icon" aria-label="Add row" icon="plus">
        Add
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Add row' })
    expect(button.className).toContain('size-7')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('does not suppress a native type attribute', () => {
    render(<Button type="submit">Submit</Button>)
    expect(
      screen.getByRole('button', { name: 'Submit' }).getAttribute('type'),
    ).toBe('submit')
  })
})
