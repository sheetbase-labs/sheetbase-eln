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
  value,
}: {
  label: string
  items: readonly { key?: string; label: string; link: LinkProps }[]
  /** The key of the current section, when several share one route. */
  value?: string
}) {
  return (
    <div className="px-4 pt-3 md:px-8">
      <Tabs
        mode="url"
        variant="segment"
        label={label}
        value={value}
        items={[...items]}
      />
    </div>
  )
}
