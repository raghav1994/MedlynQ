// User store — reads db/users.json (one file, no DB needed).
//
// Passwords stored as bcrypt hashes ($2a$10$…). NEVER stored plaintext.
// Admins edit this file directly until we build a user-management UI.

import bcrypt from "bcryptjs";
import { readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
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
  // Only meaningful for SUPERADMIN — see SessionUser.is_owner.
  is_owner?: boolean;
  // See SessionUser.desktop_access — false marks a Floor Admin account.
  desktop_access?: boolean;
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
    is_owner: u.is_owner,
    desktop_access: u.desktop_access,
  };
}

async function saveAll(users: StoredUser[]): Promise<void> {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

/** All logins for one hospital — used by the backend-admin dashboard's
 * per-hospital user list. Never call this without a SUPERADMIN guard
 * upstream — it bypasses the normal per-session hospital scoping entirely
 * by design (that's the whole point of the internal admin surface). */
export async function listUsersForHospital(hospital_id: string): Promise<Omit<StoredUser, "password_hash">[]> {
  const users = await loadAll();
  return users
    .filter((u) => u.hospital_id === hospital_id)
    .map(({ password_hash, ...rest }) => rest);
}

/** Every login with a given role, regardless of hospital — used for the
 * internal-staff (SUPERADMIN) management screen, which has no single
 * hospital_id to scope by since these accounts aren't tied to a hospital. */
export async function listUsersByRole(role: Role): Promise<Omit<StoredUser, "password_hash">[]> {
  const users = await loadAll();
  return users
    .filter((u) => u.role === role)
    .map(({ password_hash, ...rest }) => rest);
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  hospital_id: string;
  hospital_name: string;
  designation: string;
  bis_enabled?: boolean;
  password: string;
  desktop_access?: boolean;
}): Promise<Omit<StoredUser, "password_hash">> {
  const users = await loadAll();
  const existing = users.find((u) => u.email.toLowerCase() === input.email.trim().toLowerCase());
  if (existing) throw new Error(`A user with email ${input.email} already exists`);

  const password_hash = await bcrypt.hash(input.password, 10);
  const newUser: StoredUser = {
    id: `U_${randomUUID().slice(0, 8).toUpperCase()}`,
    email: input.email.trim(),
    name: input.name.trim(),
    role: input.role,
    hospital_id: input.hospital_id,
    hospital_name: input.hospital_name,
    designation: input.designation,
    bis_enabled: input.bis_enabled ?? false,
    password_hash,
    created_at: new Date().toISOString(),
    ...(input.desktop_access === false ? { desktop_access: false } : {}),
  };
  users.push(newUser);
  await saveAll(users);
  const { password_hash: _drop, ...rest } = newUser;
  return rest;
}

/** Soft-delete — sets disabled:true rather than removing the record, so a
 * disabled user's audit history (past routing decisions, redactions, etc.)
 * still resolves to a real name instead of a dangling user id. */
export async function setUserDisabled(userId: string, disabled: boolean): Promise<void> {
  const users = await loadAll();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error(`User ${userId} not found`);
  users[idx] = { ...users[idx], disabled };
  await saveAll(users);
}
