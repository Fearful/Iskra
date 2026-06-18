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
