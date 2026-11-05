import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Avatar, AvatarStack, initialsFromName } from './avatar'

afterEach(() => {
  cleanup()
})

describe('initialsFromName', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFromName('Gareth Price')).toBe('GP')
    expect(initialsFromName('ada lovelace')).toBe('AL')
  })

  it('takes one letter from a single-word name and two from a longer one', () => {
    expect(initialsFromName('Cher')).toBe('C')
    expect(initialsFromName('Mary Jane Watson')).toBe('MJ')
  })

  it('survives stray whitespace and an empty name', () => {
    expect(initialsFromName('  Grace   Hopper  ')).toBe('GH')
    expect(initialsFromName('')).toBe('?')
    expect(initialsFromName('   ')).toBe('?')
  })

  it('renders the same initials for the same person in a bare avatar and a stack', () => {
    render(<Avatar name="Gareth Price" />)
    render(<AvatarStack people={[{ id: 'u1', name: 'Gareth Price' }]} />)
    const rendered = screen.getAllByText('GP')
    expect(rendered).toHaveLength(2)
  })
})

describe('Avatar', () => {
  it('prefers explicit initials over the derived ones', () => {
    render(<Avatar name="Gareth Price" initials="GP2" />)
    expect(screen.getByText('GP2')).toBeTruthy()
  })

  it('names the person for assistive tech', () => {
    render(<Avatar name="Ada Lovelace" />)
    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' })
    expect(avatar.getAttribute('title')).toBe('Ada Lovelace')
  })
})

describe('AvatarStack', () => {
  const people = [
    'Ada Lovelace',
    'Grace Hopper',
    'Alan Turing',
    'Edsger Dijkstra',
    'Barbara Liskov',
  ].map((name, index) => ({ id: `u${index}`, name }))

  it('shows `max` avatars and folds the rest into +N', () => {
    render(<AvatarStack people={people} max={4} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.queryByText('BL')).toBeNull()
    expect(screen.getByText('AL')).toBeTruthy()
  })

  it('shows every avatar and no chip when the group fits', () => {
    render(<AvatarStack people={people.slice(0, 2)} />)
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('labels the group when given a label, and renders nothing with nobody', () => {
    const { container, rerender } = render(
      <AvatarStack people={people} label="5 here" />,
    )
    expect(screen.getByRole('group', { name: '5 here' })).toBeTruthy()
    rerender(<AvatarStack people={[]} label="nobody here" />)
    expect(container.querySelector('[role="group"]')).toBeNull()
  })
})
