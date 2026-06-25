"""Per-doc-type synopsis schemas.

Each schema lists the fields Sarvam should pull out + a short renderer
template the dashboard uses. The pipeline normalises Sarvam's raw JSON
into this shape so the UI can render synopsis boxes consistently.
"""

from __future__ import annotations

from typing import Any

# Field schemas — what to ask Sarvam for, per doc_type
SCHEMAS: dict[str, dict[str, Any]] = {
    "hpe_report": {
        "label": "Histopathology Report",
        "fields": [
            "diagnosis", "primary_site", "histology_type", "grade",
            "stage_t", "stage_n", "stage_m",
            "margins_status", "margin_distance_mm",
            "lymph_nodes_examined", "lymph_nodes_positive",
            "receptor_er", "receptor_pr", "receptor_her2",
            "specimen_date", "report_date", "pathologist",
        ],
        "suggests": ["adjuvant_chemo_indicated", "receptor_test_pending", "re_excision_needed"],
    },
    "discharge_summary": {
        "label": "Discharge Summary",
        "fields": [
            "final_diagnosis", "procedures_done", "drugs_given",
            "admission_date", "discharge_date", "icu_days",
            "follow_up_plan", "complications", "condition_at_discharge",
        ],
        "suggests": ["next_cycle_date", "review_appointment"],
    },
    "bill": {
        "label": "Final Bill",
        "fields": [
            "total_amount", "line_items", "package_rate", "scheme_cap",
            "bill_date", "bill_no", "hospital_name",
        ],
        "suggests": ["over_cap_amount", "missing_line_items"],
    },
    "chemo_chart": {
        "label": "Chemotherapy Chart",
        "fields": [
            "regimen", "cycle_no", "drugs", "doses_mg", "bsa_m2",
            "administration_date", "premedications", "vitals_during",
        ],
        "suggests": ["bsa_calculation_check", "dose_modification_needed"],
    },
    "ot_notes": {
        "label": "OT Notes",
        "fields": [
            "procedure_code", "procedure_name", "surgeon",
            "anesthesia_type", "duration_min", "blood_loss_ml",
            "complications", "specimen_sent_for_hpe",
        ],
        "suggests": ["hpe_followup_due"],
    },
    "lab_report": {
        "label": "Lab Report",
        "fields": ["panel", "abnormal_values", "test_date", "lab_name"],
        "suggests": [],
    },
    "patient_id": {
        "label": "Patient ID Proof",
        "fields": [],  # everything sensitive — minimal extraction
        "suggests": [],
    },
    "generic": {
        "label": "Document",
        "fields": ["doc_title", "doc_date", "key_phrases"],
        "suggests": [],
    },
}


def schema_for(doc_type: str) -> dict[str, Any]:
    return SCHEMAS.get(doc_type, SCHEMAS["generic"])


def normalize(doc_type: str, sarvam_json: dict[str, Any]) -> dict[str, Any]:
    """Coerce Sarvam's raw response into our synopsis shape.

    Defensive: if Sarvam returns a field we didn't ask for, drop it.
    If a required field is missing, set to None (UI shows "—").
    """
    schema = schema_for(doc_type)
    extracted = sarvam_json.get("extracted") or sarvam_json.get("fields") or {}
    out = {
        "doc_type": doc_type,
        "label": schema["label"],
        "fields": {f: extracted.get(f) for f in schema["fields"]},
        "suggests": [s for s in schema["suggests"] if extracted.get(s)],
        "raw_text": sarvam_json.get("text", ""),
        "confidence": sarvam_json.get("confidence", None),
    }
    return out
