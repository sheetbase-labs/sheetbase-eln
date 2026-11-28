'use client'

import { FollowToggle } from '#/components/follow/follow-toggle'
import type { Crumb } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Inspector, PageHeader } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import type { TabsProps } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { useFollowState } from '#/lib/follows'
import type { FollowKind } from '#/lib/follows'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

import { PaneHeaderSlot } from './pane-header-slot'

/** One fact the header shows beside the ID and status: "Expires 12 Dec". */
export interface RecordFact {
  label: string
  value: React.ReactNode
  /** Identifiers and numbers read in the mono face. */
  mono?: boolean
}

/** The header shows this many facts; the rest belong in the side panel. */
export const RECORD_FACT_LIMIT = 4

export interface RecordPageProps {
  /** The record behind the page; its Follow bell goes in the pane header. */
  recordId: string | null | undefined
  followKind?: FollowKind
  trail: readonly Crumb[]
  title: React.ReactNode
  paneTitle?: string
  identifier: string
  status?: { tone: Tone; label: React.ReactNode }
  /** Up to four facts, in the order the model gives them. */
  facts?: readonly RecordFact[]
  /** Marks that are not facts (hazard pictograms), after the facts. */
  marks?: React.ReactNode
  /** The one main action, or a decision pair. */
  actions?: React.ReactNode
  /** Everything else a person can do: `DropdownMenuItem`s for the ⋯ menu. */
  more?: React.ReactNode
  /** The ⋯ button's name, e.g. "More lot actions". */
  moreLabel?: string
  /** At most one `RecordStateLine`. */
  stateLine?: React.ReactNode
  tabs: TabsProps
  /** The side panel's sections: Properties, kind sections, Links, Activity. */
  side?: React.ReactNode
  sideLabel?: string
  /** Dialogs and print views the page owns; rendered outside the scroll. */
  overlays?: React.ReactNode
  /**
   * The tab content sets its own padding and width (a document read at a
   * comfortable measure), so the body adds none.
   */
  flush?: boolean
  /**
   * The tab content owns its scrolling and panes (a notebook with its own
   * outline and inspector), so the body only fills the space.
   */
  fill?: boolean
  /** A phone header that folds to the title and actions as you scroll. */
  compact?: boolean
  /** A row that belongs with the tabs, such as a series' runs. */
  aboveTabs?: React.ReactNode
  /**
   * The actions bring their own ⋯ menu (an experiment's lifecycle), which
   * then holds `FollowMenuItem` for a phone; the page adds no second one.
   */
  actionsOwnMenu?: boolean
  children: React.ReactNode
}

/** A count of nothing says nothing, so the tab shows its name alone. */
function withoutZeroCounts(tabs: TabsProps): TabsProps {
  const hide = <Item extends { count?: React.ReactNode }>(item: Item): Item =>
    item.count === 0 ? { ...item, count: undefined } : item

  return tabs.mode === 'url'
    ? { ...tabs, items: tabs.items.map(hide) }
    : { ...tabs, items: tabs.items.map(hide) }
}

/**
 * The one record page every kind uses: the pane header carries Follow; the
 * header names the record (its title may wrap), says its ID and status once
 * with up to four facts, and offers one main action with the rest under ⋯;
 * one state line replaces the banners; the tabs open on the record and end on
 * History; the side panel holds its other fields, links and recent activity.
 */
export function RecordPage({
  recordId,
  followKind = 'record',
  trail,
  title,
  paneTitle,
  identifier,
  status,
  facts = [],
  marks,
  actions,
  more,
  moreLabel,
  stateLine,
  tabs,
  side,
  sideLabel,
  overlays,
  flush = false,
  fill = false,
  compact = false,
  aboveTabs,
  actionsOwnMenu = false,
  children,
}: RecordPageProps) {
  return (
    <div data-record-page className="flex min-w-0 flex-1 flex-col">
      <PaneHeaderSlot>
        <FollowToggle kind={followKind} objectId={recordId} appearance="pane" />
      </PaneHeaderSlot>
      <PageHeader
        trail={trail}
        title={title}
        paneTitle={paneTitle}
        wrapTitle
        compact={compact}
        meta={
          <RecordMeta
            identifier={identifier}
            status={status}
            facts={facts}
            marks={marks}
          />
        }
        actions={
          actionsOwnMenu ? (
            actions
          ) : (
            <RecordActions
              actions={actions}
              more={more}
              moreLabel={moreLabel}
              followKind={followKind}
              recordId={recordId}
            />
          )
        }
        notice={stateLine}
        tabs={
          aboveTabs ? (
            <div className="flex flex-col gap-1.5">
              {aboveTabs}
              <Tabs {...withoutZeroCounts(tabs)} />
            </div>
          ) : (
            <Tabs {...withoutZeroCounts(tabs)} />
          )
        }
      />
      <div className="flex min-h-0 flex-1">
        <div
          data-record-page-body
          className={cn(
            'flex min-w-0 flex-1',
            fill ? 'min-h-0' : 'flex-col overflow-auto',
            !flush && !fill && 'gap-6 px-4 py-5 md:px-6',
          )}
        >
          {children}
        </div>
        {side ? (
          <Inspector
            aria-label={sideLabel ?? t('notebook.recordPage.sidePanel')}
            label={sideLabel ?? t('notebook.recordPage.sidePanel')}
            width={300}
          >
            {side}
          </Inspector>
        ) : null}
      </div>
      {overlays}
    </div>
  )
}

function RecordMeta({
  identifier,
  status,
  facts,
  marks,
}: {
  identifier: string
  status?: RecordPageProps['status']
  facts: readonly RecordFact[]
  marks?: React.ReactNode
}) {
  return (
    <>
      <span className="font-mono text-fg" data-record-id>
        {identifier}
      </span>
      {status ? <Status tone={status.tone}>{status.label}</Status> : null}
      {facts.slice(0, RECORD_FACT_LIMIT).map((fact) => (
        <span key={fact.label} data-record-fact className="min-w-0">
          {fact.label}{' '}
          <span
            className={cn(
              'font-medium text-fg',
              fact.mono && 'font-mono tabular-nums',
            )}
          >
            {fact.value}
          </span>
        </span>
      ))}
      {marks}
    </>
  )
}

function RecordActions({
  actions,
  more,
  moreLabel,
  followKind,
  recordId,
}: {
  actions?: React.ReactNode
  more?: React.ReactNode
  moreLabel?: string
  followKind: FollowKind
  recordId: string | null | undefined
}) {
  // A page with nothing under ⋯ and nothing to follow has no menu at all.
  if (!more && !recordId) return <>{actions}</>

  return (
    <>
      {actions}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="secondary"
              aria-label={moreLabel ?? t('notebook.recordPage.moreActions')}
              title={moreLabel ?? t('notebook.recordPage.moreActions')}
              icon="more"
              // With nothing else to offer, the menu only holds the phone's
              // Follow, so a computer does without it.
              className={more ? undefined : 'md:hidden'}
            />
          }
        />
        <DropdownMenuContent align="end" className="min-w-[200px]">
          {more}
          <FollowMenuItem kind={followKind} objectId={recordId} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/**
 * A phone shows one page with no pane header, so the bell the header carries
 * on a computer is the last item of the ⋯ menu there.
 */
export function FollowMenuItem({
  kind,
  objectId,
}: {
  kind: FollowKind
  objectId: string | null | undefined
}) {
  const { following, ready, pending, setFollowing } = useFollowState(
    kind,
    objectId,
  )

  if (!objectId) return null

  return (
    <DropdownMenuItem
      className="md:hidden"
      disabled={pending || !ready}
      onClick={() => {
        const next = !following
        setFollowing(next)
        toast(
          next
            ? t('account.follow.followedToast')
            : t('account.follow.unfollowedToast'),
        )
      }}
    >
      {following ? t('account.follow.unfollow') : t('account.follow.follow')}
    </DropdownMenuItem>
  )
}
