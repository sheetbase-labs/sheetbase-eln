import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProfilePhoto } from '#/components/settings/profile-photo'
import { AvatarPhotosContext } from '#/lib/avatar-photos-context'
import { screenQueryClient } from './screen-stories'

/**
 * Your photo on the Profile page (`src/components/settings/profile-photo.tsx`).
 *
 * Without a photo the avatar shows your initials and offers Upload photo. With
 * one it offers Change photo and Remove photo. Choosing a file opens the crop
 * dialog, which needs a real file, so no story opens it. The photo itself is
 * served by the app, so in Storybook the avatar falls back to initials.
 */
const meta = {
  title: 'Settings/Profile photo',
  component: ProfilePhoto,
  tags: ['autodocs'],
  args: { userId: 'u1', initials: 'GP', name: 'Gareth Price' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient({ data: [] })}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ProfilePhoto>

export default meta

type Story = StoryObj<typeof meta>

/** No photo yet: initials and Upload photo. */
export const NoPhoto: Story = {}

/** A photo is set: Change photo and Remove photo. */
export const WithPhoto: Story = {
  decorators: [
    (Story) => (
      <AvatarPhotosContext.Provider value={new Map([['u1', '1']])}>
        <Story />
      </AvatarPhotosContext.Provider>
    ),
  ],
}
