"""One-shot ICD-10 code lookup via Sarvam's chat model -- the last-resort
fallback tier when a diagnosis isn't already coded and isn't in
data/icd10_lookup.csv (see src/lib/icd10.ts's trust order).

Never trusted without human review -- the TS caller marks any result from
this script verified:false. This is a starting guess for staff to confirm
before a real NHCX submission, not a certified code.

Usage: python icd10_llm.py "<diagnosis text>"
Output: JSON {"icd10_code": "...", "icd10_display": "..."} on stdout, or {}
on any failure (missing key, bad response, network error) so the caller
falls back to leaving the diagnosis uncoded rather than crash.

Also supports the reverse direction — a staff member on the NHCX review
screen (NHCXBridge.tsx) typing a code they already know (e.g. from a
discharge summary) and wanting the official description auto-filled,
instead of typing the diagnosis and hoping the same code comes back:

Usage: python icd10_llm.py --describe "<icd10 code>"
Output: JSON {"icd10_display": "..."} on stdout, or {} on failure.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(APP_ROOT / ".env.local")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import api_settings

SARVAM_KEY = api_settings.get("sarvam_api_key", "SARVAM_API_KEY")
MODEL = api_settings.get("sarvam_chat_model", "SARVAM_CHAT_MODEL", "sarvam-30b")

SYSTEM_PROMPT = (
    "You are a medical coding assistant. Given a free-text diagnosis, return "
    "ONLY a JSON object {\"icd10_code\": \"<code>\", \"icd10_display\": \"<official "
    "short description>\"} using the WHO ICD-10 classification. If you cannot "
    "confidently determine a code, return {}."
)

DESCRIBE_SYSTEM_PROMPT = (
    "You are a medical coding assistant. Given a WHO ICD-10 code, return ONLY "
    "a JSON object {\"icd10_display\": \"<official short description>\"}. If "
    "the code is not a real ICD-10 code, return {}."
)


def _call_sarvam(system_prompt: str, user_content: str) -> dict:
    if not SARVAM_KEY:
        return {}
    try:
        from sarvamai import SarvamAI
        client = SarvamAI(api_subscription_key=SARVAM_KEY)
        resp = client.chat.completions(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.0,
            max_tokens=200,
        )
        raw = resp.choices[0].message.content or "{}"
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        return json.loads(raw)
    except Exception:
        return {}


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "--describe":
        code = sys.argv[2].strip()
        if not code:
            print(json.dumps({}))
            return
        data = _call_sarvam(DESCRIBE_SYSTEM_PROMPT, code)
        if data.get("icd10_display"):
            print(json.dumps({"icd10_display": data["icd10_display"]}))
        else:
            print(json.dumps({}))
        return

    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print(json.dumps({}))
        return
    diagnosis = sys.argv[1].strip()

    data = _call_sarvam(SYSTEM_PROMPT, diagnosis)
    if data.get("icd10_code"):
        print(json.dumps({"icd10_code": data["icd10_code"], "icd10_display": data.get("icd10_display", "")}))
    else:
        print(json.dumps({}))


if __name__ == "__main__":
    main()
