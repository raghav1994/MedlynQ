"""Cross-checks Sarvam's returned text against RapidOCR's local reading
(already computed during redaction, see redact.py's local_ocr_text) to catch
Sarvam coming back garbled/rubbish despite a non-empty response.

Existing retry logic in sarvam_vision.py only catches a completely EMPTY
result. This catches the more common real failure: Sarvam returns SOMETHING,
but it's short, symbol-heavy, or unrelated to what's actually on the page.

Heuristics are deliberately permissive — a false positive here just costs one
extra Sarvam retry + a fallback to RapidOCR's (now known to be solid) text,
not data loss. A false negative — missing a genuinely bad Sarvam read — is
the real risk, so err toward flagging.
"""
from __future__ import annotations

import re

_WORD_RE = re.compile(r"[a-zA-Z]{4,}")


def _words(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text)}


def looks_rubbish(sarvam_text: str, local_ocr_text: str) -> bool:
    local_ocr_text = (local_ocr_text or "").strip()
    sarvam_text = (sarvam_text or "").strip()

    # No independent signal to compare against — RapidOCR itself found
    # nothing meaningful (e.g. a mostly-blank page), so there's nothing to
    # second-guess Sarvam against. Trust it.
    if len(local_ocr_text) < 40:
        return False

    # Sarvam came back essentially empty while RapidOCR clearly found text.
    if len(sarvam_text) < 0.15 * len(local_ocr_text):
        return True

    # Symbol/garbage-heavy: real extracted text (even Sarvam's markdown/HTML
    # table syntax mixed in) is still mostly letters/digits/whitespace. A
    # response dominated by other characters is a strong garbling signal.
    alnum = sum(1 for c in sarvam_text if c.isalnum() or c.isspace())
    if len(sarvam_text) > 30 and alnum / len(sarvam_text) < 0.55:
        return True

    # Wild content divergence: two genuine readings of the same page should
    # share a meaningful chunk of real words, even accounting for Sarvam's
    # markdown/table formatting. Word length >=4 filters noise from short
    # OCR fragments and stray markdown tokens.
    sarvam_words = _words(sarvam_text)
    local_words = _words(local_ocr_text)
    if len(sarvam_words) >= 8 and len(local_words) >= 8:
        overlap = len(sarvam_words & local_words) / len(local_words)
        if overlap < 0.08:
            return True

    return False
