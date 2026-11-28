/**
 * The project's header facts for the shared record page: who it is for, what
 * it makes, where it is and who leads it. When it started stays in the side
 * panel.
 */
import type { ProjectSummary } from '#/components/projects/project-data'
import type { RecordFact } from '#/components/record-page/record-page'
import { t } from '#/copy'

export function projectFacts(project: ProjectSummary): RecordFact[] {
  const facts: (RecordFact | null)[] = [
    {
      label: t('projects.projectOverview.details.client'),
      value:
        project.clientCode ?? t('projects.projectOverview.details.internal'),
    },
    project.modality
      ? {
          label: t('projects.projectOverview.details.modality'),
          value: project.modality,
        }
      : null,
    project.stage
      ? {
          label: t('projects.projectOverview.details.stage'),
          value: project.stage,
        }
      : null,
    project.leadName
      ? {
          label: t('projects.projectOverview.details.lead'),
          value: project.leadName,
        }
      : null,
  ]

  return facts.filter((fact) => fact !== null)
}
