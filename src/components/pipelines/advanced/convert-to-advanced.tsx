import { t } from '#/copy'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'

function Item({
  icon,
  children,
}: {
  icon: IconName
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2 text-body">
      <span className="mt-0.5 text-fg-muted">
        <Icon name={icon} size={13} />
      </span>
      <span>{children}</span>
    </li>
  )
}

/** Convert to Advanced…: what changes, what happens to versions, and that it goes one way. */
export function ConvertToAdvancedDialog({ onClose }: { onClose: () => void }) {
  const editor = usePipelineEditor()
  const { definition, draft, config } = editor

  const current =
    editor.current?.lifecycle === 'published' ? editor.current : undefined

  const next = draft?.version ?? (current ? current.version + 1 : 1)
  const sourceMode = config?.mode ?? 'standard'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('features.pipelineVersionFile.convert.title')}
          description={`${definition.data?.display_id ?? ''} ${definition.data?.name ?? ''}`.trim()}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="m-0 mb-2 font-sans text-label font-semibold">
                {t('features.pipelineVersionFile.convert.changes')}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                <Item icon="code">
                  {t('features.pipelineVersionFile.convert.edit')}
                </Item>
                <Item icon="pipeline">
                  {t('features.pipelineVersionFile.convert.keeps', {
                    mode: t(`data.pipelineHeader.mode.${sourceMode}`),
                  })}
                </Item>
                <Item icon="lock">
                  <b className="font-semibold">
                    {t('features.pipelineVersionFile.convert.oneWay')}
                  </b>{' '}
                  {t('features.pipelineVersionFile.convert.stays')}
                </Item>
              </ul>
            </div>
            <div>
              <h3 className="m-0 mb-2 font-sans text-label font-semibold">
                {t('features.pipelineVersionFile.convert.versions')}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                <Item icon="plus">
                  {t('features.pipelineVersionFile.convert.creates', {
                    version: next,
                  })}
                </Item>
                {current ? (
                  <Item icon="play">
                    {t('features.pipelineVersionFile.convert.keepsRunning', {
                      current: current.version,
                      next,
                    })}
                  </Item>
                ) : null}
                <Item icon="clock">
                  {t('features.pipelineVersionFile.convert.earlier')}
                </Item>
              </ul>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={editor.convertToAdvanced.isPending || !editor.canSave}
            onClick={() =>
              editor.convertToAdvanced.mutate(undefined, { onSuccess: onClose })
            }
          >
            {t('features.pipelineVersionFile.convert.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
