import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PluginRecordList } from '#/components/plugins/plugin-record-panel'
import type { PluginFlag } from '#/lib/plugin-record-data'

/** What plugins added to a record: a sign-off step, a hold and a summary. */
const step: PluginFlag = {
  id: 'f1',
  extension_key: 'lab-rules',
  extension_name: 'Lab rules',
  flag_key: 'second-reviewer',
  kind: 'sign_off',
  title: 'A second reviewer has looked at this',
  message: 'Someone other than the person who sent it to review.',
  roles: ['reviewer', 'owner'],
  approvals_needed: 2,
  independent: true,
  raised_by_user_id: 'maker',
  raised_at: '2026-11-08T10:00:00Z',
  signed: 1,
  signedByMe: false,
}

const meta = {
  title: 'Plugins/Record panel',
  component: PluginRecordList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: {
    myUserId: 'someone-else',
    onSignOff: () => undefined,
    state: {
      flags: [
        step,
        {
          ...step,
          id: 'f2',
          kind: 'flag',
          flag_key: 'ph',
          title: 'pH outside the range',
          message: 'Reading was 9.2',
        },
      ],
      summaries: [
        {
          extension_key: 'lab-rules',
          extension_name: 'Lab rules',
          hook_id: 'summarise',
          summary: 'EXP-1: Titration of sodium chloride (in review)',
          updated_at: '2026-11-08T10:00:00Z',
        },
      ],
    },
  },
} satisfies Meta<typeof PluginRecordList>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The person who made the change is not offered the button. */
export const MadeTheChange: Story = { args: { myUserId: 'maker' } }
