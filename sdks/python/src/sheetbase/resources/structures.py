"""Chemical structures: describe a drawing and search registries by structure.

Needs a credential with `lab:read`. Registering a compound or changing its
structure takes the description this returns, as `p_structure` of
`rpc.register_compound` or `rpc.set_record_structure`.
"""

from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import HttpTransport


def _search_body(
    structure: str,
    mode: str,
    registry: Optional[str],
    min_similarity: Optional[float],
    include_archived: bool,
    limit: Optional[int],
) -> dict[str, Any]:
    body: dict[str, Any] = {"structure": structure, "mode": mode}
    if registry is not None:
        body["registry"] = registry
    if min_similarity is not None:
        body["minSimilarity"] = min_similarity
    if include_archived:
        body["includeArchived"] = True
    if limit is not None:
        body["limit"] = limit
    return body


class StructuresResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def describe(self, structure: str) -> dict[str, Any]:
        """Describe a SMILES line or molfile: parent, salts, formula, mass, fingerprint."""
        return self._transport.post(
            "/api/structures/describe", json_body={"structure": structure}
        )

    def search(
        self,
        structure: str,
        *,
        mode: str = "substructure",
        registry: Optional[str] = None,
        min_similarity: Optional[float] = None,
        include_archived: bool = False,
        limit: Optional[int] = None,
    ) -> dict[str, Any]:
        """Find registered compounds that contain, or resemble, a structure."""
        return self._transport.post(
            "/api/structures/search",
            json_body=_search_body(
                structure, mode, registry, min_similarity, include_archived, limit
            ),
        )
