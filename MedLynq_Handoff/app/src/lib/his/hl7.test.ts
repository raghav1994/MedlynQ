// Tests for the HL7 v2 parser + ADT^A04 → MedLynq mapper.

import { describe, it, expect } from "vitest";
import { parseHL7, getField, messageType, buildAck } from "./hl7Parser";
import { mapHL7ToAdmission } from "./hl7Mapper";

// Real-shape ADT^A04 message — Action Cancer Hospital admitting Chinta Devi
// for chemotherapy under PMJAY.  \r line terminator per HL7 spec.
const SAMPLE_A04 = [
  "MSH|^~\\&|HIS|HOSP-BLR-49|MEDLYNQ|MEDLYNQ|20260629223000||ADT^A04|MSG00001|P|2.5",
  "EVN|A04|20260629223000",
  "PID|1||PYZBP2Z4P^^^HOSP^MR||DEVI^CHINTA||19630815|F|||PSP Block^^Delhi^DL^110041^IN||+919811223344|||S||PAT001",
  "PV1|1|I|ONCOLOGY^WARD^01|3|||DR123^SHARMA^J B|||ONC|||A0|||||I0|VST001|||||||||||||||||||||||||20260629223000",
  "DG1|1||C50.9^Breast malignant neoplasm^ICD10",
  "IN1|1|PMJAY|PMJAY-NHA|National Health Authority||||||0|||20260101||||SELF|S||||||||||||||||||CARD2026A123456",
].join("\r");

describe("parseHL7", () => {
  it("parses MSH delimiters and message type", () => {
    const m = parseHL7(SAMPLE_A04);
    const mt = messageType(m);
    expect(mt.trigger).toBe("A04");
    expect(mt.structure).toBe("ADT");
    expect(m.delimiters.field).toBe("|");
    expect(m.delimiters.component).toBe("^");
  });

  it("extracts PID-3 (MRN) and PID-5 (name)", () => {
    const m = parseHL7(SAMPLE_A04);
    expect(getField(m, "PID", 3, 1, 1)).toBe("PYZBP2Z4P");
    expect(getField(m, "PID", 5, 1, 1)).toBe("DEVI");
    expect(getField(m, "PID", 5, 1, 2)).toBe("CHINTA");
  });

  it("extracts PV1 patient class + ward + attending doctor", () => {
    const m = parseHL7(SAMPLE_A04);
    expect(getField(m, "PV1", 2)).toBe("I");
    expect(getField(m, "PV1", 3, 1, 1)).toBe("ONCOLOGY");
    expect(getField(m, "PV1", 7, 1, 2)).toBe("SHARMA");
    expect(getField(m, "PV1", 7, 1, 3)).toBe("J B");
  });

  it("extracts IN1 scheme + payer + card number", () => {
    const m = parseHL7(SAMPLE_A04);
    expect(getField(m, "IN1", 2)).toBe("PMJAY");
    expect(getField(m, "IN1", 4)).toBe("National Health Authority");
    expect(getField(m, "IN1", 36)).toBe("CARD2026A123456");
  });

  it("rejects non-HL7 input", () => {
    expect(() => parseHL7("not hl7")).toThrow();
    expect(() => parseHL7("")).toThrow();
  });

  it("builds a valid HL7 ACK in response", () => {
    const m = parseHL7(SAMPLE_A04);
    const ack = buildAck(m, "AA", "Accepted");
    expect(ack).toContain("MSH|");
    expect(ack).toContain("MSA|AA|MSG00001");
  });
});

describe("mapHL7ToAdmission", () => {
  it("maps the sample to an Action patient + provisional case", () => {
    const m = parseHL7(SAMPLE_A04);
    const mapped = mapHL7ToAdmission(m, "HOSP-BLR-49");

    // Patient
    expect(mapped.patient.mrn).toBe("PYZBP2Z4P");
    expect(mapped.patient.name).toBe("CHINTA DEVI");
    expect(mapped.patient.gender).toBe("F");
    expect(mapped.patient.hospital_id).toBe("HOSP-BLR-49");
    expect(mapped.patient.age).toBeGreaterThan(60);   // born 1963
    expect(mapped.patient.department).toBe("ONCOLOGY");

    // Case seed
    expect(mapped.case_seed.scheme).toBe("PMJAY");
    expect(mapped.case_seed.payer).toBe("National Health Authority");
    expect(mapped.case_seed.diagnosis).toContain("C50.9");
    expect(mapped.case_seed.status).toBe("admitted");
    expect(mapped.case_seed.entry_mode).toBe("his_feed");
    expect(mapped.case_seed.hospital_id).toBe("HOSP-BLR-49");
    expect(mapped.case_seed.admission_date).toBe("2026-06-29");

    // Source provenance
    expect(mapped.source.msg_control_id).toBe("MSG00001");
    expect(mapped.source.trigger).toBe("A04");
    expect(mapped.source.sending_facility).toBe("HOSP-BLR-49");
  });

  it("rejects unsupported message types", () => {
    const a08 = SAMPLE_A04.replace("ADT^A04", "ADT^A08");
    const m = parseHL7(a08);
    expect(() => mapHL7ToAdmission(m, "HOSP-BLR-49")).toThrow(/Unsupported/i);
  });

  it("normalizes CGHS scheme regardless of case", () => {
    const cghs = SAMPLE_A04.replace(
      "IN1|1|PMJAY|PMJAY-NHA|National Health Authority",
      "IN1|1|cghs|CGHS-Delhi|Central Govt Health Scheme"
    );
    const mapped = mapHL7ToAdmission(parseHL7(cghs), "HOSP-BLR-49");
    expect(mapped.case_seed.scheme).toBe("CGHS");
  });

  it("falls back gracefully when DG1 is missing", () => {
    const noDiag = SAMPLE_A04.split("\r").filter((l) => !l.startsWith("DG1")).join("\r");
    const mapped = mapHL7ToAdmission(parseHL7(noDiag), "HOSP-BLR-49");
    expect(mapped.case_seed.diagnosis).toBe("");
  });
});
