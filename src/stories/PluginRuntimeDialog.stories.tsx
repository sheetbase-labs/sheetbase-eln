import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PluginRuntimeDialog } from '#/components/settings/plugin-runtime-dialog'
import { DEFAULT_PLUGIN_LIMITS } from '#/lib/extensions/runtime-config'
import type { PluginRuntimeInfo } from '#/lib/extensions/runtime-config'

/**
 * Python settings for one plugin: the packages it installs and where that
 * stands, the hosts the administrator approved, and how much one call may
 * use. Saving only happens on the button; the story sends nothing.
 */
const info: PluginRuntimeInfo = {
  extensionId: '0198d970-e266-4000-8000-0000000000b1',
  requirements: ['rdkit>=2024.3', 'biopython==1.84'],
  network: ['eutils.ncbi.nlm.nih.gov', '*.ebi.ac.uk'],
  overrides: { timeoutSeconds: 1800 },
  limits: { ...DEFAULT_PLUGIN_LIMITS, timeoutSeconds: 1800 },
  environment: {
    state: 'ready',
    error: null,
    packages: { rdkit: '2024.9.4', biopython: '1.84' },
  },
}

const meta = {
  title: 'Settings/Plugin Python settings',
  component: PluginRuntimeDialog,
  tags: ['autodocs'],
  decorators: [
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
    name: 'Structure tools',
    info,
    loading: false,
    onClose: () => {},
  },
} satisfies Meta<typeof PluginRuntimeDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Packages installed, hosts approved, one limit changed from its default. */
export const Installed: Story = {}

/** The packages could not be installed: the installer's words and a way to try again. */
export const InstallFailed: Story = {
  args: {
    info: {
      ...info,
      overrides: {},
      limits: { ...DEFAULT_PLUGIN_LIMITS },
      environment: {
        state: 'failed',
        error: 'No matching distribution found for rdkit>=2024.3',
        packages: null,
      },
    },
  },
}

/** A plugin that needs nothing beyond the runner's own Python. */
export const NoPackages: Story = {
  args: {
    info: {
      ...info,
      requirements: [],
      network: [],
      overrides: {},
      limits: { ...DEFAULT_PLUGIN_LIMITS },
      environment: { state: 'none', error: null, packages: null },
    },
  },
}
