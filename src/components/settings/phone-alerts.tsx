import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { t } from '#/copy'
import {
  disablePush,
  enablePush,
  PushUnavailableError,
  pushQueryKeys,
  readPushState,
} from '#/lib/push-client'

/**
 * Phone alerts for this device. The permission prompt comes from the tap on
 * "Turn on", never on its own. Which events reach the phone is the Phone column
 * of the table below.
 */
export function PhoneAlerts() {
  const queryClient = useQueryClient()

  const state = useQuery({
    queryKey: pushQueryKeys.state(),
    queryFn: () => readPushState(),
    staleTime: 0,
  })

  const change = useMutation({
    mutationFn: (turnOn: boolean) => (turnOn ? enablePush() : disablePush()),
    onSuccess: (next) => queryClient.setQueryData(pushQueryKeys.state(), next),
  })

  if (state.isLoading || !state.data) return null
  const current = state.data

  if (current === 'unsupported') {
    return (
      <Notice tone="info" icon="bell">
        {t('settings.notifications.phoneUnsupported')}
      </Notice>
    )
  }

  if (current === 'blocked') {
    return (
      <Notice tone="warn" icon="bell">
        {t('settings.notifications.phoneBlocked')}
      </Notice>
    )
  }

  const on = current === 'on'

  return (
    <div className="flex flex-col gap-2">
      <Notice
        tone="info"
        icon="bell"
        title={t(
          on
            ? 'settings.notifications.phoneOnTitle'
            : 'settings.notifications.phoneOffTitle',
        )}
        action={
          <Button
            type="button"
            variant={on ? 'secondary' : 'primary'}
            disabled={change.isPending}
            onClick={() => change.mutate(!on)}
          >
            {t(
              on
                ? 'settings.notifications.phoneTurnOff'
                : 'settings.notifications.phoneTurnOn',
            )}
          </Button>
        }
      >
        {t(
          on
            ? 'settings.notifications.phoneOnBody'
            : 'settings.notifications.phoneOffBody',
        )}
      </Notice>
      {change.isError ? (
        <Notice tone="bad">
          {change.error instanceof PushUnavailableError
            ? t('settings.notifications.phoneNotReady')
            : t('settings.notifications.phoneCouldNotChange')}
        </Notice>
      ) : null}
    </div>
  )
}
