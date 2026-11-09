import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookOfflineSurfaces } from '#/components/offline/notebook-offline-surfaces'
import { OfflineEditsProvider } from '#/components/offline/offline-edits'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import { SCOPE, seededStore } from './offline-fixtures'

/**
 * The notebook's offline surfaces, gated on the workspace's "Allow offline
 * editing" setting. The setting is read while the notebook is online, so it is
 * still known when the connection drops. When it is off the banner says so and
 * the replay runner is not mounted. A read that has not answered is treated as
 * allowed, so a failed read never removes the offline safety net.
 *
 * With no stream mounted the live status is `offline`, which is the state the
 * banner exists for.
 */
function client(offlineEditingAllowed: boolean | null) {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  if (offlineEditingAllowed !== null) {
    instance.setQueryData([...workspaceGeneralQueryKey, 'offline-gate'], {
      offlineEditingAllowed,
    })
  }

  return instance
}

const store = seededStore()

function withSetting(allowed: boolean | null) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(allowed)}>
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <Story />
      </OfflineEditsProvider>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Offline/Notebook surfaces',
  component: NotebookOfflineSurfaces,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { store, scope: SCOPE },
} satisfies Meta<typeof NotebookOfflineSurfaces>

export default meta

type Story = StoryObj<typeof meta>

/** Offline editing is allowed: the banner promises edits are kept. */
export const Allowed: Story = { decorators: [withSetting(true)] }

/** The workspace turned offline editing off: the banner asks the person to reconnect. */
export const NotAllowed: Story = { decorators: [withSetting(false)] }

/** The setting has not been read yet: treated as allowed. */
export const SettingUnknown: Story = { decorators: [withSetting(null)] }
