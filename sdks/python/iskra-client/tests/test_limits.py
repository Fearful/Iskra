"""The request deadline and the response size limit, against a local stub
server that misbehaves on purpose (the contract server answers promptly)."""
from __future__ import annotations

import gzip
import json
import socketserver
import threading
import time
from typing import Iterator

import pytest

from iskra_client import IskraClient, IskraException

BIG = 256 * 1024  # bytes the /big routes send


class _Handler(socketserver.BaseRequestHandler):
    """A raw HTTP/1.1 server: each route writes its response by hand."""

    def handle(self) -> None:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.request.recv(4096)
            if not chunk:
                return
            data += chunk
        path = data.split(b" ", 2)[1].decode()
        send = self.request.sendall
        stop = self.server.stop  # type: ignore[attr-defined]
        try:
            if path == "/trickle-body":
                # Headers at once, then one body byte every 0.2 s for 20 s.
                send(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n")
                for _ in range(100):
                    if stop.wait(0.2):
                        return
                    send(b" ")
            elif path == "/trickle-headers":
                # The status line and headers, one byte every 0.2 s.
                for byte in b"HTTP/1.1 200 OK\r\nX-Slow: " + b"a" * 100 + b"\r\n\r\n":
                    if stop.wait(0.2):
                        return
                    send(bytes([byte]))
            elif path == "/big":
                body = b"x" * BIG
                send(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n" % len(body) + body)
            elif path == "/big-chunked":
                # No Content-Length: the limit must hold while reading.
                send(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                for _ in range(BIG // 1024):
                    send(b"400\r\n" + b"y" * 1024 + b"\r\n")
                send(b"0\r\n\r\n")
            elif path == "/gzip-bomb":
                # Small on the wire, BIG once decompressed.
                body = gzip.compress(b"z" * BIG)
                send(
                    b"HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: %d\r\n\r\n" % len(body) + body
                )
            elif path == "/gzip-json":
                body = gzip.compress(json.dumps({"ok": True}).encode())
                send(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\n"
                    b"Set-Cookie: a=1\r\nSet-Cookie: b=2\r\nContent-Length: %d\r\n\r\n" % len(body) + body
                )
        except OSError:
            pass  # the client gave up and closed the connection


@pytest.fixture(scope="module")
def stub_url() -> Iterator[str]:
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _Handler)
    server.daemon_threads = True
    server.stop = threading.Event()  # type: ignore[attr-defined]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.stop.set()  # type: ignore[attr-defined]
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("path", ["/trickle-body", "/trickle-headers"])
def test_the_timeout_bounds_the_whole_request(stub_url: str, path: str):
    # Each read got a fresh timeout: a byte every 0.2 s kept the call open for
    # as long as the server wanted (timeout=2.0 took 9 s).
    client = IskraClient(stub_url, timeout=1.0)
    started = time.monotonic()
    with pytest.raises(IskraException) as info:
        client.get(path)
    assert time.monotonic() - started < 2.0
    assert info.value.status_code == 0
    assert "timed out" in str(info.value)


@pytest.mark.parametrize("path", ["/trickle-body", "/trickle-headers"])
async def test_the_timeout_bounds_the_whole_async_request(stub_url: str, path: str):
    client = IskraClient(stub_url, timeout=1.0)
    started = time.monotonic()
    with pytest.raises(IskraException) as info:
        await client.async_get(path)
    assert time.monotonic() - started < 2.0
    assert "timed out" in str(info.value)
    await client.aclose()


@pytest.mark.parametrize("path", ["/big", "/big-chunked", "/gzip-bomb"])
def test_responses_are_capped(stub_url: str, path: str):
    client = IskraClient(stub_url, max_response_bytes=BIG // 2)
    with pytest.raises(IskraException) as info:
        client.get(path)
    assert "max_response_bytes" in str(info.value)
    # At the limit, the same response is fine.
    with IskraClient(stub_url, max_response_bytes=BIG) as big_enough:
        assert len(big_enough._http.get_bytes(path)) == BIG


@pytest.mark.parametrize("path", ["/big", "/big-chunked", "/gzip-bomb"])
async def test_async_responses_are_capped(stub_url: str, path: str):
    client = IskraClient(stub_url, max_response_bytes=BIG // 2)
    with pytest.raises(IskraException) as info:
        await client.async_get(path)
    assert "max_response_bytes" in str(info.value)
    await client.aclose()


def test_a_compressed_response_is_still_decoded_once(stub_url: str):
    with IskraClient(stub_url) as client:
        resp = client._http.request("GET", "/gzip-json")
        assert resp.json() == {"ok": True}
        assert resp.headers.get_list("set-cookie") == ["a=1", "b=2"]
        assert client.get("/gzip-json").data == {"ok": True}


def test_limits_are_validated():
    with pytest.raises(ValueError):
        IskraClient("http://iskra", timeout=0)
    with pytest.raises(ValueError):
        IskraClient("http://iskra", max_response_bytes=0)
