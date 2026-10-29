import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { createDataClient } from '#/lib/data-client'
import {
  emailDomainOf,
  fetchJoinDomains,
  joinDomainKeys,
} from '#/lib/join-domains'
import { t } from '#/copy'

const client = createDataClient()
const dismissedKey = (workspaceId: string, userId: string) =>
  `sheetbase.joined-welcome.dismissed.${workspaceId}.${userId}`

function wasDismissed(workspaceId: string, userId: string): boolean {
  try {
    return (
      window.localStorage.getItem(dismissedKey(workspaceId, userId)) === '1'
    )
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

/**
 * Tells a colleague who got in through their email domain what happened and
 * who can change it. Shown on Home for people the lab's domain list covers;
 * owners and admins, who set the list up, never see it.
 */
export function JoinedWelcome({
  workspaceId,
  workspaceName,
  userId,
  email,
  role,
}: {
  workspaceId: string
  workspaceName: string
  userId: string
  email: string | null | undefined
  role: string | undefined
}) {
  const [hidden, setHidden] = useState(false)
  const domains = useQuery({
    queryKey: joinDomainKeys.list(workspaceId),
    queryFn: () => fetchJoinDomains(client),
    enabled: role !== undefined && role !== 'owner' && role !== 'admin',
  })
  const domain = emailDomainOf(email)
  const covered = (domains.data ?? []).some((row) => row.domain === domain)
  if (hidden || !covered || !role || wasDismissed(workspaceId, userId)) {
    return null
  }
  return (
    <Banner
      tone="info"
      title={t('projects.home.joinedWelcome.title', {
        workspace: workspaceName,
        role: (ROLE_WORDS[role] ?? (() => role))(),
      })}
      action={
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            try {
              window.localStorage.setItem(
                dismissedKey(workspaceId, userId),
                '1',
              )
            } catch {
              // Hidden for this visit even when the browser won't remember.
            }
            setHidden(true)
          }}
        >
          {t('projects.home.joinedWelcome.dismiss')}
        </Button>
      }
    >
      {t('projects.home.joinedWelcome.body', { domain: `@${domain}` })}
    </Banner>
  )
}
