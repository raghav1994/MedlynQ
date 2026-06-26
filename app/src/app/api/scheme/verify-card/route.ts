// /api/scheme/verify-card?scheme=PMJAY&card=XXXXXXXXXXXX
// Stub for real PMJAY / CGHS / SHA / Railway UMID / ECHS card verify APIs.
// When NHA / scheme keys land, swap URL + auth and keep response shape identical.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type Verified = {
  ok: boolean;
  card: string;
  scheme: string;
  beneficiary?: {
    name: string;
    age: number;
    gender: "M" | "F";
    state: string;
    district: string;
    photo_present: boolean;
  };
  wallet?: { available_inr: number; cap_inr: number; spent_inr: number; valid_till: string };
  card_status: "active" | "expired" | "blocked" | "not_found" | "invalid_format";
  message: string;
};

// Deterministic mock — same card always returns the same answer in dev so
// the OPD handover queue lands in a stable state.
function pseudoBeneficiary(card: string, scheme: string) {
  const FIRST = ["Vikram", "Sushila", "Ramesh", "Chinta", "Mohan", "Rajkumari", "Krishan", "Anita", "Devraj", "Meena"];
  const LAST = ["Singh", "Gupta", "Kohli", "Devi", "Lal", "Sharma", "Verma", "Kumari", "Yadav", "Mishra"];
  const STATES = [["Karnataka", "Bengaluru Urban"], ["Delhi", "South Delhi"], ["Uttar Pradesh", "Noida Urban"], ["Maharashtra", "Pune"], ["Tamil Nadu", "Chennai"]];
  let h = 0;
  for (let i = 0; i < card.length; i++) h = (h * 31 + card.charCodeAt(i)) >>> 0;
  const first = FIRST[h % FIRST.length];
  const last = LAST[(h >>> 4) % LAST.length];
  const [state, district] = STATES[(h >>> 8) % STATES.length];
  const age = 25 + (h % 55);
  const gender: "M" | "F" = h % 2 === 0 ? "M" : "F";
  const cap = scheme === "PMJAY" ? 500000 : scheme === "CGHS" ? 1000000 : scheme === "ECHS" ? 750000 : 500000;
  const spent = (h % cap) | 0;
  return {
    name: `${first} ${last}`,
    age, gender,
    state, district,
    photo_present: true,
    cap_inr: cap,
    spent_inr: spent,
    available_inr: cap - spent,
  };
}

export async function GET(req: NextRequest) {
  const scheme = (req.nextUrl.searchParams.get("scheme") || "").toUpperCase();
  const card = (req.nextUrl.searchParams.get("card") || "").trim();
  if (!scheme || !card) {
    return NextResponse.json({ ok: false, error: "scheme and card required" }, { status: 400 });
  }

  const digits = card.replace(/\s+/g, "");
  // Per-scheme format validation
  const FORMATS: Record<string, RegExp> = {
    PMJAY:   /^P[A-Z0-9]{12,16}$/i,            // 13-17 chars starting P
    CGHS:    /^[0-9]{8,12}$/,                  // 8-12 digits
    SHA:     /^[A-Z0-9]{10,14}$/i,             // state varies
    Railway: /^[A-Z0-9]{10,14}$/i,             // UMID
    ECHS:    /^[A-Z0-9]{10,14}$/i,
    ESI:     /^[0-9]{10,12}$/,
  };
  const re = FORMATS[scheme];
  if (re && !re.test(digits)) {
    const out: Verified = {
      ok: false, card, scheme,
      card_status: "invalid_format",
      message: `Card format does not match ${scheme} pattern.`,
    };
    return NextResponse.json(out);
  }

  // Special test cards to force statuses (handy for demo)
  if (/X+$/.test(digits)) {
    return NextResponse.json<Verified>({ ok: false, card, scheme, card_status: "expired", message: "Card expired." });
  }
  if (/0{6,}/.test(digits)) {
    return NextResponse.json<Verified>({ ok: false, card, scheme, card_status: "blocked", message: "Card blocked by scheme authority." });
  }

  const b = pseudoBeneficiary(digits, scheme);
  const verified: Verified = {
    ok: true, card, scheme,
    beneficiary: {
      name: b.name, age: b.age, gender: b.gender,
      state: b.state, district: b.district, photo_present: b.photo_present,
    },
    wallet: {
      available_inr: b.available_inr,
      cap_inr: b.cap_inr,
      spent_inr: b.spent_inr,
      valid_till: `${new Date().getFullYear() + 1}-03-31`,
    },
    card_status: "active",
    message: `Card verified (mock). Wallet ₹${b.available_inr.toLocaleString("en-IN")} of ₹${b.cap_inr.toLocaleString("en-IN")} available.`,
  };
  return NextResponse.json(verified);
}
