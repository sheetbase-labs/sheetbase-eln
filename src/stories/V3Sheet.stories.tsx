import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from '#/components/v3/ui/sheet'

/**
 * A panel that slides in from an edge: the navigation drawer at phone width, and
 * the inspector at laptop width. `side="auto"` is the one the app ships — right
 * on laptops, a bottom sheet below `lg` — so the same call site serves both.
 *
 * The legacy `UI/Sheet` story covers `src/components/ui/sheet.tsx`, a
 * same-named Radix file with zero call sites. This is the forward one.
 */
const meta = {
  title: 'v3 kit/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Sheet>
export default meta
type Story = StoryObj<typeof meta>

const Rows = ({ count = 4 }: { count?: number }) => (
  <dl className="num grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 p-4 text-body">
    {(
      [
        ['Status', 'In progress'],
        ['Material', 'Lentiviral vector'],
        ['Volume', '1.5 mL'],
        ['Owner', 'Gareth P.'],
        ['Created', '14 Oct 2026'],
      ] as const
    )
      .slice(0, count)
      .map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-fg-muted">{term}</dt>
          <dd className="m-0">{value}</dd>
        </div>
      ))}
  </dl>
)

/** The default: right on laptops, bottom on tablets and phones. */
export const Default: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button />}>Open inspector</SheetTrigger>
      <SheetContent title="Properties">
        <Rows />
      </SheetContent>
    </Sheet>
  ),
}

/** The navigation drawer, which is the `left` edge at phone width. */
export const NavigationDrawer: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button icon="panelLeft" />} />
      <SheetContent side="left" title="Project">
        <nav aria-label="Project" className="flex flex-col gap-px p-2">
          {['Overview', 'Notebook', 'Experiments', 'Datasets', 'Samples'].map(
            (item, index) => (
              <button
                key={item}
                type="button"
                aria-current={index === 1 ? 'page' : undefined}
                className="h-7 cursor-pointer rounded-md border-0 bg-transparent px-2 text-left text-body text-fg aria-[current=page]:bg-selection aria-[current=page]:font-medium"
              >
                {item}
              </button>
            ),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  ),
}

/** A caller with one thing to say can still close it, from the header control. */
export const WithCloseControl: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button />}>Open</SheetTrigger>
      <SheetContent side="right" title="Run 148">
        <Rows count={3} />
        <div className="border-t border-border-subtle p-4">
          <SheetClose render={<Button variant="primary" />}>Done</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  ),
}
