import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { SettingsGeneral } from '#/components/v3/settings/settings-general'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'
import { holdRead, screenQueryClient } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Workspace general settings (`src/routes/settings/index.tsx`): name, site,
 * time zone, display formats, record-ID prefixes and the two workspace rules.
 *
 * The screen's read is one RPC (`fetchWorkspaceGeneral`); the writes are
 * separate RPCs that run together on Save. Nothing here saves: the stories stop
 * at the form, and the states they add are the ones the form itself produces —
 * an unsaved edit and a rejected time zone.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const saved: WorkspaceGeneral = {
  name: 'TB-02 programme',
  site: 'Cambridge, UK',
  timezone: 'Europe/London',
  dateFormat: 'd MMM yyyy',
  numberFormat: 'decimal',
  publicationApprovalRequired: true,
  offlineEditingAllowed: false,
  requireChangeReason: false,
  lockOnSign: true,
  idPrefixes: {
    experiment: 'EXP',
    sample: 'SMP',
    dataset: 'DS',
    material: 'MAT',
  },
}

const meta = {
  title: 'Settings/General',
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A story's read client: the settings it seeds, or the read it answers with a refusal. */
function provider(data: ReadSeed[], refused = false) {
  const client = screenQueryClient({ data })
  if (refused) holdRead(client, workspaceGeneralQueryKey, 'denied')
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

/** What the workspace has saved. Save is inert until something changes. */
export const Saved: Story = {
  decorators: [provider([{ key: workspaceGeneralQueryKey, value: saved }])],
  render: () => <SettingsGeneral workspaceId={WORKSPACE_ID} />,
}

/** An unsaved edit: the format example and the Save button both answer it. */
export const UnsavedEdit: Story = {
  decorators: [provider([{ key: workspaceGeneralQueryKey, value: saved }])],
  render: () => <SettingsGeneral workspaceId={WORKSPACE_ID} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Site' }),
      ' — unit 4',
    )
    await expect(
      canvas.getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled()
  },
}

/**
 * A time zone the scheduler could not use. `workspace_settings.timezone` is free
 * text, so the form is the only thing that can refuse it, and it refuses before
 * the write rather than letting every date surface fall back silently.
 */
export const InvalidTimeZone: Story = {
  decorators: [provider([{ key: workspaceGeneralQueryKey, value: saved }])],
  render: () => <SettingsGeneral workspaceId={WORKSPACE_ID} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const timezone = canvas.getByRole('textbox', { name: 'Time zone' })
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'Mars/Olympus')
    await expect(
      await canvas.findByText(
        'Enter a valid IANA time zone, such as Europe/London.',
      ),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled()
  },
}

/**
 * The read was refused — the caller is not a workspace admin, which is the same
 * rule that omits this page from their settings nav: the form holds the model's
 * defaults, every Save is disabled, and the refusal is not restated, because
 * this surface has no error slot of its own. A *pending* or *failed* read
 * renders the same form, so this story stands for all three.
 */
export const ReadUnavailable: Story = {
  decorators: [provider([], true)],
  render: () => <SettingsGeneral workspaceId={WORKSPACE_ID} />,
}
