/**
 * What plugins added to a record: their summaries, the holds they raised and
 * the sign-off steps they asked for. Silent when there is nothing to show.
 * A sign-off is pressed by a person; the database checks their role.
 */
import { Fragment } from 'react'

import { InspectorSection } from '#/components/record'
import { Button } from '#/components/ui/button'
import { Row, RowList } from '#/components/ui/row'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  usePluginRecordState,
  useSignOffPluginStep,
} from '#/lib/plugin-record-data'
import type { PluginFlag, PluginRecordState } from '#/lib/plugin-record-data'

/** Pure render of the state: the unit under the component test. */
export function PluginRecordList({
  state,
  myUserId,
  signing,
  onSignOff,
}: {
  state: PluginRecordState
  myUserId: string | null
  signing?: string | null
  onSignOff?: (flag: PluginFlag) => void
}) {
  return (
    <RowList>
      {state.flags.map((flag) => {
        const isStep = flag.kind === 'sign_off'
        const madeIt =
          flag.independent &&
          myUserId !== null &&
          flag.raised_by_user_id === myUserId
        const canSign = isStep && onSignOff && !flag.signedByMe && !madeIt
        return (
          <Fragment key={flag.id}>
            <Row
              data-plugin-flag={flag.flag_key}
              eyebrow={t('plugins.recordPanel.from', {
                plugin: flag.extension_name,
              })}
              title={flag.title}
              meta={
                isStep
                  ? `${t('plugins.recordPanel.waiting')} · ${t(
                      'plugins.recordPanel.signedBy',
                      { count: flag.signed, needed: flag.approvals_needed },
                    )}`
                  : [t('plugins.recordPanel.openHold'), flag.message]
                      .filter(Boolean)
                      .join(' · ')
              }
              detail={
                isStep
                  ? [
                      flag.message,
                      t('plugins.recordPanel.roles', {
                        roles: flag.roles.join(', '),
                      }),
                      madeIt ? t('plugins.recordPanel.youMadeIt') : '',
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : flag.message
              }
            />
            {/* Under the step, not beside it: the panel is narrow and the words come first. */}
            {canSign ? (
              <li className="px-2 pb-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={signing === flag.id}
                  onClick={() => onSignOff(flag)}
                >
                  {signing === flag.id
                    ? t('plugins.recordPanel.signing')
                    : t('plugins.recordPanel.signOff')}
                </Button>
              </li>
            ) : null}
          </Fragment>
        )
      })}
      {state.summaries.map((summary) => (
        <Row
          key={`${summary.extension_key}:${summary.hook_id}`}
          eyebrow={t('plugins.recordPanel.from', {
            plugin: summary.extension_name,
          })}
          title={summary.summary}
        />
      ))}
    </RowList>
  )
}

export function PluginRecordPanel({
  recordId,
  myUserId,
}: {
  recordId: string
  myUserId: string | null
}) {
  const query = usePluginRecordState(recordId, myUserId)
  const sign = useSignOffPluginStep(recordId)
  const state = query.data
  if (query.isError)
    return (
      <InspectorSection title={t('plugins.recordPanel.title')}>
        <p className="py-1 text-xs text-muted-foreground">
          {t('plugins.recordPanel.loadFailed')}
        </p>
      </InspectorSection>
    )
  if (!state || (state.flags.length === 0 && state.summaries.length === 0))
    return null
  return (
    <InspectorSection title={t('plugins.recordPanel.title')}>
      <PluginRecordList
        state={state}
        myUserId={myUserId}
        signing={sign.isPending ? sign.variables.flagId : null}
        onSignOff={(flag) =>
          sign.mutate(
            { flagId: flag.id },
            {
              onSuccess: () => toast(t('plugins.recordPanel.signedOff')),
              onError: (error) =>
                toast.error(
                  t('plugins.recordPanel.failed', {
                    reason: error instanceof Error ? error.message : '',
                  }),
                ),
            },
          )
        }
      />
    </InspectorSection>
  )
}
