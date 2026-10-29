import { BlockPreview } from '#/components/notebook/block-preview'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { frozenBlockOf } from '#/lib/reports'
import type { ReportDetail } from '#/lib/reports'
import { t } from '#/copy'

/** The report as a reader sees it: title, then each section in order. */
export function ReportDocument({ report }: { report: ReportDetail }) {
  if (report.sections.length === 0) {
    return (
      <EmptyState
        icon="report"
        className="items-center py-14 text-center"
        title={t('projects.reports.builder.previewEmpty')}
        description={t('projects.reports.builder.previewEmptyBody')}
      />
    )
  }
  return (
    <article className="mx-auto flex w-full max-w-[860px] flex-col gap-6 rounded-md border border-border bg-surface px-8 py-8 max-md:px-4">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <span className="mono text-label text-fg-muted">
          {report.identifier}
        </span>
        <h2 className="font-heading text-[22px] font-semibold">
          {report.title}
        </h2>
        {report.subtitle ? (
          <p className="text-body text-fg-muted">{report.subtitle}</p>
        ) : null}
      </header>
      {report.sections.map((section) => {
        const frozen =
          section.sourceType === 'free_text' ? null : frozenBlockOf(section)
        return (
          <section key={section.id} className="flex flex-col gap-2">
            <h3 className="font-heading text-doc font-semibold">
              {section.title}
            </h3>
            {section.sourceType === 'free_text' ? (
              <p className="whitespace-pre-wrap text-body">
                {section.description}
              </p>
            ) : frozen ? (
              <BlockPreview block={frozen} frozen />
            ) : null}
          </section>
        )
      })}
    </article>
  )
}
