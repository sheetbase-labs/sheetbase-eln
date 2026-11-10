import { rich, t } from '#/copy'
import type { CredentialPanelCopy } from './settings-credentials'

/** Personal API tokens: the signed-in member's own credentials. */
export const personalTokensCopy: CredentialPanelCopy = {
  title: t('settings.credentials.personalTokens'),
  intro: (
    <>
      {rich('settings.credentials.personalIntro', {
        endpoint: <code>{t('settings.credentials.postApiToken')}</code>,
      })}
    </>
  ),
  revealNotice: (name) => t('settings.credentials.copyTokenNow', { name }),
  secret: {
    copyLabel: t('settings.credentials.copyToken'),
    copiedMessage: t('settings.credentials.tokenCopied'),
    failedMessage: t('settings.credentials.couldnCopyToken'),
  },
  create: {
    open: t('settings.credentials.newPersonalToken'),
    title: t('settings.credentials.createPersonalToken'),
    namePlaceholder: t('settings.credentials.localJupyter'),
    submit: t('settings.credentials.createToken'),
  },
  tableLabel: t('settings.credentials.personalTokens'),
  emptyTitle: t('settings.credentials.personalTokensYetEmpty'),
  emptyLabel: t('settings.credentials.createTokenNotebook'),
  confirm: {
    rotate: {
      title: (name) => t('settings.credentials.rotate2', { name }),
      description: t('settings.credentials.currentSecretStopsDescription'),
      action: t('settings.credentials.rotateToken'),
    },
    revoke: {
      title: (name) => t('settings.credentials.revoke2', { name }),
      description: t('settings.credentials.immediatePermanentEveryDescription'),
      action: t('settings.credentials.revokeToken'),
    },
  },
}

/** Workspace service credentials: owner-gated, shared by every integration. */
export const serviceCredentialsCopy: CredentialPanelCopy = {
  title: t('settings.credentials.workspaceServiceCredentials'),
  intro: <>{t('settings.credentials.authenticatesMachineIntegration')}</>,
  revealNotice: (name) => t('settings.credentials.copyCredentialNow', { name }),
  secret: {
    copyLabel: t('settings.credentials.copyCredential'),
    copiedMessage: t('settings.credentials.credentialCopied'),
    failedMessage: t('settings.credentials.couldnCopyCredential'),
  },
  create: {
    open: t('settings.credentials.newServiceCredential'),
    title: t('settings.credentials.createServiceCredential'),
    namePlaceholder: t('settings.credentials.nightlyImport'),
    submit: t('settings.credentials.createCredential'),
  },
  tableLabel: t('settings.credentials.workspaceServiceCredentials'),
  emptyTitle: t('settings.credentials.serviceCredentialsYetEmpty'),
  emptyLabel: t('settings.credentials.createOneCredential'),
  confirm: {
    rotate: {
      title: (name) => t('settings.credentials.rotate2', { name }),
      description: t('settings.credentials.credentialSharedCurrentDescription'),
      action: t('settings.credentials.rotateCredential'),
    },
    revoke: {
      title: (name) => t('settings.credentials.revoke2', { name }),
      description: t('settings.credentials.credentialSharedEveryDescription'),
      action: t('settings.credentials.revokeCredential'),
    },
  },
}
