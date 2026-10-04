import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ParserVersions } from './parser-versions'
import type { ParserSettingsRow } from '#/lib/parser-settings'

const parsers: ParserSettingsRow[] = [
  {
    id: 'parser-tb02',
    key: 'tb02',
    name: 'TB-02 CSV firmware 4',
    format: 'csv',
    instrument_id: 'instrument-tb02',
    instruments: { id: 'instrument-tb02', name: 'Turbidimeter TB-02' },
    parser_versions: [
      {
        id: 'version-4',
        version: 4,
        status: 'draft',
        signature: {},
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
      {
        id: 'version-3',
        version: 3,
        status: 'approved',
        signature: {},
        mapping: {},
        test_result: { ok: true },
        validated_at: '2026-09-25T11:05:00Z',
        approved_at: '2026-09-25T11:15:00Z',
        approved_by_user_id: 'qa-reviewer',
      },
    ],
  },
]

const meta = {
  title: 'Settings/Parser versions',
  component: ParserVersions,
  parameters: { layout: 'fullscreen' },
  args: { parsers, selectedVersionId: 'version-4', onSelect: () => {} },
  render: function Render(args) {
    const [selected, setSelected] = useState(args.selectedVersionId)
    return (
      <ParserVersions
        {...args}
        selectedVersionId={selected}
        onSelect={(_, version) => setSelected(version.id)}
      />
    )
  },
} satisfies Meta<typeof ParserVersions>
export default meta
type Story = StoryObj<typeof meta>
export const Populated: Story = {}
export const Empty: Story = { args: { parsers: [] } }
