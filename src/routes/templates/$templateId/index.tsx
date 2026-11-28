import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/ui/empty-state'
import {
  latestTemplateVersion,
  useTemplate,
  useTemplateVersions,
} from '#/components/templates/templates-data'
import { hasCapability } from '#/lib/capability'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { TemplateNotebook } from './-template-notebook'
import { t } from '#/copy'

/** A template's Notebook view: the notebook it makes, drawn and edited like an
 * experiment's. A save makes a new version, because a published version pins
 * work already made. */
export const Route = createFileRoute('/templates/$templateId/')({
  component: TemplateNotebookView,
})

function TemplateNotebookView() {
  const { templateId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const { regulated } = useRegulatedLab(context.workspace?.id)
  const versions = useTemplateVersions(templateId)
  const template = useTemplate(templateId)
  const versionList = versions.data ?? []
  // The newest version is the one being worked on: an open draft, else the
  // current published version.
  const version = latestTemplateVersion(versionList)

  if (!template.data) return null

  if (!version) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title={t('library.templates.overview.noVersionYet')}
          description={t('library.templates.overview.aTemplateNeedsAVersion')}
        />
      </div>
    )
  }

  return (
    <TemplateNotebook
      key={version.id}
      template={template.data}
      version={version}
      versions={versionList}
      canEdit={hasCapability(context.workspace?.role, 'schema.edit')}
      regulated={regulated}
    />
  )
}
