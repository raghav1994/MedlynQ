// User store — reads db/users.json (one file, no DB needed).
//
// Passwords stored as bcrypt hashes ($2a$10$…). NEVER stored plaintext.
// Admins edit this file directly until we build a user-management UI.

import bcrypt from "bcryptjs";
import { readFile } from "fs/promises";
import path from "path";
import type { Role } from "./session";

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hospital_id: string;
  hospital_name: string;
  designation: string;
  bis_enabled: boolean;
  password_hash: string;
  created_at: string;
  disabled?: boolean;
};

const USERS_FILE = path.resolve(process.cwd(), "db", "users.json");

async function loadAll(): Promise<StoredUser[]> {
  try {
    const raw = await readFile(USERS_FILE, "utf8");
    return JSON.parse(raw) as StoredUser[];
  } catch {
    return [];
  }
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const users = await loadAll();
  const target = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === target) ?? null;
}

export async function verifyCredentials(email: string, password: string): Promise<StoredUser | null> {
  const u = await findUserByEmail(email);
  if (!u || u.disabled) return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  return ok ? u : null;
}

export function toSessionUser(u: StoredUser) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    hospital_id: u.hospital_id,
    hospital_name: u.hospital_name,
    designation: u.designation,
    bis_enabled: u.bis_enabled,
  };
}
