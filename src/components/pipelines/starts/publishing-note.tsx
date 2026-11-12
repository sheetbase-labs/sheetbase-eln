import { Link } from '@tanstack/react-router'

import { t } from '#/copy'

/** Whether a publish request is waiting, and where the people who decide it
 * will find it. Start rules save straight away; a new version needs approval. */
export function PublishingNote({
  pipelineId,
  waiting,
}: {
  pipelineId: string
  waiting: boolean
}) {
  return (
    <section>
      <h3>{t('features.pipelineStarts.aside.publishing')}</h3>
      <div className="note" style={{ marginTop: 0 }}>
        {waiting
          ? t('features.pipelineStarts.aside.publishingWaiting')
          : t('features.pipelineStarts.aside.publishingBody')}
      </div>
      <div style={{ marginTop: 8 }}>
        <Link
          className="btn btn-s"
          to="/pipelines/$pipelineId/activity"
          params={{ pipelineId }}
        >
          {t('features.pipelineStarts.aside.openActivity')}
        </Link>
      </div>
    </section>
  )
}
