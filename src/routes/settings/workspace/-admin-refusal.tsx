import { SettingsHeader } from '#/components/settings/settings-page'
import { WorkspaceAdminsLine } from '#/components/settings/workspace-admins-line'
import { EmptyState } from '#/components/ui/empty-state'

export function WorkspaceAdminRefusal({
  workspaceId,
  title,
  reason,
  description,
}: {
  workspaceId: string
  title: string
  reason: string
  description: string
}) {
  return (
    <>
      <SettingsHeader title={title} />
      <div className="px-4 md:px-6">
        <EmptyState
          icon="lock"
          title={reason}
          description={
            <>
              {description}
              <WorkspaceAdminsLine workspaceId={workspaceId} />
            </>
          }
        />
      </div>
    </>
  )
}
