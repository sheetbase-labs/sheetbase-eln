import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CanonicalSheetLifecyclePanel } from '#/components/sheet/canonical-sheet-lifecycle-panel'
import type { SheetInstance } from '#/lib/sheet-instance-data'

/**
 * The composed Sheet lifecycle panel: adopt a definition version, upgrade,
 * extract-and-publish and materialise. Every action asks before it runs and
 * each one writes through an RPC, so the stories render the panel at rest
 * with the definition/dataset reads left pending. Its host mounts it only for
 * a writable instance (`canonical-sheet-workspace.tsx`), so there is no
 * archived state to show here: an archived sheet never renders the panel.
 */
const baseInstance: SheetInstance = {
  id: '0198d970-e266-4000-8000-000000000030',
  workspaceId: '0198d970-e266-4000-8000-00000000ffff',
  projectId: '0198d970-e266-4000-8000-0000000000p1'.replace('p', 'b'),
  notebookRecordId: '0198d970-e266-4000-8000-0000000000c1',
  sourceDefinitionVersionId: '0198d970-e266-4000-8000-0000000d0001',
  displayId: 'SH-0007',
  name: 'Observation worksheet',
  description: null,
  lifecycle: 'active',
  revision: 5,
  state: {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'definition_version' },
  },
  duplicatedFromInstanceId: null,
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-20T09:15:00.000Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

function Harness({ value }: { value: SheetInstance }) {
  const [instance, setInstance] = useState(value)
  return (
    <CanonicalSheetLifecyclePanel
      instance={instance}
      onInstance={setInstance}
    />
  )
}

const meta = {
  title: 'Sheet/Canonical sheet lifecycle panel',
  component: CanonicalSheetLifecyclePanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, queryFn: () => new Promise(() => {}) },
            },
          })
        }
      >
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { instance: baseInstance, onInstance: () => {} },
} satisfies Meta<typeof CanonicalSheetLifecyclePanel>
export default meta
type Story = StoryObj<typeof meta>

/** A composed sheet: its lifecycle actions are available and confirmed. */
export const Composed: Story = {
  render: (args) => <Harness value={args.instance} />,
}

/** An ad-hoc sheet has no definition version to upgrade or extract from. */
export const AdHoc: Story = {
  args: {
    instance: {
      ...baseInstance,
      sourceDefinitionVersionId: null,
      state: { ...baseInstance.state, provenance: { createdFrom: 'ad_hoc' } },
    },
  },
  render: (args) => <Harness value={args.instance} />,
}
