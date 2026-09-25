from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional

DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024


@dataclass
class IskraConfig:
    base_url: str
    # Out of repr() (headers too, which may carry credentials): configs and
    # the objects holding them end up in logs and error reports.
    api_key: Optional[str] = field(default=None, repr=False)
    # Seconds for the whole request: connecting, sending, the headers and the
    # body. (httpx's own timeouts restart on every read, so a server trickling
    # bytes held a call open indefinitely.) None: no limit.
    timeout: Optional[float] = 30.0
    headers: Dict[str, str] = field(default_factory=dict, repr=False)
    auth_base_path: str = "/api/sso"
    # Origin sent with requests that carry a user's session cookie (Better Auth
    # rejects cookie-authenticated POSTs without a trusted Origin). Defaults to
    # the origin of base_url; set it when the service's AuthFeature `baseURL`
    # is a different (e.g. public) URL, or add base_url to `trustedOrigins`.
    origin: Optional[str] = None
    storage_route_prefix: str = "/upload"
    # Largest response body read, after decompression; a larger one raises
    # IskraException instead of filling the memory of the calling process.
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES

    def __post_init__(self) -> None:
        if self.timeout is not None and not self.timeout > 0:
            raise ValueError("timeout must be a positive number of seconds (or None for no limit)")
        if not self.max_response_bytes > 0:
            raise ValueError("max_response_bytes must be positive")
