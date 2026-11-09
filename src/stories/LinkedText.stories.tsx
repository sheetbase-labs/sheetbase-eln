import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { LinkedText } from '#/components/ui/linked-text'

/**
 * Free text in which an identifier that names a real record becomes a link
 * (with peek), as in notebook text, comments and report text. An identifier no
 * record has stays plain, so a typo never turns into a dead link. In Storybook
 * there is no workspace to look records up in, so the text reads as written.
 */
const meta = {
  title: 'UI/LinkedText',
  component: LinkedText,
  tags: ['autodocs'],
  args: { text: 'Repeat of EXP-0142, see DS-0311 for the raw reads.' },
} satisfies Meta<typeof LinkedText>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoIdentifiers: Story = {
  args: { text: 'Left overnight at 4 °C.' },
}
