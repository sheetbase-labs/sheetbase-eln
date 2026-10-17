import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { RegisterConnectorDialog } from '#/components/v3/integrations/register-connector-dialog'
import { withApiReads } from './screen-stories'

/**
 * Registering a connector (`src/routes/settings/integrations.tsx`, steward-gated).
 * The dialog reads nothing: the parser catalogue is the build-time registry and
 * the write happens on submit, so these stories stop before Register and never
 * reach the connector RPC. `withApiReads` answers that RPC locally, so even a
 * reader who does press the button stays inside the story.
 *
 * The dialog is portalled, so the stories drive it through `screen`: the story
 * canvas does not contain what the dialog renders.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const meta = {
  title: 'Integrations/Register connector',
  component: RegisterConnectorDialog,
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    open: true,
    onOpenChange: () => {},
  },
} satisfies Meta<typeof RegisterConnectorDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Open on the default type: an instrument, with its ingestion parser. */
export const InstrumentType: Story = {}

/** A storage source: the type reveals the adapter the server-side import uses. */
export const StorageAdapter: Story = {
  play: async () => {
    await userEvent.selectOptions(
      await screen.findByLabelText('Type'),
      'storage',
    )
    await expect(
      await screen.findByLabelText('Source adapter'),
    ).toBeInTheDocument()
    await expect(
      screen.getByRole('option', { name: 'S3-compatible object storage' }),
    ).toBeInTheDocument()
  },
}

/** A database source: the same field offers the read-only PostgreSQL adapter. */
export const DatabaseAdapter: Story = {
  play: async () => {
    await userEvent.selectOptions(
      await screen.findByLabelText('Type'),
      'database',
    )
    await expect(
      await screen.findByRole('option', {
        name: 'External PostgreSQL (read-only)',
      }),
    ).toBeInTheDocument()
  },
}

/**
 * A filled-in form: the key the person typed is normalised as they type
 * ("Plate Reader Bench 2" becomes `plate-reader-bench-2`), and Register becomes
 * available only once a name and a well-formed key exist.
 */
export const FilledIn: Story = {
  play: async () => {
    await userEvent.type(
      await screen.findByLabelText(/Name/),
      'Plate reader bench 2',
    )
    await userEvent.type(screen.getByLabelText(/Key/), 'Plate Reader Bench 2')
    await expect(screen.getByLabelText(/Key/)).toHaveValue(
      'plate-reader-bench-2',
    )
    await expect(
      screen.getByRole('button', { name: 'Register connector' }),
    ).toBeEnabled()
  },
}

/**
 * Closed: nothing is registered until a steward opens the dialog, and the
 * closed dialog renders nothing at all — the silence is the contract.
 */
export const Closed: Story = { args: { open: false } }
