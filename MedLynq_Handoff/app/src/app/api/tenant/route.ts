import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const hospitalId = url.searchParams.get("hospital_id");
    
    if (hospitalId) {
      const dbDir = path.join(process.cwd(), "db", "tenants");
      const filePath = path.join(dbDir, `${hospitalId.toUpperCase()}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const tenant = JSON.parse(data);
        return NextResponse.json({ tenant });
      } else {
        return NextResponse.json({ ok: false, error: "Tenant not found" }, { status: 404 });
      }
    }
    
    const t = await getTenant();
    return NextResponse.json({ tenant: t });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
