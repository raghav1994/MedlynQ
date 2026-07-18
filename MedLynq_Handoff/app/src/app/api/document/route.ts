import { NextRequest } from "next/server";
import { cases, patients, loadDynamicData } from "@/lib/mockData";
import path from "path";
import fs from "fs";

const DELETIONS_FILE = path.resolve(process.cwd(), "db", "document_deletions.json");

function markDocumentDeleted(caseId: string, filename: string) {
  let deletions: Record<string, true> = {};
  try { deletions = JSON.parse(fs.readFileSync(DELETIONS_FILE, "utf8")); } catch {}
  deletions[`${caseId}::${filename}`] = true;
  fs.mkdirSync(path.dirname(DELETIONS_FILE), { recursive: true });
  fs.writeFileSync(DELETIONS_FILE, JSON.stringify(deletions, null, 2));
}

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    loadDynamicData();
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get("caseId");
    const filename = searchParams.get("filename");
    const mrn = searchParams.get("mrn");

    if (!filename) {
      return new Response("Missing filename", { status: 400 });
    }

    let safeMrn: string | null = null;
    if (mrn) {
      safeMrn = mrn.replace(/[^A-Za-z0-9_-]/g, "_");
    } else if (caseId) {
      const targetCase = cases.find((c) => c.id === caseId);
      if (targetCase) {
        const targetPatient = patients.find((p) => p.id === targetCase.patient_id);
        if (targetPatient) {
          safeMrn = targetPatient.mrn.replace(/[^A-Za-z0-9_-]/g, "_");
        }
      }
    }

    if (!safeMrn) {
      return new Response("Patient or MRN not found", { status: 404 });
    }

    const filePath = path.join(process.cwd(), "..", "PatientLog", safeMrn, "originals", filename);
    const ext = path.extname(filename).toLowerCase();

    if (!fs.existsSync(filePath)) {
      // Return custom mock SVG if file doesn't exist on disk (for seeded mock items)
      if ([".jpg", ".jpeg", ".png"].includes(ext)) {
        const placeholderSvg = `
          <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;">
            <rect width="100%" height="100%" fill="#f1f5f9"/>
            <rect x="20" y="20" width="360" height="260" rx="12" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 4"/>
            <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="#334155" font-weight="bold">${filename}</text>
            <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" font-size="11" fill="#94a3b8" font-style="italic">(Placeholder File)</text>
          </svg>
        `;
        return new Response(placeholderSvg.trim(), {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml",
          },
        });
      } else if (ext === ".pdf") {
        // Return a raw placeholder for PDF
        return new Response("Seeded Mock PDF Placeholder", {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }
      return new Response("File not found on disk", { status: 404 });
    }

    let contentType = "application/octet-stream";
    if (ext === ".jpg" || ext === ".jpeg") {
      contentType = "image/jpeg";
    } else if (ext === ".png") {
      contentType = "image/png";
    } else if (ext === ".pdf") {
      contentType = "application/pdf";
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Without this, some browsers (notably Chrome with "Download PDFs"
        // enabled in chrome://settings/content/pdfDocuments) treat an
        // ambiguous response as a download rather than opening it in the
        // tab. inline + a real filename tells every browser this is meant
        // to be viewed, which is what the "View" button's window.open(...,
        // "_blank") is actually going for.
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    return new Response(err?.message || "Internal server error", { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    loadDynamicData();
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get("caseId");
    const filename = searchParams.get("filename");
    const mrn = searchParams.get("mrn");

    if (!filename) {
      return new Response("Missing filename", { status: 400 });
    }

    let safeMrn: string | null = null;
    if (mrn) {
      safeMrn = mrn.replace(/[^A-Za-z0-9_-]/g, "_");
    } else if (caseId) {
      const targetCase = cases.find((c) => c.id === caseId);
      if (targetCase) {
        const targetPatient = patients.find((p) => p.id === targetCase.patient_id);
        if (targetPatient) {
          safeMrn = targetPatient.mrn.replace(/[^A-Za-z0-9_-]/g, "_");
        }
      }
    }

    if (!safeMrn) {
      return new Response("Patient or MRN not found", { status: 404 });
    }
    
    // 1. Delete original file
    const origPath = path.join(process.cwd(), "..", "PatientLog", safeMrn, "originals", filename);
    if (fs.existsSync(origPath)) {
      fs.unlinkSync(origPath);
      console.log(`DELETED ORIGINAL: ${origPath}`);
    }

    // 2. Delete extracted json manifest if it exists — land/route.ts writes
    // this as `${finalName}.json` (the FULL filename, extension included,
    // e.g. "consent_scan_a.jpg.json"), not "{baseName}.json" — using the
    // wrong path here silently orphaned every manifest on delete.
    const manifestPath = path.join(process.cwd(), "..", "PatientLog", safeMrn, "extracted", `${filename}.json`);
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      console.log(`DELETED MANIFEST: ${manifestPath}`);
    }

    // 3. Some documents (seeded/HIS entries) have no backing file — steps 1
    // and 2 above are then silent no-ops, and the doc would otherwise
    // reappear on the next read since it's hardcoded in DOCUMENTS_BY_CASE.
    // Record the deletion so docsForCase() filters it out regardless.
    if (caseId) markDocumentDeleted(caseId, filename);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(err?.message || "Internal server error", { status: 500 });
  }
}
