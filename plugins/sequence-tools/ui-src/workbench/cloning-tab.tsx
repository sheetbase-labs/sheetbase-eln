/**
 * Cloning: plan a digest-and-ligate, Golden Gate or Gibson assembly from parts,
 * see the products it can make and how the parts join, then add the product
 * to the notebook or register it with lineage to its parts.
 *
 * The run itself is `cloning-plan.ts`; the editor is one panel per job —
 * `new-plan-panel.tsx`, `plan-settings-panel.tsx`, `plan-parts-panel.tsx`
 * (with `add-part.tsx`), `plan-products-panel.tsx` and `product-panel.tsx`.
 */
import { useMemo, useState } from 'react'

import { Notice, Tabs, toast } from '../ui/kit'
import { t } from '#/copy'
import { MAX_PLAN_PARTS } from '#/lib/sequence-block'
import type { AssemblyPlan, PlanPart } from '#/lib/sequence-block'
import { runPlan } from './cloning-plan'
import { NewPlanPanel } from './new-plan-panel'
import { PlanPartsPanel } from './plan-parts-panel'
import { PlanProductsPanel } from './plan-products-panel'
import { PlanSettingsPanel } from './plan-settings-panel'
import { ProductPanel } from './product-panel'
import type { WorkbenchProps } from './shared'

/** The run, re-exported so callers keep one import. */
export { runPlan } from './cloning-plan'

export function CloningTab(props: WorkbenchProps) {
  const { draft, edit, canEdit } = props
  const plans = draft.plans ?? []

  const [selectedId, setSelectedId] = useState<string | null>(
    plans[0]?.id ?? null,
  )

  const plan = plans.find((p) => p.id === selectedId) ?? plans.at(0) ?? null

  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  const updatePlan = (id: string, change: (p: AssemblyPlan) => AssemblyPlan) =>
    edit((d) => ({
      ...d,
      plans: (d.plans ?? []).map((p) => (p.id === id ? change(p) : p)),
    }))

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? (
        <NewPlanPanel
          planCount={plans.length}
          draft={draft}
          blockId={props.blockId}
          edit={edit}
          onCreated={setSelectedId}
        />
      ) : null}

      {plans.length > 1 ? (
        <Tabs
          mode="state"
          variant="strip"
          label={t('molbio.cloning.plans')}
          value={plan?.id ?? ''}
          onValueChange={setSelectedId}
          items={plans.map((p) => ({ key: p.id, label: p.name }))}
        />
      ) : null}

      {plan ? (
        <PlanEditor
          key={plan.id}
          {...props}
          plan={plan}
          update={(change) => updatePlan(plan.id, change)}
          remove={() => {
            edit((d) => ({
              ...d,
              plans: (d.plans ?? []).filter((p) => p.id !== plan.id),
            }))
            setSelectedId(null)
          }}
        />
      ) : (
        <Notice>{t('molbio.cloning.noPlans')}</Notice>
      )}
    </div>
  )
}

function PlanEditor(
  props: WorkbenchProps & {
    plan: AssemblyPlan
    update: (change: (p: AssemblyPlan) => AssemblyPlan) => void
    remove: () => void
  },
) {
  const { draft, canEdit, plan, update, edit, blockId, insertBelow } = props

  const [productIndex, setProductIndex] = useState(0)
  const result = useMemo(() => runPlan(plan), [plan])

  const product =
    result.products.at(Math.min(productIndex, result.products.length - 1)) ??
    null

  const addPart = (part: PlanPart) => {
    if (plan.parts.length >= MAX_PLAN_PARTS) {
      toast.error(t('molbio.cloning.tooManyParts'))

      return
    }

    update((p) => ({ ...p, parts: [...p.parts, part] }))
  }

  return (
    <div className="flex flex-col gap-5">
      <PlanSettingsPanel
        plan={plan}
        canEdit={canEdit}
        update={update}
        onRemove={props.remove}
      />

      <PlanPartsPanel
        {...props}
        plan={plan}
        canEdit={canEdit}
        update={update}
        addPart={addPart}
      />

      <PlanProductsPanel
        result={result}
        productIndex={productIndex}
        onSelect={setProductIndex}
      />

      {product ? (
        <ProductPanel
          key={`${plan.id}-${productIndex}-${product.seq.length}`}
          plan={plan}
          product={product}
          blockId={blockId}
          canEdit={canEdit}
          edit={edit}
          insertBelow={insertBelow}
          fallbackName={draft.name || draft.title || ''}
        />
      ) : null}
    </div>
  )
}
