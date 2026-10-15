import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { DataClientError } from '#/lib/data-client'

/**
 * The Models board's create affordance, ported from the design: the reference
 * board has a primary "New model" header action
 * (`tests/visual/design-reference/SchemasList-light.png`) opening a "New model"
 * dialog whose primary action is "Create draft"
 * (`sheetbase-app-ui-only/src/routes/_app/models/index.tsx`, `NewModel`).
 *
 * The reference dialog asks for a name and an app-3 Record/Measurement kind;
 * `kind` is not part of the canonical registry the board reads (the board
 * already renders that split as a gap), and the RPC that actually creates a
 * model — `api.create_dataset_schema_definition` — requires a key and a name
 * and accepts a description, so those three are the fields here. The action
 * matches the design: it creates a `draft` definition with a draft v1, needs
 * `schema.edit` in the target workspace, and never inserts directly.
 */

/** The key contract the RPC enforces on create (`SB071`), the same shape the
 * model editor already names inline: `^[a-z][a-z0-9_]{0,59}$`. */
const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/
export const MODEL_NAME_MAX = 200
export const MODEL_DESCRIPTION_MAX = 2000

export interface ModelCreateInput {
  key: string
  name: string
  description: string | null
}

/**
 * The metadata contract the create RPC validates before it inserts anything
 * (`SB071`): a key matching `^[a-z][a-z0-9_]{0,59}$`, a name of 1–200
 * characters, and a description of at most 2000. Checked here so an avoidable
 * refusal never reaches the server; the server remains authoritative.
 */
export function modelCreateErrors(input: {
  key: string
  name: string
  description: string
}): { key?: string; name?: string; description?: string } {
  const key = input.key.trim()
  const name = input.name.trim()
  const description = input.description.trim()
  const errors: { key?: string; name?: string; description?: string } = {}
  if (!key) errors.key = 'Key is required.'
  else if (!MODEL_KEY_PATTERN.test(key))
    errors.key =
      'Use lower-case letters, digits and _, starting with a letter (max 60 characters).'
  if (!name) errors.name = 'Name is required.'
  else if (name.length > MODEL_NAME_MAX)
    errors.name = `Name must be ${MODEL_NAME_MAX} characters or fewer.`
  if (description.length > MODEL_DESCRIPTION_MAX)
    errors.description = `Description must be ${MODEL_DESCRIPTION_MAX} characters or fewer.`
  return errors
}

/** Map the RPC's refusal to a short, true reason rather than a shrug. */
export function describeModelCreateError(error: unknown): string | null {
  if (error == null) return null
  if (error instanceof DataClientError) {
    if (error.code === '42501' || /capability/i.test(error.message))
      return 'You don’t have permission to create models in this workspace.'
    if (error.code === '23505' || /duplicate key/i.test(error.message))
      return 'A model with that key already exists in this workspace.'
    return error.message
  }
  return error instanceof Error ? error.message : 'Could not create the model.'
}

export function ModelCreateDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: ModelCreateInput) => void
  creating: boolean
  error: string | null
}) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const errors = modelCreateErrors({ key, name, description })
  // A field stays quiet until it holds something or a create was attempted, so
  // the dialog does not open shouting at an empty form.
  const showKey = submitted || key.length > 0
  const showName = submitted || name.length > 0
  const showDescription = submitted || description.length > 0
  const invalid = Object.keys(errors).length > 0

  function submit() {
    setSubmitted(true)
    if (invalid) return
    onCreate({
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || null,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setKey('')
          setName('')
          setDescription('')
          setSubmitted(false)
        }
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="New model"
          description="Starts as a draft v1. Add its fields, then publish it; nothing uses a model until it is published."
        />
        <DialogBody>
          <form
            id="new-model-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field
              label="Key"
              required
              hint="Lower-case letters, digits and _, e.g. cell_bank_reading."
              error={showKey ? errors.key : undefined}
            >
              <Input
                autoFocus
                className="mono"
                value={key}
                aria-invalid={showKey && errors.key ? true : undefined}
                placeholder="cell_bank_reading"
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Field
              label="Name"
              required
              error={showName ? errors.name : undefined}
            >
              <Input
                value={name}
                placeholder="e.g. Cell bank reading"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Description"
              hint="Optional"
              error={showDescription ? errors.description : undefined}
            >
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-model-form"
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
