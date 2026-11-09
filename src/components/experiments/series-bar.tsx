import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { ObjectLink } from '#/components/ui/object-link'
import { t } from '#/copy'
import { useSeriesMembers, useSeriesMembership } from '#/lib/experiment-series'
import { cn } from '#/lib/utils'

/**
 * Where an experiment sits in its series: "3 of 5 in EXP-0142 Cell viability
 * assay", a chip for each experiment, and the ones either side. Nothing
 * renders for an experiment that is in no series, so a plain experiment page
 * is unchanged.
 *
 * On a desktop it sits under the header's meta line; on a phone it takes the
 * top of the notebook instead and gives up the chips and the neighbours' names,
 * so it is one line and adds no height to the header.
 */
export function SeriesBar({
  recordId,
  placement,
}: {
  recordId: string
  placement: 'header' | 'notebook'
}) {
  const membership = useSeriesMembership(recordId)
  const info = membership.data
  const members = useSeriesMembers(info?.series_record_id)

  if (!info) return null
  const chips = members.data ?? []

  return (
    <nav
      aria-label={t('projects.series.bar.label')}
      data-testid={`series-bar-${placement}`}
      className={cn(
        'flex min-w-0 items-center gap-2 text-body text-fg-muted',
        placement === 'header'
          ? 'max-md:hidden'
          : 'mx-0 mb-3 rounded-md border border-border px-3 py-1.5 md:hidden',
      )}
    >
      <Icon name="link" size={14} className="shrink-0" />
      <span className="min-w-0 truncate">
        {t('projects.series.bar.position', {
          number: info.member_number,
          total: info.member_total,
        })}{' '}
        <ObjectLink
          kind="experiment"
          id={info.series_record_id}
          identifier={info.series_identifier}
        />{' '}
        <Link
          to="/experiments/$expId/series"
          params={{ expId: info.series_record_id }}
          className="text-link"
        >
          {info.series_title}
        </Link>
      </span>
      {placement === 'header' && chips.length > 1 ? (
        <span className="flex shrink-0 items-center gap-1">
          {chips.map((member) => {
            const current = member.member_record_id === recordId

            return (
              <Link
                key={member.member_record_id}
                to="/experiments/$expId/notebook"
                params={{ expId: member.member_record_id }}
                aria-current={current ? 'page' : undefined}
                title={t('projects.series.bar.member', {
                  number: member.member_number,
                  identifier: member.identifier,
                  title: member.title,
                })}
                className={cn(
                  'flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 text-label tabular-nums',
                  current
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : member.status === 'approved'
                      ? 'border-transparent bg-success-wash text-success-text'
                      : 'border-border text-fg-muted hover:bg-surface-muted',
                )}
              >
                {member.member_number}
              </Link>
            )
          })}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 max-md:gap-1">
        {info.previous_record_id ? (
          <Link
            to="/experiments/$expId/notebook"
            params={{ expId: info.previous_record_id }}
            aria-label={t('projects.series.bar.previous')}
            className="flex min-w-0 items-center gap-1 hover:text-fg"
          >
            <Icon name="chevronLeft" size={14} />
            <span className="max-w-48 truncate max-md:hidden">
              {info.previous_title}
            </span>
          </Link>
        ) : null}
        {info.next_record_id ? (
          <Link
            to="/experiments/$expId/notebook"
            params={{ expId: info.next_record_id }}
            aria-label={t('projects.series.bar.following')}
            className="flex min-w-0 items-center gap-1 hover:text-fg"
          >
            <span className="max-w-48 truncate max-md:hidden">
              {info.next_title}
            </span>
            <Icon name="chevronRight" size={14} />
          </Link>
        ) : null}
      </span>
    </nav>
  )
}
