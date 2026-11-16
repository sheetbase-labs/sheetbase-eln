/**
 * The Analysis Studio's screen, section by section: the data-source header and
 * the mode strip, the snapshot banner, the analyse and compare bodies, the
 * chart-settings inspector and the delete confirmation.
 *
 * Split out of `-analysis-studio-page.tsx` so the route keeps the composition
 * and each section reads on its own. Every section renders exactly the markup
 * the studio rendered before the split; the page owns the chart body, which
 * still needs the preview it defines.
 */
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { AnalysisFigureGuide } from '#/components/assist/analysis-figure-guide'
import { Icon } from '#/components/icons'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { datasetOption } from '#/components/record-picker/entity-options'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { Spinner } from '#/components/ui/spinner'
import { Tabs } from '#/components/ui/tabs'
import { AnalysisPanel } from '#/components/viz/analysis-panel'
import { CompareView } from '#/components/viz/compare-view'
import { SnapshotSourceBanner } from '#/components/viz/snapshot-source-banner'
import { SourceComparison } from '#/components/viz/source-comparison'
import { t } from '#/copy'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { ChartSpec } from '#/lib/chart-spec'
import type {
  CanonicalDatasetSource,
  useLiveChartDataset,
} from '#/lib/chart-data'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import { returnLabel } from '#/lib/return-to'
import {
  STUDIO_MODE_LABEL,
  STUDIO_MODES,
  studioModeSchema,
} from './-analysis-studio-modes'
import type { StudioMode } from './-analysis-studio-modes'

interface AnalysisStudioHeaderProps {
  datasets: CanonicalDatasetWire[]
  loading: boolean
  error: unknown
  selectedDatasetId: string | null
  onSelect: (id: string) => void
  /** The page that opened the studio, when it asked to be returned to. */
  returnTo?: string
}

export function AnalysisStudioHeader({
  datasets,
  loading,
  error,
  selectedDatasetId,
  onSelect,
  returnTo,
}: AnalysisStudioHeaderProps) {
  const id = useId()

  return (
    <header
      // No `shrink-0`: the header is a flex item in the studio's toolbar, and
      // refusing to shrink held it at its max-content width, so at 400 % zoom
      // the data-source select was pushed past the column and clipped by the
      // pane's `overflow-hidden` with nothing able to scroll to it. It shrinks
      // and wraps instead (QA4-zoom-studio).
      className="flex flex-wrap items-center justify-between gap-3"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h1 id={`${id}-title`} className="text-title">
          {t('data.analysisStudio.analysisStudio')}
        </h1>
        {returnTo ? (
          <Button
            size="sm"
            variant="quiet"
            nativeButton={false}
            render={<Link to={returnTo} />}
          >
            {returnLabel(returnTo)}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <Badge variant="del">
            {t('data.analysisStudio.couldLoadDatasets')}
          </Badge>
        ) : loading ? (
          <Skeleton className="h-7 w-48" />
        ) : datasets.length === 0 ? (
          <Badge variant="kind">{t('data.analysisStudio.noDatasets')}</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-source`}>
              {t('data.analysisStudio.dataSource')}
            </label>
            <PickerSelect
              noun="dataset"
              id={`${id}-source`}
              aria-label={t('data.analysisStudio.ariaSelectDataSource')}
              value={selectedDatasetId ?? ''}
              onChange={(next) => onSelect(next)}
              size="sm"
              className="w-64 bg-surface"
              options={datasets.map((d) =>
                datasetOption({
                  id: d.id,
                  name: d.name,
                  model: d.dataset_schema?.slug,
                }),
              )}
            />
          </div>
        )}
      </div>
    </header>
  )
}

/** Nothing to analyse yet: the loading skeleton, the read failure, or the
 * invitation to create a dataset first. */
export function EmptyAnalysisState({
  loading,
  error,
}: {
  loading: boolean
  error: unknown
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-danger-border bg-danger-wash p-8 text-center text-sm text-danger-text"
      >
        {t('data.analysisStudio.couldLoadDatasetsCheck')}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-surface p-10 text-center">
      {loading ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <>
          <Icon
            name="database"
            size={32}
            className="text-fg-muted"
            aria-hidden="true"
          />
          <p className="max-w-md text-sm text-fg-muted">
            {t('data.analysisStudio.createDatasetFirstThen')}
          </p>
          <Button
            render={<Link to="/datasets" search={{ dataset: '' }} />}
            nativeButton={false}
            variant="secondary"
            size="sm"
          >
            {t('data.analysisStudio.openDatasets')}
          </Button>
        </>
      )}
    </div>
  )
}

/** The unsaved-changes group: Discard beside Save, while the chart is dirty. */
export function AnalysisStudioDirtyActions({
  saving,
  onDiscard,
  onSave,
}: {
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div
      className="ml-auto flex items-center gap-1.5"
      role="group"
      aria-label={t('data.analysisStudio.unsavedChanges')}
    >
      <span className="text-xs text-fg-muted">
        {t('data.analysisStudio.unsavedChanges')}
      </span>
      <Button
        type="button"
        size="sm"
        variant="quiet"
        disabled={saving}
        onClick={onDiscard}
      >
        {t('common.actions.discard')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? <Spinner size={16} /> : <Icon name="save" />}
        {t('common.actions.save')}
      </Button>
    </div>
  )
}

/** Show or hide the chart's encodings rail. */
export function AnalysisStudioEncodingToggle({
  open,
  chartConfigId,
  onToggle,
}: {
  open: boolean
  chartConfigId: string
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="quiet"
      aria-expanded={open}
      aria-controls={open ? chartConfigId : undefined}
      onClick={onToggle}
    >
      {open ? (
        <Icon name="panelLeftClose" className="size-4" aria-hidden="true" />
      ) : (
        <Icon name="panelLeft" className="size-4" aria-hidden="true" />
      )}
      {open
        ? t('data.analysisStudio.hideEncodings')
        : t('data.analysisStudio.showEncodings')}
    </Button>
  )
}

/**
 * The top bar: the data-source header, the mode strip, the chart-settings
 * trigger beside it, the unsaved-changes group and the encodings toggle.
 */
export function AnalysisStudioToolbar({
  datasets,
  loading,
  error,
  selectedDatasetId,
  onSelectDataset,
  returnTo,
  mode,
  onModeChange,
  hasInspector,
  inspectorOpen,
  onOpenInspector,
  chartDirty,
  saving,
  onDiscard,
  onSave,
  selectedSource,
  spec,
  configOpen,
  chartConfigId,
  onToggleConfig,
}: {
  datasets: CanonicalDatasetWire[]
  loading: boolean
  error: unknown
  selectedDatasetId: string | null
  onSelectDataset: (id: string) => void
  returnTo?: string
  mode: StudioMode
  onModeChange: (mode: StudioMode) => void
  hasInspector: boolean
  inspectorOpen: boolean
  onOpenInspector: () => void
  chartDirty: boolean
  saving: boolean
  onDiscard: () => void
  onSave: () => void
  selectedSource: CanonicalDatasetSource | null
  spec: ChartSpec | null
  configOpen: boolean
  chartConfigId: string
  onToggleConfig: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
      <AnalysisStudioHeader
        datasets={datasets}
        loading={loading}
        error={error}
        selectedDatasetId={selectedDatasetId}
        onSelect={onSelectDataset}
        returnTo={returnTo}
      />
      <Tabs
        mode="state"
        variant="segment"
        label={t('data.analysisStudio.studioMode')}
        value={mode}
        onValueChange={(next) => {
          const decoded = studioModeSchema.safeParse(next)

          if (decoded.success) onModeChange(decoded.data)
        }}
        items={STUDIO_MODES.map((value) => ({
          key: value,
          label: STUDIO_MODE_LABEL[value],
        }))}
      />
      {hasInspector ? (
        <Button
          data-local-inspector-trigger
          type="button"
          size="sm"
          icon="info"
          className="xl:hidden"
          aria-haspopup="dialog"
          aria-expanded={inspectorOpen}
          onClick={onOpenInspector}
        >
          {t('data.analysisStudio.chartSettings')}
        </Button>
      ) : null}
      {chartDirty ? (
        <AnalysisStudioDirtyActions
          saving={saving}
          onDiscard={onDiscard}
          onSave={onSave}
        />
      ) : null}
      {mode === 'chart' && selectedSource && spec ? (
        <AnalysisStudioEncodingToggle
          open={configOpen}
          chartConfigId={chartConfigId}
          onToggle={onToggleConfig}
        />
      ) : null}
    </div>
  )
}

/**
 * The pinned-snapshot notice: the chart is drawn from a frozen dataset
 * version, and one click puts it back on the live one.
 */
export function AnalysisStudioSnapshotBanner({
  mode,
  spec,
  onUseLive,
}: {
  mode: StudioMode
  spec: ChartSpec | null
  onUseLive: () => void
}) {
  const dataset = spec?.datasets[0]

  if (mode === 'analyse' || !dataset?.datasetVersionId) return null

  return (
    <div className="px-3 pt-3">
      <SnapshotSourceBanner
        datasetId={dataset.datasetId}
        datasetVersionId={dataset.datasetVersionId}
        onUseLive={onUseLive}
      />
    </div>
  )
}

/** The Analyse mode: grouped statistics and regressions over the sources. */
export function AnalysisModeSection({
  sources,
  workspaceId,
  userId,
  selectedDatasetId,
  onDatasetChange,
  activeSnapshotId,
  definitionId,
  experimentId,
}: {
  sources: CanonicalDatasetSource[]
  workspaceId: string
  userId: string
  selectedDatasetId: string | null
  onDatasetChange: (id: string) => void
  activeSnapshotId: string | null
  definitionId?: string
  experimentId?: string
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <AnalysisPanel
        datasets={sources}
        workspaceId={workspaceId}
        userId={userId}
        initialDatasetId={selectedDatasetId}
        onDatasetChange={onDatasetChange}
        initialSnapshotId={activeSnapshotId}
        initialDefinitionId={definitionId}
        experimentId={experimentId}
      />
    </div>
  )
}

/**
 * The Compare mode: step-aware guidance, the live comparison over the same
 * rows, and the source-A-against-source-B comparison beneath it.
 */
export function CompareModeSection({
  selectedSource,
  datasetQuery,
  compareConfig,
  comparePromoted,
  onPromote,
  onCompareConfigChange,
  onNavigate,
  sources,
  spec,
  datasetsLoading,
  datasetsError,
}: {
  selectedSource: CanonicalDatasetSource | null
  datasetQuery: ReturnType<typeof useLiveChartDataset>['datasetQuery']
  compareConfig: ComparativeViewConfig | null
  comparePromoted: boolean
  onPromote: (promoted: ChartSpec) => void
  onCompareConfigChange: (config: ComparativeViewConfig) => void
  onNavigate: (href: string) => void
  sources: CanonicalDatasetSource[]
  spec: ChartSpec | null
  datasetsLoading: boolean
  datasetsError: unknown
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {/* ASSIST-03: step-aware guidance for dataset → compare → chart
          propose → notebook embed. The guide reads the same live studio
          state as the Compare tab it sits beside; its propose accept
          runs the identical promote hand-off as the manual Promote
          button below. */}
      {selectedSource ? (
        <div className="mb-3">
          <AnalysisFigureGuide
            datasetId={selectedSource.datasetId}
            columnCount={selectedSource.columns.length}
            rowCount={datasetQuery.data?.rows.length ?? 0}
            compareConfig={compareConfig}
            columns={
              datasetQuery.data?.source.columns ?? selectedSource.columns
            }
            chartSpecReady={comparePromoted}
            onPromoteGuide={onPromote}
            onNavigateGuide={onNavigate}
          />
        </div>
      ) : null}
      {selectedSource && compareConfig ? (
        <CompareView
          source={selectedSource}
          columns={datasetQuery.data?.source.columns ?? selectedSource.columns}
          rows={datasetQuery.data?.rows ?? []}
          flags={datasetQuery.data?.flags ?? []}
          loading={datasetQuery.isLoading}
          error={datasetQuery.error ? String(datasetQuery.error) : null}
          config={compareConfig}
          onConfigChange={onCompareConfigChange}
          onPromote={onPromote}
        />
      ) : (
        <EmptyAnalysisState loading={datasetsLoading} error={datasetsError} />
      )}
      {selectedSource && datasetQuery.data ? (
        <SourceComparison
          // A new source A starts a new comparison.
          key={`${selectedSource.datasetId}:${spec?.datasets[0]?.datasetVersionId ?? ''}`}
          sourceA={selectedSource}
          rowsA={datasetQuery.data.rows}
          snapshotA={spec?.datasets[0]?.datasetVersionId ?? null}
          sources={sources}
        />
      ) : null}
    </div>
  )
}

/** Deleting a saved view asks first, and names what goes with it. */
export function DeleteAnalysisViewDialog({
  target,
  deleting,
  onDismiss,
  onDelete,
}: {
  target: AnalysisViewWire | null
  deleting: boolean
  onDismiss: () => void
  onDelete: (id: string) => void
}) {
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('data.analysisStudio.deleteAnalysisView')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {target
              ? t('data.analysisStudio.vRemovedEveryoneWorkspace', {
                  name: target.name,
                  version: target.version,
                })
              : ''}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction
            variant="danger-fill"
            disabled={deleting}
            onClick={() => {
              if (target) onDelete(target.id)
            }}
          >
            {deleting
              ? t('data.analysisStudio.deleting')
              : t('common.actions.delete')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
