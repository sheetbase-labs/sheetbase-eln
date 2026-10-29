import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChangeReasonDialog } from '#/components/shell/change-reason-dialog'
import { CalibrationOverdueNotice } from '#/components/v3/instruments/calibration-overdue'
import { InstrumentGateSetting } from '#/components/v3/settings/instrument-gate-setting'
import { Button } from '#/components/v3/ui/button'
import { askForChangeReason } from '#/lib/change-reason'
import { adminQueryKeys } from '#/lib/workspace-admin'
import { screenQueryClient } from './screen-stories'

/**
 * The surfaces of the settings that are enforced rather than only stored: the
 * instrument data rule, the overdue-calibration notice that follows it, and the
 * reason prompt that opens when a workspace requires one for saved changes.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const meta = {
  title: 'Settings/Enforced',
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function gateProvider(instrumentGateMode: 'off' | 'warn' | 'block') {
  const client = screenQueryClient({
    data: [
      {
        key: adminQueryKeys.settings(WORKSPACE_ID),
        value: { instrumentGateMode },
      },
    ],
  })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

/** Runs and imports from an instrument that fails a check are kept but flagged. */
export const InstrumentRuleWarn: Story = {
  decorators: [gateProvider('warn')],
  render: () => <InstrumentGateSetting workspaceId={WORKSPACE_ID} canManage />,
}

/** Runs and imports from an instrument that fails a check are refused. */
export const InstrumentRuleBlock: Story = {
  decorators: [gateProvider('block')],
  render: () => <InstrumentGateSetting workspaceId={WORKSPACE_ID} canManage />,
}

/** The notice an overdue instrument shows when its data is flagged. */
export const CalibrationNoticeFlagged: Story = {
  render: () => (
    <CalibrationOverdueNotice
      instrumentName="HPLC-02"
      gateMode="warn"
      action={<Button size="sm">Record calibration</Button>}
    />
  ),
}

/** The notice when its data is refused. */
export const CalibrationNoticeRefused: Story = {
  render: () => (
    <CalibrationOverdueNotice instrumentName="HPLC-02" gateMode="block" />
  ),
}

function OpenOnMount() {
  useEffect(() => {
    void askForChangeReason()
  }, [])
  return <ChangeReasonDialog />
}

/** The prompt for a reason, opened by a refused save. */
export const ChangeReasonPrompt: Story = {
  render: () => <OpenOnMount />,
}
