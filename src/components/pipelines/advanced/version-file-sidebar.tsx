import { useMemo } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Inspector } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { BoardButton } from '#/features/pipelines/board/board'
import '#/features/pipelines/board/version-file.css'
import { useWorkspaceMemberNames } from '#/components/pipelines/pipelines-data'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { applyFix } from '#/lib/pipelines/version-file'
import type { FileBlock } from '#/lib/pipelines/version-file-facts'
import { readFileFacts } from '#/lib/pipelines/version-file-facts'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('features.pipelineVersionFile.sidebar.copied'))
  } catch {
    toast.error(t('features.pipelineVersionFile.sidebar.copyFailed'))
  }
}

const span = (block: FileBlock) =>
  block.from === block.to
    ? t('features.pipelineVersionFile.sidebar.line', { line: block.from })
    : t('features.pipelineVersionFile.sidebar.lines', {
        from: block.from,
        to: block.to,
      })

/** The board's `.pls-cn` row: an icon, what it is, and where it is. */
function Row({
  icon,
  children,
  where,
}: {
  icon: 'download' | 'edit' | 'copy' | 'warn'
  children: React.ReactNode
  where?: React.ReactNode
}) {
  return (
    <li>
      <Icon name={icon} size={12} />
      <span>{children}</span>
      <span className="p">{where}</span>
    </li>
  )
}

/**
 * Beside the version file, as the board draws it: the problems in one list,
 * what only the file holds, where starts and secrets are written, and how to
 * push the file from git or the command line.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- five sections of the version file's own facts read from one editor.
function SidebarSections() {
  const editor = usePipelineEditor()
  const { fileCheck, definition, fileText, setFileText, draft } = editor
  const members = useWorkspaceMemberNames()
  const problems = fileCheck?.problems ?? []
  const facts = useMemo(() => readFileFacts(fileText), [fileText])
  const pipeline = definition.data?.display_id ?? definition.data?.key ?? ''
  const file = `${definition.data?.key ?? 'pipeline'}.yaml`
  const command = `sheetbase push ${pipeline} ${file}`

  // The draft's last push, as the board says it.
  const lastPush = draft?.pushed_at
    ? t(
        draft.push_commit
          ? draft.pushed_by_user_id && members.data?.[draft.pushed_by_user_id]
            ? 'features.pipelineVersionFile.sidebar.lastPushCommit'
            : 'features.pipelineVersionFile.sidebar.lastPushNobodyCommit'
          : draft.pushed_by_user_id && members.data?.[draft.pushed_by_user_id]
            ? 'features.pipelineVersionFile.sidebar.lastPush'
            : 'features.pipelineVersionFile.sidebar.lastPushNobody',
        {
          who: draft.pushed_by_user_id
            ? (members.data?.[draft.pushed_by_user_id] ?? '')
            : '',
          when: formatNotebookDateTime(draft.pushed_at, { zone: true }),
          commit: draft.push_commit?.slice(0, 7) ?? '',
        },
      )
    : null

  const only = [
    facts.outputs && facts.outputs.count > 1 ? (
      <Row key="o" icon="download" where={span(facts.outputs)}>
        {t('features.pipelineVersionFile.sidebar.outputs', {
          count: facts.outputs.count,
        })}
      </Row>
    ) : null,
    facts.parameters ? (
      <Row key="p" icon="edit" where={span(facts.parameters)}>
        {t('features.pipelineVersionFile.sidebar.parameters', {
          count: facts.parameters.count,
        })}
      </Row>
    ) : null,
    facts.include ? (
      <Row key="i" icon="copy" where={span(facts.include)}>
        {t('features.pipelineVersionFile.sidebar.include', {
          names: facts.include.names.join(', '),
        })}
      </Row>
    ) : null,
  ].filter(Boolean)

  return (
    <>
      <div>
        <div className="pls-hrow">
          <b className="pls-h3">
            {t('features.pipelineVersionFile.sidebar.problems')}
          </b>
          <span className="pls-st">
            <i className={`pls-dot ${problems.length ? 'bad' : 'ok'}`} />
            {problems.length
              ? t('features.pipelineVersionFile.sidebar.errors', {
                  count: problems.length,
                })
              : t('features.pipelineVersionFile.sidebar.noProblems')}
          </span>
        </div>
        {problems.length ? (
          <>
            <ul className="pls-cn pls-first">
              {problems.map((problem) => (
                <li key={`${problem.line}:${problem.column}`}>
                  <Icon name="warn" size={12} />
                  <button
                    type="button"
                    className="pls-jump"
                    onClick={() =>
                      editor.fileJump.current?.(problem.line, problem.column)
                    }
                  >
                    {t('features.pipelineVersionFile.sidebar.problemRow', {
                      line: problem.line,
                      message: problem.message,
                    })}
                  </button>
                  {problem.fix ? (
                    <button
                      type="button"
                      className="pls-fix"
                      onClick={() =>
                        problem.fix &&
                        setFileText(applyFix(fileText, problem.fix))
                      }
                    >
                      {problem.fix.label}
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
            <p className="sd pls-first">
              {t('features.pipelineVersionFile.sidebar.problemsNote')}
            </p>
          </>
        ) : null}
      </div>

      <div className="pls-about">
        <p className="pls-kick">
          {t('features.pipelineVersionFile.sidebar.about')}
        </p>

        <div>
          <h4 className="pls-h4">
            {t('features.pipelineVersionFile.sidebar.onlyInFile')}
          </h4>
          {only.length ? (
            <ul className="pls-cn">{only}</ul>
          ) : (
            <p className="sd m-0">
              {t('features.pipelineVersionFile.sidebar.onlyNone')}
            </p>
          )}
        </div>

        <div>
          <h4 className="pls-h4">
            {t('features.pipelineVersionFile.sidebar.starts')}
          </h4>
          <p className="sd m-0">
            {facts.starts
              ? t('features.pipelineVersionFile.sidebar.startsHere', {
                  lines: span(facts.starts),
                })
              : t('features.pipelineVersionFile.sidebar.startsNone')}
          </p>
        </div>

        <div>
          <h4 className="pls-h4">
            {t('features.pipelineVersionFile.sidebar.secrets')}
          </h4>
          <p className="sd m-0">
            {facts.secrets.length
              ? t('features.pipelineVersionFile.sidebar.secretsNames', {
                  name: facts.secrets[0],
                })
              : t('features.pipelineVersionFile.sidebar.secretsNone')}
          </p>
        </div>

        <div>
          <h4 className="pls-h4">
            {t('features.pipelineVersionFile.sidebar.push')}
          </h4>
          <div className="pls-code">
            <span>{command}</span>
            <BoardButton
              variant="quiet"
              size="sm"
              iconOnly
              icon="copy"
              aria-label={t('features.pipelineVersionFile.sidebar.copyCommand')}
              onClick={() => void copy(command)}
            />
          </div>
          <p className="sd pls-first">
            {lastPush ? `${lastPush} ` : ''}
            {t('features.pipelineVersionFile.sidebar.pushNote')}
          </p>
        </div>

        <p className="sd pls-never">
          <Icon name="lock" size={12} />
          <span>{t('features.pipelineVersionFile.sidebar.neverSteps')}</span>
        </p>
      </div>
    </>
  )
}

/** Beside the file on a wide screen. */
export function VersionFileSidebar() {
  return (
    <Inspector
      label={t('features.pipelineVersionFile.sidebar.aria')}
      width={290}
      open={false}
      className="pb-scope pls-side"
    >
      <SidebarSections />
    </Inspector>
  )
}

/** Under the file below a wide screen, so nothing sits behind a button. */
export function VersionFileStacked() {
  return (
    <div
      aria-label={t('features.pipelineVersionFile.sidebar.aria')}
      role="region"
      className="pb-scope pls-side pls-stacked"
    >
      <SidebarSections />
    </div>
  )
}
