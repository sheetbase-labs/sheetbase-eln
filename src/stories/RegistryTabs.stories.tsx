import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/reui/tabs'

/**
 * The stock shadcn `tabs` item, the candidate for comparison pair `tab-family`.
 * It is not a ReUI item — the pinned registry answers 404 for `tabs` and says it
 * is shadcn's — so it was placed from the shadcn registry with the primitive
 * import re-pointed to the unified `radix-ui` package.
 *
 * Row 16 of `docs/knowledge/design/component-comparison-record.md` declined it:
 * both sides pass the same keyboard contract, so there is no missing behaviour
 * to buy, the tab stop sits on the `role="tablist"` container rather than on the
 * tab, and it would add a second primitive library beside Base UI. The story
 * stays so the declined candidate is reviewable in the repository.
 */
const meta = {
  title: 'UI/Registry tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>

const PANELS: Record<string, string> = {
  summary: 'Twelve runs in this project; three are waiting for review.',
  runs: 'Run 148 finished in 38 s and proposed one figure.',
  evidence: 'Four files are attached, all pinned to a snapshot.',
}

/** The item's own shape, in place rather than as a URL tab strip. */
export const Default: Story = {
  render: () => (
    <div className="w-[520px]">
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">{PANELS.summary}</TabsContent>
        <TabsContent value="runs">{PANELS.runs}</TabsContent>
        <TabsContent value="evidence">{PANELS.evidence}</TabsContent>
      </Tabs>
    </div>
  ),
}

/** A tab whose content is not available here stays visible and says so. */
export const WithDisabledTab: Story = {
  render: () => (
    <div className="w-[520px]">
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="signed" disabled>
            Signed
          </TabsTrigger>
        </TabsList>
        <TabsContent value="summary">{PANELS.summary}</TabsContent>
        <TabsContent value="runs">{PANELS.runs}</TabsContent>
      </Tabs>
    </div>
  ),
}

/**
 * The unmatched half of the job: this item has no URL mode, where the v3 kit's
 * `Tabs` has `mode="state"` and `mode="url"`, and most of the strips the app
 * migrated are URL tabs. Rendered as an anchor row to show what the item cannot
 * express.
 */
export const UrlStripForComparison: Story = {
  render: () => (
    <div className="flex w-[520px] items-center gap-1 rounded-lg bg-surface-muted p-1 text-label text-fg-muted">
      {['Summary', 'Runs', 'Evidence'].map((label, index) => (
        <a
          key={label}
          href="#"
          aria-current={index === 0 ? 'page' : undefined}
          className="rounded-md px-3 py-1 font-medium text-fg no-underline aria-[current=page]:bg-surface aria-[current=page]:shadow"
        >
          {label}
        </a>
      ))}
    </div>
  ),
}
