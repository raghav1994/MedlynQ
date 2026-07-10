"""Parse Sarvam-extracted markdown into structured fields per doc_type.

Sarvam returns rich markdown with HTML tables + free text + per-page JSON.
For each known doc_type we run a targeted regex pass to lift the fields
the UI needs (diagnosis, margins, stage, drugs, totals, dates...).

Always returns the same shape:
    {
      "patient_name": "...", "mrn": "...", "age": "...", "gender": "...",
      "doc_specific": { ...key fields for this doc_type... }
    }
Missing fields come back as None — the UI shows "—".
"""

from __future__ import annotations

import re
from typing import Any

# ---------- patient identity (cross-doc, runs for everything) ----------
# NOTE: the keyword half of each pattern is wrapped in (?i:...) so ONLY that
# part is case-insensitive. Previously `re.IGNORECASE` applied to the WHOLE
# pattern, which silently made "[A-Z]" match lowercase letters too — so
# "the patient is covered with a yellow checkered sheet..." (a Sarvam image
# caption, not a document field) would match "patient" as the keyword and
# capture the rest of the sentence as if it were a real name. Scoping the
# case-insensitivity to just the keyword (so the captured value still has to
# start with a REAL capital letter) is what fixes that — the separator stays
# OPTIONAL because real OCR text often drops the colon (e.g. "Sex M" instead
# of "Sex: M"), and requiring it was rejecting genuine matches too.

# NOTE: bare "Patient" (no "Name") used to be in this keyword list, but
# Sarvam's own descriptive prose for hard-to-read images often uses phrases
# like "**Patient Information:**" or "Patient details" as a section header —
# that's Sarvam captioning the document, not a real labeled field, and it
# would capture "Information"/"Details" as if it were the patient's name.
# Requiring the actual word "Name" makes this specific to real fields.
# Separator is usually ":" but real prescriptions sometimes use ";" instead
# (confirmed: "Name; N Oresh kn" on a real chemo order sheet) — without ";"
# here this document's name/MRN never matched anything, so it looked
# identity-less and silently fell into whatever OTHER patient's group
# happened to be the only one detected in the batch.
NAME_RE   = re.compile(r"(?i:Patient\s*Name|Name)\s*[:;\-]?\s*([A-Z][A-Za-z .'-]{2,60})")
NAME_RE_TBL = re.compile(r"(?i:<th[^>]*>Name</th>\s*<td[^>]*>)\s*:?\s*([A-Z][A-Za-z .'-]{2,60})\s*(?i:</td>)")
# Fallback for prose documents (certificates, referral letters) where the
# name is embedded in a sentence instead of a labeled field, e.g. "This is
# to certify that Mr. MD Ghazali 61 Years male registered...". The value
# stops at the first digit, so it naturally captures just the name portion.
# \b is required before Mr/Mrs/Ms — without it, "ms" matches mid-word inside
# things like "Symptoms" or "Terms", capturing whatever capitalized word
# happened to follow as if it were a name.
NAME_RE_PROSE = re.compile(r"\b(?i:Mr\.?|Mrs\.?|Ms\.?)\s+([A-Z][A-Za-z .'-]{2,60})")
# "CR" alone (no "No") is real on handwritten forms — confirmed on a real
# chemo chart reading "CR : 153798" — without this bare form, that document's
# own MRN never got captured, and it wrongly split into a second patient
# instead of matching his existing "300153798" bill via suffix-match.
# \b BEFORE "CR" is required — without it, this matched the "CR" hiding
# inside "MICROSCOPY" (a lab-report table label) and grabbed "OSCOPY" as if
# it were the patient's MRN. Confirmed as a real regression the very same
# session this bare-CR support was added.
MRN_RE    = re.compile(r"(?i:CR\s*No|\bCR\b|MRN|UHID|Hospital\s*ID|Patient\s*ID|Reg\s*No)\s*[:;\-]?\s*([A-Z0-9/\-]{4,20})")
AGE_SEX   = re.compile(r"(?i:Age/Sex|Age\s*/\s*Sex)\s*[:;\-]?\s*(\d{1,3})\s*(?i:Y|yr|years?)?\s*/?\s*(?i:(Male|Female|M|F))?")
GENDER_RE = re.compile(r"(?i:Sex|Gender)\s*[:;\-]?\s*(?i:(Male|Female|M|F))\b")
# Bare "61 Years male" or "51years old male" with no "Age:"/"Sex:" label at
# all — same prose-letter case. "old" is optional filler some documents add.
AGE_GENDER_PROSE = re.compile(r"\b(\d{1,3})\s*(?i:Years?|Yrs?)\s*(?i:old\s*)?(?i:(Male|Female|M|F))\b")
# Abbreviated "50 Y/M" right after a name, with no "Years"/"Age" word at all —
# common on ID stickers/wristbands that Sarvam quotes verbatim.
AGE_GENDER_ABBR = re.compile(r"\b(\d{1,3})\s*Y\s*/\s*(M|F)\b")

# Sarvam very commonly returns structured fields as HTML tables — LABEL and
# VALUE in separate sibling <td> cells, e.g.
#   <td>Patient Name :</td><td>Mr. ABDUL VAHAB</td>
#   <td>UHID / IP NO</td><td>300165209 (7201)</td>
#   <td>Age/Gender :</td><td>55 Y/M</td>
# None of the inline patterns above ever match this because the label and
# value are separated by literal `</td>...<td>` markup, not by a colon in
# the same run of text. These patterns target that exact sibling-cell shape
# — safe to be plain case-insensitive since the `<td>` structure itself
# (never present in free-flowing prose/captions) is what makes it specific.
NAME_RE_ROWCELL = re.compile(
    r"<td[^>]*>\s*(?:Patient(?:'s)?\s*Name|Name)\s*:?\s*(?:Mr\.?|Mrs\.?|Ms\.?)?\s*</td>\s*<td[^>]*>\s*:?\s*([A-Za-z][A-Za-z .'-]{2,60}?)\s*</td>",
    re.IGNORECASE,
)
# The value cell itself sometimes repeats the colon (e.g. <td>UHID</td><td>:
# 300161362</td>) — the leading ":?\s*" before the capture handles that.
MRN_RE_ROWCELL = re.compile(
    r"<td[^>]*>\s*(?:UHID\s*/?\s*IP\s*NO|UHID|MRN|CR\s*No|Hospital\s*ID|Patient\s*ID|Reg\.?\s*No|IP\s*No)\s*:?\s*</td>\s*<td[^>]*>\s*:?\s*([A-Z0-9][A-Z0-9/\-\s()]{2,25}?)\s*</td>",
    re.IGNORECASE,
)
# The gap between age and gender varies a lot in practice: "55 Y/M", "55/Male",
# or a compound "52 Yrs 11 Mths 27 Days Male" with no slash at all. Allow any
# short run of non-tag filler between the digits and the gender word instead
# of requiring a literal "/".
AGE_GENDER_RE_ROWCELL = re.compile(
    r"<td[^>]*>\s*Age\s*(?:\(Yr\))?\s*/\s*Gender\s*:?\s*</td>\s*<td[^>]*>\s*:?\s*(\d{1,3})[^<]{0,30}?(Male|Female|M|F)",
    re.IGNORECASE,
)

# Words that can follow "Name:"/"Patient:" in real OCR noise but are never
# themselves a patient's name — reject these instead of showing them as if
# they were real data.
_NAME_BLOCKLIST = {
    "mr", "mrs", "ms", "miss", "dr", "sir", "madam", "male", "female",
    "sex", "age", "gender", "mrn", "uhid", "id", "no", "unknown", "n a", "na",
    "information", "details", "detail", "record", "records", "chart",
    "history", "summary", "data", "profile", "here", "below", "above",
}
# A bare 4-digit number that looks like a year is almost always a
# mis-extracted date, not an MRN — real MRNs are longer or contain letters.
_YEAR_LIKE = re.compile(r"^(19|20)\d{2}$")

def _clean_name(raw: str) -> str | None:
    v = raw.strip().strip(":-").strip()
    v = re.sub(r"\s{2,}", " ", v)
    # NAME_RE's character class has no stop-word — on a single-line form like
    # "Name: Jai Prakash Age/sex 73/M CR: 153798", it happily keeps consuming
    # letters straight through the next field's label. Confirmed on a real
    # handwritten chemo chart: this turned "Jai Prakash" into "Jai Prakash
    # Age", which then failed to fuzzy-match his own bill's name and wrongly
    # split him into a second patient. Truncate at the next field label.
    v = re.sub(r"\b(Age|Sex|Gender|CR|MRN|UHID|IP\s*No)\b.*$", "", v, flags=re.IGNORECASE).strip()
    if not v:
        return None
    if v.lower().rstrip(".") in _NAME_BLOCKLIST:
        return None
    # Require something that looks like an actual name: either two+ words
    # (first + last) or a single word of at least 4 letters — filters out
    # stray single tokens like "Mr." that slipped past the blocklist.
    words = v.split()
    letters_only = re.sub(r"[^A-Za-z]", "", v)
    if len(words) < 2 and len(letters_only) < 4:
        return None
    return v

def _clean_mrn(raw: str) -> str | None:
    v = raw.strip()
    if _YEAR_LIKE.match(v):
        return None
    return v

def _patient_identity(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {"patient_name": None, "mrn": None, "age": None, "gender": None}
    # Scheme feedback forms (PMJAY etc.) label the real patient via
    # "Dear: <name>" / "Beneficiary ID: <id>" — check these FIRST. Otherwise
    # the generic NAME_RE/MRN_RE below (which look for bare "Name"/"Hospital
    # ID") match "Hospital Name: Action Cancer Hospital" and "Hospital ID:
    # 31943" on these forms and silently record the HOSPITAL's identity as
    # the patient's — confirmed on a real PMJAY feedback form during testing.
    fb_name = FB_BENEFICIARY_NAME.search(text)
    if fb_name: out["patient_name"] = _clean_name(fb_name.group(1))
    fb_id = FB_BENEFICIARY_ID.search(text)
    if fb_id: out["mrn"] = _clean_mrn(fb_id.group(1))
    # Try the sibling-<td> table shape first — it's Sarvam's dominant format
    # for real hospital documents (labs, bills, discharge summaries all use
    # it) — before falling back to plain inline "Label: Value" text.
    if out["patient_name"] is None:
        m = NAME_RE_ROWCELL.search(text) or NAME_RE_TBL.search(text) or NAME_RE.search(text) or NAME_RE_PROSE.search(text)
        if m: out["patient_name"] = _clean_name(m.group(1))
    if out["mrn"] is None:
        m = MRN_RE_ROWCELL.search(text) or MRN_RE.search(text)
        if m: out["mrn"] = _clean_mrn(m.group(1))
    m = AGE_GENDER_RE_ROWCELL.search(text)
    if m:
        out["age"] = m.group(1)
        out["gender"] = "F" if m.group(2).lower().startswith("f") else "M"
    if out["age"] is None:
        m = AGE_SEX.search(text)
        if m:
            out["age"] = m.group(1)
            if m.group(2):
                g = m.group(2).lower()
                out["gender"] = "F" if g.startswith("f") else "M"
    if out["age"] is None:
        m = AGE_GENDER_PROSE.search(text)
        if m:
            out["age"] = m.group(1)
            out["gender"] = "F" if m.group(2).lower().startswith("f") else "M"
    if out["age"] is None:
        m = AGE_GENDER_ABBR.search(text)
        if m:
            out["age"] = m.group(1)
            out["gender"] = "F" if m.group(2).lower().startswith("f") else "M"
    if not out["gender"]:
        m = GENDER_RE.search(text)
        if m:
            g = m.group(1).lower()
            out["gender"] = "F" if g.startswith("f") else "M"
    return out


# ---------- HPE / Histopathology ----------
HPE_DIAGNOSIS = re.compile(r"OPINION\s*:?\s*(.+?)(?:\n|pSTAGE|Clinical|$)", re.IGNORECASE | re.DOTALL)
HPE_PSTAGE    = re.compile(r"pSTAGE\s*[:\-]?\s*([pPcCyY]?T[0-9a-z]+N[0-9a-z]+(?:M[0-9a-zX]+)?)", re.IGNORECASE)
HPE_GRADE     = re.compile(r"(?:MORPHOLOGICAL\s+)?GRADE\s*[:\-]?\s*(?:GRADE\s+)?([IVX0-9]+)", re.IGNORECASE)
HPE_MARGINS   = re.compile(r"MARGINS\s*[:\-]\s*([^.\n]{4,120})", re.IGNORECASE)
HPE_NODES_POS = re.compile(r"\((\d+)\s*/\s*(\d+)\)", re.IGNORECASE)
HPE_REPORT_DATE = re.compile(r"(?:Approval Level \d+|Final Report|Report Date)\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})", re.IGNORECASE)
HPE_SPECIMEN_DATE = re.compile(r"(?:Collected|Received|Specimen Date)\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})", re.IGNORECASE)
HPE_PATHOLOGIST = re.compile(r"FINAL\s*REPORT\s*BY\s*[:\-]?\s*(DR\.?\s*[A-Z][A-Z .]{2,40})", re.IGNORECASE)

def _parse_hpe(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    m = HPE_DIAGNOSIS.search(text)
    if m: out["diagnosis"] = re.sub(r"\s+", " ", m.group(1).strip()).strip(".")[:200]
    m = HPE_PSTAGE.search(text)
    if m:
        full = m.group(1).upper()
        # Split into T / N / M components
        tm = re.match(r"([pPcCyY]?T[0-9a-z]+)(N[0-9a-z]+)(M[0-9a-zX]+)?", full)
        if tm:
            out["stage_t"] = tm.group(1)
            out["stage_n"] = tm.group(2)
            out["stage_m"] = tm.group(3) or "M0"
    m = HPE_GRADE.search(text)
    if m: out["grade"] = m.group(1).strip()
    m = HPE_MARGINS.search(text)
    if m:
        margin = m.group(1).strip()
        out["margins_status"] = "Clear" if "free" in margin.lower() else margin[:60]
    m = HPE_NODES_POS.search(text)
    if m:
        out["lymph_nodes_positive"] = int(m.group(1))
        out["lymph_nodes_examined"] = int(m.group(2))
    m = HPE_REPORT_DATE.search(text)
    if m: out["report_date"] = m.group(1)
    m = HPE_SPECIMEN_DATE.search(text)
    if m: out["specimen_date"] = m.group(1)
    m = HPE_PATHOLOGIST.search(text)
    if m: out["pathologist"] = m.group(1).strip()
    # Primary site — best-effort: search for "LEFT BREAST" / "RIGHT BREAST" / "LUNG" etc.
    site = re.search(r"\b(LEFT|RIGHT)\s+(BREAST|LUNG|KIDNEY|LIVER|COLON|PROSTATE)\b", text, re.IGNORECASE)
    if site: out["primary_site"] = site.group(0).title()
    return out


# ---------- Discharge Summary ----------
DS_ADM_DATE = re.compile(r"(?:Date\s+of\s+Admission|Admission\s+Date|DOA)\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})", re.IGNORECASE)
DS_DIS_DATE = re.compile(r"(?:Date\s+of\s+Discharge|Discharge\s+Date|DOD)\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})", re.IGNORECASE)
DS_FINAL_DX = re.compile(r"(?:Final\s+Diagnosis|Diagnosis)\s*[:\-]?\s*(.+?)(?:\n|Procedure|Course|Treatment|$)", re.IGNORECASE | re.DOTALL)
DS_PROCEDURE = re.compile(r"(?:Procedure(?:s)?\s+Done|Operation\s+Done)\s*[:\-]?\s*(.+?)(?:\n|Drugs|Follow|$)", re.IGNORECASE | re.DOTALL)

def _parse_discharge(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := DS_ADM_DATE.search(text)): out["admission_date"] = m.group(1)
    if (m := DS_DIS_DATE.search(text)): out["discharge_date"] = m.group(1)
    if (m := DS_FINAL_DX.search(text)):
        out["final_diagnosis"] = re.sub(r"\s+", " ", m.group(1).strip())[:200]
    if (m := DS_PROCEDURE.search(text)):
        out["procedures_done"] = re.sub(r"\s+", " ", m.group(1).strip())[:200]
    return out


# ---------- Bill ----------
# Sarvam returns hospital bills as HTML tables. Each labelled cell is followed
# by a sibling `<td>: VALUE</td>` cell, or the label has `<br/>` then `: VALUE`
# inside the same cell. Patterns below handle both.

def _table_cell(label: str, value_pattern: str = r"[^<\n]{1,120}") -> re.Pattern:
    r"""<td>LABEL</td>\s*<td>: VALUE</td>  — sibling cell pattern."""
    return re.compile(
        rf"<td[^>]*>\s*{label}(?:<br/?>)?\s*</td>\s*<td[^>]*>\s*:?\s*({value_pattern})\s*</td>",
        re.IGNORECASE,
    )

def _cell_or_inline(label: str, value_pattern: str = r"[^<\n]{1,120}") -> re.Pattern:
    """LABEL<br/>: VALUE (inline) OR <td>LABEL</td><td>: VALUE</td>."""
    return re.compile(
        rf"{label}\s*(?:<br/?>)?\s*:?\s*</?td[^>]*>\s*:?\s*({value_pattern})",
        re.IGNORECASE,
    )

# Inline pattern: <td>LABEL<br/>: VALUE</td>  (label+value in same cell)
def _inline_cell(label: str, value_pattern: str = r"[^<\n]{1,120}") -> re.Pattern:
    return re.compile(
        rf"<td[^>]*>\s*{label}\s*<br/?>\s*:?\s*({value_pattern})\s*</td>",
        re.IGNORECASE,
    )

BILL_GSTIN     = re.compile(r"GSTIN\s*[:\-]?\s*([0-9A-Z]{15})", re.IGNORECASE)
BILL_IP        = _table_cell(r"I\.?P\.?\s*No\.?",     r"[A-Z0-9/\-]+")
BILL_BILL_NO_TABLE  = _table_cell(r"Bill\s*No\.?",    r"[A-Z0-9/\-]+")
BILL_BILL_NO_INLINE = _inline_cell(r"Bill\s*No\.?",   r"[A-Z0-9/\-]+")
BILL_BILL_NO   = BILL_BILL_NO_TABLE   # legacy alias
BILL_UHID      = _table_cell(r"UHID",                  r"[A-Z0-9/\-]+")
BILL_BILL_DATE = _table_cell(r"Bill\s+Date",           r"\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}[^<]*")
BILL_PNAME     = _table_cell(r"Patient(?:<br/?>)?\s*Name", r"[A-Z][A-Z .a-z']{2,60}")
BILL_GENDER_AGE= _table_cell(r"Gender/Age",            r"[^<]{3,30}")
BILL_DOA       = _table_cell(r"D\.?O\.?A\.?",          r"\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}[^<]*")
BILL_DOD       = _table_cell(r"D\.?O\.?D\.?",          r"\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}[^<]*")
BILL_PAYER     = _table_cell(r"Payer",                 r"[^<]{3,80}")
BILL_SPONSOR   = _table_cell(r"Sponsor",               r"[^<]{3,80}")
BILL_CONSULT   = _table_cell(r"Consultant",            r"[^<]{3,200}")
BILL_BED       = _table_cell(r"Bed\s*No/Ward",         r"[^<]{3,40}")
BILL_DOCTEAM   = _table_cell(r"Doctor\s*Team",         r"[^<]{3,150}")
BILL_SAC       = _table_cell(r"SAC\s*Code",            r"[0-9]+")
BILL_BILLCAT   = _table_cell(r"Billing\s*Category",    r"[^<]{3,30}")
# Totals can appear as a final summary line outside tables
BILL_GRAND_TOTAL  = re.compile(r"(?:Grand\s+Total|Net\s+Payable|Net\s+Bill|Total\s+Bill|Payable\s+Amount)\s*[:\-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]{3,})", re.IGNORECASE)
BILL_GROSS_TOTAL  = re.compile(r"Gross\s+Total\s*[:\-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]{3,})", re.IGNORECASE)
BILL_PAYER_AMT    = re.compile(r"Payer\s+Amt\.?\s*[:\-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]{3,})", re.IGNORECASE)
# Line-item amounts (catches ANY amount before .00 in line items if no Total found)
BILL_LINE_ITEM_AMT = re.compile(r"(\d{3,}(?:,\d{3})*)\.00\b")

def _parse_bill(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := BILL_GSTIN.search(text)):     out["hospital_gstin"] = m.group(1)
    if (m := BILL_IP.search(text)):        out["ip_no"] = m.group(1).strip()
    # Try inline-cell pattern first (where label+value are in same <td>); fall back to sibling-cell
    if (m := BILL_BILL_NO_INLINE.search(text)) or (m := BILL_BILL_NO_TABLE.search(text)):
        out["bill_no"] = m.group(1).strip()
    if (m := BILL_UHID.search(text)):      out["uhid"] = m.group(1).strip()
    if (m := BILL_BILL_DATE.search(text)): out["bill_date"] = m.group(1).strip()
    if (m := BILL_PNAME.search(text)):     out["patient_name_bill"] = m.group(1).strip()
    if (m := BILL_GENDER_AGE.search(text)):out["gender_age"] = m.group(1).strip()
    if (m := BILL_DOA.search(text)):       out["admission_date"] = m.group(1).strip()
    if (m := BILL_DOD.search(text)):       out["discharge_date"] = m.group(1).strip()
    if (m := BILL_PAYER.search(text)):     out["payer"] = m.group(1).strip()
    if (m := BILL_SPONSOR.search(text)):   out["sponsor"] = m.group(1).strip()
    if (m := BILL_CONSULT.search(text)):   out["consultant"] = m.group(1).strip()
    if (m := BILL_BED.search(text)):       out["bed_ward"] = m.group(1).strip()
    if (m := BILL_DOCTEAM.search(text)):   out["doctor_team"] = m.group(1).strip()
    if (m := BILL_SAC.search(text)):       out["sac_code"] = m.group(1).strip()
    if (m := BILL_BILLCAT.search(text)):   out["billing_category"] = m.group(1).strip()
    if (m := BILL_GROSS_TOTAL.search(text)): out["gross_total"]  = int(m.group(1).replace(",", ""))
    if (m := BILL_GRAND_TOTAL.search(text)): out["total_amount"] = int(m.group(1).replace(",", ""))
    if (m := BILL_PAYER_AMT.search(text)):   out["payer_amount"] = int(m.group(1).replace(",", ""))
    # Fallback: if no total found, sum line-item amounts (only when present)
    if "total_amount" not in out and "gross_total" not in out:
        amts = [int(g.replace(",", "")) for g in BILL_LINE_ITEM_AMT.findall(text)]
        if amts:
            out["sum_of_line_items"] = sum(amts)
            out["line_item_count"] = len(amts)
    return out


# ---------- Chemo Chart / Prescription ----------
CC_BSA          = re.compile(r"BSA\s*[:\-]?\s*(\d+\.\d+)\s*m\s*/?\s*2", re.IGNORECASE)
CC_STAGE        = re.compile(r"Stage\s*[:\-]?\s*([pPcCyY]?T[0-9a-z]+N[0-9a-z]+(?:M[0-9a-zX]+)?)", re.IGNORECASE)
CC_HER2         = re.compile(r"HER[\s\-]?2[\-\s]?(?:NEU)?[\s:\-]*([0-9\+\-]+%?)", re.IGNORECASE)
CC_ER           = re.compile(r"\bER[\s:\-]+([0-9\+\-]+%?)", re.IGNORECASE)
CC_PR           = re.compile(r"\bPR[\s:\-]+([0-9\+\-]+%?)", re.IGNORECASE)
CC_KI67         = re.compile(r"Ki[\s\-]?67[\s:\-]*([0-9\+\-]+%?)", re.IGNORECASE)
CC_LVEF         = re.compile(r"LVEF[\s:\-]*(\d{1,3}%?)", re.IGNORECASE)
CC_PKG_CODE     = re.compile(r"Code\s*[:\-]?\s*([A-Z]{2,5}\d{3,4}[A-Z])", re.IGNORECASE)
CC_CYCLE        = re.compile(r"(\d+)(?:st|nd|rd|th)\s+Cycle\s+(\d{1,2}[\-./]\d{1,2}[\-./]\d{2,4})", re.IGNORECASE)
CC_REGIMEN_CYC  = re.compile(r"x\s*(\d+)\s*cyc", re.IGNORECASE)
CC_HT           = re.compile(r"Ht\s*[:\-]?\s*(\d+)\s*cm", re.IGNORECASE)
CC_WT           = re.compile(r"Wt\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*kg", re.IGNORECASE)
# Drug pattern: `Inj <Brand> <dose><unit>` (chemo orders are usually Inj-prefixed)
CC_DRUG_LINE = re.compile(
    r"(?:Inj|Inf|Tab|Cap)\s+([A-Z][a-zA-Z]{2,30})\s+(\d{1,4}(?:\.\d+)?)\s*(mg|mcg|gm|g|ml|units|mg/m[²2]|mg/kg|iu)",
    re.IGNORECASE,
)

def _parse_chemo_chart(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := CC_BSA.search(text)):      out["bsa_m2"] = float(m.group(1))
    if (m := CC_STAGE.search(text)):
        full = m.group(1).upper()
        tm = re.match(r"([pPcCyY]?T[0-9a-z]+)(N[0-9a-z]+)(M[0-9a-zX]+)?", full)
        if tm:
            out["stage_t"] = tm.group(1)
            out["stage_n"] = tm.group(2)
            out["stage_m"] = tm.group(3) or "M0"
    if (m := CC_ER.search(text)):       out["receptor_er"] = m.group(1)
    if (m := CC_PR.search(text)):       out["receptor_pr"] = m.group(1)
    if (m := CC_HER2.search(text)):     out["receptor_her2"] = m.group(1)
    if (m := CC_KI67.search(text)):     out["ki67"] = m.group(1)
    if (m := CC_LVEF.search(text)):     out["lvef"] = m.group(1)
    if (m := CC_PKG_CODE.search(text)): out["package_code"] = m.group(1).upper()
    if (m := CC_CYCLE.search(text)):
        out["cycle_no"] = int(m.group(1))
        out["administration_date"] = m.group(2)
    if (m := CC_REGIMEN_CYC.search(text)):
        out["total_cycles"] = int(m.group(1))
    if (m := CC_HT.search(text)):       out["height_cm"] = int(m.group(1))
    if (m := CC_WT.search(text)):       out["weight_kg"] = float(m.group(1))

    # Drug list
    drugs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in CC_DRUG_LINE.finditer(text):
        name = m.group(1).strip()
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        drugs.append({"name": name, "dose": f"{m.group(2)}{m.group(3).lower()}"})
    if drugs:
        out["drugs"] = "; ".join(f"{d['name']} {d['dose']}" for d in drugs[:12])
        out["drug_count"] = len(drugs)
    return out


# ---------- Lab Report ----------
# Sarvam returns labs as HTML tables. Each row:
#   <td>TEST_NAME</td><td>VALUE[ H/L]</td><td>UNIT</td><td>REF_RANGE</td>...
LAB_ROW = re.compile(
    r"<tr>\s*<td[^>]*>\s*([A-Z][A-Z a-z()/\-,.\d]{2,60})\s*</td>\s*"
    r"<td[^>]*>\s*([\d.]+)\s*([HL])?\s*</td>\s*"
    # Unit + ref range cells may be partially empty in lab tables — make them optional
    r"(?:<td[^>]*>\s*([A-Za-z/%³µ²°]*(?:/[A-Za-zµ²]+)?)\s*</td>\s*)?"
    r"(?:<td[^>]*>\s*([0-9.\s\-<>]{0,30})\s*</td>)?",
    re.IGNORECASE,
)
LAB_NO          = re.compile(r"Lab\s*No(?:\s*/\s*Status)?\s*[:\-]?\s*<br\s*/?>?\s*</?td[^>]*>\s*<?td?[^>]*>?\s*:?\s*(\d{5,12})", re.IGNORECASE)
LAB_SAMPLE_DATE = re.compile(r"Sample\s*Date\s*<br\s*/?>", re.IGNORECASE)
LAB_PROFILE     = re.compile(r"<td[^>]*colspan=\"\d+\"[^>]*>\s*([A-Z][A-Z 0-9()/\-]{4,60})\s*</td>", re.IGNORECASE)
LAB_COMPANY     = re.compile(r"(SHA[^<]{3,60}|CGHS[^<]{0,60}|ECHS[^<]{0,60}|Railway[^<]{0,60}|Self[^<]{0,30}|CASH[^<]{0,30})", re.IGNORECASE)
LAB_DATES_BLOCK = re.compile(r"(\d{1,2}/\d{1,2}/\d{2,4}\s*\d{1,2}:\d{2}(?:AM|PM)?)", re.IGNORECASE)
LAB_REFERED_BY  = re.compile(r"Refered\s*By\s*</td>\s*<td[^>]*>\s*(Dr\.?[^<]{2,60})\s*</td>", re.IGNORECASE)
LAB_CREATININE_HIGH = re.compile(r"Creatinine.+?(\d+\.?\d*)\s*H", re.IGNORECASE | re.DOTALL)

def _parse_lab_report(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}

    # All test rows
    tests: list[dict[str, Any]] = []
    abnormal: list[dict[str, Any]] = []
    seen: set[str] = set()
    NOISE = {"uhid-ip no", "lab no", "bed no/ward", "age/gender", "refered by", "patient name", "test name", "result"}
    for m in LAB_ROW.finditer(text):
        name = re.sub(r"\s+", " ", m.group(1).strip())
        value = m.group(2)
        flag = m.group(3)
        unit = (m.group(4) or "").strip()
        ref = re.sub(r"\s+", " ", (m.group(5) or "").strip())
        if len(name) < 3 or name.lower() in seen or name.lower() in NOISE:
            continue
        # Skip non-lab rows where unit is missing AND no decimal in value (e.g. headers)
        if not unit and "." not in value and len(value) < 2:
            continue
        # Skip MRN-like values when name is suspicious
        if name.lower().startswith("uhid"):
            continue
        seen.add(name.lower())
        entry = {"test": name, "value": value, "unit": unit, "ref": ref, "flag": flag}
        tests.append(entry)
        if flag:
            abnormal.append(entry)

    if tests:
        out["test_count"] = len(tests)
        out["sample_tests"] = " | ".join(f"{t['test']} {t['value']}{t['flag'] or ''} {t['unit']}" for t in tests[:10])
    if abnormal:
        out["abnormal_count"] = len(abnormal)
        out["abnormal_values"] = " | ".join(
            f"{t['test']} {t['value']}{t['flag']} {t['unit']} (ref {t['ref']})"
            for t in abnormal
        )

    # Header fields
    if (m := LAB_PROFILE.search(text)):
        prof = m.group(1).strip()
        if "DEPARTMENT" not in prof.upper() and "LAB" not in prof.upper() or "TEST" in prof.upper():
            out["panel"] = prof
    if (m := LAB_REFERED_BY.search(text)):
        out["referred_by"] = m.group(1).strip().rstrip("</")

    # Lab number — flexible pattern
    lab_no_m = re.search(r"(\d{6,8})\s*/\s*Final", text, re.IGNORECASE)
    if lab_no_m: out["lab_no"] = lab_no_m.group(1)

    # Sample / Report dates — pick first 3 date-time stamps in lab block
    dates = LAB_DATES_BLOCK.findall(text)
    if dates:
        if len(dates) >= 1: out["sample_date"]    = dates[0].strip()
        if len(dates) >= 3: out["report_date"]    = dates[2].strip()

    return out


# ---------- Tumor Board Certificate ----------
TBC_DATE = re.compile(r"(?:Board\s+Date|Meeting\s+Date|Date\s+of\s+Decision)\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})", re.IGNORECASE)
TBC_DECISION = re.compile(r"(?:Decision|Recommendation|Plan)\s*[:\-]?\s*(.+?)(?:\n|$)", re.IGNORECASE | re.DOTALL)

def _parse_tbc(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := TBC_DATE.search(text)):     out["board_date"] = m.group(1)
    if (m := TBC_DECISION.search(text)):
        out["recommendation"] = re.sub(r"\s+", " ", m.group(1).strip())[:200]
    return out


# ---------- Main entry ----------
# ---------- Feedback Form (PMJAY beneficiary feedback) ----------
FB_BENEFICIARY_ID  = re.compile(r"Beneficiary\s*ID\s*[:\-]?\s*([A-Z0-9]{6,15})", re.IGNORECASE)
FB_PACKAGE_CODE    = re.compile(r"Package\s*Code\s*[:\-]?\s*\[?([A-Z0-9]{4,8})\]?", re.IGNORECASE)
FB_HOSPITAL_NAME   = re.compile(r"Hospital\s*Name\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 &.,'\-]{4,80})", re.IGNORECASE)
FB_HOSPITAL_CODE   = re.compile(r"\b(HOSP[A-Z0-9]{6,12})\b", re.IGNORECASE)
FB_HOSPITAL_ID     = re.compile(r"Hospital\s*ID\s*[:\-]?\s*(\d{4,8})", re.IGNORECASE)
FB_SCHEME_PM_JAY   = re.compile(r"PM[\-\s]?JAY", re.IGNORECASE)
FB_BENEFICIARY_NAME= re.compile(r"Dear\s*[:\-]?\s*([A-Z][A-Za-z .'-]{2,60})", re.IGNORECASE)

def _parse_feedback(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := FB_BENEFICIARY_NAME.search(text)): out["beneficiary_name"]   = m.group(1).strip()
    if (m := FB_BENEFICIARY_ID.search(text)):   out["beneficiary_id"]     = m.group(1).strip()
    if (m := FB_PACKAGE_CODE.search(text)):
        code = m.group(1).strip().upper()
        # Common OCR confusion: M0001F should be MO001F  (0 vs O)
        if re.match(r"M0\d{3}F$", code):
            code = "MO" + code[2:]
            out["package_code_ocr_corrected"] = True
        out["package_code"] = code
    if (m := FB_HOSPITAL_NAME.search(text)):    out["hospital_name"]     = m.group(1).strip().rstrip("[")
    if (m := FB_HOSPITAL_CODE.search(text)):    out["hospital_code"]     = m.group(1).strip().upper()
    if (m := FB_HOSPITAL_ID.search(text)):      out["hospital_id"]       = m.group(1).strip()
    if FB_SCHEME_PM_JAY.search(text):           out["scheme_referenced"] = "AB PM-JAY"
    return out


# ---------- Drug Pouch / Wrapper (when text is captured) ----------
POUCH_BATCH = re.compile(r"\b(?:Batch|B\.No|Lot)\.?\s*(?:No\.?)?\s*[:\-]?\s*([A-Z0-9\-/]{4,15})", re.IGNORECASE)
POUCH_EXP   = re.compile(r"\b(?:Exp|Expiry)\.?\s*(?:Date)?\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,4}(?:[\-/]\d{2,4})?)", re.IGNORECASE)
POUCH_MFG   = re.compile(r"\b(?:Mfg|Mfd|Manufactured)\.?\s*(?:Date)?\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,4}(?:[\-/]\d{2,4})?)", re.IGNORECASE)
POUCH_DRUG  = re.compile(r"\b(Trastuzumab|Paclitaxel|Docetaxel|Doxorubicin|Cyclophosphamide|Carboplatin|Rituximab|Bevacizumab|Pembrolizumab|Nivolumab)\b", re.IGNORECASE)

def _parse_pouch(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := POUCH_BATCH.search(text)):  out["batch_no"]      = m.group(1).strip()
    if (m := POUCH_EXP.search(text)):    out["expiry_date"]   = m.group(1).strip()
    if (m := POUCH_MFG.search(text)):    out["mfg_date"]      = m.group(1).strip()
    if (m := POUCH_DRUG.search(text)):   out["drug_name"]     = m.group(1).strip()
    return out


# ---------- Clinical Vitals Log ----------
CV_TEMP   = re.compile(r"(?:Temp|Temperature)\s*[:\-]?\s*(\d{2,3}\.\d|\d{2,3})\s*°?F?", re.IGNORECASE)
CV_PULSE  = re.compile(r"(?:Pulse|HR)\s*[:\-]?\s*(\d{2,3})\s*(?:BPM|bpm|/min)?", re.IGNORECASE)
CV_BP     = re.compile(r"(?:BP|Blood\s*Pressure)\s*[:\-]?\s*(\d{2,3})\s*/\s*(\d{2,3})", re.IGNORECASE)
CV_RR     = re.compile(r"\bRR\s*[:\-]?\s*(\d{1,3})\s*(?:/min)?", re.IGNORECASE)
CV_SPO2   = re.compile(r"(?:SpO2|SPO2|Sp\.O2)\s*[:\-]?\s*(\d{1,3})\s*%?", re.IGNORECASE)
CV_WT     = re.compile(r"\bWt\.?\s*[:\-]?\s*(\d{1,3}(?:\.\d)?)\s*kg", re.IGNORECASE)
CV_HT     = re.compile(r"\bHt\.?\s*[:\-]?\s*(\d{2,3})\s*cm", re.IGNORECASE)

def _parse_vitals(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if (m := CV_TEMP.search(text)):  out["temperature_f"] = m.group(1)
    if (m := CV_PULSE.search(text)): out["pulse_bpm"]     = int(m.group(1))
    if (m := CV_BP.search(text)):    out["bp_systolic"]   = int(m.group(1)); out["bp_diastolic"] = int(m.group(2))
    if (m := CV_RR.search(text)):    out["respiratory_rate"] = int(m.group(1))
    if (m := CV_SPO2.search(text)):  out["spo2_pct"]      = int(m.group(1))
    if (m := CV_WT.search(text)):    out["weight_kg"]     = float(m.group(1))
    if (m := CV_HT.search(text)):    out["height_cm"]     = int(m.group(1))
    return out


PARSERS: dict[str, Any] = {
    "hpe_report":            _parse_hpe,
    "histopathology":        _parse_hpe,
    "discharge_summary":     _parse_discharge,
    "bill":                  _parse_bill,
    "hospital_bill":         _parse_bill,
    "chemo_chart":           _parse_chemo_chart,
    "doctors_prescription":  _parse_chemo_chart,    # same format in oncology
    "prescription":          _parse_chemo_chart,
    "lab_report":            _parse_lab_report,
    "tumor_board_cert":      _parse_tbc,
    "feedback_form":         _parse_feedback,
    "drug_pouch":            _parse_pouch,
    "clinical_vitals_log":   _parse_vitals,
}

def parse(markdown: str, doc_type: str | None = None) -> dict[str, Any]:
    text = markdown or ""
    identity = _patient_identity(text)
    parser = PARSERS.get((doc_type or "").lower().replace(" ", "_"))
    doc_fields = parser(text) if parser else {}
    return {
        **identity,
        "doc_type": doc_type,
        "doc_specific": doc_fields,
    }


if __name__ == "__main__":
    import json, sys
    raw = sys.stdin.read() if not sys.stdin.isatty() else " ".join(sys.argv[2:])
    dt = sys.argv[1] if len(sys.argv) > 1 else None
    print(json.dumps(parse(raw, dt), indent=2, ensure_ascii=False))
