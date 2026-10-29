import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Icon } from '#/components/icons'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { Input } from '#/components/v3/ui/input'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import {
  extractSheetDefinitionDraft,
  fetchSheetDefinitions,
  fetchSheetDefinitionVersion,
  fetchSheetDefinitionVersions,
  previewSheetDefinitionExtraction,
  publishSheetDefinitionVersion,
  sheetDefinitionDataClient,
} from '#/lib/sheet-definition-data'
import type { SheetDefinitionExtractionSelection } from '#/lib/sheet-definition-extraction'
import type { SheetDefinitionConfiguration } from '#/lib/sheet-definition'
import {
  applySheetInstanceDefinitionUpgrade,
  previewSheetInstanceDefinitionUpgrade,
} from '#/lib/sheet-instance-data'
import type {
  SheetParameterInput,
  SheetInstance,
} from '#/lib/sheet-instance-data'
import {
  applySheetInstanceCompositionAdoption,
  previewSheetInstanceCompositionAdoption,
} from '#/lib/sheet-composition-adoption'
import {
  materializeSheetInstance,
  previewSheetMaterialization,
} from '#/lib/sheet-materialization-data'
import { sheetDefinitionUpgradeAvailability } from '#/lib/reuse-upgrade'
import { ObjectLink } from '#/components/v3/ui/object-link'

/**
 * The server's refusal in the language of the page. A sheet made by pasting or
 * typing has local columns only, which a definition-backed write (materialise,
 * extract) cannot use, so those refusals point at the way that does work.
 */
export function lifecycleErrorText(message: string): string {
  if (/active Definition-backed Sheet Instance required/i.test(message))
    return t('notebook.canonicalSheetLifecyclePanel.thisSheetIsNot')
  if (/local row identity must be one declared reference/i.test(message))
    return t('notebook.canonicalSheetLifecyclePanel.aDefinitionNeedsOne')
  return message
}

function errorText(error: unknown) {
  if (error instanceof Error) return lifecycleErrorText(error.message)
  return null
}

function defaultExtractionSelection(
  instance: SheetInstance,
  configuration?: SheetDefinitionConfiguration,
): SheetDefinitionExtractionSelection {
  const localFieldIds = instance.state.localFields
    .filter((field) => field.lifecycle === 'active')
    .map((field) => field.fieldId)
  const identity =
    instance.state.localFields.find(
      (field) =>
        field.lifecycle === 'active' && field.logicalType === 'reference',
    )?.fieldId ?? localFieldIds[0]
  return {
    bindings: (configuration?.bindings ?? []).map((binding) => {
      const parameter = configuration?.parameters.find(
        (item) => item.id === binding.parameterId,
      )
      if (!parameter)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.theSourceBindingParameter'),
        )
      return { bindingId: binding.id, key: binding.key, parameter }
    }),
    columnIds: (configuration?.columns ?? [])
      .filter((column) => column.source.kind !== 'calculated')
      .map((column) => column.id),
    joinIds: (configuration?.joins ?? []).map((join) => join.id),
    localFieldIds,
    calculationIds: (instance.state.instanceCalculations ?? [])
      .filter((item) => item.lifecycle === 'active')
      .map((item) => item.id),
    rowIdentity: configuration?.rowIdentity ?? {
      kind: 'local',
      columnIds: identity ? [identity] : localFieldIds.slice(0, 1),
    },
    includePresentation: true,
  }
}

export function configurationDefinitionHref(
  definitionId: string,
  versionId?: string,
  instanceId?: string,
) {
  const search = new URLSearchParams()
  if (versionId) search.set('version', versionId)
  if (instanceId) search.set('returnTo', `/sheets/${instanceId}`)
  return `/sheet-definitions/${encodeURIComponent(definitionId)}${search.size ? `?${search}` : ''}`
}

export function CanonicalSheetLifecyclePanel({
  instance,
  onInstance,
}: {
  instance: SheetInstance
  onInstance: (next: SheetInstance) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [definitionId, setDefinitionId] = useState('')
  const [definitionVersionId, setDefinitionVersionId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [extractKey, setExtractKey] = useState('')
  const [extractName, setExtractName] = useState('')
  const [materializeName, setMaterializeName] = useState('')
  // Adoption, upgrade, extract-and-publish and materialise all change governed
  // objects, so each one asks before it runs.
  const [confirming, setConfirming] = useState<
    'adopt' | 'upgrade' | 'extract-publish' | 'materialize' | null
  >(null)
  const [extractedDefinition, setExtractedDefinition] = useState<{
    id: string
    name: string
    versionId: string
  } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [materialisedDatasetId, setMaterialisedDatasetId] = useState<
    string | null
  >(null)
  const [preview, setPreview] = useState<string | null>(null)

  const definitions = useQuery({
    queryKey: ['sheet-definitions'],
    queryFn: () => fetchSheetDefinitions(sheetDefinitionDataClient),
    enabled: open,
  })
  const versions = useQuery({
    queryKey: ['sheet-definition-versions', definitionId],
    enabled: Boolean(open && definitionId),
    queryFn: () =>
      fetchSheetDefinitionVersions(definitionId, sheetDefinitionDataClient),
  })
  const published = (versions.data ?? []).filter(
    (item) => item.lifecycle === 'published',
  )
  // REUSE-03: governed pin vs published lineage. Badge-only: never
  // auto-applies, never an error style, silent unless a newer published
  // version exists.
  const pinnedVersion = useQuery({
    queryKey: ['sheet-definition-version', instance.sourceDefinitionVersionId],
    enabled: Boolean(instance.sourceDefinitionVersionId),
    queryFn: () =>
      fetchSheetDefinitionVersion(
        instance.sourceDefinitionVersionId!,
        sheetDefinitionDataClient,
      ),
  })
  const pinnedLineage = useQuery({
    queryKey: ['sheet-definition-versions', pinnedVersion.data?.definitionId],
    enabled: Boolean(pinnedVersion.data?.definitionId),
    queryFn: () =>
      fetchSheetDefinitionVersions(
        pinnedVersion.data!.definitionId,
        sheetDefinitionDataClient,
      ),
  })
  const upgradeAvailability = sheetDefinitionUpgradeAvailability(
    pinnedVersion.data
      ? { id: pinnedVersion.data.id, version: pinnedVersion.data.version }
      : null,
    pinnedLineage.data ?? [],
  )
  const datasets = useQuery({
    queryKey: ['dataset-explorer-summaries'],
    queryFn: () => fetchDatasetSummaries(),
    enabled: open,
  })

  const selectedVersion =
    published.find((item) => item.id === definitionVersionId) ?? published.at(0)
  const datasetParameter = selectedVersion?.configuration.parameters.find(
    (parameter) => parameter.type.kind === 'dataset',
  )
  const parameterInputs: SheetParameterInput[] =
    datasetParameter && datasetId
      ? [{ parameterId: datasetParameter.id, kind: 'dataset', datasetId }]
      : []

  const adoptPreview = useMutation({
    mutationFn: async () => {
      if (!selectedVersion)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.chooseAPublishedDefinition'),
        )
      return previewSheetInstanceCompositionAdoption({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        targetDefinitionVersionId: selectedVersion.id,
        parameterInputs,
      })
    },
    onSuccess: (result) => {
      setPreview(
        result.compatible
          ? t(
              'notebook.canonicalSheetLifecyclePanel.adoptionCompatibleCountUnmatched',
              { count: result.unmatchedLocalRowKeys.length },
            )
          : (result.errorMessage ??
              (result.errorCode
                ? t(
                    'notebook.canonicalSheetLifecyclePanel.adoptionIncompatibleCode',
                    {
                      code: result.errorCode,
                    },
                  )
                : t(
                    'notebook.canonicalSheetLifecyclePanel.adoptionIncompatible',
                  ))),
      )
    },
  })

  const adopt = useMutation({
    mutationFn: async () => {
      if (!selectedVersion)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.chooseAPublishedDefinition'),
        )
      const adoptionPreview = await previewSheetInstanceCompositionAdoption({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        targetDefinitionVersionId: selectedVersion.id,
        parameterInputs,
      })
      if (!adoptionPreview.compatible) {
        throw new Error(
          adoptionPreview.errorMessage ??
            (adoptionPreview.errorCode
              ? t(
                  'notebook.canonicalSheetLifecyclePanel.adoptionIncompatibleCode',
                  {
                    code: adoptionPreview.errorCode,
                  },
                )
              : t(
                  'notebook.canonicalSheetLifecyclePanel.adoptionIncompatible',
                )),
        )
      }
      const applied = await applySheetInstanceCompositionAdoption({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        targetDefinitionVersionId: selectedVersion.id,
        parameterInputs,
        retryToken: crypto.randomUUID(),
      })
      if (applied.status !== 'applied') {
        throw new Error(
          t(
            'notebook.canonicalSheetLifecyclePanel.adoptionPreviewWasIncompatible',
          ),
        )
      }
      return applied
    },
    onSuccess: (applied) => {
      onInstance(applied.instance)
      setStatus(
        applied.unmatchedLocalRowKeys.length > 0
          ? t(
              'notebook.canonicalSheetLifecyclePanel.adoptedDefinitionCountLocal',
              { count: applied.unmatchedLocalRowKeys.length },
            )
          : t('notebook.canonicalSheetLifecyclePanel.adoptedDefinitionOnThis'),
      )
      setPreview(null)
      void queryClient.invalidateQueries({
        queryKey: ['composed-sheet', instance.id],
      })
    },
  })

  const extract = useMutation({
    mutationFn: async () => {
      const source = instance.sourceDefinitionVersionId
        ? await fetchSheetDefinitionVersion(
            instance.sourceDefinitionVersionId,
            sheetDefinitionDataClient,
          )
        : null
      if (instance.sourceDefinitionVersionId && !source)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.theSourceSheetDefinition'),
        )
      const selection = defaultExtractionSelection(
        instance,
        source?.configuration,
      )
      await previewSheetDefinitionExtraction(
        instance.id,
        instance.revision,
        selection,
      )
      return extractSheetDefinitionDraft({
        instanceId: instance.id,
        expectedInstanceRevision: instance.revision,
        key: extractKey.trim() || 'extracted_sheet',
        name:
          extractName.trim() ||
          t('notebook.canonicalSheetLifecyclePanel.extractedName', {
            name: instance.name,
          }),
        selection,
      })
    },
    onSuccess: async (result) => {
      setExtractedDefinition({
        id: result.definition.id,
        name: result.definition.name,
        versionId: result.version.id,
      })
      setStatus(
        t(
          'notebook.canonicalSheetLifecyclePanel.extractedDraftDefinitionName',
          { name: result.definition.name },
        ),
      )
      await queryClient.invalidateQueries({ queryKey: ['sheet-definitions'] })
    },
  })

  const publishExtracted = useMutation({
    mutationFn: async () => {
      const result = await extract.mutateAsync()
      const version = await publishSheetDefinitionVersion(
        result.version.id,
        result.version.revision,
      )
      return { definition: result.definition, version }
    },
    onSuccess: ({ definition, version }) => {
      setExtractedDefinition({
        id: definition.id,
        name: definition.name,
        versionId: version.id,
      })
      setStatus(
        t(
          'notebook.canonicalSheetLifecyclePanel.publishedDefinitionVersionVersion',
          { version: version.version },
        ),
      )
    },
  })

  const upgradePreview = useMutation({
    mutationFn: async () => {
      if (!selectedVersion)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.chooseAPublishedDefinition'),
        )
      return previewSheetInstanceDefinitionUpgrade(
        instance.id,
        instance.revision,
        selectedVersion.id,
      )
    },
    onSuccess: (result) => {
      setPreview(
        result.conflicts.length > 0
          ? t('notebook.canonicalSheetLifecyclePanel.countUpgradeConflictS', {
              count: result.conflicts.length,
            })
          : t('notebook.canonicalSheetLifecyclePanel.countAutomaticChangeS', {
              count: result.automaticChanges.length,
            }),
      )
    },
  })

  const upgrade = useMutation({
    mutationFn: async () => {
      if (!selectedVersion)
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.chooseAPublishedDefinition'),
        )
      const upgradePreviewResult = await previewSheetInstanceDefinitionUpgrade(
        instance.id,
        instance.revision,
        selectedVersion.id,
      )
      if (upgradePreviewResult.conflicts.length > 0) {
        throw new Error(
          t('notebook.canonicalSheetLifecyclePanel.countUpgradeConflictS', {
            count: upgradePreviewResult.conflicts.length,
          }),
        )
      }
      return applySheetInstanceDefinitionUpgrade({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        targetDefinitionVersionId: selectedVersion.id,
        decisions: [],
        parameterInputs,
      })
    },
    onSuccess: (result) => {
      if (result.status === 'applied') {
        onInstance(result.instance)
        setStatus(
          t('notebook.canonicalSheetLifecyclePanel.upgradedThisSheetTo'),
        )
      } else {
        setStatus(
          t(
            'notebook.canonicalSheetLifecyclePanel.upgradeDeferredUntilConflicts',
          ),
        )
      }
    },
  })

  const materializePreview = useMutation({
    mutationFn: () =>
      previewSheetMaterialization({
        instanceId: instance.id,
        expectedRevision: instance.revision,
      }),
    onSuccess: (result) => {
      setPreview(
        t(
          'notebook.canonicalSheetLifecyclePanel.materialisationDigestPreviewdigestConfirm',
          { previewDigest: result.previewDigest.slice(0, 12) },
        ),
      )
    },
  })

  const materialize = useMutation({
    onMutate: () => setMaterialisedDatasetId(null),
    mutationFn: async () => {
      const materialisationPreview = await previewSheetMaterialization({
        instanceId: instance.id,
        expectedRevision: instance.revision,
      })
      return materializeSheetInstance({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        outputName:
          materializeName.trim() ||
          t('notebook.canonicalSheetLifecyclePanel.outputName', {
            name: instance.name,
          }),
        previewDigest: materialisationPreview.previewDigest,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      setStatus(
        t('notebook.canonicalSheetLifecyclePanel.datasetWrittenFromThis'),
      )
      setMaterialisedDatasetId(result.datasetId)
      setPreview(null)
    },
  })

  const combinedError =
    errorText(adopt.error) ??
    errorText(adoptPreview.error) ??
    errorText(extract.error) ??
    errorText(publishExtracted.error) ??
    errorText(upgrade.error) ??
    errorText(upgradePreview.error) ??
    errorText(materialize.error) ??
    errorText(materializePreview.error)

  const selectedDefinitionName = (definitions.data ?? []).find(
    (definition) => definition.id === selectedVersion?.definitionId,
  )?.name
  const target = selectedVersion
    ? `${selectedDefinitionName ?? t('notebook.canonicalSheetLifecyclePanel.theSelectedDefinition')} v${selectedVersion.version}`
    : t('notebook.canonicalSheetLifecyclePanel.theSelectedDefinition')
  const confirmation =
    confirming === null
      ? null
      : {
          adopt: {
            title: t('notebook.canonicalSheetLifecyclePanel.title'),
            body: t('notebook.canonicalSheetLifecyclePanel.body', { target }),
            action: t('notebook.canonicalSheetLifecyclePanel.applyAdoption'),
            pending: adopt.isPending,
            run: () => adopt.mutate(),
          },
          upgrade: {
            title: t(
              'notebook.canonicalSheetLifecyclePanel.applyThisUpgradeTitle',
            ),
            body: t('notebook.canonicalSheetLifecyclePanel.body2', { target }),
            action: t('notebook.canonicalSheetLifecyclePanel.applyUpgrade'),
            pending: upgrade.isPending,
            run: () => upgrade.mutate(),
          },
          'extract-publish': {
            title: t(
              'notebook.canonicalSheetLifecyclePanel.extractAndPublishThisTitle',
            ),
            body: t('notebook.canonicalSheetLifecyclePanel.body3'),
            action: t(
              'notebook.canonicalSheetLifecyclePanel.extractAndPublish',
            ),
            pending: publishExtracted.isPending,
            run: () => publishExtracted.mutate(),
          },
          materialize: {
            title: t(
              'notebook.canonicalSheetLifecyclePanel.writeADatasetFromTitle',
            ),
            body: t('notebook.canonicalSheetLifecyclePanel.materialiseBody', {
              name:
                materializeName.trim() ||
                t('notebook.canonicalSheetLifecyclePanel.outputName', {
                  name: instance.name,
                }),
            }),
            action: t('notebook.canonicalSheetLifecyclePanel.applyMaterialise'),
            pending: materialize.isPending,
            run: () => materialize.mutate(),
          },
        }[confirming]

  return (
    <div className="border-t px-2 py-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={() => setOpen((value) => !value)}
        >
          {open
            ? t('notebook.canonicalSheetLifecyclePanel.hideSourcesAndReuse')
            : t('notebook.canonicalSheetLifecyclePanel.sourcesExtractUpgrade')}
        </Button>
        {upgradeAvailability.status === 'upgrade-available' &&
        upgradeAvailability.latestVersion ? (
          <Badge variant="kind" className="text-xs">
            {t(
              'notebook.canonicalSheetLifecyclePanel.upgradeAvailableVVersion',
              { version: upgradeAvailability.latestVersion.version },
            )}
          </Badge>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              {t('notebook.canonicalSheetLifecyclePanel.bindADatasetTo')}
            </legend>
            <p className="text-xs text-fg-muted">
              {t('notebook.canonicalSheetLifecyclePanel.bindingShowsADataset')}
            </p>
            <label className="space-y-1 text-xs">
              <span>Sheet Definition</span>
              <PickerSelect
                noun="sheet definition"
                aria-label="Sheet Definition"
                value={definitionId}
                onChange={(id) => {
                  setDefinitionId(id)
                  setDefinitionVersionId('')
                }}
                placeholder="Select Definition"
                options={(definitions.data ?? []).map((definition) => ({
                  id: definition.id,
                  label: definition.name,
                }))}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>
                {t('notebook.canonicalSheetLifecyclePanel.publishedVersion')}
              </span>
              <select
                className="flex h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                value={selectedVersion?.id ?? ''}
                onChange={(event) => setDefinitionVersionId(event.target.value)}
                aria-label={t(
                  'notebook.canonicalSheetLifecyclePanel.ariaLabel',
                )}
              >
                <option value="">
                  {t('notebook.canonicalSheetLifecyclePanel.selectVersion')}
                </option>
                {published.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version}
                  </option>
                ))}
              </select>
            </label>
            {datasetParameter ? (
              <label className="space-y-1 text-xs">
                <span>Dataset for {datasetParameter.label}</span>
                <PickerSelect
                  noun="dataset"
                  aria-label="Dataset binding"
                  value={datasetId}
                  onChange={(id) => setDatasetId(id)}
                  placeholder="Select Dataset"
                  options={(datasets.data ?? []).map((dataset) =>
                    datasetOption({ id: dataset.id, name: dataset.name }),
                  )}
                />
                {datasetId ? (
                  <Button
                    render={
                      <Link
                        to="/datasets"
                        search={{
                          dataset: datasetId,
                          archived: false,
                          tab: 'pipelines',
                        }}
                      />
                    }
                    nativeButton={false}
                    variant="secondary"
                    size="sm"
                    className="mt-1 w-full"
                  >
                    <Icon name="pipeline" className="size-3.5" />{' '}
                    {t(
                      'notebook.canonicalSheetLifecyclePanel.runPipelinesOnThis',
                    )}
                  </Button>
                ) : null}
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={adoptPreview.isPending}
                onClick={() => adoptPreview.mutate()}
              >
                {t('notebook.canonicalSheetLifecyclePanel.previewAdoption')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={adopt.isPending}
                onClick={() => setConfirming('adopt')}
              >
                {t('notebook.canonicalSheetLifecyclePanel.applyAdoption')}
              </Button>
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              {t(
                'notebook.canonicalSheetLifecyclePanel.extractUpgradeMaterialise',
              )}
            </legend>
            <label className="space-y-1 text-xs">
              <span>
                {t('notebook.canonicalSheetLifecyclePanel.definitionKey')}
              </span>
              <Input
                className="h-8"
                value={extractKey}
                onChange={(event) => setExtractKey(event.target.value)}
                placeholder="assay_results"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>
                {t('notebook.canonicalSheetLifecyclePanel.definitionName')}
              </span>
              <Input
                className="h-8"
                value={extractName}
                onChange={(event) => setExtractName(event.target.value)}
                placeholder={instance.name}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={extract.isPending}
                onClick={() => extract.mutate()}
              >
                {t('notebook.canonicalSheetLifecyclePanel.extractDraft')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={publishExtracted.isPending}
                onClick={() => setConfirming('extract-publish')}
              >
                {t('notebook.canonicalSheetLifecyclePanel.extractAndPublish')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={upgradePreview.isPending}
                onClick={() => upgradePreview.mutate()}
              >
                {t('notebook.canonicalSheetLifecyclePanel.previewUpgrade')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={upgrade.isPending}
                onClick={() => setConfirming('upgrade')}
              >
                {t('notebook.canonicalSheetLifecyclePanel.applyUpgrade')}
              </Button>
            </div>
            <label className="space-y-1 text-xs">
              <span>
                {t(
                  'notebook.canonicalSheetLifecyclePanel.materialisedDatasetName',
                )}
              </span>
              <Input
                className="h-8"
                value={materializeName}
                onChange={(event) => setMaterializeName(event.target.value)}
                placeholder={t(
                  'notebook.canonicalSheetLifecyclePanel.outputName',
                  {
                    name: instance.name,
                  },
                )}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={materializePreview.isPending}
                onClick={() => materializePreview.mutate()}
              >
                {t('notebook.canonicalSheetLifecyclePanel.previewMaterialise')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={materialize.isPending}
                onClick={() => setConfirming('materialize')}
              >
                {t('notebook.canonicalSheetLifecyclePanel.applyMaterialise')}
              </Button>
            </div>
          </fieldset>
          {preview ? (
            <p className="text-xs md:col-span-2" role="status">
              {preview}
            </p>
          ) : null}
          {status ? (
            <div className="flex flex-wrap items-center gap-2 text-xs md:col-span-2">
              <p role="status">{status}</p>
              {materialisedDatasetId ? (
                <ObjectLink
                  kind="dataset"
                  id={materialisedDatasetId}
                  mono={false}
                  className="font-medium"
                >
                  {t('notebook.canonicalSheetLifecyclePanel.openTheNewDataset')}
                </ObjectLink>
              ) : null}
              {extractedDefinition ? (
                <a
                  className="font-medium text-primary-text underline-offset-4 hover:underline"
                  href={configurationDefinitionHref(
                    extractedDefinition.id,
                    extractedDefinition.versionId,
                    instance.id,
                  )}
                >
                  {t(
                    'notebook.canonicalSheetLifecyclePanel.reviewSheetDefinition',
                  )}
                </a>
              ) : null}
            </div>
          ) : null}
          {combinedError ? (
            <p className="text-xs text-danger-text md:col-span-2" role="alert">
              {combinedError}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !confirmation.pending) setConfirming(null)
          }}
        >
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>{confirmation.title}</ConfirmDialogTitle>
              <ConfirmDialogDescription>
                {confirmation.body}
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel disabled={confirmation.pending}>
                {t('common.actions.cancel')}
              </ConfirmDialogCancel>
              <ConfirmDialogAction
                disabled={confirmation.pending}
                onClick={() => {
                  setConfirming(null)
                  confirmation.run()
                }}
              >
                {confirmation.action}
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
