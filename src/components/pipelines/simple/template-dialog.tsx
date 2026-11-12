import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { createPipelineDefinition } from '#/lib/pipelines/data'
import { BLANK_TEMPLATE, PIPELINE_TEMPLATES } from '#/lib/pipelines/templates'
import type { PipelineTemplate } from '#/lib/pipelines/templates'

const tp = words('templates')
const KEY = /^[a-z][a-z0-9_]{0,59}$/

const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 60)

/**
 * Start a new Simple pipeline from a template, or from nothing. It makes the
 * pipeline and opens its recipe with the template's lines in place; nothing is
 * saved as a version until the choices that depend on the lab are made.
 */
export function TemplateDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<PipelineTemplate | null>(null)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const keyTouched = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (template: PipelineTemplate) =>
      createPipelineDefinition(notebookDataClient, {
        workspaceId,
        key: key.trim(),
        name: name.trim(),
        description: null,
      }).then((definition) => ({ definition, template })),
    onSuccess: ({ definition, template }) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })
      setOpen(false)
      void navigate({
        to: '/pipelines/$pipelineId/steps',
        params: { pipelineId: definition.id },
        // SAFETY: the steps route reads `template` from its search; the route has not declared it.
        search: { template: template.id } as never,
      })
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : ''

      setError(
        /duplicate key/i.test(message)
          ? t('features.pipelineSimple.duplicate.keyTaken')
          : message || tp('failed'),
      )
      toast.error(tp('failed'))
    },
  })

  const pick = (template: PipelineTemplate) => {
    setChosen(template)
    setName(template.pipelineName)
    setKey(keyFrom(template.pipelineName))
    keyTouched.current = false
    setError(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (!next) setChosen(null)
      }}
    >
      <DialogTrigger render={<Button icon="template" />}>
        {tp('action')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader title={tp('title')} description={tp('description')} />
        <DialogBody className="flex flex-col gap-2">
          {chosen ? (
            <div className="flex flex-col gap-3">
              <Field label={tp('name')}>
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)

                    if (!keyTouched.current) setKey(keyFrom(event.target.value))
                  }}
                />
              </Field>
              <Field label={tp('key')} error={error ?? undefined}>
                <Input
                  value={key}
                  onChange={(event) => {
                    keyTouched.current = true
                    setKey(event.target.value)
                    setError(null)
                  }}
                />
              </Field>
            </div>
          ) : (
            [...PIPELINE_TEMPLATES, BLANK_TEMPLATE].map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => pick(template)}
                className="grid w-full cursor-pointer grid-cols-[24px_1fr] items-start gap-2 rounded-md border-0 bg-transparent p-2 text-left font-sans text-fg hover:bg-surface-hover"
              >
                <span className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-surface text-fg-muted">
                  <Icon
                    name={template.id === 'blank' ? 'plus' : 'template'}
                    size={14}
                  />
                </span>
                <span>
                  <b className="block text-body font-medium leading-[18px]">
                    {template.id === 'blank' ? tp('scratch') : template.title}
                  </b>
                  <span className="mt-px block text-label text-fg-muted">
                    {template.id === 'blank'
                      ? tp('scratchText')
                      : template.summary}
                  </span>
                </span>
              </button>
            ))
          )}
        </DialogBody>
        {chosen ? (
          <DialogFooter>
            <Button onClick={() => setChosen(null)}>
              {t('common.actions.back')}
            </Button>
            <Button
              variant="primary"
              disabled={
                create.isPending || !name.trim() || !KEY.test(key.trim())
              }
              onClick={() => create.mutate(chosen)}
            >
              {create.isPending ? tp('creating') : tp('create')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
