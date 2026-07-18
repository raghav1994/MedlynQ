import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface MobileStaff {
  id: string;
  name: string;
  role: string;
  dept: string;
  pin: string;
  hospital_id: string;
  status: "active" | "inactive";
  device_id: string | null;
  registered_at: string | null;
}

export interface MobileSession {
  token: string;
  staff_id: string;
  name: string;
  role: string;
  dept: string;
  hospital_id: string;
  device_id: string;
  status: "active" | "pending_approval";
  login_type: "nfc" | "approval" | "credentials";
  created_at: string;
}

export interface MobileStaffLog {
  id: string;
  staff_id: string;
  name: string;
  role: string;
  dept: string;
  action: "login" | "logout" | "auto_logout" | "force_logout";
  timestamp: string;
}

const STAFF_FILE = path.join(process.cwd(), "db", "mobile_staff.json");
const SESSIONS_FILE = path.join(process.cwd(), "db", "mobile_sessions.json");
const LOGS_FILE = path.join(process.cwd(), "db", "mobile_staff_logs.json");

// Helper to safely read JSON
function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
    return fallback;
  }
}

// Helper to safely write JSON
function writeJson<T>(filePath: string, data: T): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e);
  }
}

// --- LOGGING ---

export function writeStaffLog(staffId: string, action: MobileStaffLog["action"]): void {
  const staffList = readJson<MobileStaff[]>(STAFF_FILE, []);
  const staff = staffList.find(s => s.id === staffId);
  if (!staff) return;

  const logs = readJson<MobileStaffLog[]>(LOGS_FILE, []);
  const newLog: MobileStaffLog = {
    id: `log_${crypto.randomBytes(6).toString("hex")}`,
    staff_id: staffId,
    name: staff.name,
    role: staff.role,
    dept: staff.dept,
    action,
    timestamp: new Date().toISOString()
  };
  
  logs.push(newLog);
  writeJson(LOGS_FILE, logs);
}

export function getStaffLogs(staffId: string): MobileStaffLog[] {
  const logs = readJson<MobileStaffLog[]>(LOGS_FILE, []);
  return logs
    .filter(l => l.staff_id === staffId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// --- STAFF MANAGEMENT ---

export function getStaffList(hospitalId: string): MobileStaff[] {
  const all = readJson<MobileStaff[]>(STAFF_FILE, []);
  // Return all active staff members
  return all.filter(s => s.hospital_id === hospitalId && s.status === "active");
}

export function addStaff(name: string, role: string, dept: string, pin: string, hospitalId: string): MobileStaff {
  const all = readJson<MobileStaff[]>(STAFF_FILE, []);
  const newStaff: MobileStaff = {
    id: `staff_${crypto.randomBytes(4).toString("hex")}`,
    name,
    role,
    dept,
    pin,
    hospital_id: hospitalId,
    status: "active",
    device_id: null,
    registered_at: null
  };
  all.push(newStaff);
  writeJson(STAFF_FILE, all);
  
  // Seed an initial "creation" log if desired or proceed silently
  return newStaff;
}

export function deactivateStaff(staffId: string): boolean {
  const all = readJson<MobileStaff[]>(STAFF_FILE, []);
  const staff = all.find(s => s.id === staffId);
  if (!staff) return false;
  
  staff.status = "inactive";
  writeJson(STAFF_FILE, all);
  
  // Kill any active sessions for this deactivated staff member
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const hasActiveSession = sessions.some(s => s.staff_id === staffId);
  if (hasActiveSession) {
    writeStaffLog(staffId, "force_logout");
  }
  const filtered = sessions.filter(s => s.staff_id !== staffId);
  writeJson(SESSIONS_FILE, filtered);
  
  return true;
}

export function registerDevice(staffId: string, deviceId: string, pin: string): MobileStaff | null {
  const all = readJson<MobileStaff[]>(STAFF_FILE, []);
  const staff = all.find(s => s.id === staffId && s.status === "active");
  if (!staff || staff.pin !== pin) return null;
  
  staff.device_id = deviceId;
  staff.registered_at = new Date().toISOString();
  writeJson(STAFF_FILE, all);
  return staff;
}

// --- SESSION MANAGEMENT ---

const SESSION_TIMEOUT_MS = 10 * 60 * 60 * 1000; // 10 Hours hard expiry (8 hours shift + 2 hours buffer)

export function getActiveSessions(hospitalId: string): MobileSession[] {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const now = Date.now();
  let modified = false;
  
  // Clean up expired sessions on read
  const validSessions = sessions.filter(s => {
    const elapsed = now - new Date(s.created_at).getTime();
    if (elapsed > SESSION_TIMEOUT_MS) {
      modified = true;
      writeStaffLog(s.staff_id, "auto_logout");
      return false;
    }
    return s.hospital_id === hospitalId;
  });
  
  if (modified) {
    writeJson(SESSIONS_FILE, validSessions);
  }
  
  return validSessions;
}

export function createSession(
  staffId: string, 
  deviceId: string, 
  loginType: "nfc" | "approval" | "credentials"
): { session: MobileSession; status: "active" | "pending_approval" } | null {
  const staffList = readJson<MobileStaff[]>(STAFF_FILE, []);
  const staff = staffList.find(s => s.id === staffId && s.status === "active");
  if (!staff) return null;
  
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  
  // Remove existing active sessions for this staff member to prevent multiple logins
  const cleanSessions = sessions.filter(s => s.staff_id !== staffId);
  
  const token = `token_${crypto.randomBytes(16).toString("hex")}`;
  const status = loginType === "approval" ? "pending_approval" : "active";
  
  const newSession: MobileSession = {
    token,
    staff_id: staffId,
    name: staff.name,
    role: staff.role,
    dept: staff.dept,
    hospital_id: staff.hospital_id,
    device_id: deviceId,
    status,
    login_type: loginType,
    created_at: new Date().toISOString()
  };
  
  cleanSessions.push(newSession);
  writeJson(SESSIONS_FILE, cleanSessions);
  
  if (status === "active") {
    writeStaffLog(staffId, "login");
  }
  
  return { session: newSession, status };
}

export function approveSession(staffId: string, hospitalId: string): boolean {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const session = sessions.find(s => s.staff_id === staffId && s.hospital_id === hospitalId && s.status === "pending_approval");
  if (!session) return false;
  
  session.status = "active";
  session.created_at = new Date().toISOString(); // Reset start time to exactly when it was approved
  writeJson(SESSIONS_FILE, sessions);
  
  writeStaffLog(staffId, "login");
  return true;
}

export function rejectSession(staffId: string, hospitalId: string): boolean {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const clean = sessions.filter(s => !(s.staff_id === staffId && s.hospital_id === hospitalId && s.status === "pending_approval"));
  writeJson(SESSIONS_FILE, clean);
  return true;
}

export function pingSession(token: string): { active: boolean; session?: MobileSession; reason?: string } {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const session = sessions.find(s => s.token === token);
  if (!session) {
    return { active: false, reason: "session_not_found" };
  }
  
  // Check if staff profile has been deactivated
  const staffList = readJson<MobileStaff[]>(STAFF_FILE, []);
  const staff = staffList.find(s => s.id === session.staff_id);
  if (!staff || staff.status === "inactive") {
    // Purge session
    writeStaffLog(session.staff_id, "force_logout");
    const clean = sessions.filter(s => s.token !== token);
    writeJson(SESSIONS_FILE, clean);
    return { active: false, reason: "profile_deactivated" };
  }
  
  if (session.status === "pending_approval") {
    return { active: false, reason: "pending_approval", session };
  }
  
  const elapsed = Date.now() - new Date(session.created_at).getTime();
  if (elapsed > SESSION_TIMEOUT_MS) {
    // Session expired, purge it
    writeStaffLog(session.staff_id, "auto_logout");
    const clean = sessions.filter(s => s.token !== token);
    writeJson(SESSIONS_FILE, clean);
    return { active: false, reason: "session_expired" };
  }
  
  return { active: true, session };
}

export function logoutSession(token: string): boolean {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const session = sessions.find(s => s.token === token);
  if (session) {
    writeStaffLog(session.staff_id, "logout");
  }
  const clean = sessions.filter(s => s.token !== token);
  writeJson(SESSIONS_FILE, clean);
  return true;
}

export function logoutStaffSession(staffId: string, hospitalId: string): boolean {
  const sessions = readJson<MobileSession[]>(SESSIONS_FILE, []);
  const hasActiveSession = sessions.some(s => s.staff_id === staffId && s.hospital_id === hospitalId);
  if (hasActiveSession) {
    writeStaffLog(staffId, "force_logout");
  }
  const clean = sessions.filter(s => !(s.staff_id === staffId && s.hospital_id === hospitalId));
  writeJson(SESSIONS_FILE, clean);
  return true;
}
