# Workspace roles and capabilities (GOV-01)

PostgreSQL `api.has_capability` is authoritative. The TypeScript mirror in
`src/lib/capability.ts` is for UI gating only.

## Viewer is read-only

Workspace role `viewer` cannot:

- `record.create`
- `record.link`
- `instance.upgrade`
- `schema.edit` / `schema.publish` / `schema.retire`
- `workspace.admin`

Existing `viewer` memberships are **not** rewritten to another role. They stay
`viewer` and lose mutate capabilities after migrations `0111_gov_01_viewer_readonly`
and `0112_gov_01_viewer_write_enforcement`.

Write RLS on records, blocks, Datasets and related tables requires
`record.create` (or `record.link` for `record_links`). Data-plane RPCs that
previously authorised any workspace member now call `has_capability(...,
'record.create')`. SELECT policies still use membership, so viewers can inspect.
Owner-gated administration and `api_client` policies are unchanged.

Project access level `viewer` (per-project ACL) is a separate concept from the
workspace role.

## Unused labels that remain member-class

These invitation labels exist and currently share **Member** data capabilities
(create/link/upgrade). They do **not** receive schema publish or workspace admin:

| Role | Meaning today |
| --- | --- |
| `scientist` | Member-class scientific work |
| `analyst` | Member-class scientific work |
| `reviewer` | Member-class scientific work. Review assignment on a revision is independent of this workspace role. |

Do not treat these labels as a custom RBAC language. Splitting them into distinct
capability sets is later GOV work if product requires it.

## Steward vs admin

`schema.edit` and `schema.publish` are both granted to owner, admin and steward.
The database still uses separate capability names (trigger split). That is not a
two-person control.

## External API

External credentials (`api_client`) do not use workspace `viewer`. Their allowlist
is independent (`docs/external-api.md`). Session `viewer` users talking to
`/api/db` with a cookie are bound by `has_capability` like any other member.
