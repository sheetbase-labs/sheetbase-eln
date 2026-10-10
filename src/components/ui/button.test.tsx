import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Icon } from '#/components/icons'

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
      'primary',
      'secondary',
      'quiet',
      'danger',
      'danger-fill',
      'link',
      // v2 aliases
      'default',
      'destructive',
      'outline',
      'ghost',
      'subtle',
    ] as const
    variants.forEach((variant, i) => {
      render(<Button variant={variant}>v{i}</Button>)
      expect(screen.getByRole('button', { name: `v${i}` })).toBeTruthy()
      cleanup()
    })
  })

  it('renders every documented size', () => {
    const sizes = [
      'sm',
      'md',
      'lg',
      'iconOnly',
      // v2 aliases
      'default',
      'icon',
      'icon-sm',
      'icon-xs',
    ] as const
    sizes.forEach((size, i) => {
      render(<Button size={size}>s{i}</Button>)
      expect(screen.getByRole('button', { name: `s${i}` })).toBeTruthy()
      cleanup()
    })
  })

  it('disables pointer events and dims when disabled', () => {
    render(<Button disabled>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('forwards onClick handlers', () => {
    let clicked = 0
    render(<Button onClick={() => (clicked += 1)}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(clicked).toBe(1)
  })

  it('renders a primary button when asked, and as its child when asChild is set', () => {
    render(
      <Button variant="primary" asChild>
        <a href="/x">Linked</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Linked' })
    expect(link.tagName).toBe('A')
    // The anchor inherits the button classes, so it is still styled as a
    // button but is semantically a link.
    expect(link.className).toContain('bg-primary')
  })

  it('uses the secondary surface for an unqualified button', () => {
    render(<Button>Neutral</Button>)
    expect(screen.getByRole('button', { name: 'Neutral' }).className).toContain(
      'bg-card',
    )
  })

  it('supports an icon-only button when given an aria-label', () => {
    render(
      <Button size="iconOnly" aria-label="Add row">
        <Icon name="plus" />
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Add row' })
    expect(button.className).toContain('size-control')
  })

  it('does not suppress a native type attribute', () => {
    render(<Button type="submit">Submit</Button>)
    expect(
      screen.getByRole('button', { name: 'Submit' }).getAttribute('type'),
    ).toBe('submit')
  })
})
