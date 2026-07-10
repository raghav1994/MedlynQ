"""Content-based doc-type classifier.

Reads Sarvam-extracted markdown (or PyMuPDF text) and decides what kind of
medical document this is — without needing the filename to help.

Used after Sarvam returns text so we can rename random-name uploads
(IMG_20260629_001.jpg, Scan-12.pdf, etc.) into clean, predictable filenames
the MEDCO can recognise on the patient page.

Output:
  {
    "doc_type":   "hpe_report",
    "label":      "Histopathology Report",
    "confidence": 0.93,
    "evidence":   ["OPINION:", "TUMOR HISTOLOGIC TYPE", "pSTAGE"],
    "doc_date":   "2024-11-26",   # best-guess primary date for renaming
  }
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

# Each rule fires when ≥1 phrase + ≥0 field tokens are matched in the text.
# `weight` × matched_phrases / required_phrases = rule's contribution to confidence.

CLASSIFIER_RULES = [
    {
        "doc_type": "hpe_report",
        "label": "Histopathology Report",
        "strong_phrases": [
            r"HISTOPATHOLOGY",
            r"TUMOR\s+HISTOLOGIC\s+TYPE",
            r"\bMARGINS\b.{0,40}(?:CLEAR|FREE\s+OF)",
            r"\bOPINION\b\s*:",
            r"INVASIVE.+CARCINOMA",
            r"BIOPSY\s*NO\.?",
            r"GROSS\s+EXAMINATION",
            r"MICROSCOPIC\s+EXAMINATION",
        ],
        "weak_phrases": [r"\bDCIS\b", r"\bgrade\s+[I-V]+\b", r"pSTAGE", r"lymph\s+node"],
    },
    {
        "doc_type": "lab_report",
        "label": "Lab Report",
        "strong_phrases": [
            r"DEPARTMENT\s+OF\s+LAB",
            r"LABORATORY\s+SERVICES",
            r"\bLab\s*No\b",
            r"RENAL\s+FUNCTION\s+TEST",
            r"COMPLETE\s+BLOOD\s+COUNT",
            r"LIVER\s+FUNCTION",
            r"Biological\s+ref",
            r"\bRef\.?\s*Range\b",
        ],
        "weak_phrases": [r"mg/dL", r"mEq/L", r"g/dL", r"creatinine", r"haemoglobin"],
    },
    {
        "doc_type": "bill",
        "label": "Hospital Bill",
        "strong_phrases": [
            r"Bill\s+of\s+Supply",
            r"\bGSTIN\b",
            r"\bI\.?P\.?\s*No\.?",
            r"\bGross\s+Amt\b",
            r"\bNet\s+Amt\b",
            r"\bPayer\s+Amt\b",
            r"Billing\s+Category",
            # UHID intentionally excluded — it's the patient's hospital ID and
            # prints on nearly every document type (referrals, OPD slips,
            # discharge summaries...), so it was a false-positive magnet: a
            # real OPD panel card (GSTIN + UHID, no actual billing content)
            # was misclassified as "Hospital Bill" at 0.71 confidence purely
            # off those two generic header fields.
            r"D\.?O\.?A\.?\b",
            r"D\.?O\.?D\.?\b",
        ],
        "weak_phrases": [r"Bed\s*No", r"Consultant", r"₹", r"Rs\."],
    },
    {
        "doc_type": "discharge_summary",
        "label": "Discharge Summary",
        "strong_phrases": [
            r"DISCHARGE\s+SUMMARY",
            r"FINAL\s+DIAGNOSIS",
            r"DATE\s+OF\s+DISCHARGE",
            r"DATE\s+OF\s+ADMISSION",
            r"COURSE\s+IN\s+HOSPITAL",
            r"CONDITION\s+AT\s+DISCHARGE",
            r"FOLLOW[\-\s]?UP",
        ],
        "weak_phrases": [r"discharged", r"clinical\s+course"],
    },
    {
        "doc_type": "chemo_chart",
        "label": "Chemo Chart",
        "strong_phrases": [
            r"Chemoplan",
            r"\bBSA\b",
            r"Cycle\s+\d+",
            r"q\d+\s*w(?:eekly|eeks)?",
            r"mg/m[²2]",
            r"premedication",
            r"\bER[\s\-:][\s\-:]*\d",
        ],
        "weak_phrases": [r"Trastuzumab", r"Paclitaxel", r"Docetaxel", r"HER[\s\-]?2"],
    },
    {
        "doc_type": "doctors_prescription",
        "label": "Doctor's Prescription",
        "strong_phrases": [
            r"\bRx\b",
            r"prescription",
            r"\bChemoplan\b",        # often same content
            r"\bF/U\s+after\b",
            r"Inj\s+[A-Z]",          # injectable orders
        ],
        "weak_phrases": [r"\bOD\b", r"\bBD\b", r"\bTDS\b", r"\bQID\b", r"\bSOS\b"],
    },
    {
        "doc_type": "tumor_board_cert",
        "label": "Tumor Board Certificate",
        "strong_phrases": [
            r"TUMOR\s+BOARD",
            r"TUMOUR\s+BOARD",
            r"MULTIDISCIPLINARY",
            r"BOARD\s+DECISION",
            r"BOARD\s+CERTIFICATE",
            r"TBC\b",
        ],
        "weak_phrases": [r"recommend", r"surgeon", r"oncologist", r"radiologist"],
    },
    {
        "doc_type": "feedback_form",
        "label": "Feedback Form",
        "strong_phrases": [
            r"FEEDBACK\s+FORM",
            r"प्रतिक्रिया",
            r"Beneficiary\s+ID",
            r"AB\s*PM[\-\s]?JAY",
            r"Did\s+you\s+avail",
        ],
        "weak_phrases": [r"satisfaction", r"rating", r"feedback"],
    },
    {
        "doc_type": "consent_form",
        "label": "Consent Form",
        "strong_phrases": [
            r"INFORMED\s+CONSENT",
            r"CONSENT\s+FORM",
            r"I,?\s+the\s+undersigned",
            r"hereby\s+(?:give|authorise|consent)",
        ],
        "weak_phrases": [r"signature", r"witness", r"thumb\s+impression"],
    },
    {
        "doc_type": "referral",
        "label": "Referral Letter",
        "strong_phrases": [
            r"REFERRAL\s+LETTER",
            r"REFERRED\s+BY",
            r"REFERRAL\s+NOTE",
            r"Refer\s+to",
        ],
        "weak_phrases": [r"kindly\s+see", r"referring\s+physician"],
    },
    {
        "doc_type": "opd_slip",
        "label": "OPD Slip",
        "strong_phrases": [
            r"OPD\s+SLIP",
            r"OUT\s*PATIENT",
            r"OPD\s+Registration",
            r"OPD\s+No\.?",
            # Broadened after a real "PANEL OPD CARD" (this hospital's actual
            # OPD-visit printout) matched none of the phrases above and lost
            # to the "bill" rule instead — verified directly on that document.
            r"PANEL\s+OPD\s+CARD",
            r"OPD\s+CARD",
            r"Queue\s+No",
            r"Present\s+Complaints",
            r"Prov\.?\s+Diagnosis",
        ],
        "weak_phrases": [r"consultation"],
    },
    {
        "doc_type": "ot_notes",
        "label": "OT Notes",
        "strong_phrases": [
            r"OPERATION\s+NOTES",
            r"\bOT\s+NOTES\b",
            r"OPERATIVE\s+NOTES",
            r"OPERATION\s+THEATRE",
            r"PROCEDURE\s+DONE",
            r"BLOOD\s+LOSS",
        ],
        "weak_phrases": [r"anaesthesia", r"surgeon", r"incision"],
    },
    {
        "doc_type": "patient_id",
        "label": "Patient ID Proof",
        "strong_phrases": [
            r"AADHAAR",
            r"UIDAI",
            r"AYUSHMAN\s+CARD",
            r"VOTER\s+ID",
            r"PAN\s+CARD",
            r"\bRATION\s+CARD\b",
        ],
        "weak_phrases": [r"identification", r"DOB"],
    },
]


def _count_matches(text: str, patterns: list[str]) -> tuple[int, list[str]]:
    n = 0
    hits: list[str] = []
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            n += 1
            hits.append(p)
    return n, hits


def classify(markdown: str) -> dict[str, Any]:
    text = markdown or ""
    if not text.strip():
        return {"doc_type": "unknown", "label": "Document", "confidence": 0.0, "evidence": [], "doc_date": None}

    best: dict[str, Any] = {
        "doc_type": "unknown", "label": "Document",
        "confidence": 0.0, "evidence": [], "doc_date": None,
    }

    for rule in CLASSIFIER_RULES:
        strong_n, strong_hits = _count_matches(text, rule["strong_phrases"])
        weak_n,   weak_hits   = _count_matches(text, rule["weak_phrases"])

        # Need at least 1 strong phrase to fire
        if strong_n == 0:
            continue

        # Confidence = strong-coverage + weak-bonus, capped at 0.99
        strong_cov = strong_n / len(rule["strong_phrases"])
        weak_bonus = min(weak_n / max(1, len(rule["weak_phrases"])), 0.5)
        conf = min(0.6 + 0.35 * strong_cov + 0.15 * weak_bonus, 0.99)

        if conf > best["confidence"]:
            best = {
                "doc_type": rule["doc_type"],
                "label": rule["label"],
                "confidence": round(conf, 2),
                "evidence": (strong_hits + weak_hits)[:6],
                "doc_date": _best_date(text),
            }

    if best["doc_type"] == "unknown":
        best["doc_date"] = _best_date(text)
    return best


# ---------- Date extraction (for the rename suffix) ----------
DATE_PATTERNS = [
    # Per-doc-type primary date in order of preference
    r"(?:Report\s+Date|Approval\s+Level\s+\d+)\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    r"Bill\s*Date\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    r"Date\s+of\s+Discharge\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    r"D\.?O\.?D\.?\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    r"D\.?O\.?A\.?\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    # Specimen / sample dates for HPE / lab
    r"(?:Collected|Sample\s+Date|Received)\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})",
    # Generic: any visible date
    r"\b(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})\b",
]

def _best_date(text: str) -> str | None:
    for pat in DATE_PATTERNS:
        for m in re.finditer(pat, text):
            raw = m.group(1)
            iso = _normalize_date(raw)
            if iso:
                return iso
    return None

def _normalize_date(raw: str) -> str | None:
    s = raw.replace(".", "-").replace("/", "-")
    for fmt in ("%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def rename_for(mrn: str, content_class: dict[str, Any], original_ext: str) -> str:
    """Build the clean filename based on content classification."""
    doc_type = content_class.get("doc_type", "unknown")
    date = content_class.get("doc_date") or datetime.now().strftime("%Y-%m-%d")
    iso = date.replace("-", "")
    ext = original_ext.lstrip(".").lower() or "bin"
    return f"{mrn}_{doc_type}_{iso}.{ext}"


if __name__ == "__main__":
    import json, sys
    raw = sys.stdin.read() if not sys.stdin.isatty() else " ".join(sys.argv[1:])
    print(json.dumps(classify(raw), indent=2, ensure_ascii=False))
