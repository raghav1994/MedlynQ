"""Reads db/api_settings.json (the owner-editable global API settings store,
written from Backend Admin -> the settings UI). Any field present there wins
over the .env.local default; a missing/empty field falls back to the env var
as before. Mirrors src/lib/apiSettings.ts's shape on the TS side -- keep both
in sync if the field set changes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parent.parent
_SETTINGS_FILE = APP_ROOT / "db" / "api_settings.json"


def _load() -> dict[str, Any]:
    try:
        return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get(key: str, env_var: str, default: str = "") -> str:
    """settings-store value wins, else the env var, else default."""
    value = _load().get(key)
    if value:
        return value
    return os.getenv(env_var, default)
