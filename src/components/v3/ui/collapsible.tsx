import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * A disclosure: a trigger that opens and closes one panel.
 *
 * The app reinvented this per screen — native `<details>` in seven places, each
 * with its own summary styling and no control beside the summary, and one table
 * row expander that toggled a `Show`/`Hide` label with **no `aria-expanded` at
 * all**, so the only signal of what the control would do was its text. Base UI
 * owns the parts an accessible disclosure needs: `aria-expanded` and
 * `aria-controls` on the trigger, the panel's association, Enter/Space, and the
 * open/closed state; this module owns the chrome.
 *
 * Composition is the caller's, because the sites differ: a trigger can be a text
 * summary, a quiet `Button`, or a control inside a table cell, and the panel can
 * be a `<div>` or — for a table row — a `<tr>`.
 *
 * ```tsx
 * <Collapsible>
 *   <CollapsibleTrigger>Agreement and start date</CollapsibleTrigger>
 *   <CollapsiblePanel>…</CollapsiblePanel>
 * </Collapsible>
 * ```
 *
 * The panel is not mounted while closed, so a payload inside it is not fetched,
 * rendered or hidden from the browser's page search. Pass `keepMounted` to keep
 * it in the DOM, or `hiddenUntilFound` to keep it findable by the browser's own
 * find-in-page — the one thing native `<details>` gave for free.
 *
 * Not for: a chart or a figure that grows to fill the screen. That is a size
 * change on content that is always visible, not a disclosure, and the figure
 * renderers stay in-house (ADR-0055 decision 6).
 */

export const Collapsible = CollapsiblePrimitive.Root

export function CollapsibleTrigger({
  className,
  children,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'group inline-flex cursor-pointer items-center gap-1 rounded-sm text-label text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
      {...props}
    >
      <Icon
        name="chevronRight"
        size={12}
        className="shrink-0 text-fg-muted transition-transform group-data-[panel-open]:rotate-90 motion-reduce:transition-none"
      />
      {children}
    </CollapsiblePrimitive.Trigger>
  )
}

export function CollapsiblePanel({
  className,
  children,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn(className)}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Panel>
  )
}
