"""Tenant config loader — the Python-side mirror of src/lib/tenant/loader.ts.

Python previously had ZERO tenant awareness: content_classifier.py and
identity_llm.py were both a single hardcoded, oncology-tuned rule set /
prompt shared by every hospital regardless of specialty. This module lets
Python read the same db/tenants/{hospital_id}.json files the Node side
already uses, so a hospital's document types/extraction fields can be
config, not code.

New tenant config fields this expects (on top of the existing branding
fields TypeScript already reads):
  specialties_enabled: ["oncology", "general_medicine", ...]
  document_profiles: [
    {
      "doc_type": "fever_chart",           # slug, matches classifier output
      "label": "Fever / Vitals Chart",
      "specialty": "general_medicine",
      "stage": "mid_way",                  # opd | pre_auth | mid_way | discharge
      "anchors": ["temperature chart", "fever spike", "TPR chart"],
      "extraction_keys": ["max_temp_c", "days_febrile"],
    },
    ...
  ]

A hospital only needs entries here for specialties NOT already built into
the Python-side ONCOLOGY_RULES / oncology SYSTEM_PROMPT defaults — those
stay as the tuned, fast, built-in path. This is additive layering, not a
replacement.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parent.parent
TENANTS_DIR = APP_ROOT / "db" / "tenants"

_cache: dict[str, dict[str, Any]] = {}
_cache_loaded = False


def _load_all() -> dict[str, dict[str, Any]]:
    global _cache_loaded
    if _cache_loaded:
        return _cache
    _cache_loaded = True
    if not TENANTS_DIR.exists():
        return _cache
    for f in TENANTS_DIR.glob("*.json"):
        try:
            config = json.loads(f.read_text(encoding="utf-8"))
            hid = config.get("hospital_id")
            if hid:
                _cache[hid] = config
        except Exception:
            continue
    return _cache


def get_tenant_config(hospital_id: str | None) -> dict[str, Any] | None:
    """Best-effort lookup — returns None (not an error) for an unknown/missing
    hospital_id, since every caller of this already has a hardcoded default
    to fall back to (the original oncology behavior)."""
    if not hospital_id:
        return None
    return _load_all().get(hospital_id)


def document_profiles_for(hospital_id: str | None, specialty: str | None = None) -> list[dict[str, Any]]:
    """All document_profiles for a hospital, optionally filtered to one
    specialty. Empty list if the hospital has no config-driven profiles
    (i.e. it only uses the built-in oncology rules)."""
    config = get_tenant_config(hospital_id)
    if not config:
        return []
    profiles = config.get("document_profiles", [])
    if specialty:
        return [p for p in profiles if p.get("specialty") == specialty]
    return profiles


def specialties_enabled(hospital_id: str | None) -> list[str]:
    config = get_tenant_config(hospital_id)
    if not config:
        return ["oncology"]  # original hardcoded assumption, preserved as the default
    return config.get("specialties_enabled", ["oncology"])
