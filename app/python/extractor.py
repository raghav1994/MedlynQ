"""
MedLynq extractor CLI (v3 — corpus-trained rules).

Classifies docs using BOTH filename + PDF text, with rules trained on the
488-case corpus from PatientLog\\Approved\\corpus\\master_documents.csv.

Short keywords (<=3 chars) use whole-token matching to avoid spurious hits
(e.g. "DS" matches DS_0001 but NOT DSSS or DSPP).
"""

import os, io, sys, json, re, traceback
import fitz  # PyMuPDF
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compressor import compress_pdf_safe, compress_standalone_image  # noqa: E402


# ---------- DOC TYPE CLASSIFIER (filename + text rules) ----------
# More specific patterns first. Whole-token matching for short keywords.

CLASSIFIER_RULES = [
    # Oncology-specific (NEW)
    {"label": "Tumor Board Certificate",
     "filename_keywords": ["TBC", "TUMOR_BOARD", "TUMOR_BOARD_CERT"],
     "text_keywords": ["tumor board", "multidisciplinary tumor board", "tumour board"]},

    {"label": "Beneficiary Verification Slip",
     "filename_keywords": ["BIS", "BENEFICIARY_VERIFICATION", "BENEFICIARY_SLIP", "ELIGIBILITY_SLIP"],
     "text_keywords": ["beneficiary identification", "eligibility verification", "beneficiary verification"]},

    {"label": "PET-CT Report",
     "filename_keywords": ["PETCT", "PET_CT", "PET-CT", "PETSCAN", "PET_SCAN"],
     "text_keywords": ["pet-ct", "pet scan", "fdg uptake", "fdg-pet"]},

    {"label": "Chemo Chart",
     "filename_keywords": ["CHEMOCHART", "CHEMO_CHART", "TRANS", "TRANSS", "TRANSDD", "TRANSMITTAL", "TRAN"],
     "text_keywords": ["chemotherapy chart", "chemo chart", "transfusion chart"]},

    {"label": "Discharge Photo",
     "filename_keywords": ["DSP", "DIS_PIC", "DISCHARGE_PIC", "DISCHARGE_PHOTO", "DSPP"],
     "text_keywords": []},

    {"label": "Discharge Summary",
     "filename_keywords": ["DSSS", "DSS", "DS", "DSCH", "DISCHARGE", "DISCHARGE_SUMM", "DISCHARGE_SUMMARY", "DISCHARGE_NOTE"],
     "text_keywords": ["discharge summary", "discharge sheet", "discharge note", "summary of discharge"]},

    {"label": "Hospital Bill",
     "filename_keywords": ["BILL", "INVOICE", "TAX_INVOICE", "IPD_BILL", "HOSPITAL_BILL"],
     "text_keywords": ["bill of supply", "tax invoice", "ipd bill", "hospital bill", "amount due", "grand total"]},

    {"label": "Feedback Form",
     "filename_keywords": ["FB", "FEEDBACK", "FEEDBACK_FORM"],
     "text_keywords": ["feedback form", "patient feedback", "feedback questionnaire"]},

    {"label": "Drug Pouch / Wrapper Photo",
     "filename_keywords": ["POUCH", "WRAPPER", "DRUG_POUCH", "DRUG_WRAPPER", "AMP", "AMPOULE"],
     "text_keywords": ["pouch", "wrapper", "drug barcode", "trastuzumab pouch"]},

    {"label": "Prescription / Protocol",
     "filename_keywords": ["PROTOCOL", "PROTO", "REGIMEN", "PRESC", "PRESCRIPTION", "RXSLIP"],
     "text_keywords": ["chemotherapy protocol", "treatment protocol", "drug regimen", "prescribed regimen"]},

    {"label": "Latest Pathology (HPE)",
     "filename_keywords": ["HPE", "HPEF", "HISTO", "HISTOPATH", "PATHOLOGY", "BIOPSY", "FNAC", "IHC", "IMMUNO"],
     "text_keywords": ["histopathology", "histopath", "hpe report", "biopsy report", "pathology report",
                       "fine needle aspiration", "immunohistochemistry"]},

    {"label": "Lab Report",
     "filename_keywords": ["LAB", "LAB_REPORT", "LABREPORT"],
     "text_keywords": ["lab report", "laboratory report"]},

    {"label": "Query Response Document",
     "filename_keywords": ["QUERY", "QUERY_REPLY", "QUERY_RESPONSE", "QREPLY"],
     "text_keywords": ["query reply", "query response", "in response to query"]},

    {"label": "OT Notes",
     "filename_keywords": ["OT_NOTES", "OT_NOTE", "OPERATIVE_NOTES"],
     "text_keywords": ["operation theatre notes", "ot notes", "operative notes"]},

    {"label": "OT Files",
     "filename_keywords": ["OT_FILE", "OT_FILES", "OT_RECORD", "OT"],
     "text_keywords": ["ot record", "ot file", "operating room record"]},

    {"label": "Anaesthesia Note",
     "filename_keywords": ["ANAES", "ANAESTHESIA", "ANESTHESIA", "ANES"],
     "text_keywords": ["anaesthesia", "anesthesia note", "anaesthetic"]},

    {"label": "Post Surgery Photo",
     "filename_keywords": ["POSTOP", "POST_OP", "POST_SURGERY", "WOUND"],
     "text_keywords": ["post-operative photo", "wound photo", "post-op image"]},

    {"label": "Post-op Notes",
     "filename_keywords": ["POSTOP_NOTES", "POST_OP_NOTES", "IPW", "INPATIENT_WARD"],
     "text_keywords": ["post-op notes", "post-operative notes", "in-patient ward notes"]},

    {"label": "Geotag Photo",
     "filename_keywords": ["GEOTAG", "GEO_TAG", "GEOTAG_DISCHARGE"],
     "text_keywords": ["geotag", "geo-tagged photo"]},

    {"label": "CBC / LFT / KFT Profile",
     "filename_keywords": ["CBC", "LFT", "KFT", "BLOOD_PROFILE", "BASELINE_REPORT", "CBC_BASELINE", "RFT"],
     "text_keywords": ["complete blood count", "cbc report", "liver function", "kidney function", "blood profile", "lab report"]},

    {"label": "Patient ID",
     "filename_keywords": [
         "PATIENT_ID", "ID_PROOF", "ID_CARD", "PAN_CARD",
         "AYUSHMAN", "AYUSHMAN_CARD",
         "ADHAR", "AADHAR", "ADHAR_CARD", "AADHAR_CARD", "AADHAAR", "AADHAAR_CARD", "UIDAI",
         "VOTER", "VOTERID", "VOTER_ID",
         "HEALTH_CARD", "HEALTH",
         "RATION", "RATION_CARD",
         "CGHS_CARD", "ECHS_CARD", "PMJAY_CARD",
         "FAMILY_ID", "FAMILYID"
     ],
     "text_keywords": ["aadhaar", "uidai", "voter id", "pan card", "identity proof", "ayushman card", "ration card", "family id"]},

    {"label": "Consent Form",
     "filename_keywords": ["CONSENT", "CONSENT_FORM", "INFORMED_CONSENT"],
     "text_keywords": ["consent form", "informed consent", "patient consent"]},

    {"label": "Referral",
     "filename_keywords": ["REFERRAL", "REFERRAL_LETTER", "REFERRAL_INTAKE", "REF_LETTER", "REFER"],
     "text_keywords": ["referral letter", "referred by", "reference letter"]},

    {"label": "Registration Copy",
     "filename_keywords": ["REGISTRATION", "REG_COPY", "REGISTRATION_COPY"],
     "text_keywords": ["registration form", "hospital registration", "patient registration"]},

    {"label": "Clinical Vitals Log",
     "filename_keywords": ["VITALS", "CLINICAL_NOTES", "TPR", "VITAL_CHART", "CLINICAL"],
     "text_keywords": ["vitals chart", "tpr chart", "vital signs"]},

    {"label": "Prior Imaging (CT/MRI/X-ray)",
     "filename_keywords": ["XRAY", "X_RAY", "CT_SCAN", "MRI", "ULTRASOUND", "USG", "IMAGING"],
     "text_keywords": ["x-ray", "ct scan", "mri report", "ultrasound", "imaging study"]},

    {"label": "Radiation Files",
     "filename_keywords": ["RADIATION", "RAD_FILE", "RT_FILE", "RADIO_FILE"],
     "text_keywords": ["radiation therapy file", "rt file", "radiation record"]},

    {"label": "Radiation Chart",
     "filename_keywords": ["RAD_CHART", "RADIATION_CHART", "RT_CHART"],
     "text_keywords": ["radiation chart", "rt chart"]},

    {"label": "IPD File (admission)",
     "filename_keywords": ["IPD_ADMISSION", "IPD_ADM"],
     "text_keywords": ["ipd admission", "in-patient admission"]},

    {"label": "IPD File (day care)",
     "filename_keywords": ["IPD_DAYCARE", "IPD_DAY", "DAYCARE"],
     "text_keywords": ["ipd day care", "day-care file"]},

    {"label": "IPD File",
     "filename_keywords": ["IPD"],
     "text_keywords": []},

    {"label": "OPD Slip",
     "filename_keywords": ["OPD", "OPD_SLIP"],
     "text_keywords": ["opd slip", "outpatient department"]},

    {"label": "Generic Photo (needs review)",
     "filename_keywords": ["PIC", "PHOTO", "OT_PICS", "PICS"],
     "text_keywords": []},

    {"label": "Pre-merged Packet",
     "filename_keywords": ["MERGED", "MERGED_PACKET", "BUNDLE", "COMBINED"],
     "text_keywords": []},

    # ===== Cardiac =====
    {"label": "ECHO Report",
     "filename_keywords": ["ECHO", "ECHOCARDIO", "TTE", "TEE"],
     "text_keywords": ["echocardiogram", "transthoracic echo", "lvef", "ejection fraction"]},

    {"label": "ECG Report",
     "filename_keywords": ["ECG", "EKG"],
     "text_keywords": ["electrocardiogram", "ecg report", "sinus rhythm", "12-lead ecg"]},

    {"label": "Coronary Angiography Report",
     "filename_keywords": ["CAG", "CORANGIO", "CORONARY_ANGIO", "ANGIOGRAM", "CORONARY"],
     "text_keywords": ["coronary angiography", "coronary angiogram", "lad stenosis", "rca", "lcx"]},

    {"label": "Cath Lab Note",
     "filename_keywords": ["CATH", "CATHLAB", "CATH_LAB", "PCI_NOTE"],
     "text_keywords": ["cath lab", "catheterisation lab", "pci procedure", "balloon angioplasty"]},

    {"label": "Stent / Implant Invoice",
     "filename_keywords": ["STENT_INVOICE", "STENT", "IMPLANT_INVOICE", "STENT_BILL"],
     "text_keywords": ["stent invoice", "drug eluting stent", "des invoice", "implant invoice"]},

    {"label": "Cardiac Pre-Op Workup",
     "filename_keywords": ["CARDIAC_WORKUP", "PREOP_CARDIAC", "CARDIAC_PREOP"],
     "text_keywords": ["cardiac workup", "pre-operative cardiac evaluation"]},

    # ===== Ortho =====
    {"label": "Pre-Op X-Ray",
     "filename_keywords": ["PREOP_XRAY", "PRE_OP_XRAY", "PRE_XRAY"],
     "text_keywords": ["pre-operative x-ray", "pre-op radiograph"]},

    {"label": "Post-Op X-Ray",
     "filename_keywords": ["POSTOP_XRAY", "POST_OP_XRAY", "POST_XRAY"],
     "text_keywords": ["post-operative x-ray", "post-op radiograph"]},

    {"label": "MRI / CT Joint Report",
     "filename_keywords": ["MRI_JOINT", "CT_JOINT", "JOINT_MRI", "JOINT_CT"],
     "text_keywords": ["mri knee", "mri shoulder", "mri spine", "ct joint", "meniscal tear"]},

    {"label": "Implant Sticker / Barcode",
     "filename_keywords": ["IMPLANT_STICKER", "IMPLANT_BARCODE", "IMPLANT_LABEL"],
     "text_keywords": ["implant sticker", "implant barcode", "lot no", "batch no"]},

    {"label": "Ortho OT Notes",
     "filename_keywords": ["ORTHO_OT", "ORTHO_NOTES"],
     "text_keywords": ["ortho ot notes", "orthopaedic procedure"]},

    {"label": "Ortho Surgeon Note",
     "filename_keywords": ["ORTHO_NOTE", "ORTHO_SURGEON"],
     "text_keywords": ["orthopaedic surgeon", "ortho consultation"]},

    # ===== Dialysis =====
    {"label": "Dialysis Frequency Log",
     "filename_keywords": ["DIALYSIS_LOG", "HD_LOG", "DIALYSIS_FREQ"],
     "text_keywords": ["dialysis frequency", "hd session", "haemodialysis log"]},

    {"label": "KT/V or URR Note",
     "filename_keywords": ["KTV", "URR", "KT_V"],
     "text_keywords": ["kt/v", "urea reduction ratio"]},

    {"label": "AV Fistula / Access Note",
     "filename_keywords": ["AVF", "FISTULA", "VASCULAR_ACCESS"],
     "text_keywords": ["av fistula", "vascular access", "av graft"]},

    {"label": "Renal Function Panel",
     "filename_keywords": ["RFT", "RENAL_PANEL", "KFT"],
     "text_keywords": ["renal function", "egfr", "serum creatinine"]},

    # ===== ICU =====
    {"label": "Ventilator / Vitals Chart",
     "filename_keywords": ["VENT_CHART", "VENTILATOR", "ICU_CHART", "VITALS_ICU"],
     "text_keywords": ["ventilator settings", "fio2", "peep", "tidal volume", "icu vitals"]},

    {"label": "ICU Admission Note",
     "filename_keywords": ["ICU_ADMISSION", "ICU_ADMIT"],
     "text_keywords": ["icu admission", "intensive care admission"]},

    {"label": "APACHE / SOFA Score Sheet",
     "filename_keywords": ["APACHE", "SOFA", "ICU_SCORE"],
     "text_keywords": ["apache ii", "apache score", "sofa score"]},

    {"label": "Daily Progress Notes",
     "filename_keywords": ["PROGRESS_NOTES", "DAILY_PROGRESS"],
     "text_keywords": ["daily progress note", "progress note"]},

    # ===== Maternity =====
    {"label": "Antenatal Card",
     "filename_keywords": ["ANC", "ANTENATAL", "ANC_CARD"],
     "text_keywords": ["antenatal card", "anc visits", "gestational age"]},

    {"label": "USG Reports",
     "filename_keywords": ["USG", "ULTRASOUND", "OBS_USG"],
     "text_keywords": ["ultrasound report", "obstetric ultrasound", "fetal ultrasound"]},

    {"label": "Delivery Note",
     "filename_keywords": ["DELIVERY_NOTE", "DELIVERY", "LSCS_NOTE", "VAGINAL_DEL"],
     "text_keywords": ["delivery note", "lscs", "lower segment caesarean", "vaginal delivery"]},

    {"label": "NICU Chart",
     "filename_keywords": ["NICU_CHART", "NICU"],
     "text_keywords": ["nicu chart", "neonatal icu"]},

    {"label": "Partograph",
     "filename_keywords": ["PARTOGRAPH"],
     "text_keywords": ["partograph"]},

    {"label": "Maternal Blood Group / VDRL / HIV",
     "filename_keywords": ["BLOOD_GROUP", "VDRL", "HIV_TEST", "MATERNAL_LABS"],
     "text_keywords": ["blood group", "vdrl", "hiv test", "rh typing"]},
]


def _norm_filename(name):
    base = os.path.splitext(os.path.basename(name))[0]
    base = base.upper()
    base = re.sub(r"[\s\-\.]+", "_", base)
    base = re.sub(r"_+", "_", base).strip("_")
    return base


def _fname_match(fname_norm, kw):
    """Whole-token match for short keywords (<=3 chars), substring otherwise."""
    if len(kw) <= 3:
        return kw in fname_norm.split("_") or fname_norm == kw
    return kw in fname_norm


def _looks_like_mrn(fname_norm):
    """
    Heuristic: filename is an MRN-like string when clerks photograph
    a patient ID and name the file after the MRN itself.
    Pattern: 8–14 chars, all uppercase alphanumeric, mix of letters AND digits.
    """
    if not (8 <= len(fname_norm) <= 14):
        return False
    if "_" in fname_norm:
        return False
    if not re.match(r"^[A-Z0-9]+$", fname_norm):
        return False
    has_letter = bool(re.search(r"[A-Z]", fname_norm))
    has_digit = bool(re.search(r"[0-9]", fname_norm))
    return has_letter and has_digit


def classify_doc(filename, text):
    fname_norm = _norm_filename(filename)
    text_low = (text or "").lower()

    best = ("Unclassified", 0.0, "none")

    for rule in CLASSIFIER_RULES:
        fname_hit = any(_fname_match(fname_norm, kw) for kw in rule["filename_keywords"])
        text_hit = any(kw in text_low for kw in rule["text_keywords"])

        if fname_hit and text_hit:
            score, source = 0.97, "filename+text"
        elif fname_hit:
            score, source = 0.90, "filename"
        elif text_hit:
            score, source = 0.80, "text"
        else:
            continue

        if score > best[1]:
            best = (rule["label"], score, source)

    # Fallback: file named after MRN is almost always a Patient ID photo
    if best[0] == "Unclassified" and _looks_like_mrn(fname_norm):
        return ("Patient ID", 0.75, "mrn_heuristic")

    return best


# ---------- FIELD EXTRACTION (regex) ----------
FIELD_PATTERNS = {
    "patient_name": [
        r"(?:patient\s*name|name\s*of\s*patient|patient\s*:)\s*[:\-]?\s*([A-Z][A-Za-z\s\.]{2,60}?)(?:\n|$|\s{3,})",
        r"\bname\s*[:\-]\s*((?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)?\s*[A-Z][A-Z][A-Za-z\s\.]{2,40})",
        r"\b(?:beneficiary|ben)\s*name\s*[:\-]\s*([A-Z][A-Za-z\s\.]{2,40})",
    ],
    "mrn": [
        r"(?:mrn|hospital\s*id|reg(?:istration)?\s*no|patient\s*id|uhid|uhpid)\s*[:\-]?\s*([A-Z0-9\-\/]{4,20})",
        r"\bben\s*id\s*[:\-]?\s*([A-Z0-9]{6,15})",
    ],
    "ip_no": [
        r"\bip\s*no\.?\s*[:\-]\s*([A-Z0-9\/\-]{4,20})",
    ],
    "dob": [
        r"(?:dob|date\s*of\s*birth|d\.?o\.?b\.?)\s*[:\-]?\s*(\d{1,2}[\/\-\.\s][A-Za-z0-9]{1,9}[\/\-\.\s]\d{2,4})",
    ],
    "admission_date": [
        r"(?:adm(?:ission)?\s*(?:date|on)|date\s*of\s*adm)\s*[:\-]?\s*(\d{1,2}[\/\-\.\s][A-Za-z0-9]{1,9}[\/\-\.\s]\d{2,4})",
    ],
    "discharge_date": [
        r"(?:disch(?:arge)?\s*(?:date|on))\s*[:\-]?\s*(\d{1,2}[\/\-\.\s][A-Za-z0-9]{1,9}[\/\-\.\s]\d{2,4})",
    ],
    "total_amount": [
        r"(?:total|grand\s*total|net\s*payable|amount)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]{3,})",
    ],
    "diagnosis": [
        r"(?:diagnosis|diag)\s*[:\-]\s*([A-Za-z0-9\s,\-]{4,80})",
    ],
    "age": [
        r"\bage\s*[:\-]?\s*(\d{1,3})\s*(?:yrs?|years?|y)?",
        r"\b(\d{1,3})\s*(?:yrs?|years?)\s*(?:old)?",
    ],
    "gender": [
        r"\b(?:sex|gender)\s*[:\-]?\s*(male|female|m|f)\b",
    ],
}


def extract_fields(text):
    out = {}
    for key, patterns in FIELD_PATTERNS.items():
        for pat in patterns:
            m = re.search(pat, text, flags=re.IGNORECASE | re.MULTILINE)
            if m:
                out[key] = m.group(1).strip().rstrip(":-")
                break
    return out


def extract_pdf_text(input_path, max_chars=8000):
    text_parts = []
    page_count = 0
    try:
        doc = fitz.open(input_path)
        page_count = len(doc)
        for page in doc:
            text_parts.append(page.get_text("text"))
            if sum(len(t) for t in text_parts) > max_chars:
                break
        doc.close()
    except Exception:
        pass
    return "\n".join(text_parts), page_count


def detect_extractability(input_path):
    """Returns 'text' if PDF has selectable text, 'scanned' otherwise.
    Images are always 'scanned'. PDFs need ~50+ chars per page of real text."""
    ext = os.path.splitext(input_path)[1].lower()
    if ext in (".jpg", ".jpeg", ".png"):
        return "scanned"
    if ext != ".pdf":
        return "scanned"
    text, pages = extract_pdf_text(input_path, max_chars=4000)
    pages = max(1, pages)
    return "text" if len(text.strip()) / pages >= 50 else "scanned"


def _snake(label):
    s = re.sub(r"[^A-Za-z0-9]+", "_", label.lower()).strip("_")
    return re.sub(r"_+", "_", s)


def make_ai_filename(mrn, doc_type, date_str, ext):
    parts = []
    parts.append((mrn or "unknown_mrn").upper())
    parts.append(_snake(doc_type) if doc_type != "Unclassified" else "unclassified")
    if date_str:
        nums = re.findall(r"\d+", date_str)
        if len(nums) == 3:
            y = nums[2] if len(nums[2]) == 4 else "20" + nums[2]
            m = nums[1].zfill(2)
            d = nums[0].zfill(2)
            parts.append(f"{y}{m}{d}")
        else:
            parts.append(re.sub(r"[^A-Za-z0-9]", "", date_str))
    return "_".join(parts) + ext.lower()


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: extractor.py <input> <output>"}))
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]
    ext = os.path.splitext(input_path)[-1].lower()

    if not os.path.isfile(input_path):
        print(json.dumps({"ok": False, "error": f"input not found: {input_path}"}))
        sys.exit(1)

    try:
        if ext == ".pdf":
            ok = compress_pdf_safe(input_path, output_path)
        elif ext in (".jpg", ".jpeg", ".png"):
            ok = compress_standalone_image(input_path, output_path)
        else:
            print(json.dumps({"ok": False, "error": f"unsupported ext: {ext}"}))
            sys.exit(1)

        if not ok or not os.path.isfile(output_path):
            print(json.dumps({"ok": False, "error": "compression failed"}))
            sys.exit(1)

        orig = os.path.getsize(input_path)
        new = os.path.getsize(output_path)
        reduction = round((1 - new / orig) * 100, 1) if orig else 0

        extracted_text = ""
        page_count = 0
        fields = {}

        if ext == ".pdf":
            extracted_text, page_count = extract_pdf_text(input_path)
            fields = extract_fields(extracted_text)

        original_filename = os.path.basename(input_path)
        doc_type, doc_conf, doc_src = classify_doc(original_filename, extracted_text)

        ai_filename = None
        if doc_type != "Unclassified" and doc_conf >= 0.75:
            mrn = fields.get("mrn")
            date_str = fields.get("admission_date") or fields.get("discharge_date") or fields.get("dob")
            ai_filename = make_ai_filename(mrn, doc_type, date_str, ext)

        print(json.dumps({
            "ok": True,
            "input_size": orig,
            "output_size": new,
            "reduction_pct": reduction,
            "page_count": page_count,
            "extracted_text": (extracted_text or "")[:600],
            "fields": fields,
            "doc_type": doc_type,
            "doc_type_confidence": doc_conf,
            "doc_type_source": doc_src,
            "original_filename": original_filename,
            "ai_filename": ai_filename,
        }))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)


if __name__ == "__main__":
    main()
