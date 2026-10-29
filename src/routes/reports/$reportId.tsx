import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ShareWithClientDialog } from '#/components/v3/client-sharing/share-with-client-dialog'
import {
  AddEvidenceDialog,
  AddTextDialog,
} from '#/components/v3/reports/add-section-dialogs'
import { GeneratedReports } from '#/components/v3/reports/generated-reports'
import { ReportDocument } from '#/components/v3/reports/report-document'
import { SectionCard } from '#/components/v3/reports/section-card'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  PageHeader,
} from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchReport,
  generateReport,
  moveId,
  reorderSections,
  reportKeys,
  reportStatus,
  updateReport,
  validateReport,
} from '#/lib/reports'
import type { ReportStatus } from '#/lib/reports'
import { useRecentViewTracking } from '#/lib/recents'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

const tabs = ['build', 'preview', 'generated'] as const
type ReportTab = (typeof tabs)[number]

export const Route = createFileRoute('/reports/$reportId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: ReportTab } => ({
    section: (tabs as readonly string[]).includes(search.section as string)
      ? (search.section as ReportTab)
      : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ReportPage,
})

/** The next steps a report offers, as the status they lead to. */
function nextStatuses(status: ReportStatus): ReportStatus[] {
  switch (status) {
    case 'draft':
      return ['in_review']
    case 'in_review':
      return ['approved', 'draft']
    case 'approved':
    case 'published':
      return ['draft']
    default:
      return ['draft']
  }
}

const statusAction: Record<ReportStatus, string> = {
  draft: t('projects.reports.builder.reopen'),
  in_review: t('projects.reports.builder.sendForReview'),
  approved: t('projects.reports.builder.approve'),
  published: t('projects.reports.builder.approve'),
  archived: t('projects.reports.builder.archive'),
}

function ReportPage() {
  const { reportId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const tab = search.section ?? 'build'
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [textOpen, setTextOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const query = useQuery({
    queryKey: reportKeys.detail(reportId),
    queryFn: () => fetchReport(notebookDataClient, reportId),
  })
  const report = query.data
  const names = useUserNames(report ? [report.createdByUserId] : [])
  useRecentViewTracking('record', report ? report.recordId : null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reportKeys.detail(reportId) })
  const check = useMutation({
    mutationFn: () =>
      validateReport(notebookDataClient, {
        workspaceId,
        definitionId: report?.definitionId ?? '',
      }),
    onSuccess: () => void refresh(),
    onError: () => toast.error(t('projects.reports.builder.checkFailed')),
  })
  const generate = useMutation({
    mutationFn: () =>
      generateReport(notebookDataClient, {
        workspaceId,
        definitionId: report?.definitionId ?? '',
      }),
    onSuccess: () => {
      toast(t('projects.reports.builder.generatedToast'))
      void queryClient.invalidateQueries({
        queryKey: reportKeys.generations(report?.definitionId ?? ''),
      })
      void queryClient.invalidateQueries({ queryKey: reportKeys.list })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('projects.reports.builder.generateFailed'),
      ),
  })
  const move = useMutation({
    mutationFn: (input: { id: string; direction: -1 | 1 }) =>
      reorderSections(notebookDataClient, {
        workspaceId,
        definitionId: report?.definitionId ?? '',
        sectionIds: moveId(
          (report?.sections ?? []).map((s) => s.id),
          input.id,
          input.direction,
        ),
      }),
    onSuccess: () => void refresh(),
    onError: () => toast.error(t('projects.reports.section.moveFailed')),
  })
  const changeStatus = useMutation({
    mutationFn: (status: ReportStatus) =>
      updateReport(notebookDataClient, {
        workspaceId,
        definitionId: report?.definitionId ?? '',
        status,
      }),
    onSuccess: (_d, status) => {
      toast(
        t('projects.reports.builder.statusChanged', {
          status: reportStatus(status).label.toLowerCase(),
        }),
      )
      void refresh()
      void queryClient.invalidateQueries({ queryKey: reportKeys.list })
    },
    onError: () => toast.error(t('projects.reports.builder.statusFailed')),
  })

  if (!report) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('projects.reports.builder.back'),
              link: { to: '/reports' },
            },
          ]}
          title={
            query.isLoading
              ? t('common.states.loading')
              : t('projects.reports.builder.notFound')
          }
        />
        {query.isLoading ? null : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="report"
              title={
                query.isError
                  ? t('projects.reports.builder.loadFailed')
                  : t('projects.reports.builder.notFound')
              }
              description={t('projects.reports.builder.notFoundBody')}
              action={
                <Button nativeButton={false} render={<Link to="/reports" />}>
                  {t('projects.reports.builder.back')}
                </Button>
              }
            />
          </div>
        )}
      </div>
    )
  }

  const status = reportStatus(report.status)
  const locked = report.lockedAt !== null
  const editable = !locked && report.status === 'draft'
  const readiness = (() => {
    const counts = { valid: 0, stale: 0, missing: 0 }
    for (const s of report.sections) {
      if (s.sourceType === 'free_text') continue
      if (s.validationStatus === 'stale') counts.stale += 1
      else if (s.validationStatus === 'missing_source') counts.missing += 1
      else counts.valid += 1
    }
    return counts
  })()
  const attention = readiness.stale + readiness.missing
  const ready = report.sections.length > 0 && attention === 0

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('projects.reports.builder.back'),
              link: { to: '/reports' },
            },
            { label: report.identifier, mono: true },
          ]}
          title={report.title}
          actions={
            <>
              <FavouriteToggle kind="record" objectId={report.recordId} />
              <Button icon="share" onClick={() => setShareOpen(true)}>
                {t('projects.reports.builder.shareWithClient')}
              </Button>
              <Button
                variant="primary"
                disabled={
                  generate.isPending || report.sections.length === 0 || !ready
                }
                onClick={() => generate.mutate()}
              >
                {generate.isPending
                  ? t('projects.reports.builder.generating')
                  : t('projects.reports.builder.generate')}
              </Button>
            </>
          }
          meta={
            <>
              <span className="text-fg">
                <Status tone={status.tone}>{status.label}</Status>
              </span>
              {report.subtitle ? <span>{report.subtitle}</span> : null}
              {report.projectTitle ? <span>{report.projectTitle}</span> : null}
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('projects.reports.builder.tabsLabel')}
              value={tab}
              items={tabs.map((key) => ({
                key,
                label: t(`projects.reports.builder.tabs.${key}`),
                count: key === 'build' ? report.sections.length : undefined,
                link: {
                  search: { section: key === 'build' ? undefined : key },
                },
              }))}
            />
          }
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
          {locked ? (
            <Notice
              tone="warn"
              icon="lock"
              className="mb-4"
              title={t('projects.reports.builder.lockedTitle')}
            >
              {t('projects.reports.builder.lockedBody')}
            </Notice>
          ) : null}
          {tab === 'build' ? (
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
                    onMove={(direction) =>
                      move.mutate({ id: section.id, direction })
                    }
                  />
                ))
              )}
              {editable ? (
                <div className="flex gap-2">
                  <Button icon="plus" onClick={() => setTextOpen(true)}>
                    {t('projects.reports.builder.addText')}
                  </Button>
                  <Button icon="plus" onClick={() => setEvidenceOpen(true)}>
                    {t('projects.reports.builder.addEvidence')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : tab === 'preview' ? (
            <ReportDocument report={report} />
          ) : (
            <GeneratedReports
              definitionId={report.definitionId}
              identifier={report.identifier}
            />
          )}
        </div>
      </div>

      <Inspector
        aria-label={t('projects.reports.builder.readiness')}
        className="w-[320px] gap-0 p-0 max-lg:hidden"
      >
        <div className="flex flex-col gap-4 px-4 py-3.5">
          <InspectorSection title={t('projects.reports.builder.readiness')}>
            <Status tone={ready ? 'ok' : 'warn'}>
              {ready
                ? t('projects.reports.builder.readyTitle')
                : t('projects.reports.builder.notReadyTitle')}
            </Status>
            <p className="text-label text-fg-muted">
              {t('projects.reports.builder.readyCount', {
                valid: report.sections.length - attention,
                sections: report.sections.length,
              })}
            </p>
            {readiness.stale > 0 ? (
              <p className="text-label">
                {t('projects.reports.builder.staleCount', {
                  n: readiness.stale,
                })}
              </p>
            ) : null}
            {readiness.missing > 0 ? (
              <p className="text-label">
                {t('projects.reports.builder.missingCount', {
                  n: readiness.missing,
                })}
              </p>
            ) : null}
            <Button
              disabled={check.isPending || report.sections.length === 0}
              onClick={() => check.mutate()}
            >
              {check.isPending
                ? t('projects.reports.builder.checking')
                : t('projects.reports.builder.check')}
            </Button>
          </InspectorSection>
          <InspectorSection title={t('projects.reports.builder.details')}>
            <DescriptionList
              labelWidth={90}
              items={[
                [t('projects.reports.builder.status'), status.label],
                [
                  t('projects.reports.builder.project'),
                  report.projectTitle ?? '—',
                ],
                [
                  t('projects.reports.builder.owner'),
                  names.userLabel(report.createdByUserId),
                ],
                [
                  t('projects.reports.builder.created'),
                  formatDate(report.createdAt),
                ],
                [
                  t('projects.reports.builder.updated'),
                  formatDate(report.updatedAt),
                ],
                [t('projects.reports.builder.version'), report.version],
              ]}
            />
          </InspectorSection>
          {!locked ? (
            <InspectorSection title={t('projects.reports.builder.status')}>
              <div className="flex flex-wrap gap-2">
                {nextStatuses(report.status).map((next) => (
                  <Button
                    key={next}
                    disabled={changeStatus.isPending}
                    onClick={() => changeStatus.mutate(next)}
                  >
                    {statusAction[next]}
                  </Button>
                ))}
              </div>
            </InspectorSection>
          ) : null}
        </div>
      </Inspector>

      <AddTextDialog
        open={textOpen}
        onOpenChange={setTextOpen}
        recordId={report.recordId}
        definitionId={report.definitionId}
        workspaceId={workspaceId}
      />
      <AddEvidenceDialog
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        recordId={report.recordId}
        definitionId={report.definitionId}
        workspaceId={workspaceId}
        projectId={report.projectId}
      />
      {shareOpen ? (
        <ShareWithClientDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          recordId={report.recordId}
        />
      ) : null}
    </div>
  )
}
