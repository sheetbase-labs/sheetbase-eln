import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PrintLabelButton,
  SampleLabelPrint,
} from '#/components/v3/samples/sample-label-print'
import { screenQueryClient } from './screen-stories'

/**
 * LAB-05.2 — the browser print path (`src/components/v3/samples/sample-label-print.tsx`).
 *
 * `SampleLabelPrint` is a print document, not screen chrome: its root is
 * `hidden` and the stylesheet makes it the only visible element under
 * `@media print`. The first story forces that document visible so a reviewer
 * can see exactly what the browser would print; the second shows the action
 * that sends it. The recording mutation is not exercised here — it needs a
 * server — but the action's pending/error contract is held by the component's
 * test, and no story click reaches the data client.
 */
const LABEL = {
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  sampleType: 'Cell harvest',
  barcode: 'SMP-LVV-0020',
  customFields: { batch: 'HL-0934' },
  createdAt: '2026-09-20T00:00:00.000Z',
  properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
}

const meta = {
  title: 'Samples/Label print',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * The document `window.print()` sends: the same label card the inspector
 * previews, with the print stylesheet's visibility rules applied. The story
 * applies only the display override — the component supplies the rest.
 */
export const PrintDocument: Story = {
  decorators: [
    (Story) => (
      <div className="w-[340px]">
        <style>{`[data-slot="sample-label-print"] { display: block !important; }`}</style>
        <Story />
      </div>
    ),
  ],
  render: () => <SampleLabelPrint record={LABEL} host="app.sheetbase.test" />,
}

/** The design's "Print label" action at rest. */
export const PrintAction: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  render: () => (
    <PrintLabelButton
      record={{
        id: '0198d970-e266-4000-8000-0000000005a1',
        identifier: 'SMP-2231',
        metadataVersion: 3,
      }}
    />
  ),
}
