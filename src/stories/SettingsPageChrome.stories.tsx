import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  CheckRow,
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'

/**
 * The chrome every settings page shares (`settings-page.tsx`): the header with
 * its count and actions, the body's rhythm, and the checkbox row with one muted
 * line on the consequence.
 *
 * These are the parts the settings *routes* compose, so the stories compose
 * them the way the routes do — a page header, a body, and the rows a General
 * page puts in it. The rows' handlers are story-local: nothing here writes.
 */

const meta = {
  title: 'Settings/Page chrome',
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/**
 * A page header with everything the slot takes — a title, a count, a primary
 * action and the one subtitling line — over a body with a Section and the three
 * row states (chosen, unchosen, and one this reader cannot change).
 */
export const Page: Story = {
  render: () => (
    <>
      <SettingsHeader
        title="General"
        count="4"
        actions={
          <Button variant="primary" onClick={noop}>
            Save changes
          </Button>
        }
      >
        TB-02 programme · changes apply to everyone in it
      </SettingsHeader>
      <SettingsBody>
        <Section title="Workspace">
          <Muted>
            Name, site, time zone and the formats records display in.
          </Muted>
          <CheckRow
            title="Require approval before publishing dataset versions"
            body="When enabled, the current draft needs completed approval before publication."
            checked
            onCheckedChange={noop}
          />
          <CheckRow
            title="Allow offline editing on this workspace’s devices"
            body="Edits sync when the device reconnects. Conflicts are shown to both people."
            checked={false}
            onCheckedChange={noop}
          />
          <CheckRow
            title="Keep archived datasets readable"
            body="An archived dataset stays citable; only a workspace admin can change this."
            checked={false}
            disabled
            onCheckedChange={noop}
          />
        </Section>
      </SettingsBody>
    </>
  ),
}

/**
 * The quiet header `/settings/access` uses: no count, no actions and no
 * subtitling line, and no bottom border because the filter bar below it draws
 * its own.
 */
export const QuietHeader: Story = {
  render: () => (
    <>
      <SettingsHeader title="Project access" border={false}>
        Who can open each project. Roles decide what they can do there.
      </SettingsHeader>
      <SettingsBody>
        <Muted>Nothing is filtered out of this page.</Muted>
      </SettingsBody>
    </>
  ),
}
