/**
 * OPS-005 — Study Planner create/edit task dialog.
 *
 * Equivalent form controls for timeline edits: title, type, workstream,
 * status, priority, start/end/due dates, progress, description, approval
 * requirement. The same form is used for create and edit.
 */
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Textarea,
} from '#/components/ui'
import type {
  StudyTask,
  StudyTaskInput,
  StudyTaskType,
  StudyTaskStatus,
  StudyTaskPriority,
  StudyWorkstream,
} from '#/lib/planner'
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from '#/lib/planner'

export interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workstreams: StudyWorkstream[]
  workspaceId: string
  task?: StudyTask | null
  onSubmit: (input: StudyTaskInput) => Promise<void>
  error?: string | null
}

const STATUS_VALUES: StudyTaskStatus[] = [
  'not_started',
  'in_progress',
  'review',
  'completed',
  'blocked',
]
const PRIORITY_VALUES: StudyTaskPriority[] = [
  'low',
  'medium',
  'high',
  'critical',
]

function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toISOString().slice(0, 10)
}

export function TaskDialog({
  open,
  onOpenChange,
  workstreams,
  task,
  onSubmit,
  error,
}: TaskDialogProps) {
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState<StudyTaskType>('task')
  const [workstreamId, setWorkstreamId] = useState('')
  const [status, setStatus] = useState<StudyTaskStatus>('not_started')
  const [priority, setPriority] = useState<StudyTaskPriority>('medium')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [description, setDescription] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [tags, setTags] = useState('')

  useEffect(() => {
    if (!open) return
    if (task) {
      setTitle(task.title)
      setTaskType(task.taskType)
      setWorkstreamId(task.workstreamId ?? '')
      setStatus(task.status === 'cancelled' ? 'not_started' : task.status)
      setPriority(task.priority)
      setStartsAt(toLocalDateInput(task.startsAt))
      setEndsAt(toLocalDateInput(task.endsAt))
      setDueAt(toLocalDateInput(task.dueAt))
      setProgressPercent(task.progressPercent)
      setDescription(task.description ?? '')
      setApprovalRequired(task.approvalRequired)
      setTags(task.tags.join(', '))
    } else {
      setTitle('')
      setTaskType('task')
      setWorkstreamId('')
      setStatus('not_started')
      setPriority('medium')
      setStartsAt('')
      setEndsAt('')
      setDueAt('')
      setProgressPercent(0)
      setDescription('')
      setApprovalRequired(false)
      setTags('')
    }
  }, [open, task])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const input: StudyTaskInput = {
      title,
      taskType,
      workstreamId: workstreamId || null,
      status,
      priority,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt:
        taskType === 'task' && endsAt ? new Date(endsAt).toISOString() : null,
      dueAt:
        taskType === 'milestone' && dueAt
          ? new Date(dueAt).toISOString()
          : null,
      progressPercent,
      description: description || null,
      approvalRequired,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
    await onSubmit(input)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field>
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="Task title"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <Label htmlFor="task-type">Type</Label>
              <select
                id="task-type"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as StudyTaskType)}
              >
                <option value="task">Task</option>
                <option value="milestone">Milestone</option>
              </select>
            </Field>
            <Field>
              <Label htmlFor="task-workstream">Workstream</Label>
              <select
                id="task-workstream"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={workstreamId || 'none'}
                onChange={(e) =>
                  setWorkstreamId(
                    e.target.value === 'none' ? '' : e.target.value,
                  )
                }
              >
                <option value="none">No workstream</option>
                {workstreams.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <Label htmlFor="task-status">Status</Label>
              <select
                id="task-status"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as StudyTaskStatus)}
              >
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as StudyTaskPriority)
                }
              >
                {PRIORITY_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {taskType === 'milestone' ? (
            <Field>
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                required
              />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label htmlFor="task-start">Start date</Label>
                <Input
                  id="task-start"
                  type="date"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <Label htmlFor="task-end">End date</Label>
                <Input
                  id="task-end"
                  type="date"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  required
                />
              </Field>
            </div>
          )}

          {taskType === 'task' ? (
            <Field>
              <Label htmlFor="task-progress">
                Progress: {progressPercent}%
              </Label>
              <input
                id="task-progress"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progressPercent}
                onChange={(e) => setProgressPercent(Number(e.target.value))}
                className="w-full"
              />
            </Field>
          ) : null}

          <Field>
            <Label htmlFor="task-tags">Tags (comma-separated)</Label>
            <Input
              id="task-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Phase 2, Stability"
            />
          </Field>

          <Field>
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={approvalRequired}
              onChange={(e) => setApprovalRequired(e.target.checked)}
              className="size-4 rounded border-border"
            />
            Approval required
          </label>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {task ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
