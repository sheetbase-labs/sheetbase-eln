import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Inspector } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { BoardButton, BoardStatus } from '#/features/pipelines/board/board'
import '#/features/pipelines/board/version-file.css'
import {
  destinationName,
  useNotificationDestinations,
} from '#/components/pipelines/step-list/step-bodies'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { MAX_EXECUTION_SECONDS } from '#/lib/pipelines/statement'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('features.pipelineVersionFile.sidebar.copied'))
  } catch {
    toast.error(t('features.pipelineVersionFile.sidebar.copyFailed'))
  }
}

/** A line of mono text with a Copy button, the board's `.secret`. */
function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="secret">
      <code>{text}</code>
      <BoardButton
        variant="quiet"
        size="sm"
        iconOnly
        icon="copy"
        aria-label={label}
        onClick={() => void copy(text)}
      />
    </div>
  )
}

/**
 * Beside the version file: the outline to jump by, the Python environment the
 * file's code runs in, the outside things it names, and how to push it from git.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- four sections of the version file's own facts read from one editor.
export function VersionFileSidebar() {
  const editor = usePipelineEditor()
  const { fileCheck, runtime, definition, config } = editor
  const destinations = useNotificationDestinations()
  const outline = fileCheck?.outline ?? []
  const problems = fileCheck?.problems ?? []
  const pipeline = definition.data?.display_id ?? definition.data?.key ?? ''

  const pin = runtime.data?.available
    ? runtime.data.runtime
    : config?.pythonRuntime

  const packages = Object.entries(runtime.data?.packages ?? {})

  const names = new Map(
    (destinations.data ?? []).map((d) => [d.id, destinationName(d)]),
  )

  const notified = (config?.steps ?? []).flatMap((step) => {
    if (step.kind !== 'notify') return []

    const at = outline.find(
      (item) => item.depth === 1 && item.label === step.name,
    )

    return [
      {
        id: step.notify.subscriptionId,
        name:
          names.get(step.notify.subscriptionId) ?? step.notify.subscriptionId,
        line: at?.line,
      },
    ]
  })

  return (
    <Inspector
      label={t('features.pipelineVersionFile.sidebar.aria')}
      width={300}
      className="pb-scope gap-5"
    >
      <section>
        <h3>{t('features.pipelineVersionFile.sidebar.outline')}</h3>
        <nav
          className="ol"
          aria-label={t('features.pipelineVersionFile.sidebar.jump')}
        >
          {outline.map((item) => {
            const bad = problems.some(
              (p) => p.line >= item.line && p.line <= item.endLine,
            )

            return (
              <button
                key={`${item.line}:${item.label}`}
                type="button"
                className={item.depth ? `sub${bad ? ' bad' : ''}` : undefined}
                onClick={() => editor.fileJump.current?.(item.line)}
              >
                <span>
                  {item.label}
                  {item.kind ? <span className="k">{item.kind}</span> : null}
                  {!item.depth && item.count !== undefined
                    ? ` · ${item.count}`
                    : ''}
                </span>
                <span className="n">{item.line}</span>
              </button>
            )
          })}
        </nav>
        <div
          className="muted"
          style={{ fontSize: 11, lineHeight: '16px', marginTop: 6 }}
        >
          {t('features.pipelineVersionFile.sidebar.startsNote')}
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <h3 style={{ margin: 0, flexGrow: 1 }}>
            {t('features.pipelineVersionFile.sidebar.environment')}
          </h3>
          {pin ? (
            <BoardStatus tone="ok">
              {t('features.pipelineVersionFile.sidebar.pinned')}
            </BoardStatus>
          ) : null}
        </div>
        {pin ? (
          <CopyLine
            text={pin}
            label={t('features.pipelineVersionFile.sidebar.copyDigest')}
          />
        ) : (
          <div className="muted" style={{ fontSize: 12, lineHeight: '17px' }}>
            {runtime.data?.message ??
              t('features.pipelineVersionFile.sidebar.noRuntime')}
          </div>
        )}
        <div
          className="muted"
          style={{ fontSize: 12, lineHeight: '17px', marginTop: 6 }}
        >
          {packages.length
            ? `${packages.map(([name, version]) => `${name} ${version}`).join(' · ')}. `
            : ''}
          {t('features.pipelineVersionFile.sidebar.limits', {
            seconds: MAX_EXECUTION_SECONDS,
          })}
        </div>
      </section>

      <section>
        <h3>{t('features.pipelineVersionFile.sidebar.connections')}</h3>
        {notified.length ? (
          notified.map((n) => (
            <div className="env-row" key={`${n.id}:${n.line}`}>
              <Icon name="comment" size={13} />
              <span>{n.name}</span>
              <span className="w">
                {n.line
                  ? t('features.pipelineVersionFile.sidebar.lineN', {
                      line: n.line,
                    })
                  : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 12, lineHeight: '17px' }}>
            {t('features.pipelineVersionFile.sidebar.noConnections')}
          </div>
        )}
        <div
          className="muted"
          style={{ fontSize: 12, marginTop: 6, lineHeight: '17px' }}
        >
          {t('features.pipelineVersionFile.sidebar.secretsNote')}
        </div>
      </section>

      <section>
        <h3>{t('features.pipelineVersionFile.sidebar.push')}</h3>
        <CopyLine
          text={`sheetbase push ${pipeline} ${definition.data?.key ?? 'pipeline'}.yaml`}
          label={t('features.pipelineVersionFile.sidebar.copyCommand')}
        />
        <div
          className="muted"
          style={{ fontSize: 12, marginTop: 6, lineHeight: '17px' }}
        >
          {t('features.pipelineVersionFile.sidebar.pushNote')}
        </div>
      </section>

      <section
        className="muted"
        style={{ fontSize: 12, lineHeight: '17px', display: 'flex', gap: 6 }}
      >
        <Icon name="lock" size={12} />
        <span>{t('features.pipelineVersionFile.sidebar.neverSteps')}</span>
      </section>
    </Inspector>
  )
}
