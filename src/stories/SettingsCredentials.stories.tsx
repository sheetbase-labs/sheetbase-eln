import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  SettingsCredentials,
  personalTokensCopy,
  serviceCredentialsCopy,
} from '#/components/v3/settings/settings-credentials'
import type { CredentialRow } from '#/components/v3/settings/settings-credentials'

/**
 * The credential panel (src/components/v3/settings/settings-credentials.tsx):
 * one component for both Settings sections. Personal tokens and workspace
 * service credentials differ only in the `copy` preset they are handed, which
 * is what the two former files (settings-api-tokens, settings-service-credentials)
 * duplicated in full.
 */
const meta = {
  title: 'Settings/Credential panel',
  component: SettingsCredentials,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsCredentials>
export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

const personal: CredentialRow[] = [
  {
    id: 'token-1',
    name: 'Local Jupyter',
    displayPrefix: 'sb_pat_ab12',
    scopes: ['projects:read', 'datasets:read'],
    createdAt: '2026-09-01T09:00:00.000Z',
    lastUsedAt: '2026-10-14T11:20:00.000Z',
    revokedAt: null,
    expiresAt: '2026-12-12T00:00:00.000Z',
  },
  {
    id: 'token-2',
    name: 'Plate-map exporter',
    displayPrefix: 'sb_pat_cd34',
    scopes: ['datasets:read'],
    createdAt: '2026-08-02T09:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
  },
  {
    id: 'token-3',
    name: 'Old LIMS bridge',
    displayPrefix: 'sb_pat_ef56',
    scopes: ['files:read'],
    createdAt: '2026-06-02T09:00:00.000Z',
    lastUsedAt: '2026-07-01T09:00:00.000Z',
    revokedAt: '2026-08-01T09:00:00.000Z',
    expiresAt: null,
  },
]

const service: CredentialRow[] = [
  {
    id: 'cred-1',
    name: 'Nightly import',
    displayPrefix: 'sb_svc_ab12',
    scopes: ['datasets:write'],
    createdAt: '2026-09-10T09:00:00.000Z',
    lastUsedAt: '2026-10-15T02:00:00.000Z',
    revokedAt: null,
    expiresAt: null,
  },
  {
    id: 'cred-2',
    name: 'R LIMS sync',
    displayPrefix: 'sb_svc_cd34',
    scopes: ['files:read'],
    createdAt: '2026-01-10T09:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: '2026-09-30T00:00:00.000Z',
  },
]

export const PersonalTokens: Story = {
  args: {
    copy: personalTokensCopy,
    tokens: personal,
    revealed: null,
    onCreate: noop,
    onRevoke: noop,
    onRotate: noop,
    onDismissRevealed: noop,
  },
}

export const ServiceCredentials: Story = {
  args: {
    copy: serviceCredentialsCopy,
    tokens: service,
    revealed: null,
    onCreate: noop,
    onRevoke: noop,
    onRotate: noop,
    onDismissRevealed: noop,
  },
}

/** The reveal-once secret, shown after a create or a rotate. */
export const RevealedSecret: Story = {
  args: {
    copy: serviceCredentialsCopy,
    tokens: service,
    revealed: {
      secret: 'sb_svc_9d4d3f0c1a2b3c4d5e6f7a8b',
      displayPrefix: 'sb_svc_ab12',
      name: 'Nightly import',
      scopes: ['datasets:write'],
    },
    onCreate: noop,
    onRevoke: noop,
    onRotate: noop,
    onDismissRevealed: noop,
  },
}

export const Empty: Story = {
  args: {
    copy: personalTokensCopy,
    tokens: [],
    revealed: null,
    onCreate: noop,
    onRevoke: noop,
    onRotate: noop,
    onDismissRevealed: noop,
  },
}
