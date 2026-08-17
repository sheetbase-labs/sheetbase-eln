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
`api.is_workspace_writer` (`record.create`) or `record.link` for
`record_links`. `FOR ALL` membership policies are split so SELECT stays
membership-based. Storage/ops write policies that used
`storage_member_using` now use `is_workspace_writer`; their companion
SELECT policies are unchanged.

Data-plane mutation RPCs that previously authorised any workspace member
now call `is_workspace_writer`. Migration `0112` aborts if any
authenticated write policy or authenticated mutation RPC still uses a
1-arg membership / `storage_member_using` write gate. Inventory functions
`internal.gov01_authenticated_write_policy_violations` and
`internal.gov01_authenticated_mutation_rpc_violations` are the audit
surface. Owner-row write policies (for example analysis views keyed only
by `owner_user_id`) also require `is_workspace_writer`, so a member
demoted to viewer cannot keep mutating their own rows.

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
