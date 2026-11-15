import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PluginRunList } from '#/components/settings/plugin-logs-dialog'
import type { PluginRunLog } from '#/lib/extensions/run-logs-client'

/**
 * A plugin's recent runs in the Logs view: how each ended, which function ran,
 * when, how long it took, the error and what the plugin printed. Never the
 * inputs or the answer.
 */
const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

const runs: PluginRunLog[] = [
  {
    id: '1',
    kind: 'operation',
    entry: 'search_protocols',
    ok: false,
    duration_ms: 842,
    error: 'PluginError: protocols.io refused the token (401).',
    output: ['searching protocols.io for "western blot"'],
    created_at: ago(3),
  },
  {
    id: '2',
    kind: 'operation',
    entry: 'lookup_terms',
    ok: true,
    duration_ms: 2310,
    error: null,
    output: ['looked up "T cell" in cl', 'found 4 terms'],
    created_at: ago(95),
  },
  {
    id: '3',
    kind: 'check',
    entry: 'range',
    ok: true,
    duration_ms: 41,
    error: null,
    output: [],
    created_at: ago(60 * 30),
  },
]

const meta = {
  title: 'Settings/Plugin logs',
  component: PluginRunList,
  tags: ['autodocs'],
  args: { runs },
} satisfies Meta<typeof PluginRunList>

export default meta

type Story = StoryObj<typeof meta>

/** A failure with its message, a run that printed, and one that printed nothing. */
export const Runs: Story = {}

/** A plugin that has not run yet. */
export const Empty: Story = { args: { runs: [] } }
