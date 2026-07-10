// Filename-based doc-type guess — used as the fallback hint sent to
// land_document.py. Content classification (Sarvam OCR text) overrides this
// when it's confident (>=0.75), but when OCR confidence lands just under
// that bar, this filename guess is what the file actually gets labeled —
// so a blank/generic hint here means real documents keep showing up as
// "Unknown Document" even though OCR read them successfully.
export function classifyByFilename(name: string): string {
  const n = name.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/hpe|histopath|biopsy/,     "HPE Report"],
    [/discharge|_ds_|\bdss\b|summary/, "Discharge Summary"],
    [/bill|invoice/,             "Hospital Bill"],
    [/chemo|protocol/,           "Chemo Chart"],
    [/lab|rft|lft|cbc/,          "Lab Report"],
    [/pet.?ct|petct/,            "PET-CT Report"],
    [/tbc|tumor.?board/,         "Tumor Board Certificate"],
    [/prescription|rx|opd/,      "Doctor's Prescription"],
    [/aadhaar|aadhar/,           "Aadhaar"],
    [/card|ayushman/,            "Insurance / Scheme Card"],
    [/consent/,                  "Consent Form"],
    [/ot[_-]notes|operative/,    "OT Notes"],
    [/feedback/,                 "Feedback Form"],
    [/pouch/,                    "Drug Pouch"],
    [/geotag|discharge_photo/,   "Discharge Photo"],
  ];
  for (const [re, dt] of map) if (re.test(n)) return dt;
  return "Unknown Document";
}
