import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Workflow } from 'lucide-react'

import { Button, Input, Label } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import {
  extractSheetDefinitionDraft,
  fetchSheetDefinitions,
  fetchSheetDefinitionVersions,
  previewSheetDefinitionExtraction,
  publishSheetDefinitionVersion,
  sheetDefinitionDataClient,
} from '#/lib/sheet-definition-data'
import type { SheetDefinitionExtractionSelection } from '#/lib/sheet-definition-extraction'
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

function errorText(error: unknown) {
  if (error instanceof DataClientError) return error.message
  if (error instanceof Error) return error.message
  return null
}

function defaultExtractionSelection(
  instance: SheetInstance,
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
    bindings: [],
    columnIds: [],
    joinIds: [],
    localFieldIds,
    calculationIds: (instance.state.instanceCalculations ?? [])
      .filter((item) => item.lifecycle === 'active')
      .map((item) => item.id),
    rowIdentity: {
      kind: 'local',
      columnIds: identity ? [identity] : localFieldIds.slice(0, 1),
    },
    includePresentation: true,
  }
}

export function configurationDefinitionHref(definitionId: string) {
  return `/configure?kind=definition&id=${encodeURIComponent(definitionId)}`
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
  const [extractedDefinition, setExtractedDefinition] = useState<{
    id: string
    name: string
  } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
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
      const selection = defaultExtractionSelection(instance)
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
      })
      setStatus(
        `Extracted draft Definition “${result.definition.name}”. Continue in Configure to review and publish it.`,
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
      setExtractedDefinition({ id: definition.id, name: definition.name })
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
      setStatus(`Materialised Dataset ${result.datasetId}.`)
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

  return (
    <div className="border-t px-2 py-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide sources and reuse' : 'Sources, extract, upgrade'}
      </Button>
      {open ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              Bind Dataset / adopt Definition
            </legend>
            <p className="text-xs text-muted-foreground">
              Adoption composes this Instance with a published Definition. It is
              not field promotion.
            </p>
            <Label className="space-y-1 text-xs">
              <span>Sheet Definition</span>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
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
            </Label>
            <Label className="space-y-1 text-xs">
              <span>Published version</span>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
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
            </Label>
            {datasetParameter ? (
              <Label className="space-y-1 text-xs">
                <span>Dataset for {datasetParameter.label}</span>
                <select
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                    asChild
                    variant="outline"
                    size="sm"
                    className="mt-1 w-full"
                  >
                    <Link
                      to="/datasets"
                      search={{
                        dataset: datasetId,
                        archived: false,
                        tab: 'pipelines',
                      }}
                    >
                      <Workflow className="size-3.5" /> Run Pipelines on this
                      Dataset
                    </Link>
                  </Button>
                ) : null}
              </Label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={adoptPreview.isPending}
                onClick={() => adoptPreview.mutate()}
              >
                Preview adoption
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={adopt.isPending}
                onClick={() => adopt.mutate()}
              >
                Apply adoption
              </Button>
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-md border p-2">
            <legend className="px-1 text-xs font-medium">
              Extract, upgrade, materialise
            </legend>
            <Label className="space-y-1 text-xs">
              <span>Definition key</span>
              <Input
                className="h-8"
                value={extractKey}
                onChange={(event) => setExtractKey(event.target.value)}
                placeholder="assay_results"
              />
            </Label>
            <Label className="space-y-1 text-xs">
              <span>Definition name</span>
              <Input
                className="h-8"
                value={extractName}
                onChange={(event) => setExtractName(event.target.value)}
                placeholder={instance.name}
              />
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={extract.isPending}
                onClick={() => extract.mutate()}
              >
                Extract draft
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={publishExtracted.isPending}
                onClick={() => publishExtracted.mutate()}
              >
                Extract and publish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={upgradePreview.isPending}
                onClick={() => upgradePreview.mutate()}
              >
                Preview upgrade
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={upgrade.isPending}
                onClick={() => upgrade.mutate()}
              >
                Apply upgrade
              </Button>
            </div>
            <Label className="space-y-1 text-xs">
              <span>Materialised Dataset name</span>
              <Input
                className="h-8"
                value={materializeName}
                onChange={(event) => setMaterializeName(event.target.value)}
                placeholder={`${instance.name} output`}
              />
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={materializePreview.isPending}
                onClick={() => materializePreview.mutate()}
              >
                Preview materialise
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={materialize.isPending}
                onClick={() => materialize.mutate()}
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
              {extractedDefinition ? (
                <a
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  href={configurationDefinitionHref(extractedDefinition.id)}
                >
                  Continue in Configure
                </a>
              ) : null}
            </div>
          ) : null}
          {combinedError ? (
            <p className="text-xs text-destructive md:col-span-2" role="alert">
              {combinedError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
