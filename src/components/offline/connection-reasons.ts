import { t } from '#/copy'

/** The reasons surfaced for actions that cannot run offline. */
export const CONNECTION_REQUIRED_REASONS = {
  submit: t('notebook.connectionRequired.submit'),
  sign: t('notebook.connectionRequired.sign'),
  share: t('notebook.connectionRequired.share'),
  import: t('notebook.connectionRequired.import'),
  rerun: t('notebook.connectionRequired.rerun'),
  search: t('notebook.connectionRequired.search'),
}

export type ConnectionRequiredAction = keyof typeof CONNECTION_REQUIRED_REASONS
