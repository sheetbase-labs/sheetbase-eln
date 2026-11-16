import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'

export interface GateModeOption<M extends string> {
  value: M
  label: string
  hint: string
}

/** A labelled mode picker (block, warn or off) shared by the gate settings. */
export function GateModeField<M extends string>({
  label,
  options,
  mode,
  disabled,
  onPick,
}: {
  label: string
  options: ReadonlyArray<GateModeOption<M>>
  mode: M
  disabled: boolean
  onPick: (next: M) => void
}) {
  return (
    <div className="max-w-xl">
      <Field label={label} hint={options.find((o) => o.value === mode)?.hint}>
        <Select
          aria-label={label}
          value={mode}
          disabled={disabled}
          onChange={(event) => {
            const next = options.find((o) => o.value === event.target.value)

            if (next) onPick(next.value)
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
