import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DecideRequestDialog } from '#/components/requests/decide-request-dialog'
import { RequestFormDialog } from '#/components/requests/request-form-dialog'
import { RequestSettingsDialog } from '#/components/requests/request-settings'
import { RequestsPage } from '#/components/requests/requests-page'
import { requestKeys } from '#/lib/requests'
import type { RequestForm } from '#/lib/requests'
import { screenQueryClient, withApiReads } from './screen-stories'

/**
 * Requests: any record model can take requests from the people it serves. The
 * form dialog lists the models that do; the page shows the requester's own
 * requests, the ones waiting for a decision and everything. Reads are held, so
 * the lists show their loading state; the form is seeded.
 */
const forms: RequestForm[] = [
  {
    model_key: 'assay_request',
    name: 'Assay request',
    identifier_prefix: 'ASR',
    intro: 'Tell us what you need and when.',
    handler_user_ids: [],
  },
]

const meta = {
  title: 'Requests/Requests',
  component: RequestsPage,
  decorators: [
    withApiReads('pending'),
    (Story) => (
      <QueryClientProvider
        client={screenQueryClient({
          data: [{ key: requestKeys.forms, value: forms }],
        })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    userId: 'user-1',
    canWrite: true,
    canEditModels: true,
    tab: 'mine',
    onTabChange: () => {},
  },
} satisfies Meta<typeof RequestsPage>

export default meta

type Story = StoryObj<typeof meta>

/** The page for a writer who handles requests, while the lists load. */
export const Page: Story = {}

/** The request form: pick a model, say what is needed, send it. */
export const Form: Story = {
  render: () => (
    <RequestFormDialog open onOpenChange={() => {}} forms={forms} />
  ),
}

/** Deciding a request closed: nothing is shown until one is chosen. */
export const DecideClosed: Story = {
  render: () => (
    <DecideRequestDialog request={null} askerName="Dana" onClose={() => {}} />
  ),
}

/** Switching requests on for a model: who handles them and the intro people see. */
export const Settings: Story = {
  render: () => (
    <RequestSettingsDialog
      open
      onOpenChange={() => {}}
      model={{
        id: 'model-1',
        workspace_id: 'ws-1',
        key: 'assay_request',
        name: 'Assay request',
        description: null,
        identifier_prefix: 'ASR',
        lifecycle: 'active',
        current_version: 1,
        created_at: '2026-11-01T09:00:00Z',
        updated_at: '2026-11-01T09:00:00Z',
      }}
    />
  ),
}
