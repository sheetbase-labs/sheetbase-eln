/**
 * Modal Dataset selector: the full catalogue grid (search, filters,
 * grouping, column selector) inside a Dialog, so choosing a Dataset scales
 * past what a popover or native select can carry.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui'
import { DatasetsListGrid } from '#/components/datasets/dataset-list-grid'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'

export interface DatasetPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  datasets: CanonicalDatasetWire[]
  loading?: boolean
  error?: unknown
  selectedId?: string | null
  onSelect: (id: string) => void
}

export function DatasetPickerDialog({
  open,
  onOpenChange,
  datasets,
  loading = false,
  error = null,
  selectedId = null,
  onSelect,
}: DatasetPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(44rem,85vh)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select dataset</DialogTitle>
          <DialogDescription className="sr-only">
            Search, filter and choose a dataset.
          </DialogDescription>
        </DialogHeader>
        <DatasetsListGrid
          datasets={datasets}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={(id) => {
            onSelect(id)
            onOpenChange(false)
          }}
          emptyFallback={
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
              {loading ? 'Loading datasets…' : 'No datasets available.'}
            </div>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
