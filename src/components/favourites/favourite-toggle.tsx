'use client'

import { Star } from 'lucide-react'

import { Button } from '#/components/ui'
import { useFavouriteState } from '#/lib/favourites'
import type { DataClient } from '#/lib/data-client'
import type { FavouriteObjectKind } from '#/lib/favourites'
import { cn } from '#/lib/utils'

/**
 * FIND-02 — the star toggle for favouriting a canonical object. Rendered in
 * the object page header on the five surfaces FIND-01 tracks views on.
 *
 * Optimistic and never blocking: the star flips immediately, the write goes
 * through the `set_record_favourite` SECURITY DEFINER RPC, and a failed write
 * rolls the star back and surfaces a small error message. Unknown or
 * no-longer-visible objects are ignored server-side (the RPC returns null),
 * so a stale star can never create data.
 */
export function FavouriteToggle({
  kind,
  objectId,
  client,
  className,
}: {
  kind: FavouriteObjectKind
  /** Null when the page has no canonical object selected; renders nothing. */
  objectId: string | null | undefined
  /** Injectable client for presentational tests; defaults to the app client. */
  client?: DataClient
  className?: string
}) {
  const { isFavourite, setFavourite, pending, error } = useFavouriteState(
    kind,
    objectId,
    client,
  )

  if (!objectId) return null

  return (
    <span className={cn('inline-flex items-center', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={isFavourite ? 'Remove favourite' : 'Add favourite'}
        aria-pressed={isFavourite}
        disabled={pending}
        onClick={() => setFavourite(!isFavourite)}
      >
        <Star
          className={cn(
            'size-3.5',
            isFavourite
              ? 'fill-warning text-warning-text'
              : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          Could not save favourite.
        </span>
      ) : null}
    </span>
  )
}
