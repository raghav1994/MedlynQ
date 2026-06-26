import { NextRequest, NextResponse } from "next/server";
import os from "os";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const CONNECTION_FILE = path.join(process.cwd(), "db", "mobile_connection.json");

function getLocalIps(): string[] {
  const ips: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips.length > 0 ? ips : ["127.0.0.1"];
}

export async function GET() {
  try {
    let lastConnected = null;
    try {
      const raw = await fs.readFile(CONNECTION_FILE, "utf8");
      lastConnected = JSON.parse(raw);
    } catch {}

    const ips = getLocalIps();
    return NextResponse.json({
      ok: true,
      ips: ips,
      ip: ips[0],
      lastConnected,
      timestamp: new Date().toISOString()
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = {
      device: body.device || "Unknown Device",
      role: body.role || "Unknown Role",
      ip: req.headers.get("x-forwarded-for") || req.ip || "unknown",
      timestamp: new Date().toISOString()
    };

    // Ensure db dir exists
    await fs.mkdir(path.dirname(CONNECTION_FILE), { recursive: true });
    await fs.writeFile(CONNECTION_FILE, JSON.stringify(data, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      status: "connected",
      registered: data
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
