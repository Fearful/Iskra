from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class IskraConfig:
    base_url: str
    api_key: Optional[str] = None
    timeout: float = 30.0
    headers: Dict[str, str] = field(default_factory=dict)
    auth_base_path: str = "/api/sso"
    # Origin sent with requests that carry a user's session cookie (Better Auth
    # rejects cookie-authenticated POSTs without a trusted Origin). Defaults to
    # the origin of base_url; set it when the service's AuthFeature `baseURL`
    # is a different (e.g. public) URL, or add base_url to `trustedOrigins`.
    origin: Optional[str] = None
    storage_route_prefix: str = "/upload"
