import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'

/**
 * A disclosure: one trigger, one panel. The trigger carries `aria-expanded` and
 * `aria-controls` and works from the keyboard; the panel is not mounted while
 * closed unless the caller keeps it.
 */
const meta = {
  title: 'UI/Collapsible',
  tags: ['autodocs'],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Collapsible className="w-96">
      <CollapsibleTrigger>Agreement and start date</CollapsibleTrigger>
      <CollapsiblePanel className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Agreement reference">
          <Input placeholder="AG-2026-014" />
        </Field>
        <Field label="Start date">
          <Input type="date" />
        </Field>
      </CollapsiblePanel>
    </Collapsible>
  ),
}

/** The panel is unmounted while closed, so nothing inside it is fetched. */
export const OpenOnFirstRender: Story = {
  render: () => (
    <Collapsible defaultOpen className="w-96">
      <CollapsibleTrigger>Full validation evidence</CollapsibleTrigger>
      <CollapsiblePanel className="mt-1">
        <Muted>3,142 rows read · 0 rejected · validated 16 Oct 2026</Muted>
      </CollapsiblePanel>
    </Collapsible>
  ),
}

/** A payload belongs in a disclosure: collapsed, it costs nothing to render. */
export const Payload: Story = {
  render: () => (
    <Collapsible className="w-[36rem]">
      <CollapsibleTrigger className="text-label text-fg-muted">
        Technical result payload
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-1">
        <CodeBlock
          code={JSON.stringify(
            { kind: 'csv', rowCount: 3142, source: { kind: 's3_object' } },
            null,
            2,
          )}
          language="json"
          label="Technical result payload"
          maxHeight="sm"
        />
      </CollapsiblePanel>
    </Collapsible>
  ),
}

/**
 * Controlled: the surface owns which disclosure is open, which is how a list
 * keeps one detail row open at a time.
 */
export const Controlled: Story = {
  render: () => {
    function TwoDisclosures() {
      const [open, setOpen] = useState<'a' | 'b' | null>('a')
      return (
        <div className="flex w-96 flex-col gap-2">
          {(['a', 'b'] as const).map((id) => (
            <Collapsible
              key={id}
              open={open === id}
              onOpenChange={(next) => setOpen(next ? id : null)}
              className="rounded-md border border-border p-2"
            >
              <CollapsibleTrigger>Run {id.toUpperCase()}</CollapsibleTrigger>
              <CollapsiblePanel className="mt-1">
                <Muted>Only one of these is open at a time.</Muted>
              </CollapsiblePanel>
            </Collapsible>
          ))}
        </div>
      )
    }
    return <TwoDisclosures />
  },
}
