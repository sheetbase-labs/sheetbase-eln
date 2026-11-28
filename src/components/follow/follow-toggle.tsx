'use client'

import { Icon } from '#/components/icons'
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
  appearance = 'button',
}: {
  kind: FollowKind
  /** Null while the page has no object yet; renders nothing. */
  objectId: string | null | undefined
  client?: DataClient
  /**
   * `pane` is the bell alone, drawn like the pane header's own buttons, for a
   * record page that lends it to the header of the pane it sits in.
   */
  appearance?: 'button' | 'pane'
}) {
  const { following, ready, pending, setFollowing } = useFollowState(
    kind,
    objectId,
    client,
  )

  if (!objectId) return null

  const label = following
    ? t('account.follow.following')
    : t('account.follow.follow')

  const hint =
    kind === 'record'
      ? t('account.follow.followRecordHint')
      : t('account.follow.followProjectHint')

  function toggle() {
    const next = !following
    setFollowing(next)
    toast(
      next
        ? t('account.follow.followedToast')
        : t('account.follow.unfollowedToast'),
    )
  }

  if (appearance === 'pane') {
    return (
      <button
        type="button"
        className="mx-act"
        data-follow-toggle
        aria-pressed={following}
        aria-label={t('account.follow.follow')}
        title={hint}
        disabled={pending || !ready}
        onClick={toggle}
      >
        <Icon name="bell" size={14} aria-hidden="true" />
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      icon="bell"
      aria-pressed={following}
      disabled={pending || !ready}
      title={hint}
      onClick={toggle}
    >
      <span className="max-md:sr-only">{label}</span>
    </Button>
  )
}
