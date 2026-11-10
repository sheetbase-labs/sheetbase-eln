/**
 * The Build tab of a report: its sections in order, and the three ways to add
 * one to an editable report. Split from the route so the page keeps the header,
 * the inspector and the dialogs.
 */
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { SectionCard } from '#/components/reports/section-card'
import type { ReportDetail } from '#/lib/reports'
import { t } from '#/copy'

export function ReportSections({
  report,
  workspaceId,
  editable,
  showPluginButton,
  onMove,
  onAddText,
  onAddEvidence,
  onAddPlugin,
}: {
  report: ReportDetail
  workspaceId: string
  /** Not locked and still a draft. */
  editable: boolean
  showPluginButton: boolean
  onMove: (id: string, direction: -1 | 1) => void
  onAddText: () => void
  onAddEvidence: () => void
  onAddPlugin: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {report.sections.length === 0 ? (
        <EmptyState
          icon="report"
          className="items-center py-10 text-center"
          title={t('projects.reports.builder.noSections')}
          description={t('projects.reports.builder.noSectionsBody')}
        />
      ) : (
        report.sections.map((section, index) => (
          <SectionCard
            key={`${section.id}:${section.title}:${section.description ?? ''}`}
            section={section}
            index={index}
            total={report.sections.length}
            recordId={report.recordId}
            workspaceId={workspaceId}
            locked={!editable}
            onMove={(direction) => onMove(section.id, direction)}
          />
        ))
      )}
      {editable ? (
        <div className="flex gap-2">
          <Button icon="plus" onClick={onAddText}>
            {t('projects.reports.builder.addText')}
          </Button>
          <Button icon="plus" onClick={onAddEvidence}>
            {t('projects.reports.builder.addEvidence')}
          </Button>
          {showPluginButton ? (
            <Button icon="plug" onClick={onAddPlugin}>
              {t('plugins.reportSection.button')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
