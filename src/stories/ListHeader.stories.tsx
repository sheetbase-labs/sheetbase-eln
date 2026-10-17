import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { ListHeader } from '#/components/v3/inventory/list'
import { Tabs } from '#/components/v3/ui/tabs'

/**
 * The header of a list screen: title, count, actions and the tab strip.
 *
 * Eight registry screens compose it; the experiments list and the inbox used to
 * compose the identical band by hand, character for character, and the two of
 * them carried the states this story exists for — an action that has to wrap
 * rather than leave the column below `md`, and a header with no count to show
 * because the screen does not know it yet.
 */
const meta = {
  title: 'v3 kit/List header',
  component: ListHeader,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Samples',
    total: 1284,
    actions: (
      <>
        <Button>Scan label</Button>
        <Button variant="primary">Register sample</Button>
      </>
    ),
  },
} satisfies Meta<typeof ListHeader>
export default meta
type Story = StoryObj<typeof meta>

/** The registry header: count and actions on the title line. */
export const RegistryList: Story = {}

/** No count: the screen does not know it yet (the inbox's tab counts). */
export const WithoutCount: Story = {
  args: { total: undefined },
}

/** The subtitle slot the inbox header needed: what this list is. */
export const WithSubtitle: Story = {
  args: {
    title: 'Inbox',
    total: undefined,
    subtitle: 'Everything waiting on you, across projects',
  },
}

/** With the tab strip: the rail scrolls sideways and bleeds to the edges. */
export const WithTabs: Story = {
  args: {
    tabs: (
      <Tabs
        mode="url"
        label="Sample lists"
        value="instock"
        items={[
          {
            key: 'all',
            label: 'All',
            count: 1284,
            link: { to: '/samples', search: {} },
          },
          {
            key: 'instock',
            label: 'In stock',
            count: 412,
            link: { to: '/samples', search: { tab: 'instock' } },
          },
        ]}
      />
    ),
  },
}
