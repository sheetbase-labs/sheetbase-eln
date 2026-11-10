import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { DescriptionList } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  clientSharingKeys,
  fetchRecordSharing,
  recordSharingKey,
  shareRecordWithClient,
  unshareRecordWithClient,
} from '#/lib/client-sharing'
import type { RecordSharing } from '#/lib/client-sharing'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

const dataClient = createDataClient()

function useRecordSharing(open: boolean, recordId: string) {
  const queryClient = useQueryClient()

  const sharing = useQuery({
    queryKey: recordSharingKey(recordId),
    queryFn: () => fetchRecordSharing(dataClient, recordId),
    enabled: open,
  })

  const info = sharing.data
  const clientName = info?.clientName ?? ''
  const shared = info?.sharedAt != null

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: recordSharingKey(recordId) })

    if (info?.clientId) {
      void queryClient.invalidateQueries({
        queryKey: clientSharingKeys.shares(info.clientId),
      })
      void queryClient.invalidateQueries({
        queryKey: clientSharingKeys.preview(info.clientId),
      })
    }
  }

  const change = useMutation({
    mutationFn: async (share: boolean) => {
      if (!info?.clientId) return
      const input = { clientId: info.clientId, recordId }

      if (share) await shareRecordWithClient(dataClient, input)
      else await unshareRecordWithClient(dataClient, input)
    },
    onSuccess: (_data, share) => {
      toast(
        share
          ? t('projects.clientSharing.shared', { client: clientName })
          : t('projects.clientSharing.stopped'),
      )
      refresh()
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('projects.clientSharing.failed'),
      ),
  })

  const approved = info?.recordStatus === 'approved'

  const canShare =
    info?.canManage === true &&
    info.clientId !== null &&
    approved &&
    !info.autoShare

  const canUnshare = shared && info.canManage && !info.autoShare

  return {
    sharing,
    info,
    canShare,
    canUnshare,
    change,
  }
}

function SharingDetails({ info }: { info: RecordSharing }) {
  const clientName = info.clientName ?? ''
  const shared = info.sharedAt != null
  const approved = info.recordStatus === 'approved'

  const state = info.autoShare
    ? t('projects.clientSharing.autoState')
    : shared
      ? t('projects.clientSharing.sharedState', {
          date: formatDate(info.sharedAt ?? ''),
          name: info.sharedByName ?? '',
        })
      : t('projects.clientSharing.notShared')

  return (
    <>
      {!info.clientId ? (
        <Notice title={t('projects.clientSharing.noClient')}>
          {t('projects.clientSharing.noClientBody')}
        </Notice>
      ) : null}
      {info.clientId ? (
        <DescriptionList
          labelWidth={90}
          items={[
            [
              t('projects.clientSharing.client'),
              `${info.clientCode ?? ''} ${clientName}`.trim(),
            ],
            [t('projects.clientSharing.state'), state],
          ]}
        />
      ) : null}
      {info.clientId && !approved ? (
        <Notice tone="warn" title={t('projects.clientSharing.notApproved')}>
          {t('projects.clientSharing.notApprovedBody')}
        </Notice>
      ) : null}
      {info.clientId && info.autoShare ? (
        <Notice>{t('projects.clientSharing.auto')}</Notice>
      ) : null}
      {!info.canManage ? (
        <Notice>{t('projects.clientSharing.noPermission')}</Notice>
      ) : null}
    </>
  )
}

/**
 * Share one record with the client its project belongs to, from the record
 * itself. The database decides what may be shared (an approved record in a
 * project with a client); this dialog says where the record stands and what
 * is missing, in the words of the person looking at it.
 */
export function ShareWithClientDialog({
  open,
  onOpenChange,
  recordId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
}) {
  const { sharing, info, canShare, canUnshare, change } = useRecordSharing(
    open,
    recordId,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.clientSharing.title')}
          description={t('projects.clientSharing.body')}
        />
        <DialogBody>
          {sharing.isError ? (
            <Notice
              tone="bad"
              title={t('projects.clientSharing.loadFailed')}
              action={
                <Button size="sm" onClick={() => void sharing.refetch()}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            />
          ) : null}
          {info ? <SharingDetails info={info} /> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('projects.clientSharing.close')}
          </DialogClose>
          {canUnshare ? (
            <Button
              disabled={change.isPending}
              onClick={() => change.mutate(false)}
            >
              {t('projects.clientSharing.stop')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canShare || change.isPending}
              onClick={() => change.mutate(true)}
            >
              {t('projects.clientSharing.share')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
