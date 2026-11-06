/**
 * Structure search over every registry that takes structures: draw part of a
 * molecule to find the compounds that contain it, or a whole one to find the
 * closest.
 */
import { ObjectLink } from '#/components/ui/object-link'
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { messageOf } from '#/lib/bio-registry'
import type { RegistryModel } from '#/lib/bio-registry'
import {
  compoundKeys,
  describeStructure,
  parentSvg,
  searchStructures,
} from '#/lib/compound-registry'
import type { SearchMode, StructureHit } from '#/lib/compound-registry'
import { notebookDataClient } from '#/lib/notebook-data'

import {
  MolfilePicture,
  StructureDialog,
  StructurePicture,
} from './structure-input'
import { useOcl } from './use-ocl'

const SIMILARITY_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const

export function RegistryStructureSearch({
  registries,
}: {
  registries: RegistryModel[]
}) {
  const ocl = useOcl()
  const [query, setQuery] = useState('')
  const [pasted, setPasted] = useState('')
  const [mode, setMode] = useState<SearchMode>('substructure')
  const [kind, setKind] = useState('')
  const [minSimilarity, setMinSimilarity] = useState(0.6)
  const [archived, setArchived] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [pasteError, setPasteError] = useState(false)

  const nameOf = useMemo(
    () => new Map(registries.map((m) => [m.key, m.name] as const)),
    [registries],
  )

  const results = useQuery({
    queryKey: compoundKeys.search([query, mode, kind, minSimilarity, archived]),
    queryFn: () =>
      searchStructures(notebookDataClient, {
        query,
        mode,
        kind: kind || null,
        minSimilarity,
        includeArchived: archived,
        limit: 200,
      }),
    enabled: query.trim() !== '',
    staleTime: 10_000,
  })

  function usePasted() {
    if (!ocl) return
    const described = describeStructure(ocl, pasted)
    if (!described) {
      setPasteError(true)
      return
    }
    setPasteError(false)
    setQuery(described.molfile)
    setPasted('')
  }

  const columns = useMemo<RegistryColumn<StructureHit>[]>(
    () => [
      {
        id: 'structure',
        header: t('registry.chemistry.search.columns.structure'),
        size: 170,
        enableSorting: false,
        cell: ({ row }) => (
          <StructurePicture
            svg={ocl ? parentSvg(ocl, row.original.parentCode, 60) : null}
            label={row.original.identifier}
            height={60}
          />
        ),
      },
      {
        id: 'number',
        header: t('registry.chemistry.search.columns.number'),
        accessorFn: (h) => h.identifier,
        size: 110,
        cell: ({ row }) => (
          <ObjectLink
            kind="record"
            id={row.original.recordId}
            identifier={row.original.identifier}
          />
        ),
      },
      {
        id: 'name',
        header: t('registry.chemistry.search.columns.name'),
        accessorFn: (h) => h.title,
        size: 240,
        cell: ({ row }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{
              modelId: row.original.kind,
              recordId: row.original.recordId,
            }}
            className="truncate font-medium text-fg hover:underline"
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'registry',
        header: t('registry.chemistry.search.columns.registry'),
        accessorFn: (h) => nameOf.get(h.kind) ?? h.kind,
        size: 130,
        cell: ({ row }) => (
          <span className="truncate">
            {nameOf.get(row.original.kind) ?? row.original.kind}
          </span>
        ),
      },
      {
        id: 'formula',
        header: t('registry.chemistry.search.columns.formula'),
        accessorFn: (h) => h.formula ?? '',
        size: 120,
        cell: ({ row }) => (
          <span className="mono">{row.original.formula ?? ''}</span>
        ),
      },
      {
        id: 'mass',
        header: t('registry.chemistry.search.columns.mass'),
        accessorFn: (h) => h.mass ?? 0,
        size: 90,
        cell: ({ row }) => (
          <span className="mono">{row.original.mass?.toFixed(2) ?? ''}</span>
        ),
      },
      {
        id: 'match',
        header: t('registry.chemistry.search.columns.match'),
        accessorFn: (h) => h.similarity,
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {mode === 'substructure'
              ? t('registry.chemistry.search.exact')
              : t('registry.chemistry.search.score', {
                  percent: `${Math.round(row.original.similarity * 100)}%`,
                })}
          </span>
        ),
      },
    ],
    [ocl, nameOf, mode],
  )

  const hits = results.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start gap-6 border-b border-border px-6 py-4">
        <div className="flex min-w-60 flex-col gap-2">
          <span className="text-label font-medium">
            {t('registry.chemistry.search.title')}
          </span>
          {query ? (
            <MolfilePicture
              molfile={query}
              label={t('registry.chemistry.search.title')}
              height={130}
            />
          ) : (
            <span className="max-w-xs text-label text-fg-muted">
              {t('registry.chemistry.search.hint')}
            </span>
          )}
          <span className="flex flex-wrap gap-2">
            <Button disabled={!ocl} onClick={() => setDrawing(true)}>
              {query
                ? t('registry.chemistry.search.change')
                : t('registry.chemistry.search.draw')}
            </Button>
            {query ? (
              <Button variant="quiet" onClick={() => setQuery('')}>
                {t('registry.chemistry.search.clear')}
              </Button>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            <Input
              className="h-8 w-56 font-mono text-xs"
              value={pasted}
              placeholder={t('registry.chemistry.input.smilesPlaceholder')}
              aria-label={t('registry.chemistry.input.smilesLabel')}
              onChange={(e) => {
                setPasted(e.target.value)
                setPasteError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') usePasted()
              }}
            />
            <Button disabled={!pasted.trim() || !ocl} onClick={usePasted}>
              {t('registry.chemistry.input.useSmiles')}
            </Button>
          </span>
          {pasteError ? (
            <span role="alert" className="text-label text-danger-text">
              {t('registry.chemistry.input.unreadable')}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Select
            size="sm"
            aria-label={t('registry.chemistry.search.mode')}
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
          >
            <option value="substructure">
              {t('registry.chemistry.search.substructure')}
            </option>
            <option value="similarity">
              {t('registry.chemistry.search.similarity')}
            </option>
          </Select>
          {mode === 'similarity' ? (
            <Select
              size="sm"
              aria-label={t('registry.chemistry.search.minSimilarity', {
                percent: '',
              })}
              value={String(minSimilarity)}
              onChange={(e) => setMinSimilarity(Number(e.target.value))}
            >
              {SIMILARITY_STEPS.map((step) => (
                <option key={step} value={step}>
                  {t('registry.chemistry.search.minSimilarity', {
                    percent: `${Math.round(step * 100)}%`,
                  })}
                </option>
              ))}
            </Select>
          ) : null}
          {registries.length > 1 ? (
            <Select
              size="sm"
              aria-label={t('registry.chemistry.search.registry')}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">
                {t('registry.chemistry.search.allRegistries')}
              </option>
              {registries.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
          ) : null}
          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={archived}
              onCheckedChange={(checked) => setArchived(checked === true)}
            />
            {t('registry.chemistry.search.archived')}
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {results.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('registry.chemistry.search.error')}>
              {messageOf(results.error, '')}
            </Notice>
          </div>
        ) : query.trim() === '' ? (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="search"
              title={t('registry.chemistry.search.prompt')}
            />
          </div>
        ) : results.isPending || hits.length > 0 ? (
          <RegistryGrid
            label={t('registry.chemistry.search.title')}
            rows={hits}
            columns={columns}
            getRowId={(h) => h.recordId}
            rowLabel={(h) => h.identifier}
            selectable={false}
            rowHeight={72}
            isLoading={results.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="search"
              title={t('registry.chemistry.search.none')}
            />
          </div>
        )}
      </div>
      <StructureDialog
        open={drawing}
        onOpenChange={setDrawing}
        initial={query}
        mode="query"
        onUse={(molfile) => setQuery(molfile)}
      />
    </div>
  )
}
