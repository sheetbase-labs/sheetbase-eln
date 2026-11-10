import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PluginParserList } from '#/components/settings/plugin-parser-table'

/** Instrument readers that installed plugins add, under Settings → Instruments. */
const meta = {
  title: 'Plugins/Instrument parsers',
  component: PluginParserList,
  tags: ['autodocs'],
  args: {
    parsers: [
      {
        extensionId: 'ext-1',
        manifestId: 'man-1',
        manifestVersion: '1.0.0',
        point: 'instrument-parsers',
        id: 'acme-reader',
        name: 'plugin.lab-inventory.acme-reader',
        extensionKey: 'lab-inventory',
        extensionName: 'Lab inventory',
        declaration: {
          id: 'acme-reader',
          title: 'Acme plate reader',
          description: 'Reads the Acme export, skipping the preamble.',
          extensions: ['.csv'],
          encoding: 'text',
          instrument: 'Acme reader',
          contains: ['Acme Reader'],
          runner: { kind: 'python', entry: 'python/reader.py:read' },
        },
      },
    ],
  },
} satisfies Meta<typeof PluginParserList>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Nothing is shown when no plugin adds a parser. */
export const None: Story = { args: { parsers: [] } }
