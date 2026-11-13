"""Files: put a file into a project, add a version, read it back.

Needs a personal token holding ``files:write`` (to upload) or ``files:read``
(to download). The file is stored as the person the token belongs to, with their
access to the project. A workspace service credential cannot upload.
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
from typing import Any, Optional, Union

from sheetbase._http import AsyncHttpTransport, HttpTransport

FileSource = Union[bytes, "os.PathLike[str]", str]


def _read(source: FileSource, name: Optional[str]) -> tuple[bytes, str]:
    """Bytes and file name from bytes (name needed) or a path."""
    if isinstance(source, (bytes, bytearray)):
        if not name:
            raise ValueError("name is required when uploading bytes.")
        return bytes(source), name
    with open(source, "rb") as handle:
        data = handle.read()
    return data, name or os.path.basename(os.fspath(source))


def _media_type(name: str, media_type: Optional[str]) -> str:
    return media_type or mimetypes.guess_type(name)[0] or "application/octet-stream"


def _authorize_body(
    project_id: str, name: str, media_type: Optional[str], data: bytes
) -> dict[str, Any]:
    return {
        "projectId": project_id,
        "displayName": name,
        "mediaType": _media_type(name, media_type),
        "byteSize": len(data),
        "checksum": hashlib.sha256(data).hexdigest(),
    }


class FilesResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def upload(
        self,
        project_id: str,
        source: FileSource,
        *,
        name: Optional[str] = None,
        media_type: Optional[str] = None,
    ) -> dict[str, Any]:
        """Upload a new file to a project from bytes or a path.

        Returns the stored file: ``fileRecordId``, ``byteSize``, ``checksum``
        and ``status``.
        """
        data, file_name = _read(source, name)
        slot = self._transport.post(
            "/api/files/upload-authorize",
            json_body=_authorize_body(project_id, file_name, media_type, data),
        )
        stored = self._transport.request(
            "PUT",
            slot["uploadUrl"],
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        )
        return {**slot, **stored}

    def upload_version(
        self,
        file_record_id: str,
        source: FileSource,
        *,
        name: Optional[str] = None,
        media_type: Optional[str] = None,
    ) -> dict[str, Any]:
        """Add a new version to an existing file."""
        data, file_name = _read(source, name)
        return self._transport.request(
            "PUT",
            f"/api/files/{file_record_id}/version",
            params={"name": file_name} if name else None,
            content=data,
            headers={"Content-Type": _media_type(file_name, media_type)},
        )

    def download(self, file_record_id: str, *, version: Optional[int] = None) -> bytes:
        """The bytes of the newest version, or of an earlier one."""
        return self._transport.request(
            "GET",
            f"/api/files/{file_record_id}/download",
            params={"version": version} if version else None,
            raw=True,
        )

    def get(self, file_record_id: str) -> Optional[dict[str, Any]]:
        """The file's details (name, type, size, checksum, status), newest version."""
        rows = self._transport.get(
            "/api/db/file_objects",
            params={"record_id": f"eq.{file_record_id}", "order": "version.desc", "limit": 1},
        )
        return rows[0] if rows else None


class AsyncFilesResource:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def upload(
        self,
        project_id: str,
        source: FileSource,
        *,
        name: Optional[str] = None,
        media_type: Optional[str] = None,
    ) -> dict[str, Any]:
        data, file_name = _read(source, name)
        slot = await self._t.post(
            "/api/files/upload-authorize",
            json_body=_authorize_body(project_id, file_name, media_type, data),
        )
        stored = await self._t.request(
            "PUT",
            slot["uploadUrl"],
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        )
        return {**slot, **stored}

    async def upload_version(
        self,
        file_record_id: str,
        source: FileSource,
        *,
        name: Optional[str] = None,
        media_type: Optional[str] = None,
    ) -> dict[str, Any]:
        data, file_name = _read(source, name)
        return await self._t.request(
            "PUT",
            f"/api/files/{file_record_id}/version",
            params={"name": file_name} if name else None,
            content=data,
            headers={"Content-Type": _media_type(file_name, media_type)},
        )

    async def download(
        self, file_record_id: str, *, version: Optional[int] = None
    ) -> bytes:
        return await self._t.request(
            "GET",
            f"/api/files/{file_record_id}/download",
            params={"version": version} if version else None,
            raw=True,
        )

    async def get(self, file_record_id: str) -> Optional[dict[str, Any]]:
        rows = await self._t.get(
            "/api/db/file_objects",
            params={"record_id": f"eq.{file_record_id}", "order": "version.desc", "limit": 1},
        )
        return rows[0] if rows else None
