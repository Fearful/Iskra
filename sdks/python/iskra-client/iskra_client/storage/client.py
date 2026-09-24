from __future__ import annotations
import mimetypes
from pathlib import Path
from typing import BinaryIO, List, Optional, TYPE_CHECKING, Union
from urllib.parse import quote

from iskra_client.http_client import parse_body
from iskra_client.storage.models import StoredFile, UploadedFile

if TYPE_CHECKING:
    from iskra_client.http_client import HttpClientWrapper

FileSource = Union[Path, str, bytes, BinaryIO]


class StorageClient:
    """Client for the routes `UploadFeature` exposes (`exposeRoutes: true`).

    Those routes go through the feature's `authorize` callback, which usually
    requires a signed-in user: call them on `iskra.with_session(session)`.
    """

    def __init__(self, http: HttpClientWrapper, route_prefix: str = "/upload") -> None:
        self._http = http
        self._prefix = "/" + route_prefix.strip("/")

    @property
    def route_prefix(self) -> str:
        return self._prefix

    def with_route_prefix(self, route_prefix: str) -> StorageClient:
        """A StorageClient for an UploadFeature mounted at another `routePrefix`."""
        return StorageClient(self._http, route_prefix)

    # ── Sync ─────────────────────────────────────────────────────────────

    def upload(
        self,
        file: FileSource,
        name: Optional[str] = None,
        subfolder: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> UploadedFile:
        """Uploads a file (a path, bytes or a binary file object) as `name`
        (defaults to the path's file name) under the optional `subfolder`."""
        name, data = _read(file, name)
        resp = self._http.request(
            "POST", self._prefix, params={"subfolder": subfolder}, files=_multipart(name, data, content_type)
        )
        return UploadedFile.from_dict(parse_body(resp) or {})

    def list(self, subfolder: Optional[str] = None) -> List[StoredFile]:
        """Files under the project (or `subfolder`), including nested folders."""
        resp = self._http.request("GET", self._prefix, params={"subfolder": subfolder})
        return _files(parse_body(resp))

    def download(self, name: str, subfolder: Optional[str] = None) -> bytes:
        return self._http.request("GET", self._file_path(name, subfolder)).content

    def delete(self, name: str, subfolder: Optional[str] = None) -> None:
        self._http.request("DELETE", self._file_path(name, subfolder))

    # ── Async ────────────────────────────────────────────────────────────

    async def async_upload(
        self,
        file: FileSource,
        name: Optional[str] = None,
        subfolder: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> UploadedFile:
        name, data = _read(file, name)
        resp = await self._http.async_request(
            "POST", self._prefix, params={"subfolder": subfolder}, files=_multipart(name, data, content_type)
        )
        return UploadedFile.from_dict(parse_body(resp) or {})

    async def async_list(self, subfolder: Optional[str] = None) -> List[StoredFile]:
        resp = await self._http.async_request("GET", self._prefix, params={"subfolder": subfolder})
        return _files(parse_body(resp))

    async def async_download(self, name: str, subfolder: Optional[str] = None) -> bytes:
        return (await self._http.async_request("GET", self._file_path(name, subfolder))).content

    async def async_delete(self, name: str, subfolder: Optional[str] = None) -> None:
        await self._http.async_request("DELETE", self._file_path(name, subfolder))

    # ── Helpers ──────────────────────────────────────────────────────────

    def _file_path(self, name: str, subfolder: Optional[str]) -> str:
        segments = [s for s in (subfolder or "").split("/") if s] + [name]
        for segment in segments:
            # httpx resolves "." and ".." like a browser: "../api/admin" left
            # the upload routes and sent the API key and cookie elsewhere.
            if segment in (".", "..") or not segment:
                raise ValueError(f"invalid file name or subfolder segment: {segment!r}")
        return self._prefix + "/" + "/".join(quote(s, safe="") for s in segments)


def _read(file: FileSource, name: Optional[str]) -> "tuple[str, bytes]":
    if isinstance(file, (str, Path)):
        path = Path(file)
        return name or path.name, path.read_bytes()
    if isinstance(file, (bytes, bytearray)):
        if not name:
            raise ValueError("name is required when uploading bytes")
        return name, bytes(file)
    data = file.read()
    if not name:
        name = Path(getattr(file, "name", "") or "").name
        if not name:
            raise ValueError("name is required when the file object has no name")
    return name, data


def _multipart(name: str, data: bytes, content_type: Optional[str]) -> dict:
    content_type = content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
    return {"file": (name, data, content_type)}


def _files(body: object) -> List[StoredFile]:
    files = body.get("files", []) if isinstance(body, dict) else []
    return [StoredFile.from_dict(f) for f in files if isinstance(f, dict)]
