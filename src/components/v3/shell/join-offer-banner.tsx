import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { DropdownMenuItem } from '#/components/v3/ui/dropdown-menu'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  describeJoinDomainError,
  fetchJoinOffer,
  joinDomainKeys,
  joinMyDomainWorkspace,
} from '#/lib/join-domains'
import type { JoinOffer } from '#/lib/join-domains'
import { setActiveWorkspace } from '#/lib/user-preferences'
import { t } from '#/copy'

const client = createDataClient()
const dismissedKey = (workspaceId: string) =>
  `sheetbase.join-offer.dismissed.${workspaceId}`

function wasDismissed(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(workspaceId)) === '1'
  } catch {
    return false
  }
}

const ROLE_WORDS: Record<string, () => string> = {
  scientist: () => t('settings.joinDomains.roleScientist').toLowerCase(),
  analyst: () => t('settings.joinDomains.roleAnalyst').toLowerCase(),
  reviewer: () => t('settings.joinDomains.roleReviewer').toLowerCase(),
  viewer: () => t('settings.joinDomains.roleViewer').toLowerCase(),
}

/** The offer, and joining it. Shared by the banner and the workspace menu. */
function useJoinOffer() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const offer = useQuery({
    queryKey: joinDomainKeys.offer,
    queryFn: () => fetchJoinOffer(client),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const join = useMutation({
    mutationFn: async (target: JoinOffer) => {
      const workspaceId = await joinMyDomainWorkspace(client)
      await setActiveWorkspace(client, workspaceId)
      return target
    },
    onSuccess: async (target) => {
      await queryClient.cancelQueries()
      queryClient.clear()
      toast.success(
        t('settings.joinDomains.joined', { workspace: target.workspace_name }),
      )
      await router.navigate({ to: '/', ignoreBlocker: true })
      await router.invalidate()
    },
    onError: (failure) => toast.error(describeJoinDomainError(failure)),
  })
  return { offer: offer.data ?? null, join }
}

/** The workspace menu's own row for the same offer. */
export function JoinOfferMenuItem() {
  const { offer, join } = useJoinOffer()
  if (!offer) return null
  return (
    <DropdownMenuItem
      icon="user"
      disabled={join.isPending}
      onClick={() => join.mutate(offer)}
    >
      {t('settings.joinDomains.offerJoin', { workspace: offer.workspace_name })}
    </DropdownMenuItem>
  )
}

/**
 * The lab someone's email domain opens, offered to a person who signed up
 * before the domain was added and so has a workspace of their own. Nothing
 * moves until they choose Join; Not now hides the offer on this device.
 */
export function JoinOfferBanner() {
  const { offer: data, join } = useJoinOffer()
  const [hidden, setHidden] = useState<string | null>(null)
  if (
    !data ||
    hidden === data.workspace_id ||
    wasDismissed(data.workspace_id)
  ) {
    return null
  }
  return (
    <Banner
      tone="review"
      icon="user"
      action={
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={join.isPending}
            onClick={() => join.mutate(data)}
          >
            {t('settings.joinDomains.offerJoin', {
              workspace: data.workspace_name,
            })}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              try {
                window.localStorage.setItem(
                  dismissedKey(data.workspace_id),
                  '1',
                )
              } catch {
                // Hidden for this visit even when the browser won't remember.
              }
              setHidden(data.workspace_id)
            }}
          >
            {t('settings.joinDomains.offerLater')}
          </Button>
        </>
      }
    >
      {t('settings.joinDomains.offerBody', {
        workspace: data.workspace_name,
        domain: `@${data.domain}`,
        role: (ROLE_WORDS[data.role] ?? ROLE_WORDS.scientist)(),
      })}
    </Banner>
  )
}
