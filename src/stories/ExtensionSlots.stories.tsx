import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  ExtensionCommandGroup,
  ExtensionObjectActions,
} from '#/components/extensions/extension-slots'
import { Command, CommandInput, CommandList } from '#/components/v3/ui/command'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'

/**
 * EXT-02 — the contributed-UI slots extensions render through. Extensions
 * supply only id/title, never markup, so these components are the whole
 * surface: ghost buttons in a record's action row, and an "Extensions" group
 * in the ⌘K palette. Both are absent while empty — the silence is the contract
 * and the empty stories name it. `toExtensionPanelTabs` is the third slot; it
 * maps resolved panels onto inspector tabs through a host-owned renderer and
 * returns `InspectorTab` data rather than rendered UI, so it has no story of
 * its own (its behaviour is covered by the component tests).
 */
function contribution(
  overrides: Partial<ResolvedExtensionContribution> = {},
): ResolvedExtensionContribution {
  return {
    extensionId: 'ext-1',
    extensionKey: 'sample',
    manifestId: 'sheetbase.sample-panel',
    manifestVersion: '1.0.0',
    point: 'object-actions',
    id: 'open-panel',
    title: 'Open sample panel',
    requiredCapability: null,
    key: 'sample:object-actions:open-panel',
    ...overrides,
  }
}

const actions = [
  contribution(),
  contribution({
    id: 'draw-plate',
    title: 'Draw plate map',
    extensionKey: 'plate-tools',
    key: 'plate-tools:object-actions:draw-plate',
  }),
]

const commands = [
  contribution({
    point: 'commands',
    id: 'scan-code',
    title: 'Scan a code',
    key: 'sample:commands:scan-code',
  }),
  contribution({
    point: 'commands',
    id: 'export-package',
    title: 'Export evidence package',
    extensionKey: 'regulatory',
    key: 'regulatory:commands:export-package',
  }),
]

const meta = {
  title: 'Extensions/Object actions',
  component: ExtensionObjectActions,
  tags: ['autodocs'],
  args: { actions, onSelect: () => {} },
} satisfies Meta<typeof ExtensionObjectActions>
export default meta
type Story = StoryObj<typeof meta>

/** One quiet button per resolved action, in the record's action row rhythm. */
export const Default: Story = {}

/** Nothing declared: the slot renders nothing rather than an empty row. */
export const NoActions: Story = {
  args: { actions: [] },
}

/** The palette group, mounted as the palette mounts it. */
export const PaletteGroup: Story = {
  render: () => (
    <Command label="Commands" className="w-96 rounded-lg border border-border">
      <CommandInput placeholder="Search commands…" autoFocus={false} />
      <CommandList label="Commands">
        <ExtensionCommandGroup commands={commands} onSelect={() => {}} />
      </CommandList>
    </Command>
  ),
}
