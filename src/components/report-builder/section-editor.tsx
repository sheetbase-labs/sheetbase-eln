/** OPS-007 — Dialog editor for a selected report section. */
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  Textarea,
} from '#/components/ui'
import {
  SECTION_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
} from '#/lib/report-builder'
import type { ReportSection, SectionType } from '#/lib/report-builder'

const sectionTypes: SectionType[] = [
  'text',
  'chart',
  'table',
  'file',
  'record_metadata',
  'composite',
]

export interface SectionEditorProps {
  section: ReportSection | null
  isSaving: boolean
  onClose: () => void
  onSave: (input: {
    title: string
    description: string
    sectionType: SectionType
  }) => void
}

export function SectionEditor({
  section,
  isSaving,
  onClose,
  onSave,
}: SectionEditorProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sectionType, setSectionType] = useState<SectionType>('text')

  useEffect(() => {
    if (!section) return
    setTitle(section.title)
    setDescription(section.description ?? '')
    setSectionType(section.sectionType)
  }, [section])

  return (
    <Dialog open={Boolean(section)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit section</DialogTitle>
          <DialogDescription>
            Update the section&apos;s display content and type. Sources are
            bound separately to preserve frozen evidence.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            onSave({ title: title.trim(), description, sectionType })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="report-section-title">Title</FieldLabel>
              <Input
                id="report-section-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={300}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="report-section-description">
                Description
              </FieldLabel>
              <Textarea
                id="report-section-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the purpose and contents of this section"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="report-section-type">
                Section type
              </FieldLabel>
              <Select
                id="report-section-type"
                value={sectionType}
                onChange={(event) =>
                  setSectionType(event.target.value as SectionType)
                }
              >
                {sectionTypes.map((type) => (
                  <option key={type} value={type}>
                    {SECTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="report-section-source-type">
                Source type
              </FieldLabel>
              <Select
                id="report-section-source-type"
                value={section?.sourceType ?? 'free_text'}
                disabled
              >
                {section ? (
                  <option value={section.sourceType}>
                    {SOURCE_TYPE_LABELS[section.sourceType]}
                  </option>
                ) : null}
              </Select>
              <FieldDescription>
                Bind or replace a source through the frozen-evidence workflow;
                it cannot be changed with this editor.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim()}>
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
