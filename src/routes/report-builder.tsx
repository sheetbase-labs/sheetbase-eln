/**
 * OPS-007 — Report Builder route.
 *
 * Three-pane layout matching the mockup: an ordered report outline on the
 * left, a frozen-evidence preview in the centre, and a document/validation/
 * export inspector on the right. Sections reference frozen revision data;
 * preview and export never substitute live data. Generation is deterministic
 * and records inputs, version, actor and output checksum.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { FileText, Plus } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
  ReportDetails,
  ReportOutline,
  ReportPreview,
} from '#/components/report-builder'
import { Button } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  addReportSection,
  createReportDefinition,
  describeReportBuilderError,
  fetchReports,
  fetchReportGenerations,
  fetchReportSections,
  generateReport,
  reportBuilderQueryKeys,
  reorderReportSections,
  validateReport,
} from '#/lib/report-builder'
import type { OutputFormat } from '#/lib/report-builder'

const getReportBuilderContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/report-builder')({
  beforeLoad: async () => {
    const context = await getReportBuilderContext()
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ReportBuilderRoute,
})

const dataClient = createDataClient()
const VIEW_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function ReportBuilderRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('html')

  const reportsQuery = useQuery({
    queryKey: reportBuilderQueryKeys.reports(workspaceId),
    queryFn: () => fetchReports(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const reports = reportsQuery.data ?? []
  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  )
  const activeReportId =
    selectedReportId ?? (reports.length > 0 ? reports[0].id : '')

  const sectionsQuery = useQuery({
    queryKey: reportBuilderQueryKeys.sections(activeReportId || 'none'),
    queryFn: () => fetchReportSections(dataClient, activeReportId),
    enabled: Boolean(activeReportId),
  })
  const generationsQuery = useQuery({
    queryKey: reportBuilderQueryKeys.generations(activeReportId || 'none'),
    queryFn: () => fetchReportGenerations(dataClient, activeReportId),
    enabled: Boolean(activeReportId),
  })

  const sections = sectionsQuery.data ?? []
  const generations = generationsQuery.data ?? []
  const [validationReady, setValidationReady] = useState<{
    reportId: string
    sections: number
    valid: number
    missingSource: number
    stale: number
    locked: number
    ready: boolean
  } | null>(null)

  function invalidateReport(reportId: string | null = activeReportId) {
    void queryClient.invalidateQueries({
      queryKey: ['ops-007', 'reports', workspaceId],
    })
    if (!reportId) return
    void queryClient.invalidateQueries({
      queryKey: reportBuilderQueryKeys.sections(reportId),
    })
    void queryClient.invalidateQueries({
      queryKey: reportBuilderQueryKeys.generations(reportId),
    })
    void queryClient.invalidateQueries({
      queryKey: reportBuilderQueryKeys.validation(reportId),
    })
  }

  const createReportMutation = useMutation({
    mutationFn: () =>
      createReportDefinition(dataClient, {
        workspaceId,
        title: 'Untitled report',
        subtitle: null,
      }),
    onSuccess: (wire) => {
      setActionError(null)
      invalidateReport()
      setSelectedReportId(wire.id)
    },
    onError: (cause) => setActionError(describeReportBuilderError(cause)),
  })

  const addSectionMutation = useMutation({
    mutationFn: () => {
      if (!activeReportId) throw new Error('Select or create a report first.')
      return addReportSection(dataClient, {
        workspaceId,
        reportId: activeReportId,
        title: 'New section',
        sectionType: 'text',
        sourceType: 'free_text',
      })
    },
    onSuccess: (wire) => {
      setActionError(null)
      invalidateReport(activeReportId)
      setSelectedSectionId(wire.id)
    },
    onError: (cause) => setActionError(describeReportBuilderError(cause)),
  })

  const moveSectionMutation = useMutation({
    mutationFn: async ({
      sectionId,
      direction,
    }: {
      sectionId: string
      direction: 'up' | 'down'
    }) => {
      if (!activeReportId) return
      const ordered = sections.slice().sort((a, b) => a.position - b.position)
      const index = ordered.findIndex((s) => s.id === sectionId)
      if (index < 0) return
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= ordered.length) return
      const reordered = ordered.slice()
      const [moved] = reordered.splice(index, 1)
      reordered.splice(swapIndex, 0, moved)
      await reorderReportSections(dataClient, {
        workspaceId,
        reportId: activeReportId,
        sectionIds: reordered.map((s) => s.id),
      })
    },
    onSuccess: () => {
      setActionError(null)
      invalidateReport(activeReportId)
    },
    onError: (cause) => setActionError(describeReportBuilderError(cause)),
  })

  const validateMutation = useMutation({
    mutationFn: () => {
      if (!activeReportId) throw new Error('No report selected.')
      return validateReport(dataClient, {
        workspaceId,
        reportId: activeReportId,
      })
    },
    onSuccess: (summary) => {
      setActionError(null)
      setValidationReady(summary)
      invalidateReport(activeReportId)
    },
    onError: (cause) => setActionError(describeReportBuilderError(cause)),
  })

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!activeReportId) throw new Error('No report selected.')
      return generateReport(dataClient, {
        workspaceId,
        reportId: activeReportId,
        outputFormat,
      })
    },
    onSuccess: () => {
      setActionError(null)
      invalidateReport(activeReportId)
    },
    onError: (cause) => setActionError(describeReportBuilderError(cause)),
  })

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Report Builder' }]}
      fullBleed
      primaryAction={
        <Button
          size="sm"
          onClick={() => createReportMutation.mutate()}
          disabled={createReportMutation.isPending}
        >
          <Plus className="size-4" /> New report
        </Button>
      }
      inspectorLabel="Report"
      inspector={
        <ReportDetails
          report={selectedReport}
          generations={generations}
          validation={
            validationReady && validationReady.reportId === activeReportId
              ? validationReady
              : null
          }
          outputFormat={outputFormat}
          onOutputFormatChange={setOutputFormat}
          onValidate={() => validateMutation.mutate()}
          onGenerate={() => generateMutation.mutate()}
          isGenerating={generateMutation.isPending}
          isValidating={validateMutation.isPending}
          timeZone={VIEW_TIMEZONE}
        />
      }
    >
      <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col">
        <div className="space-y-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-1.5 text-sm font-semibold">
              <FileText className="size-4 text-muted-foreground" />
              Report Builder
            </h1>
            {selectedReport ? (
              <span className="text-xs text-muted-foreground">
                {selectedReport.documentIdentifier}
              </span>
            ) : null}
            {actionError ? (
              <p role="alert" className="ml-auto text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
          {reports.length > 0 ? (
            <select
              aria-label="Select report"
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={activeReportId}
              onChange={(e) => {
                setSelectedReportId(e.target.value || null)
                setSelectedSectionId(null)
              }}
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.documentIdentifier}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-72 shrink-0 overflow-auto border-r border-border/60">
            {activeReportId ? (
              <ReportOutline
                sections={sections}
                selectedSectionId={selectedSectionId}
                onSelectSection={setSelectedSectionId}
                onAddSection={() => addSectionMutation.mutate()}
                onMoveSection={(id, direction) =>
                  moveSectionMutation.mutate({ sectionId: id, direction })
                }
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                Create a report to start building its outline.
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            <ReportPreview
              report={selectedReport}
              sections={sections}
              validation={
                validationReady && validationReady.reportId === activeReportId
                  ? validationReady
                  : null
              }
              generationsChecksum={generations[0]?.outputChecksum ?? null}
            />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
