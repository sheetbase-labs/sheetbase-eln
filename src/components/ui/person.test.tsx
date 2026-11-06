import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AvatarPhotosContext } from '#/lib/avatar-photos-context'

import { Person } from './person'

afterEach(cleanup)

describe('Person', () => {
  it('shows initials and the name when there is no photo', () => {
    render(<Person userId="u1" name="Gareth Price" />)
    expect(screen.getByText('GP')).toBeTruthy()
    expect(screen.getByText('Gareth Price')).toBeTruthy()
  })

  it('shows the profile photo when the person has one', () => {
    const { container } = render(
      <AvatarPhotosContext.Provider value={new Map([['u1', 'v1']])}>
        <Person userId="u1" name="Gareth Price" />
      </AvatarPhotosContext.Provider>,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/avatars/u1?v=v1',
    )
  })
})
