import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '#/components/ui'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { modelFieldValuesFromInput } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'

export function CreateReagentDialog({
  open,
  onOpenChange,
  projects,
  projectsLoading,
  loadError = null,
  onRetry,
  pending,
  error,
  modelFields,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; key: string; title: string }[]
  projectsLoading: boolean
  loadError?: string | null
  onRetry?: () => void
  pending: boolean
  error: string | null
  modelFields: ModelFieldDefinition[]
  onCreate: (input: {
    projectId: string
    title: string
    category: string
    properties: {
      supplier: string
      catalogNo: string
      lot: string
      expiry: string
      quantity: string
      unit: string
      storage: string
    }
    customFields: Record<string, unknown>
  }) => void
}) {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [supplier, setSupplier] = useState('')
  const [catalogNo, setCatalogNo] = useState('')
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [storage, setStorage] = useState('')
  const [customFields, setCustomFields] = useState<
    Record<string, string | boolean>
  >({})

  const [validationError, setValidationError] = useState<string | null>(null)
  const selectedProjectId =
    projectId || (projects.length === 1 ? projects[0].id : '')
  const parsedQuantity = Number(quantity)
  const quantityError =
    quantity !== '' && (!Number.isFinite(parsedQuantity) || parsedQuantity < 0)
      ? 'Enter a quantity of zero or more.'
      : quantity !== '' && !unit.trim()
        ? 'Add a unit for this quantity, such as mL, g or units.'
        : null

  function submit() {
    if (
      pending ||
      projectsLoading ||
      loadError ||
      !selectedProjectId ||
      !title.trim() ||
      quantityError
    )
      return
    setValidationError(null)
    let values: Record<string, unknown>
    try {
      values = modelFieldValuesFromInput(modelFields, customFields, true)
    } catch (cause) {
      setValidationError(
        cause instanceof Error
          ? cause.message
          : 'Check the reagent details and try again.',
      )
      return
    }
    onCreate({
      projectId: selectedProjectId,
      title: title.trim(),
      category: category.trim(),
      properties: {
        supplier,
        catalogNo,
        lot,
        expiry,
        quantity,
        unit,
        storage,
      },
      customFields: values,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>New reagent</DialogTitle>
            <DialogDescription>
              Add a reagent to your inventory. Include its lot and expiry so
              your team can choose the right stock.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label className="text-xs text-muted-foreground">
              Project (required)
              <Select
                className="mt-1 h-9"
                aria-label="Project"
                required
                disabled={projectsLoading || pending}
                value={selectedProjectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">
                  {projectsLoading ? 'Loading…' : 'Select a project'}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </Select>
            </Label>
            <Label className="text-xs text-muted-foreground">
              Name (required)
              <Input
                className="mt-1 h-9"
                aria-label="Reagent name"
                autoFocus
                required
                placeholder="e.g. Phosphate-buffered saline"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Category
              <Input
                className="mt-1 h-9"
                aria-label="Category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="solvent"
              />
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Label className="text-xs text-muted-foreground">
                Supplier
                <Input
                  className="mt-1 h-9"
                  aria-label="Supplier"
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Catalogue number
                <Input
                  className="mt-1 h-9"
                  aria-label="Catalogue number"
                  value={catalogNo}
                  onChange={(event) => setCatalogNo(event.target.value)}
                />
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Label className="text-xs text-muted-foreground">
                Lot
                <Input
                  className="mt-1 h-9"
                  aria-label="Lot"
                  value={lot}
                  onChange={(event) => setLot(event.target.value)}
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Expiry
                <Input
                  className="mt-1 h-9"
                  type="date"
                  aria-label="Expiry"
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Label className="text-xs text-muted-foreground">
                Initial quantity
                <Input
                  className="mt-1 h-9"
                  type="number"
                  aria-label="Initial quantity"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  aria-describedby={
                    quantityError ? 'reagent-stock-error' : undefined
                  }
                  aria-invalid={quantityError ? true : undefined}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Unit
                <Input
                  className="mt-1 h-9"
                  aria-label="Unit"
                  placeholder="mL, g, units"
                  required={quantity !== ''}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </Label>
              <Label className="text-xs text-muted-foreground">
                Storage
                <Input
                  className="mt-1 h-9"
                  aria-label="Storage"
                  placeholder="e.g. 4°C"
                  value={storage}
                  onChange={(event) => setStorage(event.target.value)}
                />
              </Label>
            </div>
            {quantityError ? (
              <p id="reagent-stock-error" className="text-xs text-destructive">
                {quantityError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Leave quantity blank if stock has not been measured.
            </p>
            {!projectsLoading && !loadError && projects.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                Create a project before adding reagents.
              </p>
            ) : null}
            {modelFields.length > 0 ? (
              <div className="grid gap-3 border-t pt-3">
                <p className="text-xs font-medium">Workspace fields</p>
                {modelFields.map((definition) => (
                  <ModelFieldInput
                    key={definition.id}
                    definition={definition}
                    value={
                      customFields[definition.fieldName] ??
                      (typeof definition.defaultValue === 'boolean'
                        ? definition.defaultValue
                        : definition.defaultValue == null
                          ? ''
                          : String(definition.defaultValue))
                    }
                    onChange={(value) =>
                      setCustomFields((current) => ({
                        ...current,
                        [definition.fieldName]: value,
                      }))
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
          {loadError ? (
            <div role="alert" className="text-sm text-destructive">
              {loadError}
              {onRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="ml-2"
                >
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          {error || validationError ? (
            <p role="alert" className="text-xs text-destructive">
              {error || validationError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                projectsLoading ||
                !!loadError ||
                !selectedProjectId ||
                !title.trim() ||
                !!quantityError
              }
            >
              {pending ? 'Creating…' : 'Create reagent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
