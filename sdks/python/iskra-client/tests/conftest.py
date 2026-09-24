"""Runs the SDK against the real Iskra contract server (sdks/contract/server.ts).

The server is started once per test session with Bun ($BUN, or `bun` on
PATH). Set ISKRA_CONTRACT_URL to test against a server that is already
running instead.
"""
from __future__ import annotations
import json
import os
import queue
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Iterator

import pytest

from iskra_client import IskraClient

REPO_ROOT = Path(__file__).resolve().parents[4]
SERVER = REPO_ROOT / "sdks" / "contract" / "server.ts"
READY = "ISKRA_CONTRACT_READY "


@pytest.fixture(scope="session")
def base_url() -> Iterator[str]:
    external = os.environ.get("ISKRA_CONTRACT_URL")
    if external:
        yield external.rstrip("/")
        return

    bun = os.environ.get("BUN") or shutil.which("bun")
    if not bun:
        pytest.skip("bun not found: set BUN or ISKRA_CONTRACT_URL to run the contract tests")

    proc = subprocess.Popen(
        [bun, "run", str(SERVER)],
        cwd=REPO_ROOT,
        stdin=subprocess.PIPE,  # the server exits when this closes
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**os.environ, "CONTRACT_EXIT_ON_STDIN_EOF": "1"},
    )
    lines: "queue.Queue[str]" = queue.Queue()
    output: list = []

    def pump() -> None:
        # Keep draining: a full pipe would block the server's logging.
        assert proc.stdout is not None
        for line in proc.stdout:
            output.append(line)
            lines.put(line)
        lines.put("")

    threading.Thread(target=pump, daemon=True).start()
    try:
        while True:
            try:
                line = lines.get(timeout=30)
            except queue.Empty:
                raise RuntimeError("contract server did not start within 30s:\n" + "".join(output))
            if not line:
                raise RuntimeError("contract server exited:\n" + "".join(output))
            if line.startswith(READY):
                yield json.loads(line[len(READY):])["baseUrl"]
                break
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture
def iskra(base_url: str) -> Iterator[IskraClient]:
    with IskraClient(base_url=base_url) as client:
        yield client


@pytest.fixture
def credentials() -> "tuple[str, str]":
    return f"user-{uuid.uuid4().hex[:12]}@example.com", "correct-horse-battery"
