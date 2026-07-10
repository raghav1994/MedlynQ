import fitz
import re
import csv
import os

pdf_path = r"C:\Users\asus\Desktop\HBP-2022.pdf"
output_csv_path = r"C:\Users\asus\Desktop\MedLynq\app\data\package_master_hbp_2022.csv"

# Specialty mappings
specialty_mapping = {
    "Burns Management": "Plastic",
    "Emergency Room Packages": "General",
    "High end Diagnostics": "General",
    "High end Medicine": "General",
    "High end procedures": "General",
    "Orthopedics, Emergency Room Packages": "Orthopaedic",
    "Urology, Pediatric Surgery, Emergency": "Urology",
    "Cardiology": "Cardiac",
    "Cardiology, Interventional Radiology": "Cardiac",
    "Cardiology, CTVS": "Cardiac",
    "Cardiology, General Surgery": "Cardiac",
    "General Medicine": "General",
    "Pediatric Medical Management": "Paediatrics",
    "Neo-natal Care": "Paediatrics",
    "Neo - neonatal Care": "Paediatrics",
    "Neo - natal Care": "Paediatrics",
    "Neo - natal Care/opthalmol ogy": "Paediatrics",
    "Medical Oncology": "Oncology",
    "Radiation Oncology": "Oncology",
    "Organ and Tissue Transplant": "Transplant",
    "Orthopedics": "Orthopaedic",
    "Neurosurgery": "Neurosurgery",
    "ENT": "ENT",
    "Obstetrics & Gynecology": "Gynaecology",
    "Urology": "Urology",
    "Plastic & Reconstructive Surgery": "Plastic",
    "Pediatric Surgery": "Paediatrics",
    "General Surgery": "General",
    "Oral & Maxillofacial Surgery": "General",
    "Ophthalmology": "Ophthalmology",
    "Infectious Diseases, General Medicine": "Infectious",
    "Mental Disorders": "Mental Health",
}

def clean_specialty(spec_str):
    spec_str = spec_str.strip()
    if not spec_str:
        return "General"
    
    if spec_str in specialty_mapping:
        return specialty_mapping[spec_str]
        
    spec_lower = spec_str.lower()
    if "oncology" in spec_lower or "cancer" in spec_lower:
        return "Oncology"
    if "cardiac" in spec_lower or "cardio" in spec_lower or "ctvs" in spec_lower:
        return "Cardiac"
    if "ortho" in spec_lower:
        return "Orthopaedic"
    if "dialysis" in spec_lower or "nephro" in spec_lower:
        return "Dialysis"
    if "icu" in spec_lower or "intensive" in spec_lower:
        return "ICU"
    if "maternity" in spec_lower or "obstet" in spec_lower or "gyn" in spec_lower:
        return "Gynaecology"
    if "neuro" in spec_lower:
        return "Neurosurgery"
    if "uro" in spec_lower:
        return "Urology"
    if "gastro" in spec_lower:
        return "Gastro"
    if "pediatr" in spec_lower or "paediatr" in spec_lower or "neo" in spec_lower:
        return "Paediatrics"
    if "transplant" in spec_lower:
        return "Transplant"
    if "plastic" in spec_lower or "burn" in spec_lower:
        return "Plastic"
    if "psych" in spec_lower or "mental" in spec_lower:
        return "Mental Health"
    if "infect" in spec_lower or "covid" in spec_lower:
        return "Infectious"
    if "endo" in spec_lower:
        return "Endocrine"
    if "derm" in spec_lower:
        return "Dermatology"
    if "rheum" in spec_lower:
        return "Rheumatology"
    if "pulm" in spec_lower or "asthma" in spec_lower:
        return "Pulmonary"
    if "haem" in spec_lower:
        return "Haematology"
    if "ent" in spec_lower or "ear" in spec_lower or "throat" in spec_lower:
        return "ENT"
    if "ophth" in spec_lower or "eye" in spec_lower:
        return "Ophthalmology"
        
    return "General"

def get_column_idx(x0):
    if x0 < 105:
        return 0 # Specialty
    elif x0 < 140:
        return 1 # Specialty Code
    elif x0 < 180:
        return 2 # Package Code
    elif x0 < 250:
        return 3 # Package Name
    elif x0 < 300:
        return 4 # Procedure Code
    elif x0 < 390:
        return 5 # Procedure Name
    elif x0 < 450:
        return 6 # Tier3
    elif x0 < 500:
        return 7 # Tier2
    elif x0 < 550:
        return 8 # Tier1
    elif x0 < 600:
        return 9 # Implant Mapped
    elif x0 < 680:
        return 10 # Implant Cost
    else:
        return 11 # Stratification Remarks

code_regex = re.compile(r"^[A-Z]{2}\d{3,4}[A-Z0-9]+$")

doc = fitz.open(pdf_path)
all_rows = []

for page_idx in range(len(doc)):
    page = doc[page_idx]
    words = page.get_text("words")
    drawings = page.get_drawings()
    
    # 1. Find horizontal line coordinates to serve as row dividers
    horizontal_lines = []
    for d in drawings:
        for item in d['items']:
            if item[0] == 're':
                rect = item[1]
                x0, y0, x1, y1 = rect
                width = x1 - x0
                height = y1 - y0
                if width > 400 and height < 2.0:
                    horizontal_lines.append((y0 + y1)/2)
                    
    horizontal_lines = sorted(list(set(horizontal_lines)))
    
    # 2. Find the first code position on the page to identify the header boundary
    first_code_y = None
    for w in words:
        if code_regex.match(w[4].strip()):
            first_code_y = (w[1] + w[3]) / 2
            break
            
    if first_code_y is None:
        first_code_y = 100.0
        
    header_line = None
    for y in reversed(horizontal_lines):
        if y < first_code_y:
            header_line = y
            break
            
    if header_line is None:
        header_line = 90.0
        
    row_boundaries = [y for y in horizontal_lines if y >= header_line - 1.0]
    
    if len(row_boundaries) < 2:
        # Fallback if drawings/lines are missing on this page
        continue
        
    num_rows = len(row_boundaries) - 1
    rows_words = [[] for _ in range(num_rows)]
    
    # 3. Partition words on the page into their respective rows
    for w in words:
        x0, y0, x1, y1, word = w[0], w[1], w[2], w[3], w[4]
        if y1 < header_line or "Package Master" in word or "HBP-2022" in word:
            continue
        y_center = (y0 + y1) / 2
        
        assigned = False
        for i in range(num_rows):
            if row_boundaries[i] <= y_center < row_boundaries[i+1]:
                rows_words[i].append(w)
                assigned = True
                break
                
    # 4. Reconstruct columns for each row
    for i in range(num_rows):
        row_w = rows_words[i]
        if not row_w:
            continue
            
        row_w_sorted = sorted(row_w, key=lambda x: x[1])
        lines = []
        for w in row_w_sorted:
            y_center = (w[1] + w[3]) / 2
            placed = False
            for line in lines:
                line_y_center = sum((item[1] + item[3])/2 for item in line) / len(line)
                if abs(y_center - line_y_center) < 5:
                    line.append(w)
                    placed = True
                    break
            if not placed:
                lines.append([w])
                
        merged_cols = [""] * 12
        for line in lines:
            line.sort(key=lambda x: x[0])
            line_cols = [""] * 12
            for w in line:
                col_idx = get_column_idx(w[0])
                if line_cols[col_idx]:
                    line_cols[col_idx] += " " + w[4]
                else:
                    line_cols[col_idx] = w[4]
                    
            for idx in range(12):
                val = line_cols[idx].strip()
                if val:
                    if merged_cols[idx]:
                        if idx in [1, 2, 4, 6, 7, 8]: # codes and prices
                            pass
                        else:
                            merged_cols[idx] += " " + val
                    else:
                        merged_cols[idx] = val
                        
        if merged_cols[4].strip() and code_regex.match(merged_cols[4].strip()):
            all_rows.append(merged_cols)

# Output CSV creation
with open(output_csv_path, mode='w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    # Header: code,name,specialty,schemes,cap_inr,length_of_stay_days,notes,source
    writer.writerow(["code", "name", "specialty", "schemes", "cap_inr", "length_of_stay_days", "notes", "source"])
    
    for r in all_rows:
        code = r[4].strip()
        package_name = r[3].strip()
        proc_name = r[5].strip()
        raw_specialty = r[0].strip()
        
        specialty = clean_specialty(raw_specialty)
        
        # Clean price (cap_inr) from Tier3
        price_str = r[6].strip()
        if not price_str:
            # Fallback to Tier2 or Tier1
            price_str = r[7].strip() or r[8].strip()
        
        # Remove commas or other non-numeric chars from price
        price_str = re.sub(r"[^\d]", "", price_str)
        try:
            cap_inr = int(price_str)
        except ValueError:
            cap_inr = 0
            
        # Clean procedure name
        clean_proc = re.sub(r"^Criteria \d+:\s*", "", proc_name, flags=re.IGNORECASE)
        clean_proc = re.sub(r"^Criteria \d+\s*", "", clean_proc, flags=re.IGNORECASE)
        clean_proc = " ".join(clean_proc.split())
        
        # Determine name and notes
        parts = re.split(r'[.;:]', clean_proc)
        first_part = parts[0].strip()
        if len(first_part) < 15 and len(parts) > 1:
            first_part = first_part + ": " + parts[1].strip()
            
        if len(first_part) > 80:
            first_part = first_part[:77] + "..."
            
        # Fallback to package name if first_part is empty
        if not first_part:
            first_part = package_name or "Medical Procedure"
            
        name = first_part
        notes = clean_proc
        
        # Length of stay heuristics
        los = 3 # default surgery/general
        name_lower = name.lower()
        if specialty == "Oncology" and any(k in name_lower for k in ["cycle", "chemo", "injection", "infusion", "dose", "regimen"]):
            los = 1
        elif specialty == "Dialysis":
            los = 1
        elif "transplant" in name_lower:
            los = 21
        elif any(k in name_lower for k in ["screening", "biopsy", "fnac", "ultrasound", "scan", "venography", "angiography"]):
            los = 1
            
        # Check if LOS is explicitly mentioned in the description
        los_match = re.search(r"LOS\s*-\s*(\d+)", notes, re.IGNORECASE)
        if los_match:
            los = int(los_match.group(1))
            
        writer.writerow([code, name, specialty, "PMJAY", cap_inr, los, notes, "pmjay_hbp_2022"])

print(f"Generated CSV with {len(all_rows)} package rows at: {output_csv_path}")
