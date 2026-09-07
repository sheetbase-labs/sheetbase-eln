import { FormSection } from '#/components/ui/form-section'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Select, Textarea } from '#/components/ui'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import type { PipelineConfig } from '#/lib/pipelines/config'

type Action = NonNullable<PipelineConfig['actions']>[number]

/** Keep unfinished JSON local so a keystroke never discards action arguments. */
export function PipelineActionsEditor({
  actions,
  onChange,
  onValidityChange,
}: {
  actions: Action[]
  onChange: (actions: Action[]) => void
  onValidityChange: (valid: boolean) => void
}) {
  const [drafts, setDrafts] = useState(() =>
    actions.map((action) => ({
      raw: JSON.stringify(action.arguments, null, 2),
      error: '',
    })),
  )
  useEffect(
    () => onValidityChange(drafts.every((draft) => !draft.error)),
    [drafts, onValidityChange],
  )
  function move(index: number, direction: number) {
    const next = [...actions]
    const nextDrafts = [...drafts]
    ;[next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ]
    ;[nextDrafts[index], nextDrafts[index + direction]] = [
      nextDrafts[index + direction],
      nextDrafts[index],
    ]
    setDrafts(nextDrafts)
    onChange(next)
  }
  return (
    <FormSection
      title="ELN actions"
      hint="Create or update records, move samples and manage datasets. Actions run in order after the analysis steps."
    >
      <div className="space-y-3">
        {actions.map((action, index) => {
          const operation = PIPELINE_ACTIONS.find(
            (item) => item.operation === action.operation,
          )
          return (
            <div key={index} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-0 flex-1"
                  aria-label={`Action ${index + 1} name`}
                  value={action.name}
                  onChange={(event) =>
                    onChange(
                      actions.map((item, i) =>
                        i === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move action ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move action ${index + 1} down`}
                  disabled={index === actions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove action ${index + 1}`}
                  onClick={() => {
                    setDrafts(drafts.filter((_, i) => i !== index))
                    onChange(actions.filter((_, i) => i !== index))
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Select
                aria-label={`Action ${index + 1} operation`}
                value={action.operation}
                onChange={(event) =>
                  onChange(
                    actions.map((item, i) =>
                      i === index
                        ? { ...item, operation: event.target.value }
                        : item,
                    ),
                  )
                }
              >
                <option value="">Choose an action…</option>
                {PIPELINE_ACTIONS.map((item) => (
                  <option key={item.operation} value={item.operation}>
                    {item.label}
                  </option>
                ))}
              </Select>
              {operation && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {operation.description}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const args = { ...action.arguments }
                      for (const argument of operation.arguments)
                        if (
                          argument.required &&
                          !argument.server &&
                          !(argument.name in args)
                        )
                          args[argument.name] = null
                      setDrafts(
                        drafts.map((draft, i) =>
                          i === index
                            ? { raw: JSON.stringify(args, null, 2), error: '' }
                            : draft,
                        ),
                      )
                      onChange(
                        actions.map((item, i) =>
                          i === index ? { ...item, arguments: args } : item,
                        ),
                      )
                    }}
                  >
                    Add required fields
                  </Button>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Action fields
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {operation.arguments
                        .filter((argument) => !argument.server)
                        .map((argument) => (
                          <li key={argument.name}>
                            <code>{argument.name}</code> · {argument.type}
                            {argument.required ? ' · required' : ''}
                          </li>
                        ))}
                    </ul>
                  </details>
                </>
              )}
              <Textarea
                aria-label={`Action ${index + 1} arguments`}
                aria-invalid={Boolean(drafts[index]?.error)}
                className="min-h-32 font-mono text-xs leading-5"
                spellCheck={false}
                value={drafts[index]?.raw ?? '{}'}
                onChange={(event) => {
                  const raw = event.target.value
                  let error = ''
                  try {
                    const args: unknown = JSON.parse(raw)
                    if (
                      !args ||
                      typeof args !== 'object' ||
                      Array.isArray(args)
                    )
                      throw new Error('Invalid arguments')
                    onChange(
                      actions.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              arguments: args as Record<string, unknown>,
                            }
                          : item,
                      ),
                    )
                  } catch {
                    error =
                      'Enter a JSON object with the fields for this action.'
                  }
                  setDrafts(
                    drafts.map((item, i) =>
                      i === index ? { raw, error } : item,
                    ),
                  )
                }}
              />
              {drafts[index]?.error && (
                <p role="alert" className="text-xs text-destructive">
                  {drafts[index].error}
                </p>
              )}
            </div>
          )
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            let n = actions.length + 1
            while (actions.some((action) => action.name === `action_${n}`)) n++
            setDrafts([...drafts, { raw: '{}', error: '' }])
            onChange([
              ...actions,
              { name: `action_${n}`, operation: '', arguments: {} },
            ])
          }}
        >
          <Plus className="size-4" /> Add ELN action
        </Button>
        {actions.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Use run values in action fields
            </summary>
            <p className="mt-2 text-muted-foreground">
              Use a reference instead of a fixed value. For example:
            </p>
            <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3">
              {'{ "p_title": { "$ref": "parameters.title" } }'}
            </pre>
          </details>
        )}
      </div>
    </FormSection>
  )
}
