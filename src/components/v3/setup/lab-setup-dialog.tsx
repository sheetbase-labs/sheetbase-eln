import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { ChoiceCheckbox } from '#/components/v3/ui/choice'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  browserTimeZone,
  completeWorkspaceSetup,
  rememberSetupSkipped,
  STARTER_TABLE_KEYS,
  starterTableLabel,
  timeZoneChoices,
} from '#/lib/lab-setup'
import type { StarterTableKey } from '#/lib/lab-setup'
import {
  describeJoinDomainError,
  emailDomainOf,
  isPublicEmailDomain,
  joinDomainKeys,
  setJoinDomains,
} from '#/lib/join-domains'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import { t } from '#/copy'

const client = createDataClient()

/**
 * Shown once, over Home, to the first admin of a new workspace. Every choice
 * starts on a sensible default so Finish setup takes one click; Skip for now
 * leaves the checklist on Home to come back to.
 */
export function LabSetupDialog({
  workspaceId,
  workspaceName,
  currentTimeZone,
  ownEmail,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  currentTimeZone?: string | null
  ownEmail: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const domain = emailDomainOf(ownEmail)
  const domainOffered = Boolean(domain) && !isPublicEmailDomain(domain)
  const [name, setName] = useState(workspaceName)
  const [timeZone, setTimeZone] = useState(currentTimeZone || browserTimeZone())
  const [allowDomain, setAllowDomain] = useState(domainOffered)
  const [starters, setStarters] = useState<ReadonlySet<StarterTableKey>>(
    new Set(STARTER_TABLE_KEYS),
  )
  const [error, setError] = useState<string | null>(null)

  const finish = useMutation({
    mutationFn: async () => {
      if (allowDomain && domainOffered) {
        try {
          await setJoinDomains(client, {
            workspaceId,
            domains: [domain],
            role: 'scientist',
          })
        } catch (failure) {
          throw new SetupStepError(describeJoinDomainError(failure))
        }
      }
      await completeWorkspaceSetup(client, {
        workspaceId,
        name,
        timeZone,
        starterKeys: STARTER_TABLE_KEYS.filter((key) => starters.has(key)),
      })
    },
    onSuccess: async () => {
      toast.success(t('settings.labSetup.done'))
      await queryClient.invalidateQueries({
        queryKey: workspaceGeneralQueryKey,
      })
      await queryClient.invalidateQueries({
        queryKey: joinDomainKeys.list(workspaceId),
      })
      await queryClient.invalidateQueries({ queryKey: ['ui-port', 'import'] })
      await router.invalidate()
      onClose()
    },
    onError: (failure) =>
      setError(
        failure instanceof SetupStepError
          ? failure.message
          : t('settings.labSetup.error'),
      ),
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !finish.isPending) {
          rememberSetupSkipped(workspaceId)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title={t('settings.labSetup.title')}
          description={t('settings.labSetup.description')}
        />
        <DialogBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.labSetup.labName')}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t('settings.labSetup.timeZone')}>
              <Select
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
              >
                {timeZoneChoices([timeZone, browserTimeZone()]).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {domainOffered ? (
            <ChoiceCheckbox
              title={t('settings.labSetup.joinTitle', { domain: `@${domain}` })}
              checked={allowDomain}
              onCheckedChange={(checked) => setAllowDomain(Boolean(checked))}
            >
              {t('settings.labSetup.joinHint')}
            </ChoiceCheckbox>
          ) : null}
          <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="p-0 text-label font-medium">
              {t('settings.labSetup.starterTitle')}
            </legend>
            <span className="text-label text-fg-muted">
              {t('settings.labSetup.starterHint')}
            </span>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {STARTER_TABLE_KEYS.map((key) => (
                <ChoiceCheckbox
                  key={key}
                  title={starterTableLabel(key)}
                  checked={starters.has(key)}
                  onCheckedChange={(checked) =>
                    setStarters((current) => {
                      const next = new Set(current)
                      if (checked) next.add(key)
                      else next.delete(key)
                      return next
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="quiet"
            disabled={finish.isPending}
            onClick={() => {
              rememberSetupSkipped(workspaceId)
              onClose()
            }}
          >
            {t('settings.labSetup.skip')}
          </Button>
          <Button
            variant="primary"
            disabled={finish.isPending || !name.trim()}
            onClick={() => {
              setError(null)
              finish.mutate()
            }}
          >
            {finish.isPending
              ? t('settings.labSetup.finishing')
              : t('settings.labSetup.finish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

class SetupStepError extends Error {}
