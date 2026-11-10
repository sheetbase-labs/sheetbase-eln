import { Button, Field, Input, Select, Tabs } from '../ui/kit'
import { t } from '#/copy'
import { SEQUENCE_METHODS } from '#/lib/sequence-block'
import type { AssemblyPlan } from '#/lib/sequence-block'
import { TYPE_IIS, methodLabel } from './cloning-plan'
import { EnzymePicker } from './enzyme-picker'
import { Panel } from './shared'

/**
 * The plan's own settings: its name and the method it assembles by, which
 * decides what else it asks for — an overlap length for Gibson, one Type IIS
 * enzyme for Golden Gate, a set of cutters for ligation.
 */
export function PlanSettingsPanel({
  plan,
  canEdit,
  update,
  onRemove,
}: {
  plan: AssemblyPlan
  canEdit: boolean
  update: (change: (p: AssemblyPlan) => AssemblyPlan) => void
  onRemove: () => void
}) {
  return (
    <Panel
      title={plan.name}
      actions={
        canEdit ? (
          <Button size="sm" variant="danger" onClick={onRemove}>
            {t('molbio.cloning.deletePlan')}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        {canEdit ? (
          <Field label={t('molbio.cloning.planName')} className="w-56">
            <Input
              value={plan.name}
              onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
        ) : null}
        <Tabs
          mode="state"
          variant="segment"
          label={t('molbio.cloning.methodLabel')}
          value={plan.method}
          onValueChange={(k) => {
            if (!canEdit) return
            update((p) => ({
              ...p,
              method: k,
              enzymes:
                k === 'golden_gate'
                  ? ['BsaI']
                  : k === 'ligation'
                    ? []
                    : p.enzymes,
            }))
          }}
          items={SEQUENCE_METHODS.map((m) => ({
            key: m,
            label: methodLabel(m),
          }))}
        />
      </div>
      <p className="text-label text-fg-muted">
        {t(`molbio.cloning.methodHint.${plan.method}`)}
      </p>
      {plan.method === 'gibson' ? (
        <Field label={t('molbio.cloning.minOverlap')} className="w-40">
          <Input
            inputMode="numeric"
            disabled={!canEdit}
            value={String(plan.minOverlap ?? 15)}
            onChange={(e) =>
              update((p) => ({
                ...p,
                minOverlap: Math.max(
                  8,
                  Math.min(60, Number(e.target.value) || 15),
                ),
              }))
            }
          />
        </Field>
      ) : plan.method === 'golden_gate' ? (
        <Field label={t('molbio.cloning.typeIIS')} className="w-48">
          <Select
            disabled={!canEdit}
            value={plan.enzymes[0] ?? ''}
            onChange={(e) =>
              update((p) => ({ ...p, enzymes: [e.target.value] }))
            }
          >
            {TYPE_IIS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <EnzymePicker
          selected={plan.enzymes}
          disabled={!canEdit}
          onChange={(names) => update((p) => ({ ...p, enzymes: names }))}
        />
      )}
    </Panel>
  )
}
