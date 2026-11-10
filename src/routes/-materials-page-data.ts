/**
 * The materials registry's reads and writes.
 *
 * The list, the inspector and the dialogs each read from this module, so the
 * route composes them instead of owning every query and mutation itself.
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { useHasCapability } from '#/lib/use-capability'
import { useProjectNames } from '#/components/samples/samples-data'
import { useHasProjectAccess } from '#/components/projects/project-access'
import {
  fetchAllMaterialSafety,
  materialSafetyKeys,
} from '#/lib/material-safety'
import {
  materialListQueryKeys,
  toMaterialListRow,
  useArchivedReagentCount,
  useReagentPage,
} from '#/components/materials/materials-data'
import type { MaterialListRow } from '#/components/materials/materials-data'
import {
  createReagent,
  fetchCertificateFile,
  fetchReplacementLot,
  fetchReagentUsage,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import { openOrderFor } from '#/components/materials/reagent-order-model'
import { useReagentOrders } from '#/components/materials/reagent-orders'
import { useListView } from '#/lib/list-views'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { notebookDataClient } from '#/lib/notebook-data'
import { requireBuiltInModel } from '#/lib/built-in-models'
import type { ModelFieldRecordValues } from '#/lib/model-fields'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'

import {
  failureMessage,
  linkedMaterialTab,
  materialTabCounts,
  sortReagentsByExpiry,
  visibleMaterials,
} from './-materials-page-model'
import type { MaterialTab } from './-materials-page-model'

const MATERIAL_MODEL = requireBuiltInModel('material')

/** What the lot is registered as; the form collects it and the mutation sends
 * it. */
export interface RegisterLotInput {
  projectId: string
  title: string
  supplier?: string
  catalogNo?: string
  lot?: string
  expiry?: string
  quantity: number
  unit?: string
  storage?: string
  customFields?: ModelFieldRecordValues['customFields']
  typeKey?: string | null
  typeFields?: ModelFieldRecordValues['customFields']
}

/** What a replacement lot states about itself. */
export interface ReplacementLotInput {
  lot: string
  expiry: string
  quantity: number
  unit?: string
  reason?: string
}

/** The registry's pages, its capability gates and the shared list chrome. */
export function useMaterialsReads(tab: MaterialTab | undefined) {
  const canWrite = useHasCapability('record.create')
  const canPlaceOrders = useHasCapability('schema.edit')
  const orders = useReagentOrders()
  const page = useReagentPage()
  const archivedPage = useReagentPage(undefined, true, tab === 'archived')
  const archivedCount = useArchivedReagentCount()
  const view = useListView('materials')
  const bulk = useBulkSelection()
  const projects = useProjectNames()
  const hasProjectAccess = useHasProjectAccess()

  const safetyByLot = useQuery({
    queryKey: materialSafetyKeys.all(),
    queryFn: () => fetchAllMaterialSafety(notebookDataClient),
    staleTime: 30_000,
  })

  return {
    canWrite,
    canPlaceOrders,
    orders,
    page,
    archivedPage,
    archivedCount,
    view,
    bulk,
    projects,
    hasProjectAccess,
    safetyByLot,
  }
}

export type MaterialsReads = ReturnType<typeof useMaterialsReads>

/** The lots on every page the screen holds, soonest expiry first. */
export function materialRows(
  page: MaterialsReads['page'],
  archivedPage: MaterialsReads['archivedPage'],
): MaterialListRow[] {
  return sortReagentsByExpiry([
    ...(page.data?.rows ?? []),
    ...(archivedPage.data?.rows ?? []),
  ]).map(toMaterialListRow)
}

/** The open lot's own reads: what used it, its replacement and its
 * certificate. */
export function useMaterialLotReads(sel: MaterialListRow | undefined) {
  const usage = useQuery({
    queryKey: ['ui-port', 'materials', 'usage', sel?.id ?? ''],
    queryFn: () => fetchReagentUsage(notebookDataClient, sel!.id),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  const replacementLink = useQuery({
    queryKey: ['ui-port', 'materials', 'replacement', sel?.id ?? ''],
    queryFn: () => fetchReplacementLot(notebookDataClient, sel!.id),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  const certificate = useQuery({
    queryKey: ['ui-port', 'materials', 'certificate', sel?.uuid ?? ''],
    queryFn: () => fetchCertificateFile(notebookDataClient, sel!.uuid),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  return { usage, replacementLink, certificate }
}

/**
 * Every write the screen makes on a lot: quarantine, restore, a replacement
 * lot, receiving stock, and registering a new lot.
 */
export function useMaterialLotActions({
  sel,
  queryClient,
  closeQuarantine,
  closeReplacement,
  closeRegister,
  closeReceive,
  onRegistered,
}: {
  sel: MaterialListRow | undefined
  queryClient: QueryClient
  /** Quarantine and its reason field close together, as they always have. */
  closeQuarantine: () => void
  closeReplacement: () => void
  closeRegister: () => void
  closeReceive: () => void
  /** The route opens the new lot once it exists. */
  onRegistered: (created: { id: string; identifier: string }) => void
}) {
  // A quarantined lot is isolated, not gone: the same RPC restores it. The
  // reason is the operator's, never a fabricated ledger entry.
  const quarantine = useMutation({
    mutationFn: (reason: string) =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'quarantine',
        quantityDelta: 0,
        reason: reason.trim() || undefined,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotQuarantined'))
      closeQuarantine()
    },
    onError: (error) =>
      toast(
        failureMessage(
          error,
          t('library.materials.page.couldNotQuarantineLot'),
        ),
      ),
  })

  const restore = useMutation({
    mutationFn: () =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'restore',
        quantityDelta: 0,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotRestored'))
    },
    onError: (error) =>
      toast(
        failureMessage(error, t('library.materials.page.couldNotRestoreLot')),
      ),
  })

  const replacement = useMutation({
    mutationFn: (input: ReplacementLotInput) =>
      registerReplacementLot(notebookDataClient, {
        recordId: sel!.uuid,
        lot: input.lot,
        expiry: input.expiry,
        quantity: input.quantity,
        unit: input.unit ?? sel!.unit,
        reason: input.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.replacementLotRegistered'))
      closeReplacement()
    },
    onError: (error) =>
      toast(
        failureMessage(
          error,
          t('library.materials.page.couldNotRegisterTheReplacement'),
        ),
      ),
  })

  const register = useMutation({
    mutationFn: async (input: RegisterLotInput) => {
      const created = await createReagent(notebookDataClient, {
        projectId: input.projectId,
        title: input.title,
        properties: {
          supplier: input.supplier ?? null,
          catalogNo: input.catalogNo ?? null,
          lot: input.lot ?? null,
          expiry: input.expiry ?? null,
          quantity: input.quantity,
          unit: input.unit ?? null,
          storage: input.storage ?? null,
        },
        customFields: input.customFields,
      })

      if (!input.typeKey) return created

      // A subtype gives the lot its own ID.
      const typed = await saveNewObjectFields(
        notebookDataClient,
        MATERIAL_MODEL,
        created.id,
        input.typeKey,
        input.typeFields ?? {},
      )

      return { ...created, identifier: typed.identifier ?? created.identifier }
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(
        t('library.materials.page.lotRegistered', {
          identifier: created.identifier,
        }),
      )
      closeRegister()
      onRegistered(created)
    },
    onError: (error) =>
      toast(
        failureMessage(error, t('library.materials.page.couldNotRegisterLot')),
      ),
  })

  const receive = useMutation({
    mutationFn: (input: { quantity: number; reason?: string }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'receive',
        quantityDelta: input.quantity,
        reason: input.reason,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotReceived'))
      closeReceive()
    },
    onError: (error) =>
      toast(
        failureMessage(error, t('library.materials.page.couldNotReceiveLot')),
      ),
  })

  return { quarantine, restore, replacement, register, receive }
}

/** Every dialog the list opens, and the quarantine reason the confirm holds. */
export function useMaterialsDialogs() {
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  const [reorderOpen, setReorderOpen] = useState(false)

  return {
    receiveOpen,
    setReceiveOpen,
    registerOpen,
    setRegisterOpen,
    solutionOpen,
    setSolutionOpen,
    replacementOpen,
    setReplacementOpen,
    quarantineOpen,
    setQuarantineOpen,
    quarantineReason,
    setQuarantineReason,
    reorderOpen,
    setReorderOpen,
    /** Quarantine and its reason field close together, as they always have. */
    closeQuarantine: () => {
      setQuarantineOpen(false)
      setQuarantineReason('')
    },
  }
}

export type MaterialsDialogs = ReturnType<typeof useMaterialsDialogs>

/**
 * The lots on screen: the selected row, the tab's counts and the tab a linked
 * lot lives on.
 */
export function useMaterialsListModel({
  reads,
  tab,
  search,
}: {
  reads: MaterialsReads
  tab: MaterialTab
  search: { q?: string; selected?: string }
}) {
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(
    () => materialRows(reads.page, reads.archivedPage),
    [reads.page, reads.archivedPage],
  )

  const counts = materialTabCounts({
    rows,
    orders: reads.orders.data ?? [],
    archivedCount: reads.archivedCount.data ?? 0,
  })

  const visible = visibleMaterials({ rows, tab, query: search.q ?? '' })

  const sel =
    visible.find((row) => row.uuid === (selected ?? search.selected)) ??
    visible.at(0)

  const openOrder = sel ? openOrderFor(reads.orders.data, sel.uuid) : undefined

  // A link such as `?selected=<lot>` names a lot, not a tab. When that lot
  // lives on another tab (an expired or quarantined lot, say) move to the tab
  // that holds it instead of selecting the first row of the wrong list.
  const linkedTab = linkedMaterialTab({
    rows,
    selected: search.selected,
    tab,
  })

  return {
    selected,
    setSelected,
    rows,
    counts,
    visible,
    sel,
    openOrder,
    linkedTab,
  }
}
