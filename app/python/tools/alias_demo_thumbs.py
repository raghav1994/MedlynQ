"""One-shot helper: for each demo mock filename, copy a representative
corpus thumbnail to that filename so the patient detail page shows real
previews instead of broken images.

Run once after build_thumbs.py. Idempotent.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
THUMBS = ROOT / "app" / "public" / "_thumbs"

# Mock filename → corpus token to search for in existing thumb names
ALIAS_MAP = {
    "Patient_ID.pdf":          "CARD",
    "Consent_Form.pdf":        "Form",
    "Referral.pdf":             "Report",
    "Registration_Copy.pdf":    "0001",
    "HPE_Report.pdf":           "HISTO",
    "Protocol.pdf":             "Protocol",
    "CBC.pdf":                  "CBC",
    "IPD_Daycare.pdf":          "Chart",
    "Discharge_Summary.pdf":    "DS",
    "Hospital_Bill.pdf":        "BILL",
    "Clinical_Vitals.pdf":      "CLINICAL",
    "OT_Notes.pdf":             "Notes",
    "Chemo_Chart.pdf":          "Chart",
    "Drug_Pouch.pdf":           "POUCH",
    "Tumor_Board_Cert.pdf":     "Cert",
    "PET_CT.pdf":               "BIOPSY",
    "Feedback_Form.pdf":        "Form",
    "Geotag_Photo.pdf":         "BILL",
    "Post_Surgery_Photo.pdf":   "POUCH",
    "Anaesthesia_Note.pdf":     "Notes",
}


def find_thumb_with_token(token: str) -> Path | None:
    token_u = token.upper()
    for p in sorted(THUMBS.glob("*.png")):
        if token_u in p.name.upper():
            return p
    return None


def main():
    if not THUMBS.exists():
        print(f"thumbs dir missing — run build_thumbs.py first: {THUMBS}", file=sys.stderr)
        sys.exit(1)

    copied = 0
    missed = []
    for mock_name, token in ALIAS_MAP.items():
        alias_path = THUMBS / (Path(mock_name).stem + ".png")
        if alias_path.exists():
            continue
        src = find_thumb_with_token(token)
        if not src:
            missed.append((mock_name, token))
            continue
        shutil.copyfile(src, alias_path)
        copied += 1

    print(f"copied {copied} aliases into {THUMBS}")
    for m, t in missed:
        print(f"  no thumb matched for {m} (token {t!r})")


if __name__ == "__main__":
    main()
