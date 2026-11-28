import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Chip } from '#/components/ui/chip'
import { Field, FieldRow, Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  JOIN_ROLES,
  describeJoinDomainError,
  emailDomainOf,
  fetchJoinDomains,
  isJoinDomain,
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

    if (!isJoinDomain(domain)) {
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
    <Section
      title={t('settings.joinDomains.title')}
      description={t('settings.joinDomains.description')}
    >
      <JoinDomainChips
        domains={domains}
        suggestion={canManage ? suggestion : null}
        disabled={save.isPending}
        onAdd={add}
        onRemove={
          canManage
            ? (domain) =>
                save.mutate({
                  domains: domains.filter((item) => item !== domain),
                  role,
                })
            : undefined
        }
      />
      {canManage ? (
        <FieldRow>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              add(draft)
            }}
          >
            <Field
              label={t('settings.joinDomains.domainLabel')}
              className="w-56 max-md:min-w-0 max-md:flex-1"
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
          </form>
          <Field
            label={t('settings.joinDomains.joinAs')}
            className="w-40 max-md:basis-full md:ml-4"
          >
            <Select
              value={role}
              disabled={save.isPending || domains.length === 0}
              onChange={(event) => {
                const selectedRole = JOIN_ROLES.find(
                  (option) => option === event.target.value,
                )

                if (selectedRole) save.mutate({ domains, role: selectedRole })
              }}
            >
              {JOIN_ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_LABEL[item]()}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      ) : null}
    </Section>
  )
}

/** The domains people join from, with the admin's own domain offered beside
 * them until it is added. */
function JoinDomainChips({
  domains,
  suggestion,
  disabled,
  onAdd,
  onRemove,
}: {
  domains: string[]
  suggestion: string | null
  disabled: boolean
  onAdd: (domain: string) => void
  onRemove?: (domain: string) => void
}) {
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-1.5">
      {domains.map((domain) => (
        <Chip
          key={domain}
          variant="remove"
          removeLabel={
            onRemove ? t('settings.joinDomains.remove', { domain }) : undefined
          }
          onRemove={onRemove ? () => onRemove(domain) : undefined}
        >
          {domain}
        </Chip>
      ))}
      {suggestion ? (
        <Chip
          icon="plus"
          className="border-dashed text-fg-muted hover:text-fg"
          disabled={disabled}
          onClick={() => onAdd(suggestion)}
        >
          {t('settings.joinDomains.suggest', { domain: suggestion })}
        </Chip>
      ) : null}
      {domains.length === 0 && !suggestion ? (
        <span className="text-label text-fg-muted">
          {t('settings.joinDomains.noDomains')}
        </span>
      ) : null}
    </div>
  )
}
