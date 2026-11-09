/**
 * SAML 2.0 sign-in, built on Better Auth's SSO plugin (which checks the
 * response signature, the audience, the time window, replays and that the
 * response answers a request we made). This file turns the environment's SAML
 * settings into the plugin's options and decides what to do with the groups
 * the identity provider sends.
 *
 * One identity provider per installation, named `saml`, like OIDC. Providers
 * cannot be added from the app: the plugin's registration routes are closed in
 * `auth.ts`.
 */
import type { SSOOptions } from '@better-auth/sso'

import { SAML_PROVIDER_ID } from './auth-methods'
import type { SamlConfig } from './auth-methods'

const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'

/** Where the provider is told to send people back to, and our identity. */
export function samlServiceProvider(baseUrl: string, config: SamlConfig) {
  const root = baseUrl.replace(/\/+$/, '')

  return {
    entityId:
      config.spEntityId ??
      `${root}/api/auth/sso/saml2/sp/metadata?providerId=${SAML_PROVIDER_ID}`,
    acsUrl: `${root}/api/auth/sso/saml2/sp/acs/${SAML_PROVIDER_ID}`,
    metadataUrl: `${root}/api/auth/sso/saml2/sp/metadata?providerId=${SAML_PROVIDER_ID}`,
  }
}

/** The groups in an assertion's attribute, as a list of names. */
export function groupsFromAttribute(value: unknown): string[] | null {
  if (value === undefined || value === null) return null

  const list: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function samlPluginOptions(
  config: SamlConfig,
  deps: {
    baseUrl: string
    applyGroups: (userId: string, groups: string[]) => Promise<void>
  },
): SSOOptions {
  const sp = samlServiceProvider(deps.baseUrl, config)

  const mapping = {
    id: 'nameID',
    email: config.emailAttribute ?? 'email',
    name: config.nameAttribute ?? 'displayName',
    ...(config.groupsAttribute
      ? { extraFields: { groups: config.groupsAttribute } }
      : {}),
  }

  const idpMetadata = config.idpMetadata
    ? { metadata: config.idpMetadata }
    : {
        entityID: config.idpEntityId ?? '',
        cert: config.idpCert,
        singleSignOnService: [
          { Binding: REDIRECT_BINDING, Location: config.idpSsoUrl ?? '' },
        ],
      }

  return {
    defaultSSO: [
      {
        providerId: SAML_PROVIDER_ID,
        // The domains this provider speaks for; with `domainVerification`
        // below, a sign-in for an address in them may take over the existing
        // account for that address.
        domain: config.emailDomains.join(','),
        samlConfig: {
          issuer: sp.entityId,
          entryPoint: config.idpSsoUrl ?? '',
          cert: config.idpCert,
          audience: sp.entityId,
          callbackUrl: '/',
          idpInitiatedCallbackUrl: '/',
          idpMetadata,
          spMetadata: { entityID: sp.entityId },
          wantAssertionsSigned: !config.allowUnsignedAssertions,
          identifierFormat: EMAIL_FORMAT,
          mapping,
        },
      },
    ],
    // Config-defined providers count as verified for their own domains.
    domainVerification: { enabled: true },
    saml: {
      // A response must answer a request we made; unsolicited responses are
      // refused (the default), and an assertion must say when it is valid.
      enableInResponseToValidation: true,
      allowIdpInitiated: false,
      requireTimestamps: true,
      clockSkew: 2 * 60 * 1000,
      enableSingleLogout: false,
    },
    provisionUserOnEveryLogin: true,
    provisionUser: async ({ user, userInfo }) => {
      const groups = groupsFromAttribute(userInfo.groups)

      if (groups) await deps.applyGroups(user.id, groups)
    },
  }
}
