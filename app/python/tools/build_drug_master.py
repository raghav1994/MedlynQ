"""Build a normalised drug master from the Indian Medicine CSV.

Input:  Indian Medicine database/A_Z_medicines_dataset_of_India.csv
Output: app/data/drug_master.csv
         Columns: generic, brand_names, manufacturer, pack, type,
                  mrp_min, mrp_max, oncology, n_skus

Logic:
  - Group SKUs by generic composition (short_composition1 + short_composition2)
  - Aggregate brand names + manufacturers + price range
  - Flag oncology generics using a curated list of cancer drugs
  - Skip discontinued SKUs

Run once: `python python/tools/build_drug_master.py`
Re-run after the source CSV is updated.
"""

from __future__ import annotations

import csv
import os
import re
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[3]  # MedLynq/
SOURCE = ROOT / "Indian Medicine database" / "A_Z_medicines_dataset_of_India.csv"
OUT_DIR = ROOT / "app" / "data"
OUT_FILE = OUT_DIR / "drug_master.csv"

ONCOLOGY_GENERICS = {
    # Cytotoxic
    "paclitaxel", "docetaxel", "doxorubicin", "cyclophosphamide", "carboplatin",
    "cisplatin", "oxaliplatin", "fluorouracil", "5-fu", "capecitabine", "gemcitabine",
    "irinotecan", "etoposide", "vincristine", "vinblastine", "vinorelbine",
    "methotrexate", "cytarabine", "ifosfamide", "epirubicin", "mitomycin",
    "bleomycin", "dacarbazine", "temozolomide", "pemetrexed", "topotecan",
    # Hormonal
    "tamoxifen", "letrozole", "anastrozole", "exemestane", "fulvestrant",
    "abiraterone", "enzalutamide", "bicalutamide", "leuprolide", "goserelin",
    # Targeted / biologics
    "trastuzumab", "rituximab", "bevacizumab", "cetuximab", "pertuzumab",
    "imatinib", "dasatinib", "nilotinib", "erlotinib", "gefitinib", "sorafenib",
    "sunitinib", "lapatinib", "ibrutinib", "palbociclib", "ribociclib",
    "olaparib", "regorafenib", "lenvatinib", "pembrolizumab", "nivolumab",
    "atezolizumab", "durvalumab", "ipilimumab", "osimertinib",
    # Supportive (relevant on chemo charts)
    "ondansetron", "granisetron", "palonosetron", "filgrastim", "pegfilgrastim",
}


def normalise_generic(c1: str, c2: str) -> str:
    parts = []
    for c in (c1, c2):
        if not c:
            continue
        # strip dose like "(500mg)" → keep name
        name = re.sub(r"\s*\([^)]*\)", "", c).strip().lower()
        if name:
            parts.append(name)
    return " + ".join(sorted(set(parts)))


def is_oncology(generic: str) -> bool:
    if not generic:
        return False
    parts = re.split(r"\s*\+\s*", generic)
    return any(p in ONCOLOGY_GENERICS for p in parts)


def main():
    if not SOURCE.exists():
        print(f"source CSV not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)

    groups: dict[str, dict] = defaultdict(lambda: {
        "brands": set(),
        "manufacturers": set(),
        "packs": set(),
        "types": set(),
        "prices": [],
        "n_skus": 0,
    })

    with open(SOURCE, "r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Is_discontinued", "").strip().upper() == "TRUE":
                continue
            generic = normalise_generic(
                row.get("short_composition1", ""),
                row.get("short_composition2", ""),
            )
            if not generic:
                continue
            g = groups[generic]
            name = (row.get("name") or "").strip()
            if name:
                g["brands"].add(name)
            mfg = (row.get("manufacturer_name") or "").strip()
            if mfg:
                g["manufacturers"].add(mfg)
            pack = (row.get("pack_size_label") or "").strip()
            if pack:
                g["packs"].add(pack)
            typ = (row.get("type") or "").strip()
            if typ:
                g["types"].add(typ)
            try:
                price = float((row.get("price(₹)") or "").strip())
                if price > 0:
                    g["prices"].append(price)
            except ValueError:
                pass
            g["n_skus"] += 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "generic", "brand_names", "manufacturers", "pack_size",
            "type", "mrp_min", "mrp_max", "oncology", "n_skus"
        ])
        rows_written = 0
        onco_rows = 0
        for generic, g in sorted(groups.items()):
            prices = g["prices"]
            mrp_min = round(min(prices), 2) if prices else ""
            mrp_max = round(max(prices), 2) if prices else ""
            onco = is_oncology(generic)
            if onco:
                onco_rows += 1
            # Cap brand names list size to keep CSV reasonable
            brands = list(sorted(g["brands"]))[:25]
            w.writerow([
                generic,
                " | ".join(brands),
                " | ".join(sorted(g["manufacturers"])[:10]),
                " | ".join(sorted(g["packs"])[:5]),
                " | ".join(sorted(g["types"])[:3]),
                mrp_min, mrp_max,
                "1" if onco else "0",
                g["n_skus"],
            ])
            rows_written += 1

    print(f"wrote {OUT_FILE}")
    print(f"  total generics: {rows_written}")
    print(f"  oncology generics: {onco_rows}")


if __name__ == "__main__":
    main()
