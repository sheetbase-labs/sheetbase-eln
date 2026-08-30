# Workspace roles and capabilities (GOV-01)

PostgreSQL `api.has_capability` is authoritative. The TypeScript mirror in
`src/lib/capability.ts` is for UI gating only.

## The viewer role is read-only

The workspace role `viewer` cannot use:

- `record.create`
- `record.link`
- `instance.upgrade`
- `schema.edit` / `schema.publish` / `schema.retire`
- `workspace.admin`

Existing `viewer` memberships are **not** rewritten to another role. They
stay `viewer`. They lose mutate capabilities after migrations
`0111_gov_01_viewer_readonly` and `0112_gov_01_viewer_write_enforcement`.

Write RLS on records, blocks, Datasets and related tables requires
`api.is_workspace_writer` (`record.create`), or `record.link` for
`record_links`. The `FOR ALL` membership policies are split so SELECT stays
membership-based. Storage and ops write policies that used
`storage_member_using` now use `is_workspace_writer`. Their companion SELECT
policies are unchanged.

Data-plane mutation RPCs that previously authorised any workspace member now
call `is_workspace_writer`. Migration `0112` aborts if any authenticated
write policy or authenticated mutation RPC still uses a 1-arg membership or
`storage_member_using` write gate. The inventory functions
`internal.gov01_authenticated_write_policy_violations` and
`internal.gov01_authenticated_mutation_rpc_violations` are the audit surface.
Owner-row write policies (for example analysis views keyed only by
`owner_user_id`) also require `is_workspace_writer`. A member demoted to
viewer cannot then mutate their own rows.

Owner-gated administration and `api_client` policies are unchanged.

The project access level `viewer` (per-project ACL) is a separate concept
from the workspace role.

## Unused labels stay member-class

These invitation labels exist. They currently share **Member** data
capabilities (create/link/upgrade). They do **not** receive schema publish or
workspace admin:

| Role        | Meaning today                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `scientist` | Member-class scientific work                                                                         |
| `analyst`   | Member-class scientific work                                                                         |
| `reviewer`  | Member-class scientific work. Review assignment on a revision is independent of this workspace role. |

Do not treat these labels as a custom RBAC language. Splitting them into
distinct capability sets is later GOV work if product requires it.

## Steward versus admin

`schema.edit` and `schema.publish` are both granted to owner, admin, and
steward. The database keeps separate capability names (trigger split). This
is not two-person control.

## External API

External credentials (`api_client`) do not use workspace `viewer`. Their
allowlist is independent (`docs/external-api.md`). Session `viewer` users
that talk to `/api/db` with a cookie are bound by `has_capability` like any
other member.
