import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Chip } from '#/components/v3/ui/chip'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  JOIN_ROLES,
  describeJoinDomainError,
  emailDomainOf,
  fetchJoinDomains,
  isDomainShaped,
  isPublicEmailDomain,
  joinDomainKeys,
  normaliseDomainInput,
  setJoinDomains,
} from '#/lib/join-domains'
import type { JoinRole } from '#/lib/join-domains'
import { t } from '#/copy'

const client = createDataClient()

const ROLE_LABEL: Record<JoinRole, () => string> = {
  scientist: () => t('settings.joinDomains.roleScientist'),
  analyst: () => t('settings.joinDomains.roleAnalyst'),
  reviewer: () => t('settings.joinDomains.roleReviewer'),
  viewer: () => t('settings.joinDomains.roleViewer'),
}

/**
 * Members and roles → "Let colleagues join". An admin lists the lab's email
 * domains and the role people join as; every change saves at once. The
 * database refuses public domains and any domain the admin's own verified
 * address doesn't use, so this only has to show what it says.
 */
export function JoinDomainsSection({
  workspaceId,
  canManage,
  ownEmail,
}: {
  workspaceId: string
  canManage: boolean
  /** The signed-in admin's address; its domain is the one they can add. */
  ownEmail: string
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const stored = useQuery({
    queryKey: joinDomainKeys.list(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: () => fetchJoinDomains(client),
  })
  const domains = (stored.data ?? []).map((row) => row.domain)
  const role: JoinRole = stored.data?.[0]?.role ?? 'scientist'

  const save = useMutation({
    mutationFn: (input: { domains: string[]; role: JoinRole }) =>
      setJoinDomains(client, { workspaceId, ...input }),
    onSuccess: async () => {
      setError(null)
      setDraft('')
      await queryClient.invalidateQueries({
        queryKey: joinDomainKeys.list(workspaceId),
      })
      toast.success(t('settings.joinDomains.saved'))
    },
    onError: (failure) => setError(describeJoinDomainError(failure)),
  })

  const ownDomain = emailDomainOf(ownEmail)
  const suggestion =
    ownDomain && !isPublicEmailDomain(ownDomain) && !domains.includes(ownDomain)
      ? ownDomain
      : null

  function add(raw: string) {
    const domain = normaliseDomainInput(raw)
    if (!domain) return
    if (!isDomainShaped(domain)) {
      setError(t('settings.joinDomains.invalid', { domain }))
      return
    }
    if (domains.includes(domain)) {
      setDraft('')
      return
    }
    save.mutate({ domains: [...domains, domain], role })
  }

  if (!canManage && domains.length === 0) return null

  return (
    <Section title={t('settings.joinDomains.title')}>
      <Muted>{t('settings.joinDomains.description')}</Muted>
      <div className="flex flex-wrap items-center gap-2">
        {domains.length === 0 ? (
          <Muted>{t('settings.joinDomains.none')}</Muted>
        ) : (
          domains.map((domain) => (
            <Chip
              key={domain}
              variant="remove"
              removeLabel={
                canManage
                  ? t('settings.joinDomains.remove', { domain })
                  : undefined
              }
              onRemove={
                canManage
                  ? () =>
                      save.mutate({
                        domains: domains.filter((item) => item !== domain),
                        role,
                      })
                  : undefined
              }
            >
              {domain}
            </Chip>
          ))
        )}
      </div>
      {canManage ? (
        <>
          <form
            className="flex max-w-[420px] flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              add(draft)
            }}
          >
            <Field
              label={t('settings.joinDomains.domainLabel')}
              className="min-w-[200px] flex-1"
              error={error}
            >
              <Input
                value={draft}
                placeholder={t('settings.joinDomains.domainPlaceholder')}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setError(null)
                }}
                inputMode="url"
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={save.isPending || !draft.trim()}>
              {t('settings.joinDomains.add')}
            </Button>
            {suggestion ? (
              <Button
                type="button"
                variant="quiet"
                disabled={save.isPending}
                onClick={() => add(suggestion)}
              >
                {t('settings.joinDomains.suggest', { domain: suggestion })}
              </Button>
            ) : null}
          </form>
          <Field
            label={t('settings.joinDomains.joinAs')}
            hint={t('settings.joinDomains.joinAsHint')}
            className="max-w-[240px]"
          >
            <Select
              value={role}
              disabled={save.isPending || domains.length === 0}
              onChange={(event) =>
                save.mutate({ domains, role: event.target.value as JoinRole })
              }
            >
              {JOIN_ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_LABEL[item]()}
                </option>
              ))}
            </Select>
          </Field>
          <Muted>{t('settings.joinDomains.yourDomainHint')}</Muted>
        </>
      ) : null}
    </Section>
  )
}
