import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { SampleWorkflowsPanel } from '#/components/settings/sample-workflows-panel'
import { SettingsHeader } from '#/components/settings/settings-page'
import { canManageSettings } from '#/lib/settings-access'
import { t } from '#/copy'

/** Settings → Lab setup → Sample workflows: the steps a sample moves through. */
export const Route = createFileRoute('/settings/lab/workflows')({
  validateSearch: (search) => {
    const workflow = z.string().catch('').parse(search.workflow)

    return workflow ? { workflow } : {}
  },
  component: WorkflowSettings,
})

function WorkflowSettings() {
  const { context } = Route.useRouteContext()
  const { workflow } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <>
      <SettingsHeader title={t('settings.storage.workflows')} />
      <SampleWorkflowsPanel
        workspaceId={context.workspace?.id ?? ''}
        canManage={canManageSettings(context.workspace, 'storage')}
        editing={workflow ?? null}
        onEdit={(id) => void navigate({ search: id ? { workflow: id } : {} })}
      />
    </>
  )
}
