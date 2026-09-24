import io
from pathlib import Path

import pytest

from iskra_client import ForbiddenException, IskraClient, NotFoundException


@pytest.fixture
def user(iskra: IskraClient, credentials) -> IskraClient:
    email, password = credentials
    return iskra.with_session(iskra.auth.sign_up(email, password).data)


def test_upload_requires_a_signed_in_user(iskra: IskraClient):
    with pytest.raises(ForbiddenException):
        iskra.storage.upload(b"x", "x.txt")


def test_upload_list_download_delete(user: IskraClient, tmp_path: Path):
    source = tmp_path / "report.txt"
    source.write_bytes(b"quarterly numbers")

    uploaded = user.storage.upload(source, subfolder="reports/2026")
    assert uploaded.filename == "report.txt"
    assert uploaded.path == "contract/reports/2026/report.txt"
    assert uploaded.size == len(b"quarterly numbers")
    assert uploaded.uploaded_at

    files = user.storage.list(subfolder="reports")
    assert [f.name for f in files] == ["report.txt"]
    assert files[0].mime_type == "text/plain"

    assert user.storage.download("report.txt", subfolder="reports/2026") == b"quarterly numbers"

    user.storage.delete("report.txt", subfolder="reports/2026")
    assert user.storage.list(subfolder="reports") == []
    with pytest.raises(NotFoundException):
        user.storage.download("report.txt", subfolder="reports/2026")


def test_upload_bytes_and_file_objects(user: IskraClient):
    raw = bytes(range(256))
    user.storage.upload(raw, "blob.bin", subfolder="bytes")
    user.storage.upload(io.BytesIO(b"from a stream"), "stream.txt", subfolder="bytes")
    assert user.storage.download("blob.bin", subfolder="bytes") == raw
    assert user.storage.download("stream.txt", subfolder="bytes") == b"from a stream"


def test_the_service_sanitizes_names(user: IskraClient):
    uploaded = user.storage.upload(b"x", "my report (final).txt", subfolder="names")
    assert uploaded.filename == "my_report__final_.txt"
    assert user.storage.download(uploaded.filename, subfolder="names") == b"x"


def test_bytes_need_a_name(user: IskraClient):
    with pytest.raises(ValueError):
        user.storage.upload(b"x")


def test_with_route_prefix_targets_another_mount(user: IskraClient):
    files = user.storage.with_route_prefix("/files")
    assert files.route_prefix == "/files"
    assert user.storage.route_prefix == "/upload"
    with pytest.raises(NotFoundException):
        files.list()


async def test_async_storage(user: IskraClient):
    await user.storage.async_upload(b"async bytes", "a.txt", subfolder="async")
    assert [f.name for f in await user.storage.async_list(subfolder="async")] == ["a.txt"]
    assert await user.storage.async_download("a.txt", subfolder="async") == b"async bytes"
    await user.storage.async_delete("a.txt", subfolder="async")
    assert await user.storage.async_list(subfolder="async") == []
