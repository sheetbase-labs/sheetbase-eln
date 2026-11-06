"""People and continuity: hand over work, out of office, sign-in group roles.

Personal tokens only (`people:read` / `people:write`). The token acts as its
member, so their own permissions apply.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from sheetbase._http import HttpTransport


class PeopleResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list_absences(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/member_absences", params=params)

    def list_group_mappings(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/idp_group_mappings", params=params)

    def list_directory_sync_tokens(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        """Directory sync (SCIM) tokens; the secret is never returned."""
        return self._transport.get("/api/db/scim_tokens", params=params)

    def list_directory_sync_groups(
        self, *, params: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        return self._transport.get("/api/db/scim_groups", params=params)

    def directory_sync_status(self, *, workspace_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/directory_sync_status",
            json_body={"p_workspace_id": workspace_id},
        )

    def revoke_directory_sync_token(self, *, token_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/revoke_scim_token", json_body={"p_id": token_id}
        )

    def preview_handover(self, *, workspace_id: str, user_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/preview_member_handover",
            json_body={"p_workspace_id": workspace_id, "p_user_id": user_id},
        )

    def hand_over_work(
        self,
        *,
        workspace_id: str,
        from_user_id: str,
        to_user_id: str,
        selection: Sequence[str],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/hand_over_member_work",
            json_body={
                "p_workspace_id": workspace_id,
                "p_from_user_id": from_user_id,
                "p_to_user_id": to_user_id,
                "p_selection": list(selection),
            },
        )

    def set_absence(
        self,
        *,
        workspace_id: str,
        starts_on: str,
        ends_on: str,
        delegate_user_id: Optional[str] = None,
        note: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_starts_on": starts_on,
            "p_ends_on": ends_on,
            "p_delegate_user_id": delegate_user_id,
        }
        if note is not None:
            body["p_note"] = note
        if user_id is not None:
            body["p_user_id"] = user_id
        return self._transport.post(
            "/api/db/rpc/set_member_absence", json_body=body
        )

    def cancel_absence(self, *, absence_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/cancel_member_absence",
            json_body={"p_absence_id": absence_id},
        )

    def set_group_mapping(
        self, *, workspace_id: str, group_name: str, role: str
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/set_idp_group_mapping",
            json_body={
                "p_workspace_id": workspace_id,
                "p_group_name": group_name,
                "p_role": role,
            },
        )

    def remove_group_mapping(self, *, mapping_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/remove_idp_group_mapping",
            json_body={"p_id": mapping_id},
        )

    def adopt_group_roles(self, *, workspace_id: str) -> Any:
        return self._transport.post(
            "/api/db/rpc/adopt_group_roles",
            json_body={"p_workspace_id": workspace_id},
        )
