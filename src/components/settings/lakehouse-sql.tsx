import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Muted, Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { CheckRow } from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { describeConnectorsError } from '#/lib/connectors/client'
import {
  fetchLakehouseSettings,
  remoteKeys,
  setLakehouseSql,
} from '#/lib/pipelines/remote/client'
import { t } from '#/copy'

const dataClient = createDataClient()

/** The steward's switch for SQL steps over the open tables. */
export function LakehouseSqlSection({
  workspaceId,
  canManage,
  dataAccess,
}: {
  workspaceId: string
  canManage: boolean
  dataAccess: boolean
}) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: [...remoteKeys.lakehouse, workspaceId],
    queryFn: () => fetchLakehouseSettings(dataClient, workspaceId),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setLakehouseSql(dataClient, workspaceId, enabled),
    onSuccess: () => {
      toast(t('features.pipelineRemote.settings.lakeSaved'))
      void queryClient.invalidateQueries({ queryKey: remoteKeys.lakehouse })
    },
    onError: (cause) => toast(describeConnectorsError(cause)),
  })

  const editable = canManage && dataAccess

  return (
    <Section title={t('features.pipelineRemote.settings.lakeTitle')}>
      <Muted>{t('features.pipelineRemote.settings.lakeHint')}</Muted>
      <CheckRow
        title={t('features.pipelineRemote.settings.lakeSwitch')}
        body={
          settings.data && !settings.data.lakeEnabled
            ? t('features.pipelineRemote.settings.lakeNeedsOpenTables')
            : settings.data
              ? t('features.pipelineRemote.settings.lakeTables', {
                  n: settings.data.tableCount,
                })
              : ''
        }
        checked={settings.data?.enabled === true}
        disabled={!editable || settings.isPending || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
      />
    </Section>
  )
}
