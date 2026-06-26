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
    # ===== Cardiac =====
    "echo_report": {
        "label": "ECHO Report",
        "fields": ["lvef_pct", "wall_motion", "valvular_lesions", "chamber_dimensions", "report_date"],
        "suggests": ["systolic_dysfunction", "valve_replacement_indicated"],
    },
    "ecg_report": {
        "label": "ECG Report",
        "fields": ["rate_bpm", "rhythm", "axis", "ischemic_changes", "report_date"],
        "suggests": ["ischemia_suspected", "arrhythmia_present"],
    },
    "coronary_angio": {
        "label": "Coronary Angiography",
        "fields": ["vessels_involved", "stenosis_pct", "procedure_recommendation", "report_date"],
        "suggests": ["pci_indicated", "cabg_indicated"],
    },
    "stent_invoice": {
        "label": "Stent / Implant Invoice",
        "fields": ["brand", "model", "batch_no", "gst_no", "amount", "invoice_date"],
        "suggests": ["batch_traceable", "missing_gst"],
    },
    "cath_lab_note": {
        "label": "Cath Lab Note",
        "fields": ["procedure", "stents_placed", "contrast_used_ml", "complications", "procedure_date"],
        "suggests": [],
    },

    # ===== Ortho =====
    "preop_xray": {
        "label": "Pre-Op X-Ray",
        "fields": ["region", "findings", "fracture_pattern", "study_date"],
        "suggests": [],
    },
    "implant_sticker": {
        "label": "Implant Sticker / Barcode",
        "fields": ["implant_type", "brand", "size", "batch_no", "lot_no"],
        "suggests": ["batch_traceable", "missing_lot"],
    },
    "ortho_ot_notes": {
        "label": "Ortho OT Notes",
        "fields": ["procedure", "implant_used", "duration_min", "blood_loss_ml", "surgery_date"],
        "suggests": [],
    },

    # ===== Dialysis =====
    "dialysis_frequency_log": {
        "label": "Dialysis Frequency Log",
        "fields": ["sessions_per_week", "duration_hours", "vascular_access", "log_period"],
        "suggests": ["under_dialysed"],
    },
    "renal_panel": {
        "label": "Renal Function Panel",
        "fields": ["creatinine", "urea", "egfr", "potassium", "report_date"],
        "suggests": ["dialysis_indicated"],
    },

    # ===== ICU =====
    "ventilator_chart": {
        "label": "Ventilator / Vitals Chart",
        "fields": ["mode", "fio2", "peep", "tidal_volume", "spo2", "chart_date"],
        "suggests": ["weaning_ready", "high_fio2_dependence"],
    },
    "icu_admission_note": {
        "label": "ICU Admission Note",
        "fields": ["diagnosis", "apache_ii", "sofa_score", "admission_date"],
        "suggests": [],
    },

    # ===== Maternity =====
    "delivery_note": {
        "label": "Delivery Note",
        "fields": ["mode_of_delivery", "gestational_age", "baby_weight_g", "apgar_1min", "apgar_5min", "delivery_date"],
        "suggests": ["nicu_admission_indicated"],
    },
    "nicu_chart": {
        "label": "NICU Chart",
        "fields": ["admission_reason", "ventilation", "feeds", "stay_days", "discharge_date"],
        "suggests": [],
    },
    "antenatal_card": {
        "label": "Antenatal Card",
        "fields": ["lmp", "edd", "visits", "blood_group", "hiv_status", "vdrl_status"],
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
