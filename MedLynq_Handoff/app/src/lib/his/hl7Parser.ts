// HL7 v2.x parser — minimal, focused on ADT^A04 (Register a patient).
//
// HL7v2 is pipe-delimited, line-per-segment. The first segment (MSH) defines
// the field delimiters in characters 4-7. We assume the standard `|^~\&`.
//
// Segment ID is always the first 3 chars. Fields are pipe-delimited within a
// segment. A field can have components (^) and repetitions (~) — exposed as
// nested arrays so the mapper can pick what it needs.
//
// Example PID:
//   PID|1||PYZBP2Z4P^^^HOSP^MR||DEVI^CHINTA||19630815|F|...
//
// Parsed:
//   { id: "PID", fields: [["1"], [""], [["PYZBP2Z4P","","","HOSP","MR"]], [""], [["DEVI","CHINTA"]], ...] }

export type HL7Component = string;
export type HL7Field = HL7Component[];           // ["DEVI","CHINTA"] — components
export type HL7Repetition = HL7Field[];          // for ~-repeated fields
export type HL7Segment = {
  id: string;
  fields: HL7Repetition[];                       // [field][repetition][component]
};

export type HL7Message = {
  raw: string;
  segments: HL7Segment[];
  segmentById: Map<string, HL7Segment[]>;
  delimiters: { field: string; component: string; repetition: string; escape: string; subcomponent: string };
};

function splitWithDelim(s: string, delim: string): string[] {
  if (!delim) return [s];
  return s.split(delim);
}

export function parseHL7(raw: string): HL7Message {
  // Normalize line endings — HL7 spec uses \r, real-world uses \r\n or \n.
  const clean = raw.replace(/\r\n?/g, "\n").trim();
  const lines = clean.split("\n").filter((l) => l.length >= 3);
  if (lines.length === 0 || !lines[0].startsWith("MSH")) {
    throw new Error("Not a valid HL7 message — first segment must be MSH");
  }

  // Delimiters live in MSH-1 + MSH-2.
  // MSH-1 is the field delimiter itself (char at index 3 of "MSH|").
  // MSH-2 is the encoding chars (next 4 chars).
  const field = lines[0][3] ?? "|";
  const encoding = lines[0].slice(4, 8);
  const component = encoding[0] ?? "^";
  const repetition = encoding[1] ?? "~";
  const escape = encoding[2] ?? "\\";
  const subcomponent = encoding[3] ?? "&";

  const segments: HL7Segment[] = [];
  for (const line of lines) {
    const id = line.slice(0, 3);
    const fieldStrings = line.split(field);
    // MSH is special: fieldStrings[1] is the encoding chars, but fieldStrings[0] is "MSH".
    // For other segments fieldStrings[0] is the segment ID. Normalize: drop the ID.
    const rawFields = fieldStrings.slice(1);

    const fields: HL7Repetition[] = rawFields.map((rawField) => {
      const reps = splitWithDelim(rawField, repetition);
      return reps.map((rep) => splitWithDelim(rep, component));
    });

    // MSH quirk: the field delimiter itself is field-1 of MSH (the char that follows "MSH").
    // Re-insert it so callers can read MSH-1 consistently.
    if (id === "MSH") {
      fields.unshift([[field]]);
    }

    segments.push({ id, fields });
  }

  const segmentById = new Map<string, HL7Segment[]>();
  for (const seg of segments) {
    const arr = segmentById.get(seg.id) ?? [];
    arr.push(seg);
    segmentById.set(seg.id, arr);
  }

  return {
    raw,
    segments,
    segmentById,
    delimiters: { field, component, repetition, escape, subcomponent },
  };
}

// ---------- Read helpers ----------

/** Get a specific field/repetition/component. All 1-indexed per HL7 convention. */
export function getField(
  msg: HL7Message,
  segmentId: string,
  fieldIndex: number,
  repetition = 1,
  component?: number,
): string | undefined {
  const seg = msg.segmentById.get(segmentId)?.[0];
  if (!seg) return undefined;
  const f = seg.fields[fieldIndex - 1];
  if (!f) return undefined;
  const rep = f[repetition - 1];
  if (!rep) return undefined;
  if (component == null) return rep.join(msg.delimiters.component);
  return rep[component - 1];
}

export function messageType(msg: HL7Message): { trigger: string; structure: string } {
  // MSH-9: e.g. "ADT^A04^ADT_A01"
  const raw = getField(msg, "MSH", 9) ?? "";
  const parts = raw.split(msg.delimiters.component);
  return { trigger: parts[1] ?? "", structure: parts[0] ?? "" };
}

export function messageControlId(msg: HL7Message): string {
  return getField(msg, "MSH", 10) ?? "";
}

export function sendingFacility(msg: HL7Message): string {
  return getField(msg, "MSH", 4) ?? "";
}

/** Build a minimal ACK^A01 message acknowledging receipt. */
export function buildAck(original: HL7Message, code: "AA" | "AE" | "AR", text?: string): string {
  const now = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const controlId = messageControlId(original);
  const ourId = `MEDLYNQ${Date.now()}`;
  const lines = [
    `MSH|^~\\&|MEDLYNQ|MEDLYNQ|${sendingFacility(original)}|${getField(original, "MSH", 3) ?? ""}|${now}||ACK^A04|${ourId}|P|2.5`,
    `MSA|${code}|${controlId}${text ? `|${text}` : ""}`,
  ];
  return lines.join("\r");
}
