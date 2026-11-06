import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { AvatarPhotosContext } from '#/lib/avatar-photos-context'

import { MentionTextarea } from './mention-textarea'

afterEach(cleanup)

describe('MentionTextarea', () => {
  it('shows each person with their profile photo or initials in the list', async () => {
    const user = userEvent.setup()
    render(
      <AvatarPhotosContext.Provider value={new Map([['u1', 'v1']])}>
        <MentionTextarea
          value="Thanks @"
          onChange={() => {}}
          candidates={[
            { userId: 'u1', name: 'Ada Lovelace' },
            { userId: 'u2', name: 'Grace Hopper' },
          ]}
        />
      </AvatarPhotosContext.Provider>,
    )
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.type(box, '{End}')
    const list = await screen.findByRole('listbox')
    expect(list.textContent).toContain('Ada Lovelace')
    expect(list.querySelector('img')?.getAttribute('src')).toBe(
      '/api/avatars/u1?v=v1',
    )
    expect(list.textContent).toContain('GH')
  })
})
