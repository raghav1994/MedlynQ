"""Generates a synthetic case corpus covering specialty/scheme combinations
the real HAR-extracted corpus (PatientLog/Approved/corpus/) has zero examples
of — that corpus is 100% PMJAY oncology. This fills gaps for: cardiac, ortho,
dialysis, icu, maternity, and non-PMJAY schemes (CGHS, ECHS, ESI, Railway_UMID,
NDMC, FCI, DU/DU_AFFILIATED, TPA, Cash).

Every document is a REAL one-page PDF with actual extractable text (unlike
the real corpus's raw un-OCR'd scans) — plausible fake patient name/MRN/
vitals plus doc-type-specific content — so the OCR/classifier/checklist
pipeline can genuinely be run against this data, not just filename-matched.

Output shape mirrors the real corpus exactly:
  PatientLog/Synthetic/corpus/batch_01/case_01_<case_id>/*.pdf + manifest.json
  PatientLog/Synthetic/corpus/master_{patients,cases,documents,queries}.csv

Run with: .venv/Scripts/python.exe python/tools/gen_synthetic_corpus.py
"""

from __future__ import annotations

import csv
import json
import random
from pathlib import Path

import fitz  # PyMuPDF

random.seed(42)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "PatientLog" / "Synthetic" / "corpus"

# ---- checklist doc types per specialty/treatment, mirrored from
# src/lib/checklist.ts (kept in sync by hand — small enough to duplicate) ----
UNIVERSAL_PRE_AUTH = ["Aadhaar", "Insurance / Scheme Card", "Consent Form"]
UNIVERSAL_DISCHARGE = ["Feedback Form", "Discharge Summary", "Hospital Bill",
                       "Registration Copy", "IPD File (admission)", "Clinical Vitals Log"]

SPECIALTY_DOCS = {
    "cardiac": {
        "pre_auth": ["ECHO Report", "ECG Report", "Coronary Angiography Report", "Cardiac Pre-Op Workup"],
        "mid_way": ["Stent / Implant Invoice", "Cath Lab Note", "Cardiac OT Notes"],
    },
    "ortho": {
        "pre_auth": ["Pre-Op X-Ray", "MRI / CT Joint Report", "Ortho Surgeon Note"],
        "mid_way": ["Implant Sticker / Barcode", "Ortho OT Notes", "Post-Op X-Ray"],
    },
    "dialysis": {
        "pre_auth": ["Renal Function Panel", "AV Fistula / Access Note"],
        "mid_way": ["Dialysis Frequency Log", "KT/V or URR Note"],
    },
    "icu": {
        "pre_auth": ["ICU Admission Note", "APACHE / SOFA Score Sheet"],
        "mid_way": ["Ventilator / Vitals Chart", "Daily Progress Notes"],
    },
    "maternity": {
        "pre_auth": ["Antenatal Card", "USG Reports", "Maternal Blood Group / VDRL / HIV"],
        "mid_way": ["Delivery Note", "NICU Chart", "Partograph"],
    },
    "oncology": {
        "pre_auth": ["Histopathology Report", "Tumor Board Certificate"],
        "mid_way": ["Chemo Chart", "Drug Pouch / Wrapper Photo"],
    },
}

FIRST_NAMES_M = ["Rajesh", "Suresh", "Mahendra", "Anil", "Vinod", "Dinesh", "Om", "Harish", "Ashok", "Ramesh"]
FIRST_NAMES_F = ["Sunita", "Geeta", "Kavita", "Pooja", "Rekha", "Meena", "Sarita", "Kiran", "Usha", "Nirmala"]
LAST_NAMES = ["Sharma", "Verma", "Yadav", "Singh", "Kumar", "Gupta", "Mishra", "Pandey", "Chaudhary", "Rawat"]

STATES = {"Delhi": ["West Delhi", "East Delhi", "South Delhi"], "UP": ["Noida", "Meerut", "Ghaziabad"],
          "Haryana": ["Gurugram", "Faridabad"], "Punjab": ["Ludhiana", "Amritsar"]}


def fake_name(gender: str) -> str:
    first = random.choice(FIRST_NAMES_M if gender == "M" else FIRST_NAMES_F)
    return f"{first} {random.choice(LAST_NAMES)}"


def fake_mrn() -> str:
    return "SYN" + "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=7))


def make_pdf(path: Path, title: str, body_lines: list[str]) -> int:
    doc = fitz.open()
    page = doc.new_page()
    y = 60
    page.insert_text((50, y), title, fontsize=16, fontname="helv")
    y += 30
    for line in body_lines:
        page.insert_text((50, y), line, fontsize=11, fontname="helv")
        y += 20
    doc.save(str(path))
    doc.close()
    return path.stat().st_size


# ---- doc-type specific fake content, so content_classifier.py has real
# signal to key off (not just a blank templated page) ----
DOC_CONTENT = {
    "Aadhaar": lambda p: ["GOVERNMENT OF INDIA", f"Name: {p['name']}", f"DOB: {p['dob']}", "Aadhaar No: XXXX XXXX " + fake_mrn()[-4:]],
    "Insurance / Scheme Card": lambda p: [f"{p['scheme']} BENEFICIARY CARD", f"Beneficiary Name: {p['name']}", f"MRN: {p['mrn']}", f"Scheme: {p['scheme']}"],
    "Consent Form": lambda p: ["INFORMED CONSENT FOR TREATMENT", f"Patient: {p['name']}", f"Age/Sex: {p['age']}/{p['gender']}", "I hereby consent to the proposed treatment.", "Signature: ___________"],
    "ECHO Report": lambda p: ["ECHOCARDIOGRAPHY REPORT", f"Name: {p['name']} Age/Sex: {p['age']}/{p['gender']}", "EF: 45% (mildly reduced)", "LV: mild hypertrophy", "Valves: no significant regurgitation"],
    "ECG Report": lambda p: ["ELECTROCARDIOGRAM (ECG)", f"Name: {p['name']}", "Rhythm: Sinus", "Rate: 78 bpm", "Findings: ST-T changes in lead V4-V6"],
    "Coronary Angiography Report": lambda p: ["CORONARY ANGIOGRAPHY REPORT", f"Patient: {p['name']} MRN: {p['mrn']}", "LAD: 80% stenosis", "RCA: 40% stenosis", "Impression: Triple vessel disease"],
    "Cardiac Pre-Op Workup": lambda p: ["CARDIAC PRE-OPERATIVE WORKUP", f"Name: {p['name']}", "Fitness for surgery: Fit with precautions"],
    "Stent / Implant Invoice": lambda p: ["IMPLANT INVOICE", f"Patient: {p['name']}", "Item: Drug Eluting Stent", "Batch No: DES-2026-4471", "Amount: Rs 45,000"],
    "Cath Lab Note": lambda p: ["CATH LAB PROCEDURE NOTE", f"Patient: {p['name']}", "Procedure: PTCA with stent placement", "Access: Right radial"],
    "Cardiac OT Notes": lambda p: ["OPERATION THEATRE NOTES - CARDIAC", f"Patient: {p['name']}", "Procedure: CABG x2", "Duration: 4h 20m"],
    "Pre-Op X-Ray": lambda p: ["X-RAY REPORT (PRE-OP)", f"Name: {p['name']} Age/Sex: {p['age']}/{p['gender']}", "Right knee - AP/Lateral view", "Findings: Grade 3 osteoarthritis"],
    "MRI / CT Joint Report": lambda p: ["MRI JOINT REPORT", f"Patient: {p['name']}", "Joint: Right knee", "Findings: Meniscal tear, cartilage thinning"],
    "Ortho Surgeon Note": lambda p: ["ORTHOPAEDIC SURGEON NOTE", f"Patient: {p['name']}", "Diagnosis: Osteoarthritis right knee", "Plan: Total knee replacement"],
    "Implant Sticker / Barcode": lambda p: ["IMPLANT STICKER", "Item: Total Knee Prosthesis", "Batch: TKR-8827-A", f"Patient: {p['name']}"],
    "Ortho OT Notes": lambda p: ["OPERATION THEATRE NOTES - ORTHO", f"Patient: {p['name']}", "Procedure: Total Knee Replacement", "Implant used: Cemented TKR"],
    "Post-Op X-Ray": lambda p: ["X-RAY REPORT (POST-OP)", f"Patient: {p['name']}", "Implant position: Satisfactory", "No periprosthetic fracture"],
    "Renal Function Panel": lambda p: ["RENAL FUNCTION TEST", f"Name: {p['name']} Age/Sex: {p['age']}/{p['gender']}", "Urea: 88 mg/dL", "Creatinine: 6.2 mg/dL", "eGFR: 9 mL/min"],
    "AV Fistula / Access Note": lambda p: ["AV FISTULA ACCESS NOTE", f"Patient: {p['name']}", "Access site: Left forearm", "Fistula maturation: Adequate"],
    "Dialysis Frequency Log": lambda p: ["DIALYSIS FREQUENCY LOG", f"Patient: {p['name']} MRN: {p['mrn']}", "Sessions: 3x/week", "Duration: 4h per session"],
    "KT/V or URR Note": lambda p: ["DIALYSIS ADEQUACY NOTE", f"Patient: {p['name']}", "KT/V: 1.4", "URR: 68%"],
    "ICU Admission Note": lambda p: ["ICU ADMISSION NOTE", f"Patient: {p['name']} Age/Sex: {p['age']}/{p['gender']}", "Diagnosis: Septic shock", "GCS: 13/15"],
    "APACHE / SOFA Score Sheet": lambda p: ["APACHE II / SOFA SCORE SHEET", f"Patient: {p['name']}", "APACHE II Score: 18", "SOFA Score: 7"],
    "Ventilator / Vitals Chart": lambda p: ["VENTILATOR & VITALS CHART", f"Patient: {p['name']}", "Mode: SIMV", "SpO2: 96%", "HR: 88 bpm"],
    "Daily Progress Notes": lambda p: ["ICU DAILY PROGRESS NOTES", f"Patient: {p['name']}", "Day 3: Hemodynamically stable, weaning sedation"],
    "Antenatal Card": lambda p: ["ANTENATAL CARD", f"Name: {p['name']} Age: {p['age']}", "Gravida/Para: G2P1", "EDD: 2026-08-15"],
    "USG Reports": lambda p: ["OBSTETRIC USG REPORT", f"Patient: {p['name']}", "Gestational age: 38 weeks", "Presentation: Cephalic", "AFI: Normal"],
    "Maternal Blood Group / VDRL / HIV": lambda p: ["MATERNAL SCREENING PANEL", f"Patient: {p['name']}", "Blood Group: B+", "VDRL: Non-reactive", "HIV: Non-reactive"],
    "Delivery Note": lambda p: ["DELIVERY NOTE", f"Patient: {p['name']}", "Mode: LSCS", "Outcome: Live birth, female, 2.9kg"],
    "NICU Chart": lambda p: ["NICU CHART", f"Baby of {p['name']}", "Birth weight: 2.9kg", "APGAR: 8/9"],
    "Partograph": lambda p: ["PARTOGRAPH", f"Patient: {p['name']}", "Labour duration: 6h 40m", "No complications recorded"],
    "Histopathology Report": lambda p: ["HISTOPATHOLOGY REPORT", f"Patient: {p['name']} Age/Sex: {p['age']}/{p['gender']}", "OPINION: Invasive ductal carcinoma", "Margins: Clear"],
    "Tumor Board Certificate": lambda p: ["TUMOR BOARD CERTIFICATE", f"Patient: {p['name']}", "Board decision: Neoadjuvant chemotherapy followed by surgery"],
    "Chemo Chart": lambda p: ["CHEMOTHERAPY ADMINISTRATION CHART", f"Patient: {p['name']} MRN: {p['mrn']}", "Cycle: 2 of 6", "Regimen: FOLFOX"],
    "Drug Pouch / Wrapper Photo": lambda p: ["DRUG POUCH LABEL", "Drug: Oxaliplatin 100mg", f"Patient: {p['name']}", "Batch: OXP-2026-119"],
    "Feedback Form": lambda p: ["PATIENT FEEDBACK FORM", f"Patient: {p['name']}", "Overall experience: Satisfactory"],
    "Discharge Summary": lambda p: ["DISCHARGE SUMMARY", f"Name: {p['name']} Age/Sex: {p['age']}/{p['gender']}", f"MRN: {p['mrn']}", "Condition at discharge: Stable", "Follow-up: 2 weeks OPD"],
    "Hospital Bill": lambda p: ["HOSPITAL BILL", f"Patient: {p['name']}", f"Total Amount: Rs {p['claimed_amount']}", "Payment mode: " + p['scheme']],
    "Registration Copy": lambda p: ["HOSPITAL REGISTRATION SLIP", f"Name: {p['name']}", f"MRN: {p['mrn']}", f"Registration Date: {p['admission_date']}"],
    "IPD File (admission)": lambda p: ["IPD ADMISSION FILE", f"Patient: {p['name']}", f"Admission Date: {p['admission_date']}", f"Ward: {p['specialty'].title()}"],
    "Clinical Vitals Log": lambda p: ["CLINICAL VITALS LOG", f"Patient: {p['name']}", "BP: 128/82", "Pulse: 82", "Temp: 98.4F", "SpO2: 98%"],
}


SCENARIOS = [
    dict(specialty="ortho", scheme="CGHS", scheme_variant=None, auth_mode="pre_auth", treatment="surgery", status="preauth_pending", stage="pre_auth", gender="M", age=58),
    dict(specialty="ortho", scheme="ECHS", scheme_variant=None, auth_mode="pre_auth", treatment="surgery", status="admitted", stage="mid_way", gender="M", age=65),
    dict(specialty="dialysis", scheme="ESI", scheme_variant=None, auth_mode="pre_auth", treatment="medicine", status="admitted", stage="mid_way", gender="F", age=49),
    dict(specialty="dialysis", scheme="FCI", scheme_variant=None, auth_mode="pre_approval", treatment="medicine", status="awaiting_approval", stage="pre_auth", gender="M", age=52),
    dict(specialty="icu", scheme="CAPF", scheme_variant=None, auth_mode="pre_auth", treatment="medicine", status="preauth_pending", stage="pre_auth", gender="M", age=41),
    dict(specialty="icu", scheme="Railway_UMID", scheme_variant=None, auth_mode="pre_auth", treatment="medicine", status="query", stage="mid_way", gender="F", age=63),
    dict(specialty="maternity", scheme="NDMC", scheme_variant=None, auth_mode="pre_auth", treatment="surgery", status="discharged", stage="discharge", gender="F", age=27),
    dict(specialty="maternity", scheme="Cash", scheme_variant=None, auth_mode="cash", treatment="surgery", status="successful", stage="discharge", gender="F", age=31),
    dict(specialty="cardiac", scheme="TPA", scheme_variant=None, auth_mode="pre_auth", treatment="surgery", status="admitted", stage="mid_way", gender="M", age=60),
    dict(specialty="cardiac", scheme="DU", scheme_variant="DU_AFFILIATED", auth_mode="pre_approval", treatment="surgery", status="awaiting_approval", stage="pre_auth", gender="M", age=55),
    dict(specialty="oncology", scheme="ECHS", scheme_variant=None, auth_mode="pre_auth", treatment="chemo", status="query", stage="mid_way", gender="F", age=57),
    dict(specialty="oncology", scheme="Ayushman", scheme_variant="SHA_UP", auth_mode="pre_approval", treatment="chemo", status="awaiting_approval", stage="pre_auth", gender="F", age=44),
]

PAYER_LABEL = {
    "CGHS": "CGHS Central", "ECHS": "ECHS Cell", "ESI": "ESIC", "FCI": "FCI Medical Cell",
    "CAPF": "CAPF Composite Hospital", "Railway_UMID": "Railway UMID", "NDMC": "NDMC Dispensary",
    "Cash": "Self-pay", "TPA": "Private TPA Desk", "DU": "Delhi University Health Centre",
    "Ayushman": "NHA / SHA Uttar Pradesh",
}


def build_docs_for(p: dict) -> list[str]:
    docs = list(UNIVERSAL_PRE_AUTH)
    docs += SPECIALTY_DOCS.get(p["specialty"], {}).get("pre_auth", [])
    stage_order = ["pre_auth", "mid_way", "discharge"]
    if stage_order.index(p["stage"]) >= 1:
        docs += SPECIALTY_DOCS.get(p["specialty"], {}).get("mid_way", [])
    if stage_order.index(p["stage"]) >= 2:
        docs += UNIVERSAL_DISCHARGE
    return docs


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    batch_dir = OUT / "batch_01"
    batch_dir.mkdir(exist_ok=True)

    patients_rows, cases_rows, documents_rows, queries_rows = [], [], [], []

    for i, sc in enumerate(SCENARIOS, start=1):
        pid = f"SYN{i:03d}"
        mrn = fake_mrn()
        name = fake_name(sc["gender"])
        state = random.choice(list(STATES.keys()))
        district = random.choice(STATES[state])
        case_id = f"SYN-CASE-{i:03d}"
        claimed_amount = random.choice([42500, 68000, 95000, 134550, 210000, 31740])
        admission_date = f"2026-0{random.randint(4,6)}-{random.randint(10,28):02d}"

        p = dict(name=name, mrn=mrn, age=sc["age"], gender=sc["gender"], dob="1970-01-01",
                 scheme=sc["scheme"], claimed_amount=claimed_amount, admission_date=admission_date,
                 specialty=sc["specialty"])

        patients_rows.append([pid, mrn, name, sc["age"], sc["gender"], state, district, sc["specialty"]])

        cases_rows.append([
            case_id, pid, mrn, sc["scheme"], sc["scheme_variant"] or "", sc["auth_mode"],
            sc["specialty"], sc["treatment"], sc["status"], PAYER_LABEL.get(sc["scheme"], sc["scheme"]),
            claimed_amount, admission_date,
        ])

        case_dir = batch_dir / f"case_{i:02d}_{case_id}"
        case_dir.mkdir(exist_ok=True)

        doc_types = build_docs_for(sc)
        files_manifest = []
        for j, dt in enumerate(doc_types, start=1):
            fname = f"{j:03d}_{dt.replace(' ', '_').replace('/', '-')}.pdf"
            content_fn = DOC_CONTENT.get(dt)
            body = content_fn(p) if content_fn else [f"Patient: {p['name']}", f"Document: {dt}"]
            size = make_pdf(case_dir / fname, dt, body)
            files_manifest.append({"filename": fname, "ext": "pdf", "size": size, "doc_type": dt})
            documents_rows.append([case_id, pid, mrn, fname, dt, "pdf", size])

        # A rejection/query scenario for 'query' status cases — exercises the
        # multi-round QueryRound model + rejection_rounds field.
        if sc["status"] == "query":
            queries_rows.append([case_id, 1, sc["stage"], "missing_doc",
                                  f"PROVIDE ADDITIONAL {random.choice(doc_types).upper()} FOR VERIFICATION",
                                  PAYER_LABEL.get(sc["scheme"], sc["scheme"]), claimed_amount, "open", 15])
        if sc["status"] == "awaiting_approval":
            queries_rows.append([case_id, 1, "approval", "missing_doc",
                                  "ATTACH BASELINE INVESTIGATION REPORTS BEFORE APPROVAL",
                                  PAYER_LABEL.get(sc["scheme"], sc["scheme"]), claimed_amount, "open", 15])

        (case_dir / "manifest.json").write_text(json.dumps({
            "case_id": case_id, "mrn": mrn, "patient_name": name, "scheme": sc["scheme"],
            "scheme_variant": sc["scheme_variant"], "specialty": sc["specialty"],
            "treatment_type": sc["treatment"], "status": sc["status"], "auth_mode": sc["auth_mode"],
            "files": files_manifest,
        }, indent=2), encoding="utf-8")

    def write_csv(name, header, rows):
        with open(OUT / name, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    write_csv("master_patients.csv", ["patient_id", "mrn", "name", "age", "gender", "state", "district", "specialty"], patients_rows)
    write_csv("master_cases.csv", ["case_id", "patient_id", "mrn", "scheme", "scheme_variant", "auth_mode",
                                    "specialty", "treatment_type", "status", "payer", "claimed_amount", "admission_date"], cases_rows)
    write_csv("master_documents.csv", ["case_id", "patient_id", "mrn", "filename", "doc_type", "ext", "size_bytes"], documents_rows)
    write_csv("master_queries.csv", ["case_id", "round", "stage", "query_type", "raw_text", "raised_by",
                                      "amount_at_stake", "status", "deadline_days_total"], queries_rows)

    print(f"Generated {len(SCENARIOS)} synthetic cases, {len(documents_rows)} documents, {len(queries_rows)} queries")
    print(f"Output: {OUT}")


if __name__ == "__main__":
    main()
