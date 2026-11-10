import { useState } from 'react'

import { Button, Checkbox, Field, Notice, Select, toast } from '../ui/kit'
import { t } from '#/copy'
import { useAsync } from '#/lib/use-async'
import {
  duplicatesOf,
  isDuplicateError,
  registerProduct,
  registryModels,
} from '#/lib/registry'
import type { DuplicateMatch, RegistryModel } from '#/lib/registry'
import type { ParsedSequence } from '#/lib/sequence'
import type { AssemblyProduct } from '#/lib/molbio'
import type { AssemblyPlan } from '#/lib/sequence-block'
import type { WorkbenchProps } from './shared'

/**
 * Register the product as a record in the registry, with lineage to its parts.
 * A duplicate is a question rather than a failure: the warning names the record
 * it collides with and lets the person register anyway.
 */
export function RegisterProductPanel({
  plan,
  product,
  name,
  parsed,
  parents,
  fallbackName,
  edit,
}: {
  plan: AssemblyPlan
  product: AssemblyProduct
  name: string
  parsed: ParsedSequence
  parents: Parameters<typeof registerProduct>[0]['parents']
  fallbackName: string
  edit: WorkbenchProps['edit']
}) {
  const [modelKey, setModelKey] = useState('')
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [allowDup, setAllowDup] = useState(false)
  const [busy, setBusy] = useState(false)
  const models = useAsync(registryModels, 'models')
  const sequences = (models.data ?? []).filter((m) => m.registry_sequence_field)

  const model: RegistryModel | undefined =
    sequences.find((m) => m.key === modelKey) ?? sequences.at(0)

  const register = async () => {
    if (!model) return
    setBusy(true)

    try {
      const done = await registerProduct({
        model,
        title: name.trim() || fallbackName,
        sequence: parsed,
        parents,
        allowDuplicate: allowDup,
      })

      edit((d) => ({
        ...d,
        products: [
          ...(d.products ?? []),
          {
            recordId: done.recordId,
            identifier: done.identifier,
            title: done.title,
            method: product.method,
            planId: plan.id,
            registeredAt: new Date().toISOString(),
          },
        ],
      }))
      toast(t('molbio.cloning.registered', { identifier: done.identifier }))
      setDuplicates(null)
    } catch (error) {
      if (isDuplicateError(error)) {
        try {
          setDuplicates(await duplicatesOf(model, parsed, name))
        } catch {
          setDuplicates([])
        }
      } else
        toast.error(
          error instanceof Error
            ? error.message
            : t('molbio.cloning.registerFailed'),
        )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h4 className="text-body font-medium text-fg">
        {t('molbio.cloning.registerTitle')}
      </h4>
      {models.isSuccess && sequences.length === 0 ? (
        <Notice>{t('molbio.cloning.noRegistry')}</Notice>
      ) : (
        <>
          <p className="text-label text-fg-muted">
            {parents.length > 0
              ? t('molbio.cloning.lineage', { count: parents.length })
              : t('molbio.cloning.noLineage')}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('molbio.cloning.registry')} className="w-56">
              <Select
                value={model?.key ?? ''}
                onChange={(e) => {
                  setModelKey(e.target.value)
                  setDuplicates(null)
                }}
              >
                {sequences.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={busy || !model}
              onClick={() => void register()}
            >
              {t('molbio.cloning.register')}
            </Button>
          </div>
        </>
      )}
      {duplicates ? (
        <Notice tone="warn">
          <div className="flex flex-col gap-2">
            <span>
              {duplicates.length > 0
                ? t('molbio.cloning.duplicate', {
                    identifiers: duplicates.map((d) => d.identifier).join(', '),
                  })
                : t('molbio.cloning.duplicateUnknown')}
            </span>
            <label className="flex items-center gap-2">
              <Checkbox checked={allowDup} onCheckedChange={setAllowDup} />
              {t('registry.duplicate.registerAnyway')}
            </label>
          </div>
        </Notice>
      ) : null}
    </div>
  )
}
