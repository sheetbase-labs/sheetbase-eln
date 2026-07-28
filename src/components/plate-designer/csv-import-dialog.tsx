import { useState } from 'react'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '#/components/ui'
import { parseCsv, previewCsvImport } from '#/lib/plate-designer'
import type { CsvImportPreview, CsvImportRow } from '#/lib/plate-designer'

export interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (rows: CsvImportRow[]) => void
  rows: number
  cols: number
}

export function CsvImportDialog(props: CsvImportDialogProps) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const update = (value: string) => {
    setText(value)
    // Parse eagerly as well as previewing so malformed/empty input is normalized.
    parseCsv(value)
    setPreview(
      value.trim() ? previewCsvImport(value, props.rows, props.cols) : null,
    )
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import plate CSV</DialogTitle>
          <DialogDescription>
            Upload or paste CSV data, then review detected columns and
            validation.
          </DialogDescription>
        </DialogHeader>
        <Label>
          CSV file
          <Input
            className="mt-1"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void file.text().then(update)
            }}
          />
        </Label>
        <Label>
          Paste CSV
          <Textarea
            className="mt-1 min-h-28 font-mono text-xs"
            value={text}
            onChange={(e) => update(e.target.value)}
            placeholder="well,role,sample,replicate,volume,unit"
          />
        </Label>
        {preview && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium">
                Detected column mapping
              </p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(preview.mapping).map(([field, column]) => (
                  <Badge key={field} variant={column ? 'info' : 'outline'}>
                    {field}: {column || 'not detected'}
                  </Badge>
                ))}
              </div>
            </div>
            {preview.errors.length > 0 && (
              <ul
                role="alert"
                className="space-y-1 rounded border border-danger/30 bg-danger/5 p-3 text-xs text-danger"
              >
                {preview.errors.map((error, index) => (
                  <li key={`${error.code}-${index}`}>{error.message}</li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {[
                      'Well',
                      'Role',
                      'Sample',
                      'Replicate',
                      'Volume',
                      'Concentration',
                      'Notes',
                    ].map((heading) => (
                      <th key={heading} className="border-b p-2">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, index) => (
                    <tr key={`${row.wellCode}-${index}`}>
                      <td className="p-2 font-mono">{row.wellCode}</td>
                      <td className="p-2">{row.role}</td>
                      <td className="p-2">{row.sampleIdentifier}</td>
                      <td className="p-2">{row.replicate}</td>
                      <td className="p-2">
                        {row.volumeValue} {row.volumeUnit}
                      </td>
                      <td className="p-2">
                        {row.concentrationValue} {row.concentrationUnit}
                      </td>
                      <td className="p-2">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!preview?.rows.length || Boolean(preview.errors.length)}
            onClick={() => {
              if (preview) props.onImport(preview.rows)
              props.onOpenChange(false)
            }}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
