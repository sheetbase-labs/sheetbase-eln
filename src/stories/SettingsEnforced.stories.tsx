import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChangeReasonDialog } from '#/components/shell/change-reason-dialog'
import { CalibrationOverdueNotice } from '#/components/instruments/calibration-overdue'
import { InstrumentGateSetting } from '#/components/settings/instrument-gate-setting'
import { SubmitReadinessSetting } from '#/components/settings/submit-readiness-setting'
import { Button } from '#/components/ui/button'
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

function gateProvider(
  instrumentGateMode: 'off' | 'warn' | 'block',
  submitReadinessMode: 'off' | 'warn' | 'block' = 'warn',
) {
  const client = screenQueryClient({
    data: [
      {
        key: adminQueryKeys.settings(WORKSPACE_ID),
        value: { instrumentGateMode, submitReadinessMode },
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

/** Open steps and a missing decision are listed but the submission goes through. */
export const SubmitReadinessWarn: Story = {
  decorators: [gateProvider('warn', 'warn')],
  render: () => <SubmitReadinessSetting workspaceId={WORKSPACE_ID} canManage />,
}

/** They are listed and the submission is refused until they are cleared. */
export const SubmitReadinessBlock: Story = {
  decorators: [gateProvider('warn', 'block')],
  render: () => <SubmitReadinessSetting workspaceId={WORKSPACE_ID} canManage />,
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
