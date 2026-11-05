'use client'

import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { useFollowState } from '#/lib/follows'
import type { FollowKind } from '#/lib/follows'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'

/**
 * Follow or unfollow a record or project. A followed record or project is in
 * your Inbox's Following tab, and a followed record tells you about new
 * comments. The label says what you are doing now; a tooltip says what it does.
 */
export function FollowToggle({
  kind,
  objectId,
  client,
}: {
  kind: FollowKind
  /** Null while the page has no object yet; renders nothing. */
  objectId: string | null | undefined
  client?: DataClient
}) {
  const { following, ready, pending, setFollowing } = useFollowState(
    kind,
    objectId,
    client,
  )
  if (!objectId) return null
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      icon="bell"
      aria-pressed={following}
      disabled={pending || !ready}
      title={
        kind === 'record'
          ? t('account.follow.followRecordHint')
          : t('account.follow.followProjectHint')
      }
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
      <span className="max-md:sr-only">
        {following ? t('account.follow.following') : t('account.follow.follow')}
      </span>
    </Button>
  )
}
