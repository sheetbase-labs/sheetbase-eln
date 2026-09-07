/**
 * AUTO-03 — create a Pipeline Definition (identity only; the first version
 * is created from the definition detail page).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

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
  Textarea,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  createPipelineDefinition,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { DataClient } from '#/lib/data-client'

export function CreatePipelineDefinitionDialog({
  dataClient,
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  dataClient: DataClient
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (definitionId: string) => void
}) {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      createPipelineDefinition(dataClient, {
        workspaceId,
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: (definition) => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.definitions })
      setKey('')
      setName('')
      setDescription('')
      setError('')
      onCreated(definition.id)
    },
    onError: (cause: unknown) => {
      const message =
        cause instanceof DataClientError
          ? cause.message
          : 'Could not create the Pipeline.'
      setError(message)
    },
  })

  const canSubmit = key.trim().length > 0 && name.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Pipeline</DialogTitle>
          <DialogDescription>
            Name the work you want to automate. Next, add steps, choose an
            output and publish a version to run.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pipeline-key">Key</Label>
            <Input
              id="pipeline-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="concentration_normalization"
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Stable, immutable, lowercase identifier — unique in this
              workspace.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-name">Name</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Concentration normalization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-description">Description</Label>
            <Textarea
              id="pipeline-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Create Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
