import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Archive, Plus } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { CsvImportDialog } from '#/components/plate-designer/csv-import-dialog'
import { PlateInspector } from '#/components/plate-designer/plate-inspector'
import {
  DEFAULT_CONTROLS,
  PlateToolbar,
} from '#/components/plate-designer/plate-toolbar'
import type { AutoFillConfig } from '#/components/plate-designer/plate-toolbar'
import { Button, Input, Select } from '#/components/ui'
import { PlateMap } from '#/components/viz/plate-map'
import type { PlateWell } from '#/components/viz/plate-map'
import { createDataClient } from '#/lib/data-client'
import {
  UndoStack,
  archivePlateDesign,
  autoFillPlate,
  createPlateDesign,
  defaultPlateDesignDoc,
  describePlateDesignerError,
  fetchPlateDesigns,
  fetchPlateWells,
  plateDesignerQueryKeys,
  savePlateDesign,
  validatePlateDesign,
} from '#/lib/plate-designer'
import type {
  CsvImportRow,
  PlateDesignDoc,
  PlateWellAssignment,
} from '#/lib/plate-designer'
import {
  ASSIGNMENT_ROLES,
  ROLE_STYLES,
  parseWellCode,
  rowLabel,
  wellCode,
} from '#/lib/plate-map'
import type { AssignmentRole } from '#/lib/plate-map'

const getPlateDesignerContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/plate-designer')({
  beforeLoad: async () => {
    const context = await getPlateDesignerContext()
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PlateDesignerRoute,
})

const dataClient = createDataClient()
const initialConfig: AutoFillConfig = {
  replicates: 1,
  fillDirection: 'row',
  startWell: 'A1',
  randomize: false,
  seed: 1,
  volumeValue: '',
  volumeUnit: 'µL',
  controls: DEFAULT_CONTROLS,
}

export function PlateDesignerRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [design, setDesign] = useState<PlateDesignDoc>(() =>
    defaultPlateDesignDoc(workspaceId),
  )
  const [selectedWellCodes, setSelectedWellCodes] = useState<string[]>([])
  const [autoFillConfig, setAutoFillConfig] =
    useState<AutoFillConfig>(initialConfig)
  const undoStack = useRef(new UndoStack<PlateWellAssignment[]>([]))
  const [undoVersion, setUndoVersion] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [newName, setNewName] = useState('Untitled plate')
  const [error, setError] = useState<string | null>(null)
  const [saveHistory, setSaveHistory] = useState<
    Array<{ action: string; timestamp: string; wellCount: number }>
  >([])

  const designs = useQuery({
    queryKey: plateDesignerQueryKeys.list(workspaceId),
    queryFn: () => fetchPlateDesigns(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const wells = useQuery({
    queryKey: plateDesignerQueryKeys.wells(design.id ?? 'none'),
    queryFn: () => fetchPlateWells(dataClient, design.id!),
    enabled: Boolean(design.id),
  })
  useEffect(() => {
    if (!wells.data) return
    setDesign((current) => ({ ...current, wells: wells.data }))
    undoStack.current.reset(wells.data)
    setUndoVersion((value) => value + 1)
  }, [wells.data])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: plateDesignerQueryKeys.list(workspaceId),
    })
  const createMutation = useMutation({
    mutationFn: () =>
      createPlateDesign(dataClient, { workspaceId, name: newName.trim() }),
    onSuccess: async (created) => {
      await invalidate()
      const next = defaultPlateDesignDoc(workspaceId)
      setDesign({
        ...next,
        id: created.id,
        name: created.name,
        metadataVersion: created.metadata_version,
      })
      setSelectedWellCodes([])
      setError(null)
    },
    onError: (cause) => setError(describePlateDesignerError(cause)),
  })
  const saveMutation = useMutation({
    mutationFn: () =>
      savePlateDesign(dataClient, {
        designId: design.id!,
        wells: design.wells,
        validation: design.validation,
        expectedMetadataVersion: design.metadataVersion,
      }),
    onSuccess: (saved) => {
      setDesign((current) => ({
        ...current,
        metadataVersion: saved.metadata_version,
        updatedAt: saved.updated_at,
      }))
      setSaveHistory((history) =>
        [
          {
            action: 'Saved design',
            timestamp: new Date().toISOString(),
            wellCount: design.wells.length,
          },
          ...history,
        ].slice(0, 10),
      )
      setError(null)
      void invalidate()
    },
    onError: (cause) => setError(describePlateDesignerError(cause)),
  })
  const archiveMutation = useMutation({
    mutationFn: () =>
      archivePlateDesign(dataClient, {
        designId: design.id!,
        expectedMetadataVersion: design.metadataVersion,
      }),
    onSuccess: () => {
      setDesign(defaultPlateDesignDoc(workspaceId))
      void invalidate()
    },
    onError: (cause) => setError(describePlateDesignerError(cause)),
  })

  const updateWells = (next: PlateWellAssignment[]) => {
    undoStack.current.push(next)
    setDesign((current) => ({ ...current, wells: next }))
    setUndoVersion((value) => value + 1)
  }
  const selectedCode = selectedWellCodes[0] ?? null
  const selectedWell =
    design.wells.find((well) => well.wellCode === selectedCode) ?? null
  const validationErrors = validatePlateDesign(design)
  const plateWells = useMemo<PlateWell[]>(() => {
    const assigned = new Map(design.wells.map((well) => [well.wellCode, well]))
    return Array.from({ length: design.rows * design.cols }, (_, index) => {
      const row = Math.floor(index / design.cols)
      const col = index % design.cols
      const code = wellCode(row, col)
      const assignment = assigned.get(code)
      return assignment
        ? {
            row,
            col,
            wellCode: code,
            roleClass: ROLE_STYLES[assignment.role].cellClass,
            displayLabel:
              assignment.sampleRef?.identifier ??
              ROLE_STYLES[assignment.role].label,
            label: code,
          }
        : {
            row,
            col,
            wellCode: code,
            roleClass: ROLE_STYLES.empty.cellClass,
            displayLabel: '',
            label: code,
          }
    })
  }, [design.cols, design.rows, design.wells])

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
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Plate Designer' }]}
      fullBleed
      inspectorLabel="Plate well"
      inspector={
        <PlateInspector
          well={selectedWell}
          wellCode={selectedCode}
          validationErrors={validationErrors}
          design={design}
          saveHistory={saveHistory}
          onClose={() => setSelectedWellCodes([])}
          onEditWell={(patch) => {
            if (!selectedWell) return
            updateWells(
              design.wells.map((well) =>
                well.wellCode === selectedWell.wellCode
                  ? { ...well, ...patch }
                  : well,
              ),
            )
          }}
        />
      }
    >
      <div className="h-full overflow-auto bg-muted/20 p-4">
        <div className="space-y-4">
          <header className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <h1 className="text-xl font-semibold">Plate Designer</h1>
              <p className="text-xs text-muted-foreground">
                Design, validate, and save microplate layouts.
              </p>
            </div>
            <Input
              className="w-48"
              aria-label="New design name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              size="sm"
              disabled={
                !workspaceId || !newName.trim() || createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              <Plus className="size-4" /> New design
            </Button>
            <Select
              className="w-56"
              aria-label="Plate design"
              value={design.id ?? ''}
              onChange={(event) => {
                const next = designs.data?.find(
                  (item) => item.id === event.target.value,
                )
                if (next) {
                  setDesign(next)
                  setSelectedWellCodes([])
                }
              }}
            >
              <option value="">Select a design</option>
              {(designs.data ?? []).map((item) => (
                <option key={item.id} value={item.id ?? ''}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!design.id || archiveMutation.isPending}
              onClick={() => archiveMutation.mutate()}
            >
              <Archive className="size-4" /> Archive
            </Button>
          </header>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <PlateToolbar
            config={autoFillConfig}
            onConfigChange={setAutoFillConfig}
            selectedCount={selectedWellCodes.length}
            validationErrorCount={validationErrors.length}
            hasDesign={Boolean(design.id)}
            savePending={saveMutation.isPending}
            canUndo={undoStack.current.canUndo() && undoVersion >= 0}
            onImportCsv={() => setImportOpen(true)}
            onSave={() => saveMutation.mutate()}
            onAutoFill={() =>
              updateWells(
                autoFillPlate(design.rows, design.cols, {
                  samples: design.wells
                    .filter((well) => well.sampleRef)
                    .map((well) => well.sampleRef!),
                  replicates: autoFillConfig.replicates,
                  fillDirection: autoFillConfig.fillDirection,
                  startWell: autoFillConfig.startWell,
                  controls: autoFillConfig.controls,
                  randomize: autoFillConfig.randomize,
                  seed: autoFillConfig.seed,
                  ...(autoFillConfig.volumeValue
                    ? {
                        volume: {
                          value: Number(autoFillConfig.volumeValue),
                          unit: autoFillConfig.volumeUnit,
                        },
                      }
                    : {}),
                }),
              )
            }
            onUndo={() => {
              const previous = undoStack.current.undo()
              if (previous)
                setDesign((current) => ({ ...current, wells: previous }))
              setUndoVersion((value) => value + 1)
            }}
            onClearAll={() => updateWells([])}
            onClearSelected={() => {
              updateWells(
                design.wells.filter(
                  (well) => !selectedWellCodes.includes(well.wellCode),
                ),
              )
              setSelectedWellCodes([])
            }}
            onAssignRole={(role) => {
              const existing = new Map(
                design.wells.map((well) => [well.wellCode, well]),
              )
              for (const code of selectedWellCodes) {
                const position = parseWellCode(code)
                if (!position) continue
                existing.set(code, {
                  ...existing.get(code),
                  ...position,
                  wellCode: code,
                  role,
                })
              }
              updateWells([...existing.values()])
            }}
          />
          <div className="rounded-lg border bg-background p-6">
            <PlateMap
              wells={plateWells}
              rows={design.rows}
              cols={design.cols}
              selectedWellCode={selectedCode}
              onSelectWellCode={(code) => setSelectedWellCodes([code])}
              ariaLabel={`${design.rows} by ${design.cols} plate`}
              roleLegend={ASSIGNMENT_ROLES.map((role) => ({
                label: ROLE_STYLES[role].label,
                className: ROLE_STYLES[role].cellClass,
              }))}
            />
            <p className="mt-4 text-xs text-muted-foreground">
              Rows {rowLabel(0)}–{rowLabel(design.rows - 1)} · {design.cols}{' '}
              columns
            </p>
          </div>
        </div>
      </div>
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        rows={design.rows}
        cols={design.cols}
        onImport={(rows) => updateWells(rowsToAssignments(rows))}
      />
    </AppShell>
  )
}

function rowsToAssignments(rows: CsvImportRow[]): PlateWellAssignment[] {
  return rows.flatMap((row) => {
    const position = parseWellCode(row.wellCode)
    if (!position) return []
    return [
      {
        ...position,
        wellCode: row.wellCode,
        role: row.role as AssignmentRole,
        ...(row.sampleIdentifier
          ? {
              sampleRef: {
                recordId: row.sampleIdentifier,
                identifier: row.sampleIdentifier,
                title: row.sampleIdentifier,
              },
              sampleRecordId: row.sampleIdentifier,
            }
          : {}),
        ...(row.replicate ? { replicate: Number(row.replicate) } : {}),
        ...(row.volumeValue && row.volumeUnit
          ? {
              volume: {
                value: Number(row.volumeValue),
                unit: row.volumeUnit,
              },
            }
          : {}),
        ...(row.concentrationValue
          ? { concentrationValue: Number(row.concentrationValue) }
          : {}),
        ...(row.concentrationUnit
          ? { concentrationUnit: row.concentrationUnit }
          : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      },
    ]
  })
}
