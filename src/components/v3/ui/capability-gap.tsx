import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Capability gap: the honest state for an area whose capability is not built
 * in this deployment yet (a DB-first build). It is not an error and not an
 * empty state — nothing is missing from anyone's records. It says what the
 * area will do, what to use today instead, and, for admins only, the roadmap
 * item that tracks it.
 *
 * Usage: use it only when the capability does not exist in this deployment.
 * Use EmptyState when the capability exists but has no data, a danger Banner
 * when a request failed, and the denied Notice when the person lacks
 * permission. Always offer at least one real alternative link; never show
 * sample data inside a gap. The roadmap chip is for admins, never clients.
 */
export type CapabilityGapLink = {
  label: React.ReactNode
  link: LinkProps
  note?: React.ReactNode
}

type Props = {
  title: React.ReactNode
  /** One or two sentences: what this area will do once the capability exists. */
  will: React.ReactNode
  /** What exists today instead. At least one link; the first is the most useful. */
  instead: CapabilityGapLink[]
  /** Roadmap item, e.g. RM-112. Shown only when `admin` is true. */
  roadmap?: string
  admin?: boolean
  icon?: IconName
  /** page: in place of a tab's content. inline: inside a panel or inspector. */
  variant?: 'page' | 'inline'
  className?: string
}

export function RoadmapChip({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-surface px-1.5 text-[11px] text-fg-muted',
        className,
      )}
      title="Visible to workspace admins only"
    >
      Tracked as <span className="mono text-fg">{id}</span>
    </span>
  )
}

export function CapabilityGap({
  title,
  will,
  instead,
  roadmap,
  admin,
  icon = 'clock',
  variant = 'page',
  className,
}: Props) {
  if (variant === 'inline') {
    return (
      <div
        data-slot="capability-gap"
        role="note"
        className={cn(
          'flex gap-2.5 rounded-md border border-dashed border-border-strong px-3 py-2.5 text-label leading-[18px]',
          className,
        )}
      >
        <Icon name={icon} size={14} className="mt-0.5 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{title}</span>
            {admin && roadmap ? <RoadmapChip id={roadmap} /> : null}
          </div>
          <p className="m-0 mt-0.5 text-fg-muted">{will}</p>
          <p className="m-0 mt-1.5">
            <span className="text-fg-muted">Today: </span>
            {instead.map((l, i) => (
              <span key={i}>
                {i ? <span className="text-fg-muted"> · </span> : null}
                <Link {...l.link}>{l.label}</Link>
              </span>
            ))}
          </p>
        </div>
      </div>
    )
  }
  return (
    <section
      data-slot="capability-gap"
      aria-label="Not available in this release"
      className={cn('flex max-w-[600px] flex-col gap-3 py-2', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-md border border-dashed border-border-strong text-fg-muted">
          <Icon name={icon} size={16} />
        </span>
        <span className="text-label text-fg-muted">
          Not in this release yet
        </span>
        {admin && roadmap ? (
          <RoadmapChip id={roadmap} className="ml-auto" />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-section">{title}</h2>
        <p className="m-0 text-body leading-5 text-fg-muted">{will}</p>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-surface-muted px-3 py-1.5 text-label font-medium text-fg-muted">
          What you can use today
        </div>
        <ul className="m-0 list-none p-0">
          {instead.map((l, i) => (
            <li
              key={i}
              className="border-b border-border-subtle last:border-b-0"
            >
              <Link
                {...l.link}
                className="flex min-h-10 items-center gap-3 px-3 py-2 text-body text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline max-md:min-h-12"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-link">{l.label}</span>
                  {l.note ? (
                    <span className="text-label text-fg-muted">{l.note}</span>
                  ) : null}
                </span>
                <Icon
                  name="chevronRight"
                  size={14}
                  className="shrink-0 text-fg-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 text-caption text-fg-muted">
        New capabilities arrive in a validated release through change control.
        Nothing is missing from your records; this area simply isn’t switched on
        in this deployment.
      </p>
    </section>
  )
}
