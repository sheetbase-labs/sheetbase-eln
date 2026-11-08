import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  changeChannel,
  channelsQueryKey,
  listChannels,
} from '#/lib/extensions/outgoing-client'
import type { ChannelWire } from '#/lib/extensions/outgoing-client'

/**
 * The other ways notifications can reach this person, added by plugins (a chat
 * message, say). Shows nothing until a plugin adds one. Which notifications
 * are sent follows the choice made here: the ones that alert the phone, or all.
 */
export function PluginChannels() {
  const channels = useQuery({
    queryKey: channelsQueryKey,
    queryFn: listChannels,
    staleTime: 0,
  })
  if (!channels.data || channels.data.length === 0) return null
  return (
    <section
      aria-label={t('settings.notifications.channels.heading')}
      className="flex flex-col gap-3"
    >
      <h2 className="m-0 text-body font-semibold text-fg">
        {t('settings.notifications.channels.heading')}
      </h2>
      {channels.data.map((channel) => (
        <ChannelCard
          key={`${channel.extensionKey}:${channel.channelId}`}
          channel={channel}
        />
      ))}
    </section>
  )
}

function ChannelCard({ channel }: { channel: ChannelWire }) {
  const queryClient = useQueryClient()
  const on = channel.mine !== null
  const [destination, setDestination] = useState(
    channel.mine?.destination ?? '',
  )
  const [scope, setScope] = useState<'phone' | 'all'>(
    channel.mine?.scope ?? 'phone',
  )
  const apply = useMutation({
    mutationFn: changeChannel,
    onSuccess: (next, input) => {
      queryClient.setQueryData(channelsQueryKey, next)
      if (input.action === 'test')
        toast(t('settings.notifications.channels.testSent'))
      if (input.action === 'save')
        toast(t('settings.notifications.channels.saved'))
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.notifications.channels.couldNotChange'),
      ),
  })
  const base = {
    extensionKey: channel.extensionKey,
    channelId: channel.channelId,
  }
  const changed =
    !on ||
    destination.trim() !== channel.mine?.destination ||
    scope !== channel.mine.scope
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-fg">{channel.title}</span>
        <span className="text-caption text-fg-muted">
          {channel.description}
        </span>
      </div>
      {!channel.ready ? (
        <Notice tone="warn">
          {t('settings.notifications.channels.notReady')}
        </Notice>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={channel.destinationLabel}
            className="min-w-[220px] flex-1"
          >
            <Input
              value={destination}
              placeholder={channel.destinationHint ?? undefined}
              onChange={(e) => setDestination(e.target.value)}
            />
          </Field>
          <Field label={t('settings.notifications.channels.send')}>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'phone' | 'all')}
            >
              <option value="phone">
                {t('settings.notifications.channels.scopePhone')}
              </option>
              <option value="all">
                {t('settings.notifications.channels.scopeAll')}
              </option>
            </Select>
          </Field>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={apply.isPending || !destination.trim() || !changed}
              onClick={() =>
                apply.mutate({
                  action: 'save',
                  ...base,
                  destination: destination.trim(),
                  scope,
                })
              }
            >
              {t(
                on
                  ? 'common.actions.save'
                  : 'settings.notifications.channels.turnOn',
              )}
            </Button>
            {on ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={apply.isPending || changed}
                  onClick={() => apply.mutate({ action: 'test', ...base })}
                >
                  {t('settings.notifications.channels.sendTest')}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate({ action: 'remove', ...base })}
                >
                  {t('settings.notifications.channels.turnOff')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
      {channel.mine?.lastError ? (
        <Notice tone="bad">
          {t('settings.notifications.channels.lastFailed', {
            reason: channel.mine.lastError,
          })}
        </Notice>
      ) : null}
    </div>
  )
}
