/**
 * The sheet toolbar's quiet pieces: the one save line for the whole table and
 * the "More" menu that holds the less frequent tools. The design keeps the
 * toolbar to a save state and a couple of controls; everything else is one
 * click further away.
 */
import { useSyncExternalStore } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

const PHONE_TOOLBAR_QUERY = '(max-width: 640px)'

/** The phone query, or null where the page has no media queries (tests). */
function phoneQuery(): MediaQueryList | null {
  return 'matchMedia' in globalThis
    ? globalThis.matchMedia(PHONE_TOOLBAR_QUERY)
    : null
}

function subscribePhone(onChange: () => void): () => void {
  const query = phoneQuery()

  if (!query) return () => {}

  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}

/** True at phone width, where the toolbar folds its view switches into More. */
export function usePhoneToolbar(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => phoneQuery()?.matches ?? false,
    () => false,
  )
}

export type SheetSaveState = 'saved' | 'saving' | 'failed' | 'read-only'

/** One calm line for the whole table: did my edits save? */
export function SheetSaveStatus({
  state,
  detail,
}: {
  state: SheetSaveState | null
  /** Why a save failed, shown on hover. */
  detail?: string
}) {
  if (!state) return null

  const label = {
    saved: t('notebook.sheetToolbar.saved'),
    saving: t('notebook.sheetToolbar.saving'),
    failed: t('notebook.sheetToolbar.saveFailed'),
    'read-only': t('notebook.sheetToolbar.readOnly'),
  }[state]

  return (
    <span
      role="status"
      aria-live="polite"
      title={state === 'failed' ? detail : undefined}
      data-save-state={state}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 px-1 text-label',
        state === 'failed' ? 'text-danger-text' : 'text-fg-muted',
      )}
    >
      {state === 'saved' ? (
        <Icon name="check" size={13} aria-hidden="true" />
      ) : state === 'failed' ? (
        <Icon name="warn" size={13} aria-hidden="true" />
      ) : state === 'read-only' ? (
        <Icon name="lock" size={13} aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-fg-muted"
        />
      )}
      {label}
    </span>
  )
}

export interface SheetMoreItem {
  id: string
  label: string
  icon?: IconName
  disabled?: boolean
  onSelect: () => void
}

/** The tools a sheet needs now and then, behind one button. */
export function SheetMoreMenu({
  groups,
}: {
  groups: ReadonlyArray<{
    id: string
    label?: string
    items: readonly SheetMoreItem[]
  }>
}) {
  const shown = groups.filter((group) => group.items.length > 0)

  if (shown.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="more"
            aria-label={t('notebook.sheetToolbar.moreTools')}
          />
        }
      >
        <span className="max-sm:sr-only">
          {t('notebook.sheetToolbar.more')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {shown.map((group, index) => (
          <DropdownMenuGroup key={group.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {group.label ? (
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            ) : null}
            {group.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                icon={item.icon}
                disabled={item.disabled}
                onClick={item.onSelect}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
