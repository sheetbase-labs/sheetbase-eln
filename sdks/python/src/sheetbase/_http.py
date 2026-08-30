"""HTTP transport for the Sheetbase SDK.

Wraps httpx to handle:
- credential exchange and automatic token refresh;
- the ``Authorization: Bearer`` header on every data request;
- stable error envelope parsing (token path vs data path);
- PostgREST query-parameter serialisation for table reads.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Optional, Sequence
from urllib.parse import quote, urlparse

import httpx

from sheetbase._version import __version__
from sheetbase.errors import TokenError, data_path_error, DataPathError


@dataclass(frozen=True)
class TableHead:
    """Metadata returned by a public table ``HEAD`` request."""

    status_code: int
    content_range: Optional[str]
    total_count: Optional[int]
    request_id: Optional[str]


class HttpTransport:
    """Synchronous HTTP transport."""

    def __init__(
        self,
        base_url: str,
        credential: str,
        scopes: Sequence[str],
        *,
        timeout: float = 30.0,
        token_ttl_buffer: float = 30.0,
        client: Optional[httpx.Client] = None,
    ) -> None:
        parsed = urlparse(base_url.rstrip("/"))
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError(
                f"Sheetbase base URL must be HTTPS (got {parsed.scheme}). "
                "Use http://localhost or http://127.0.0.1 for local development."
            )
        self.base_url = base_url.rstrip("/")
        self.credential = credential
        self.scopes = list(scopes)
        self.timeout = timeout
        self._token_ttl_buffer = token_ttl_buffer
        self._token: Optional[str] = None
        self._token_expires: float = 0.0
        self._client = client or httpx.Client(timeout=timeout)
        self._closed = client is not None  # we don't own a client passed from outside

    # ── token management ────────────────────────────────────────────────

    def _ensure_token(self) -> str:
        if self._token and time.monotonic() < self._token_expires:
            return self._token
        self._exchange()
        assert self._token is not None
        return self._token

    def _exchange(self) -> None:
        resp = self._client.post(
            f"{self.base_url}/api/token",
            json={"credential": self.credential, "scopes": self.scopes},
            headers={"User-Agent": f"sheetbase-py/{__version__}"},
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            body = _safe_json(resp)
            err = body.get("error", {}) if body else {}
            raise TokenError(
                err.get("code", "server_error"),
                err.get("message", "Token exchange failed."),
            )
        data = resp.json()
        self._token = data["token"]
        # Default TTL is 300s; refresh early to avoid edge-case expiry.
        self._token_expires = time.monotonic() + 300 - self._token_ttl_buffer

    # ── data requests ───────────────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        try:
            return self._do_request(method, path, params=params, json_body=json_body, headers=headers)
        except DataPathError as err:
            if err.category == "unauthenticated":
                self._token = None
                self._token_expires = 0.0
                return self._do_request(method, path, params=params, json_body=json_body, headers=headers)
            raise

    def _do_request(
        self, method: str, path: str, *, params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        token = self._ensure_token()
        hdrs = {
            "Authorization": f"Bearer {token}",
            "User-Agent": f"sheetbase-py/{__version__}",
        }
        if headers:
            hdrs.update(headers)
        resp = self._client.request(
            method,
            f"{self.base_url}{path}",
            params=params,
            json=json_body,
            headers=hdrs,
            timeout=self.timeout,
        )
        if method == "HEAD" and resp.status_code < 400:
            return _table_head(resp)
        return self._handle_response(resp)

    def get(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return self.request("GET", path, params=params, headers=headers)

    def post(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return self.request(
            "POST", path, params=params, json_body=json_body, headers=headers
        )

    def head(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> TableHead:
        result = self.request("HEAD", path, params=params, headers=headers)
        assert isinstance(result, TableHead)
        return result

    def patch(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return self.request(
            "PATCH", path, params=params, json_body=json_body, headers=headers
        )

    def delete(
        self,
        path: str,
        *,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return self.request("DELETE", path, headers=headers)

    # ── response handling ───────────────────────────────────────────────

    @staticmethod
    def _handle_response(resp: httpx.Response) -> Any:
        if resp.status_code < 400:
            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()

        body = _safe_json(resp)
        err = body.get("error", {}) if body else {}

        # Token path errors have ``code``; data path errors have ``category``.
        if "code" in err:
            raise TokenError(err["code"], err.get("message", "Request failed."))
        if "category" in err:
            raise data_path_error(
                err["category"],
                err.get("message", "Request failed."),
                err.get("request_id"),
            )
        # Unknown error shape — fall back to a generic data-path error.
        raise data_path_error(
            "server_error",
            err.get("message", f"HTTP {resp.status_code}: {resp.text[:200]}"),
        )

    # ── lifecycle ───────────────────────────────────────────────────────

    def close(self) -> None:
        if not self._closed:
            self._client.close()
            self._closed = True

    def __enter__(self) -> HttpTransport:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class AsyncHttpTransport:
    """Asynchronous HTTP transport — mirrors :class:`HttpTransport`."""

    def __init__(
        self,
        base_url: str,
        credential: str,
        scopes: Sequence[str],
        *,
        timeout: float = 30.0,
        token_ttl_buffer: float = 30.0,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        parsed = urlparse(base_url.rstrip("/"))
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError(
                f"Sheetbase base URL must be HTTPS (got {parsed.scheme}). "
                "Use http://localhost or http://127.0.0.1 for local development."
            )
        self.base_url = base_url.rstrip("/")
        self.credential = credential
        self.scopes = list(scopes)
        self.timeout = timeout
        self._token_ttl_buffer = token_ttl_buffer
        self._token: Optional[str] = None
        self._token_expires: float = 0.0
        self._client = client or httpx.AsyncClient(timeout=timeout)
        self._closed = client is not None

    async def _ensure_token(self) -> str:
        if self._token and time.monotonic() < self._token_expires:
            return self._token
        await self._exchange()
        assert self._token is not None
        return self._token

    async def _exchange(self) -> None:
        resp = await self._client.post(
            f"{self.base_url}/api/token",
            json={"credential": self.credential, "scopes": self.scopes},
            headers={"User-Agent": f"sheetbase-py/{__version__}"},
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            body = _safe_json(resp)
            err = body.get("error", {}) if body else {}
            raise TokenError(
                err.get("code", "server_error"),
                err.get("message", "Token exchange failed."),
            )
        data = resp.json()
        self._token = data["token"]
        self._token_expires = time.monotonic() + 300 - self._token_ttl_buffer

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        try:
            return await self._do_request(
                method, path, params=params, json_body=json_body, headers=headers
            )
        except DataPathError as err:
            if err.category == "unauthenticated":
                self._token = None
                self._token_expires = 0.0
                return await self._do_request(
                    method, path, params=params, json_body=json_body, headers=headers
                )
            raise

    async def _do_request(
        self, method: str, path: str, *, params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        token = await self._ensure_token()
        hdrs = {
            "Authorization": f"Bearer {token}",
            "User-Agent": f"sheetbase-py/{__version__}",
        }
        if headers:
            hdrs.update(headers)
        resp = await self._client.request(
            method,
            f"{self.base_url}{path}",
            params=params,
            json=json_body,
            headers=hdrs,
            timeout=self.timeout,
        )
        if method == "HEAD" and resp.status_code < 400:
            return _table_head(resp)
        return HttpTransport._handle_response(resp)

    async def get(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return await self.request("GET", path, params=params, headers=headers)

    async def post(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return await self.request(
            "POST", path, params=params, json_body=json_body, headers=headers
        )

    async def head(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> TableHead:
        result = await self.request("HEAD", path, params=params, headers=headers)
        assert isinstance(result, TableHead)
        return result

    async def patch(
        self,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return await self.request(
            "PATCH", path, params=params, json_body=json_body, headers=headers
        )

    async def delete(
        self,
        path: str,
        *,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        return await self.request("DELETE", path, headers=headers)

    async def close(self) -> None:
        if not self._closed:
            await self._client.aclose()
            self._closed = True

    async def __aenter__(self) -> AsyncHttpTransport:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


def _safe_json(resp: httpx.Response) -> Optional[dict[str, Any]]:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _table_head(resp: httpx.Response) -> TableHead:
    content_range = resp.headers.get("content-range")
    total_count: Optional[int] = None
    if content_range and "/" in content_range:
        total = content_range.rsplit("/", 1)[1]
        if total != "*":
            try:
                total_count = int(total)
            except ValueError:
                pass
    return TableHead(
        status_code=resp.status_code,
        content_range=content_range,
        total_count=total_count,
        request_id=resp.headers.get("x-request-id"),
    )
