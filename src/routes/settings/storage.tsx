import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { LabelTemplatesPanel } from '#/components/v3/settings/label-templates-panel'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { StorageLocationsPanel } from '#/components/v3/settings/storage-locations-panel'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { createDataClient } from '#/lib/data-client'
import { fetchStorageAccess } from '#/lib/storage-locations'

/**
 * Settings → Storage and labels: where samples are kept (sites down to boxes)
 * and the label templates they print with. Who may open and change it is the
 * workspace's choice under Members and roles; the database enforces it.
 */
export const Route = createFileRoute('/settings/storage')({
  component: StorageSettings,
})

const dataClient = createDataClient()

type StorageTab = 'locations' | 'labels'

function StorageSettings() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const [tab, setTab] = useState<StorageTab>('locations')
  const access = useQuery({
    queryKey: ['settings-access', workspaceId, 'storage'],
    queryFn: () => fetchStorageAccess(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  if (access.isLoading) {
    return (
      <>
        <SettingsHeader title="Storage and labels" />
        <SettingsBody>
          <Muted>Loading…</Muted>
        </SettingsBody>
      </>
    )
  }
  if (access.data !== 'view' && access.data !== 'manage') {
    return (
      <>
        <SettingsHeader title="Storage and labels" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="You don't have access to Storage and labels"
            description={
              <>
                Storage locations and label templates are managed by the people
                your workspace has chosen.
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
          />
        </div>
      </>
    )
  }
  const canManage = access.data === 'manage'
  return (
    <>
      <SettingsHeader title="Storage and labels" border={false}>
        Where samples are kept, and the labels they print with.
      </SettingsHeader>
      <Tabs
        mode="state"
        label="Storage and labels sections"
        className="border-b border-border px-4 md:px-6"
        value={tab}
        onValueChange={(key) => setTab(key as StorageTab)}
        items={[
          { key: 'locations', label: 'Storage locations' },
          { key: 'labels', label: 'Label templates' },
        ]}
      />
      {tab === 'locations' ? (
        <StorageLocationsPanel
          workspaceId={workspaceId}
          canManage={canManage}
        />
      ) : (
        <LabelTemplatesPanel workspaceId={workspaceId} canManage={canManage} />
      )}
    </>
  )
}
