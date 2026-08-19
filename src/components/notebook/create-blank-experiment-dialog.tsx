import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

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
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { createBlankExperiment } from '#/lib/notebook-create'
import {
  notebookDataClient,
  notebookQueryKeys,
  toProject,
} from '#/lib/notebook-data'
import type { Project, ProjectWire } from '#/lib/notebook-data'

export function CreateBlankExperimentDialog({
  open,
  onOpenChange,
  projectId,
  projects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projects?: Project[]
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const listed = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: () =>
      notebookDataClient
        .list<ProjectWire>('projects', '?order=title.asc')
        .then((rows) => rows.map(toProject)),
    enabled: open && !projectId && !projects,
  })
  const projectOptions = projects ?? listed.data ?? []
  const targetProjectId = projectId ?? selectedProjectId

  const create = useMutation({
    mutationFn: (submittedTitle: string) =>
      createBlankExperiment(notebookDataClient, {
        projectId: targetProjectId,
        title: submittedTitle,
      }),
    onSuccess: (record) => {
      onOpenChange(false)
      setTitle('')
      if (!record.projectId) return
      void navigate({
        to: '/projects/$projectId/experiments/$recordId',
        params: { projectId: record.projectId, recordId: record.id },
      })
    },
  })

  const errorMessage =
    create.error instanceof DataClientError
      ? create.error.message
      : create.error instanceof Error
        ? create.error.message
        : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Create experiment</DialogTitle>
          <DialogDescription>
            Starts a blank Notebook in the chosen project. You can add Sheets
            and files in the Notebook.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!targetProjectId) return
            create.mutate(title)
          }}
        >
          {!projectId ? (
            <Label className="space-y-1">
              <span>Project</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                required
                aria-label="Project"
              >
                <option value="">Select a project</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </Label>
          ) : null}
          <Label className="space-y-1">
            <span>Title</span>
            <Input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled experiment"
              aria-label="Experiment title"
              autoFocus
            />
          </Label>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {projectId ? (
              <Button
                type="button"
                variant="secondary"
                disabled={!targetProjectId || create.isPending}
                onClick={() => create.mutate('')}
              >
                Start writing
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={!targetProjectId || create.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
