import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createFileRoute, redirect } from '@tanstack/react-router'

import { ShareWithClientDialog } from '#/components/client-sharing/share-with-client-dialog'
import {
  AddEvidenceDialog,
  AddTextDialog,
} from '#/components/reports/add-section-dialogs'
import { GeneratedReports } from '#/components/reports/generated-reports'
import { ReportDocument } from '#/components/reports/report-document'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
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
import { AddPluginSectionDialog } from '#/components/extensions/plugin-report-section-dialog'
import { usePluginPoints } from '#/components/extensions/use-plugin-points'
import { useRecentViewTracking } from '#/lib/recents'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { z } from 'zod'

import { ReportHeader, ReportMissing } from './-report-header'
import { ReportReadinessPanel } from './-report-readiness'
import { ReportSections } from './-report-sections'
import { REPORT_TABS } from './-report-tabs'

/** The tab a URL may ask for; anything else opens the builder. */
const reportSearchSchema = z.object({
  section: z.enum(REPORT_TABS).optional().catch(undefined),
})

export const Route = createFileRoute('/reports/$reportId')({
  validateSearch: (search) => reportSearchSchema.parse(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ReportPage,
})

function ReportPage() {
  const { reportId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const tab = search.section ?? 'build'
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [textOpen, setTextOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [pluginOpen, setPluginOpen] = useState(false)
  const pluginSections = usePluginPoints().reportSections
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
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed generation carries whatever the transport threw; its message is shown only when it is an Error.
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
    return <ReportMissing loading={query.isLoading} failed={query.isError} />
  }

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
        <ReportHeader
          report={report}
          tab={tab}
          ready={ready}
          generating={generate.isPending}
          onShare={() => setShareOpen(true)}
          onGenerate={() => generate.mutate()}
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
            <ReportSections
              report={report}
              workspaceId={workspaceId}
              editable={editable}
              showPluginButton={pluginSections.length > 0}
              onMove={(id, direction) => move.mutate({ id, direction })}
              onAddText={() => setTextOpen(true)}
              onAddEvidence={() => setEvidenceOpen(true)}
              onAddPlugin={() => setPluginOpen(true)}
            />
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

      <ReportReadinessPanel
        report={report}
        readiness={readiness}
        ready={ready}
        userLabel={names.userLabel}
        checking={check.isPending}
        changing={changeStatus.isPending}
        onCheck={() => check.mutate()}
        onChangeStatus={(next) => changeStatus.mutate(next)}
      />

      <AddTextDialog
        open={textOpen}
        onOpenChange={setTextOpen}
        recordId={report.recordId}
        definitionId={report.definitionId}
        workspaceId={workspaceId}
      />
      <AddPluginSectionDialog
        open={pluginOpen}
        onOpenChange={setPluginOpen}
        recordId={report.recordId}
        definitionId={report.definitionId}
        workspaceId={workspaceId}
        projectId={report.projectId}
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
