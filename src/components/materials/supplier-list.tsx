/**
 * Supplier lists: any record model can be ticked as the lab's supplier list,
 * and a ready-made Supplier model is offered for a lab that has none. An order
 * names the supplier record it was placed with.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  createSupplierModel,
  fetchSupplierModelKeys,
  fetchSuppliers,
  setModelSupplierList,
  supplierKeys,
} from '#/lib/suppliers'

const client = notebookDataClient

/** The models ticked as a supplier list, and the suppliers in them. */
export function useSuppliers() {
  const models = useQuery({
    queryKey: supplierKeys.models,
    queryFn: () => fetchSupplierModelKeys(client),
    staleTime: 30_000,
  })
  const keys = models.data ?? []
  const suppliers = useQuery({
    queryKey: supplierKeys.list(keys),
    queryFn: () => fetchSuppliers(client, keys),
    enabled: models.isSuccess && keys.length > 0,
    staleTime: 30_000,
  })
  return {
    modelKeys: keys,
    suppliers: suppliers.data ?? [],
    isPending: models.isPending || (keys.length > 0 && suppliers.isPending),
  }
}

function useRefreshSuppliers() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: supplierKeys.all })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'record-models'],
    })
  }
}

/** Offered where a supplier is chosen and the lab has no supplier list yet. */
export function SetUpSuppliers({ canSetUp }: { canSetUp: boolean }) {
  const refresh = useRefreshSuppliers()
  const create = useMutation({
    mutationFn: () => createSupplierModel(client),
    onSuccess: () => {
      refresh()
      toast.success(t('spend.suppliers.setUpDone'))
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('spend.suppliers.couldNotSetUp'),
      ),
  })
  if (!canSetUp) return null
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-md border border-border px-3 py-2">
      <span className="text-label font-medium">
        {t('spend.suppliers.setUpTitle')}
      </span>
      <span className="text-label text-fg-muted">
        {t('spend.suppliers.setUpBody')}
      </span>
      <Button
        size="sm"
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        {t('spend.suppliers.setUp')}
      </Button>
    </div>
  )
}

/** On a model's page: tick it as the supplier list, or untick it. */
export function SupplierListDialog({
  open,
  onOpenChange,
  modelKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelKey: string
}) {
  const refresh = useRefreshSuppliers()
  const keys = useQuery({
    queryKey: supplierKeys.models,
    queryFn: () => fetchSupplierModelKeys(client),
  })
  const [choice, setChoice] = useState<boolean | null>(null)
  const checked = choice ?? keys.data?.includes(modelKey) ?? false

  const save = useMutation({
    mutationFn: () => setModelSupplierList(client, modelKey, checked),
    onSuccess: () => {
      refresh()
      toast.success(t('spend.suppliers.listDialog.saved'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('spend.suppliers.listDialog.couldNotSave'),
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('spend.suppliers.listDialog.title')}
          description={t('spend.suppliers.listDialog.description')}
        />
        <DialogBody>
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={checked}
              disabled={keys.isPending}
              onCheckedChange={(next) => setChoice(next === true)}
            />
            {t('spend.suppliers.listDialog.useAs')}
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || keys.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
