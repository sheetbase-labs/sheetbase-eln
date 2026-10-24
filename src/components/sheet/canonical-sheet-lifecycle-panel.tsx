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
    return 'This sheet is not backed by a definition, so it cannot be written out as a dataset as it stands. To keep its data, promote a column into a Dataset Schema from the column menu.'
  if (/local row identity must be one declared reference/i.test(message))
    return 'A definition needs one reference column that says what each row is about, and this sheet has none. To keep its data, promote a column into a Dataset Schema from the column menu.'
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
        throw new Error('The source binding parameter is unavailable.')
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
      if (!selectedVersion) throw new Error('Choose a published Definition.')
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
          ? `Adoption compatible. ${result.unmatchedLocalRowKeys.length} unmatched local row(s). Apply to compose this Instance.`
          : (result.errorMessage ??
              `Adoption is incompatible${result.errorCode ? ` (${result.errorCode})` : ''}.`),
      )
    },
  })

  const adopt = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error('Choose a published Definition.')
      const adoptionPreview = await previewSheetInstanceCompositionAdoption({
        instanceId: instance.id,
        expectedRevision: instance.revision,
        targetDefinitionVersionId: selectedVersion.id,
        parameterInputs,
      })
      if (!adoptionPreview.compatible) {
        throw new Error(
          adoptionPreview.errorMessage ??
            `Adoption is incompatible${adoptionPreview.errorCode ? ` (${adoptionPreview.errorCode})` : ''}.`,
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
        throw new Error('Adoption preview was incompatible.')
      }
      return applied
    },
    onSuccess: (applied) => {
      onInstance(applied.instance)
      setStatus(
        applied.unmatchedLocalRowKeys.length > 0
          ? `Adopted Definition. ${applied.unmatchedLocalRowKeys.length} local rows are unmatched.`
          : 'Adopted Definition on this Sheet Instance.',
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
        throw new Error('The source Sheet Definition version is unavailable.')
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
        name: extractName.trim() || `${instance.name} definition`,
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
        `Extracted draft Definition “${result.definition.name}”. Review and publish the Sheet Definition.`,
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
      setStatus(`Published Definition version ${version.version}.`)
    },
  })

  const upgradePreview = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error('Choose a published Definition.')
      return previewSheetInstanceDefinitionUpgrade(
        instance.id,
        instance.revision,
        selectedVersion.id,
      )
    },
    onSuccess: (result) => {
      setPreview(
        result.conflicts.length > 0
          ? `${result.conflicts.length} upgrade conflict(s). Resolve mapping before applying.`
          : `${result.automaticChanges.length} automatic change(s). Apply to upgrade this Instance.`,
      )
    },
  })

  const upgrade = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error('Choose a published Definition.')
      const upgradePreviewResult = await previewSheetInstanceDefinitionUpgrade(
        instance.id,
        instance.revision,
        selectedVersion.id,
      )
      if (upgradePreviewResult.conflicts.length > 0) {
        throw new Error(
          `${upgradePreviewResult.conflicts.length} upgrade conflict(s). Resolve mapping before applying.`,
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
        setStatus('Upgraded this Sheet to the selected Definition version.')
      } else {
        setStatus('Upgrade deferred until conflicts are resolved.')
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
        `Materialisation digest ${result.previewDigest.slice(0, 12)}… Confirm to write a Dataset.`,
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
        outputName: materializeName.trim() || `${instance.name} output`,
        previewDigest: materialisationPreview.previewDigest,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      setStatus('Dataset written from this sheet.')
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
    ? `${selectedDefinitionName ?? 'the selected Definition'} v${selectedVersion.version}`
    : 'the selected Definition'
  const confirmation =
    confirming === null
      ? null
      : {
          adopt: {
            title: 'Apply this adoption?',
            body: `This Sheet takes the fields of ${target}. Local rows that do not match stay unmatched.`,
            action: 'Apply adoption',
            pending: adopt.isPending,
            run: () => adopt.mutate(),
          },
          upgrade: {
            title: 'Apply this upgrade?',
            body: `This Sheet moves to ${target} and adopts changes that are already applied. A preview with conflicts is refused instead of partially applied.`,
            action: 'Apply upgrade',
            pending: upgrade.isPending,
            run: () => upgrade.mutate(),
          },
          'extract-publish': {
            title: 'Extract and publish this Definition?',
            body: 'A Definition draft is extracted from this Sheet and published straight away, so new Sheets can start from it. It is not reviewed against a draft first.',
            action: 'Extract and publish',
            pending: publishExtracted.isPending,
            run: () => publishExtracted.mutate(),
          },
          materialize: {
            title: 'Write a Dataset from this Sheet?',
            body: `A Dataset is written from the rows this Sheet holds now, as “${materializeName.trim() || `${instance.name} output`}”. Later edits to the Sheet do not change that Dataset.`,
            action: 'Apply materialise',
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
          {open ? 'Hide sources and reuse' : 'Sources, extract, upgrade'}
        </Button>
        {upgradeAvailability.status === 'upgrade-available' &&
        upgradeAvailability.latestVersion ? (
          <Badge variant="kind" className="text-xs">
            Upgrade available · v{upgradeAvailability.latestVersion.version}
          </Badge>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              Bind a dataset to this sheet
            </legend>
            <p className="text-xs text-fg-muted">
              Binding composes this sheet with a published definition and shows
              a dataset beside your own columns. It does not move any column
              into the dataset; to do that, choose Promote column on the column
              itself.
            </p>
            <label className="space-y-1 text-xs">
              <span>Sheet Definition</span>
              <select
                className="flex h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                value={definitionId}
                onChange={(event) => {
                  setDefinitionId(event.target.value)
                  setDefinitionVersionId('')
                }}
                aria-label="Sheet Definition"
              >
                <option value="">Select Definition</option>
                {(definitions.data ?? []).map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>Published version</span>
              <select
                className="flex h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                value={selectedVersion?.id ?? ''}
                onChange={(event) => setDefinitionVersionId(event.target.value)}
                aria-label="Published Sheet Definition version"
              >
                <option value="">Select version</option>
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
                <select
                  className="flex h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  value={datasetId}
                  onChange={(event) => setDatasetId(event.target.value)}
                  aria-label="Dataset binding"
                >
                  <option value="">Select Dataset</option>
                  {(datasets.data ?? []).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
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
                    <Icon name="pipeline" className="size-3.5" /> Run Pipelines
                    on this Dataset
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
                Preview adoption
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={adopt.isPending}
                onClick={() => setConfirming('adopt')}
              >
                Apply adoption
              </Button>
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              Extract, upgrade, materialise
            </legend>
            <label className="space-y-1 text-xs">
              <span>Definition key</span>
              <Input
                className="h-8"
                value={extractKey}
                onChange={(event) => setExtractKey(event.target.value)}
                placeholder="assay_results"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>Definition name</span>
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
                Extract draft
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={publishExtracted.isPending}
                onClick={() => setConfirming('extract-publish')}
              >
                Extract and publish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={upgradePreview.isPending}
                onClick={() => upgradePreview.mutate()}
              >
                Preview upgrade
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={upgrade.isPending}
                onClick={() => setConfirming('upgrade')}
              >
                Apply upgrade
              </Button>
            </div>
            <label className="space-y-1 text-xs">
              <span>Materialised Dataset name</span>
              <Input
                className="h-8"
                value={materializeName}
                onChange={(event) => setMaterializeName(event.target.value)}
                placeholder={`${instance.name} output`}
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
                Preview materialise
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={materialize.isPending}
                onClick={() => setConfirming('materialize')}
              >
                Apply materialise
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
                  Open the new dataset
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
                  Review Sheet Definition
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
                Cancel
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
