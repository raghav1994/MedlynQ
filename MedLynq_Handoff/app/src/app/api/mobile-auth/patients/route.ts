import { NextRequest, NextResponse } from "next/server";
import { patients as mockPatients, cases as mockCases } from "@/lib/mockData";
import { readFile } from "fs/promises";
import path from "path";
import { getPendingPatientIds } from "@/lib/documentRequests";

export const runtime = "nodejs";

const STORE_FILE = path.resolve(process.cwd(), "..", "PatientLog", "_index", "patients.json");

async function readStore(): Promise<any[]> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const hospitalId = url.searchParams.get("hospital_id");
    const department = url.searchParams.get("department");

    if (!hospitalId) {
      return NextResponse.json({ ok: false, error: "hospital_id parameter is required" }, { status: 400 });
    }

    // Load static mock patients
    const staticList = mockPatients.filter(p => p.hospital_id === hospitalId);

    // Load dynamic patients
    const dynamicList = await readStore();
    const dynamicMapped = dynamicList.map(p => ({
      ...p,
      hospital_id: hospitalId // Scoped to requested hospital for mobile
    }));

    // Merge lists
    const mergedList = [...staticList, ...dynamicMapped];

    const pendingPatientIds = await getPendingPatientIds(hospitalId);

    // Map case status and scheme
    const enrichedList = mergedList.map(p => {
      const pCase = mockCases.find(c => c.patient_id === p.id);

      let status = "Active";
      let scheme = "CGHS";

      if (pCase) {
        scheme = pCase.scheme;
        if (pCase.status === "admitted") {
          status = "Active";
        } else if (pCase.status === "preauth_pending") {
          status = "Pending";
        } else if (pCase.status?.includes("discharge") || pCase.discharge_date) {
          status = "Discharged";
        }
      }

      return {
        id: p.id,
        mrn: p.mrn,
        name: p.name,
        age: p.age,
        gender: p.gender,
        state: p.state || "Delhi",
        district: p.district || "Bangalore",
        department: p.department || "Oncology",
        status,
        scheme,
        has_pending_request: pendingPatientIds.has(p.id),
      };
    });

    // Filter by department if supplied
    const finalPatients = department && department.toLowerCase() !== "all"
      ? enrichedList.filter(p => p.department.toLowerCase() === department.toLowerCase())
      : enrichedList;

    return NextResponse.json({ ok: true, patients: finalPatients });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
