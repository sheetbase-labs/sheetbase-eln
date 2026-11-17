/**
 * The assay setup a plate design remembers, in the New plate run dialog: pick
 * the assay's design and the controls and settings come with it, and the first
 * plate of an assay can be remembered for the next one.
 */
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { ASSAY_METHODS } from '#/lib/plate-assay'
import type { AssayDesign, AssaySetup } from '#/lib/plate-assay-setup'

import { controlsLine, setupLines } from './assay-setup-lines'
import type { AssaySetupChoice } from './use-assay-setup'

/** The remembered setup of the chosen design, said back in plain words. */
function RememberedSetup({
  design,
  setup,
  fromLastPlate,
}: {
  design: AssayDesign
  setup: AssaySetup
  fromLastPlate: boolean
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-md bg-surface-muted px-3 py-2.5 text-label"
      data-testid="remembered-setup"
    >
      <div className="font-medium text-fg">
        {t('features.plateRuns.setup.title', { design: design.name })}
      </div>
      <div className="text-fg-muted">{setupLines(setup).join(' · ')}</div>
      {controlsLine(setup) ? (
        <div className="text-fg-muted">{controlsLine(setup)}</div>
      ) : null}
      <div className="text-fg-muted">
        {fromLastPlate
          ? `${t('features.plateRuns.setup.fromLastPlate')} ${t('features.plateRuns.setup.remembered')}`
          : t('features.plateRuns.setup.remembered')}
      </div>
    </div>
  )
}

/** Remember this plate's controls and settings: on the design, or as a new assay. */
function RememberSetupChoice({ choice }: { choice: AssaySetupChoice }) {
  const { design } = choice

  if (design && choice.canRememberOnDesign)
    return (
      <label className="flex items-center gap-2 text-label">
        <Checkbox
          checked={choice.rememberOnDesign}
          onCheckedChange={(value) => choice.onRememberOnDesign(value === true)}
        />
        {design.setup
          ? t('features.plateRuns.setup.rememberUpdate', {
              design: design.name,
            })
          : t('features.plateRuns.setup.remember', { design: design.name })}
      </label>
    )

  if (!design && choice.hasControls)
    return (
      <Field
        label={t('features.plateRuns.setup.rememberNew')}
        hint={t('features.plateRuns.setup.rememberNewHint')}
      >
        <Input
          value={choice.newName}
          maxLength={200}
          placeholder={t('features.plateRuns.setup.rememberNamePlaceholder')}
          onChange={(e) => choice.onNewName(e.target.value)}
        />
      </Field>
    )

  return null
}

/**
 * How the plate is read: screened for hits against its controls, or quantified
 * off a standard curve. The assay's design remembers the answer, so it is asked
 * once per assay.
 */
function ReadMethodFields({ choice }: { choice: AssaySetupChoice }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field
        label={t('features.plateRuns.quantify.method')}
        hint={t('features.plateRuns.quantify.methodHint')}
      >
        <Select
          value={choice.method}
          onChange={(e) => {
            const next = ASSAY_METHODS.find((m) => m === e.target.value)

            if (next) choice.onMethod(next)
          }}
        >
          {ASSAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`features.plateRuns.quantify.methods.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      {choice.method === 'quantify' ? (
        <Field
          label={t('features.plateRuns.quantify.dilutionFactor')}
          hint={t('features.plateRuns.quantify.dilutionFactorHint')}
        >
          <Input
            type="number"
            min={1}
            step="any"
            value={String(choice.dilutionFactor)}
            onChange={(e) => {
              const next = Number(e.target.value)

              choice.onDilution(Number.isFinite(next) && next > 0 ? next : null)
            }}
          />
        </Field>
      ) : null}
    </div>
  )
}

/**
 * What the dialog says about the assay's setup: the one the design remembers,
 * and the offer to remember this plate's. A plate read with a layout has its
 * controls in the layout, so it has no control columns to remember.
 */
export function AssaySetupSection({
  choice,
  hasLayout,
}: {
  choice: AssaySetupChoice
  hasLayout: boolean
}) {
  const { design, setup } = choice

  return (
    <>
      <ReadMethodFields choice={choice} />
      {design && setup ? (
        <RememberedSetup
          design={design}
          setup={setup}
          fromLastPlate={choice.takenFromLastPlate}
        />
      ) : null}
      {hasLayout ? null : <RememberSetupChoice choice={choice} />}
    </>
  )
}
