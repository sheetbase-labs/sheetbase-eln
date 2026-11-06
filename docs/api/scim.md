# SCIM 2.0 directory sync

An identity provider uses this endpoint to add, update and switch off people
and to push groups. Set it up from Settings > Members and roles > Directory
sync; the full walk-through, including what each change does to access, is in
[`authentication.md`](../operations/authentication.md#directory-sync-scim-20).

- **Base URL:** `<BETTER_AUTH_URL>/api/scim/v2`
- **Authentication:** `Authorization: Bearer sbscim_…`. A token belongs to one
  workspace, is made by a member who manages members, and is shown once.
  Failed attempts are rate limited; a token may make 600 calls a minute.
- **Content type:** `application/scim+json` .

## Resources

| Path                                                   | Methods                         | Notes                                                                                                   |
| ------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | `GET`                           | Say what is supported. No bulk, sort or ETag.                                                           |
| `/Users`                                               | `GET`, `POST`                   | List with `filter=userName eq "…"` (or `externalId eq`), `startIndex` and `count`.                      |
| `/Users/{id}`                                          | `GET`, `PUT`, `PATCH`, `DELETE` | `active: false` and `DELETE` suspend; `active: true` restores. Never changes owners or client accounts. |
| `/Groups`                                              | `GET`, `POST`                   | Filter with `displayName eq "…"`.                                                                       |
| `/Groups/{id}`                                         | `GET`, `PUT`, `PATCH`, `DELETE` | A group gives a role when its name matches a sign-in group.                                             |

A filter the endpoint cannot read is refused with `invalidFilter` rather than
answered with everyone. Errors use the SCIM error schema with the usual
`scimType`. A duplicate user name is `409` (`uniqueness`).

## Events

Each change is a webhook event: `member.provisioned`, `member.directory_updated`,
`member.reactivated`, `member.deprovisioned`, `workspace.scim_group.created`,
`.updated` and `.deleted`, and `workspace.scim_token.created` and `.revoked`.
See [`event-catalogue.md`](event-catalogue.md#directory-sync-stable-webhook-and-sse).

## Reading from the Sheetbase API

Personal tokens with `people:read` can read `scim_tokens` (label, dates; never
the secret), `scim_groups`, `scim_group_members` and call
`directory_sync_status`; `revoke_scim_token` needs `people:write`.
