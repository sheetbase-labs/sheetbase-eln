import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ReportFigures } from '#/components/facility/report-controls'
import { InstrumentRateSection } from '#/components/facility/instrument-rate'
import { ScheduledReportsPanel } from '#/components/facility/scheduled-reports'
import { InstrumentUsagePanel } from '#/components/facility/usage-report'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { SpendReportPanel } from '#/components/materials/spend-report'
import { SupplierListDialog } from '#/components/materials/supplier-list'
import { usageKeys } from '#/lib/facility-usage'
import { scheduledReportKeys } from '#/lib/scheduled-reports'
import type { ScheduledReport } from '#/lib/scheduled-reports'
import { supplierKeys } from '#/lib/suppliers'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * What the lab spends and what its instruments earn: the spend and usage
 * reports, the recharge rate, the supplier list and the scheduled emails. Reads
 * are seeded; nothing here is written.
 */
const instrument: InstrumentRow = {
  id: 'inst-1',
  displayId: 'PR-01',
  name: 'Plate reader',
  instrumentType: 'plate_reader',
  model: null,
  serialNumber: null,
  vendor: null,
  location: null,
  ownerId: null,
  retiredAt: null,
  intakeMethod: 'manual',
  position: 0,
  updatedAt: '2026-11-01T09:00:00Z',
}

const weekly: ScheduledReport = {
  id: 'r1',
  name: 'Weekly instrument usage',
  kind: 'instrument_usage',
  projectId: null,
  period: 'previous_week',
  openHours: 10,
  frequency: 'weekly',
  weekday: 1,
  monthDay: 1,
  sendHour: 8,
  timeZone: 'Europe/London',
  recipientUserIds: ['u1', 'u2'],
  active: true,
  nextRunAt: '2026-11-09T08:00:00Z',
  lastRunAt: '2026-11-02T08:00:00Z',
  lastResult: 'sent',
  lastRecipientCount: 2,
  createdBy: 'u1',
}

const meta = {
  title: 'Spend and usage',
  parameters: {
    tanstack: {
      router: { route: screenRoutes('/materials'), path: '/materials' },
    },
  },
  decorators: [
    withApiReads('pending'),
    (Story) => (
      <QueryClientProvider
        client={screenQueryClient({
          data: [
            { key: usageKeys.rates, value: [] },
            { key: supplierKeys.models, value: ['supplier'] },
            { key: scheduledReportKeys.all, value: [weekly] },
          ],
        })}
      >
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** An instrument with no recharge rate, and the button to set one. */
export const RateNotSet: Story = {
  render: () => <InstrumentRateSection instrument={instrument} canManage />,
}

/** Ticking a record model as the lab's supplier list. */
export const SupplierList: Story = {
  render: () => (
    <SupplierListDialog open onOpenChange={() => {}} modelKey="supplier" />
  ),
}

/** Reports emailed on a rhythm. */
export const Scheduled: Story = {
  render: () => <ScheduledReportsPanel emailConfigured />,
}

/** The spend report while its lines load. */
export const SpendLoading: Story = {
  render: () => <SpendReportPanel />,
}

/** The usage report while its bookings load. */
export const UsageLoading: Story = {
  render: () => <InstrumentUsagePanel />,
}

/** The headline figures above a report. */
export const Figures: Story = {
  render: () => (
    <ReportFigures
      figures={[
        { label: 'Booked', value: '42.5 h' },
        {
          label: 'Used',
          value: '38%',
          tip: 'Utilisation is the hours booked out of the hours an instrument is open, counting Monday to Friday.',
        },
        { label: 'Bookings', value: '17' },
        { label: 'Recharge', value: '£638.00' },
      ]}
    />
  ),
}
