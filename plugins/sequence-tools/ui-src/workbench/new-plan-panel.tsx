import { useState } from 'react'

import { Button, Field, Input, Tabs, toast } from '../ui/kit'
import { t } from '#/copy'
import { MAX_PLANS, SEQUENCE_METHODS, newId } from '#/lib/sequence-block'
import type {
  AssemblyPlan,
  PlanPart,
  SequenceMethod,
} from '#/lib/sequence-block'
import { methodLabel, partFromSequence } from './cloning-plan'
import { Panel } from './shared'
import type { WorkbenchProps } from './shared'

/**
 * Start a plan: name it and choose how the parts will be assembled. The method
 * decides which settings the plan editor then offers, so it is chosen here with
 * the name rather than after the fact.
 */
export function NewPlanPanel({
  planCount,
  draft,
  blockId,
  edit,
  onCreated,
}: {
  planCount: number
  draft: WorkbenchProps['draft']
  blockId: string
  edit: WorkbenchProps['edit']
  onCreated: (planId: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [newMethod, setNewMethod] = useState<SequenceMethod>('golden_gate')

  const create = () => {
    if (planCount >= MAX_PLANS) {
      toast.error(t('molbio.cloning.tooManyPlans'))

      return
    }

    const id = newId('plan')

    const first: PlanPart[] = draft.residues
      ? [partFromSequence(draft, blockId)]
      : []

    edit((d) => ({
      ...d,
      plans: [
        ...(d.plans ?? []),
        {
          id,
          name:
            newName.trim() ||
            t('molbio.cloning.unnamed', { number: planCount + 1 }),
          method: newMethod,
          enzymes: newMethod === 'golden_gate' ? ['BsaI'] : [],
          parts: first,
        } satisfies AssemblyPlan,
      ],
    }))
    onCreated(id)
    setNewName('')
  }

  return (
    <Panel
      title={t('molbio.cloning.newPlan')}
      hint={t('molbio.cloning.newPlanHint')}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('molbio.cloning.planName')} className="w-56">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('molbio.cloning.planNamePlaceholder')}
          />
        </Field>
        <Tabs
          mode="state"
          variant="segment"
          label={t('molbio.cloning.methodLabel')}
          value={newMethod}
          onValueChange={setNewMethod}
          items={SEQUENCE_METHODS.map((m) => ({
            key: m,
            label: methodLabel(m),
          }))}
        />
        <Button variant="primary" icon="plus" onClick={create}>
          {t('molbio.cloning.createPlan')}
        </Button>
      </div>
    </Panel>
  )
}
