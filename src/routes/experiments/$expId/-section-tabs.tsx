import { Tabs } from '#/components/ui/tabs'
import type { LinkProps } from '@tanstack/react-router'

/**
 * The sections inside one of the experiment's tabs (Data, Review): a compact
 * strip of links, one per section, each its own URL. The tab above stays lit
 * while any of its sections is open.
 */
export function SectionTabs({
  label,
  items,
}: {
  label: string
  items: readonly { label: string; link: LinkProps }[]
}) {
  return (
    <div className="px-4 pt-3 md:px-8">
      <Tabs mode="url" variant="segment" label={label} items={[...items]} />
    </div>
  )
}
