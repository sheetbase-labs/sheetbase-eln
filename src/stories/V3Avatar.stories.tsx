import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Avatar,
  AvatarStack,
  initialsFromName,
} from '#/components/v3/ui/avatar'

/**
 * The v3 Avatar (DSYS). One component and one initials rule for every surface:
 * `initialsFromName` takes the first letter of the first two words, so
 * `Gareth Price` reads `GP` in a bare avatar, in a contributor stack and in a
 * comment chip. Six hand-rolled spellings were deleted in favour of this
 * component; three of them spelled the same person three different ways.
 */
const meta = {
  title: 'UI/v3 Avatar',
  component: Avatar,
  tags: ['autodocs'],
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

const PEOPLE = [
  { id: 'gareth', name: 'Gareth Price' },
  { id: 'mia', name: 'Mia Chen' },
  { id: 'roisin', name: 'Róisín Ó Súilleabháin' },
  { id: 'cher', name: 'Cher' },
  { id: 'lee', name: 'Lee Chen-Wallace' },
  { id: 'sam', name: 'Sam Okafor' },
]

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-label text-fg-muted">
          Sizes — sm (22px) and md (28px, the default)
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Avatar name="Gareth Price" size="sm" />
          <Avatar name="Gareth Price" />
        </div>
      </div>
      <div>
        <p className="text-label text-fg-muted">Tones</p>
        <div className="mt-2 flex items-center gap-3">
          <Avatar name="Gareth Price" tone="accent" />
          <Avatar name="Gareth Price" tone="review" />
          <Avatar name="Gareth Price" tone="ok" />
          <Avatar name="Gareth Price" tone="warn" />
        </div>
      </div>
    </div>
  ),
}

export const Initials: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p className="text-label text-fg-muted">
        Derived from the name by one rule — never sliced, never supplied per
        surface:
      </p>
      <ul className="flex flex-col gap-2">
        {PEOPLE.map((person) => (
          <li key={person.id} className="flex items-center gap-3 text-xs">
            <Avatar name={person.name} size="sm" />
            <span>{person.name}</span>
            <span className="font-mono text-fg-muted">
              {initialsFromName(person.name)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-label text-fg-muted">
        An explicit `initials` prop still wins where a surface holds one already
        — the app shell reads the signed-in user's initials from the session:
      </p>
      <Avatar name="Gareth Price" initials="GP" size="sm" />
    </div>
  ),
}

export const Stacks: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-label text-fg-muted">
          Contributor stack with `+N` overflow (max 4 of 6)
        </p>
        <div className="mt-2">
          <AvatarStack people={PEOPLE} max={4} />
        </div>
      </div>
      <div>
        <p className="text-label text-fg-muted">
          Presence stack, with the group's own label for assistive tech
        </p>
        <div className="mt-2">
          <AvatarStack
            people={PEOPLE.slice(0, 3)}
            label={`${PEOPLE.slice(0, 3).length} here`}
          />
        </div>
      </div>
      <div>
        <p className="text-label text-fg-muted">
          Every avatar in every stack is the same component:
        </p>
        <div className="mt-2">
          <AvatarStack people={PEOPLE.slice(0, 2)} label="2 here" />
        </div>
      </div>
    </div>
  ),
}
