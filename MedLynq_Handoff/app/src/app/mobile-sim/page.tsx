"use client";

import { useEffect, useState, useRef } from "react";
import AppShell from "@/components/AppShell";
import clsx from "clsx";
import { useRoleGate } from "@/lib/useRoleGate";

type Patient = { id: string; mrn: string; name: string; age: number; gender: string; department: string; status?: string; scheme?: string };

interface StaffProfile {
  id: string;
  name: string;
  role: string;
  dept: string;
  pin: string;
  hospital_id: string;
  device_id: string | null;
}

interface MobileSession {
  token: string;
  staff_id: string;
  name: string;
  role: string;
  dept: string;
  status: "active" | "pending_approval";
  login_type: "nfc" | "approval" | "credentials";
  created_at: string;
}

const MOCK_PATIENTS: Patient[] = [
  { id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi", age: 62, gender: "F", department: "Oncology", status: "Active", scheme: "CGHS" },
  { id: "P0002", mrn: "MU29120HU", name: "Rajkumari", age: 65, gender: "F", department: "Oncology", status: "Pending", scheme: "ECHS" },
  { id: "P0003", mrn: "MH9VWGX49", name: "Mohan Lal", age: 71, gender: "M", department: "Cardiology", status: "Active", scheme: "TPA" },
  { id: "P0008", mrn: "MK70A6O8G", name: "Vikram Singh", age: 68, gender: "M", department: "Cardiology", status: "Discharged", scheme: "General" },
  { id: "P0010", mrn: "PTBQ4UU03", name: "Ramesh Kohli", age: 60, gender: "M", department: "Gastroenterology", status: "Active", scheme: "CGHS" }
];

const DOC_TYPES = [
  "Patient ID",
  "Consent Form",
  "Referral",
  "Registration Copy",
  "Beneficiary Verification Slip",
  "Latest Pathology (HPE)",
  "PET-CT Report",
  "Tumor Board Certificate",
  "Prescription / Protocol",
  "OPD Slip",
  "CBC / LFT / KFT Profile",
  "IPD File (admission)",
  "Prior Imaging (CT/MRI/X-ray)",
  "Drug Pouch / Wrapper Photo",
  "Chemo Chart",
  "IPD File (day care)",
  "OT Notes",
  "OT Files",
  "Anaesthesia Note",
  "Post Surgery Photo",
  "Radiation Files",
  "Radiation Chart",
  "Feedback Form",
  "Discharge Summary",
  "Discharge Photo",
  "Hospital Bill",
  "Geotag Photo",
  "Post-op Notes",
  "Clinical Vitals Log"
];

const formatName = (fullName: string) => {
  let clean = fullName.replace(/^(Nurse|Sister|Dr\.)\s+/i, "");
  const parts = clean.split(/\s+/);
  if (parts.length > 1) {
    return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
  }
  return clean;
};

export default function MobileSimulatorPage() {
  useRoleGate(["ADMIN"], "/patients");
  const [screen, setScreen] = useState<
    "welcome" | "sim_scan" | "board" | "pin" | "waiting_approval" | "dash" | "select_patient" | "camera" | "confirm" | "success" | "medco_login" | "onboard_welcome" | "onboard_biometrics" | "onboard_activation"
  >("welcome"); // Default to welcome landing screen

  // Dynamic lists from backend
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [activeSessions, setActiveSessions] = useState<MobileSession[]>([]);
  const [tenant, setTenant] = useState<any>({
    hospital_id: "HOSP-BLR-49",
    name: "Action Cancer Hospital",
    latitude: "28.6292° N",
    longitude: "77.1065° E",
    address: "Paschim Vihar, New Delhi"
  });

  // Patient Registry State
  const [patients, setPatients] = useState<Patient[]>(MOCK_PATIENTS);
  const [showAddPatientForm, setShowAddPatientForm] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientMrn, setNewPatientMrn] = useState("");
  const [newPatientAge, setNewPatientAge] = useState("");
  const [newPatientGender, setNewPatientGender] = useState("M");
  const [newPatientStatus, setNewPatientStatus] = useState("Active");
  const [newPatientDept, setNewPatientDept] = useState("Oncology");
  const [newPatientScheme, setNewPatientScheme] = useState("CGHS");

  // Keep default patient details synced with tenant config specialties/schemes
  useEffect(() => {
    if (tenant?.specialties_enabled?.length > 0) {
      const s = tenant.specialties_enabled[0];
      setNewPatientDept(s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "));
    }
    if (tenant?.schemes_enabled?.length > 0) {
      setNewPatientScheme(tenant.schemes_enabled[0]);
    }
  }, [tenant]);

  // Local login session
  const [currentUser, setCurrentUser] = useState<StaffProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"active" | "pending_approval" | null>(null);
  const [activeTab, setActiveTab] = useState<"patients" | "admin_panel">("patients");
  const [onboardedStaff, setOnboardedStaff] = useState<any>(null);
  const [selectedHistoryStaffId, setSelectedHistoryStaffId] = useState<string | null>(null);
  const [selectedStaffLogs, setSelectedStaffLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const handleSelectHistoryStaff = async (staffId: string) => {
    if (selectedHistoryStaffId === staffId) {
      setSelectedHistoryStaffId(null);
      setSelectedStaffLogs([]);
      return;
    }
    
    setSelectedHistoryStaffId(staffId);
    setIsLoadingLogs(true);
    try {
      const res = await fetch(`/api/mobile-auth/staff-logs?staff_id=${staffId}`);
      const data = await res.json();
      if (data.ok) {
        setSelectedStaffLogs(data.logs);
      }
    } catch {
      addLog("Failed to fetch logs.");
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Form states
  const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const [selectedDept, setSelectedDept] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [selectedScheme, setSelectedScheme] = useState<string>("All");

  useEffect(() => {
    if (currentUser) {
      setSelectedDept(currentUser.dept || "All");
    } else {
      setSelectedDept("All");
      setSelectedStatus("All");
      setSelectedScheme("All");
    }
  }, [currentUser]);
  const [medcoEmail, setMedcoEmail] = useState("admin@action.in");
  const [medcoPassword, setMedcoPassword] = useState("password");
  const [medcoError, setMedcoError] = useState("");

  // Onboard new staff form
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState("Nurse");
  const [newStaffDept, setNewStaffDept] = useState("Oncology");
  const [newStaffPin, setNewStaffPin] = useState("1379");
  const [onboardedQrData, setOnboardedQrData] = useState<{ pin: string; name: string; id?: string; role?: string; dept?: string; payload?: string } | null>(null);

  // Capture queue (Supports MEDCO batch uploads)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDocType, setSelectedDocType] = useState("Consent Form");
  
  // Batch of QUEUED documents — each may itself be multiple pages, merged
  // into one PDF at upload time (see handleUpload). Replaces the old flat
  // {blob,url,docType}[] shape, which uploaded every captured photo as its
  // own separate document even when it was really page 2 of the same one.
  const [batchQueue, setBatchQueue] = useState<{ docType: string; pages: { blob: Blob; url: string }[] }[]>([]);

  // Pages already captured+confirmed for the document CURRENTLY being
  // built (same doc_type, not yet finalized into batchQueue) — accumulates
  // via "+ Add another page" on the Confirm screen.
  const [currentDocPages, setCurrentDocPages] = useState<{ blob: Blob; url: string }[]>([]);

  // Single capture preview — the just-taken photo, shown on the Confirm screen
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);

  // Upload status
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusMsg, setUploadStatusMsg] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [simLogs, setSimLogs] = useState<string[]>([]);

  // Fetch initial data
  const loadInitialData = async () => {
    try {
      const tenantRes = await fetch("/api/tenant");
      const tenantData = await tenantRes.json();
      if (tenantData.tenant) {
        setTenant(tenantData.tenant);
        
        // Load patients dynamically from the server database
        try {
          const patientsRes = await fetch(`/api/mobile-auth/patients?hospital_id=${tenantData.tenant.hospital_id}`);
          const patientsJson = await patientsRes.json();
          if (patientsJson.ok && patientsJson.patients) {
            setPatients(patientsJson.patients);
          }
        } catch (e) {
          console.error("Failed to load patients:", e);
        }
        
        // Load staff members for this tenant
        const staffRes = await fetch(`/api/mobile-auth/staff?hospital_id=${tenantData.tenant.hospital_id}`);
        const staffJson = await staffRes.json();
        if (staffJson.ok) setStaffList(staffJson.staff);

        // Load active sessions
        const sessRes = await fetch(`/api/mobile-auth/session?hospital_id=${tenantData.tenant.hospital_id}`);
        const sessJson = await sessRes.json();
        if (sessJson.ok) setActiveSessions(sessJson.sessions);
      }
    } catch (e) {
      addLog("Error loading initial data from backend API.");
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Poll for remote approval if session is pending
  useEffect(() => {
    if (!sessionToken || sessionStatus !== "pending_approval") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/mobile-auth/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: sessionToken })
        });
        const data = await res.json();
        if (data.ok) {
          if (data.active) {
            setSessionStatus("active");
            setScreen("dash");
            addLog(`✓ Shift remote approval granted by Admin.`);
            clearInterval(interval);
          } else if (data.reason === "session_not_found" || data.reason === "profile_deactivated") {
            setSessionToken(null);
            setSessionStatus(null);
            setCurrentUser(null);
            setScreen("board");
            addLog(`❌ Approval request denied or profile deactivated.`);
            clearInterval(interval);
          }
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionToken, sessionStatus]);

  // Periodic session poll when active (detects remote logout / shift expiry)
  useEffect(() => {
    if (!sessionToken || sessionStatus !== "active") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/mobile-auth/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: sessionToken })
        });
        const data = await res.json();
        if (data.ok && !data.active) {
          addLog(`⚠️ Session expired or revoked remotely. Reason: ${data.reason || "unknown"}.`);
          handleLocalLogout();
        }
      } catch {}
    }, 5000);

    return () => clearInterval(interval);
  }, [sessionToken, sessionStatus]);

  // Poll active sessions list for Admin dashboard view
  useEffect(() => {
    if (screen !== "dash" || activeTab !== "admin_panel") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/mobile-auth/session?hospital_id=${tenant.hospital_id}`);
        const data = await res.json();
        if (data.ok) {
          setActiveSessions(data.sessions);
        }
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [screen, activeTab, tenant.hospital_id]);

  const addLog = (msg: string) => {
    setSimLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 30));
  };

  const handleLocalLogout = () => {
    setSessionToken(null);
    setSessionStatus(null);
    setCurrentUser(null);
    batchQueue.forEach((d) => d.pages.forEach((p) => URL.revokeObjectURL(p.url)));
    setBatchQueue([]);
    currentDocPages.forEach((p) => URL.revokeObjectURL(p.url));
    setCurrentDocPages([]);
    setCapturedBlob(null);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setScreen("welcome");
  };

  // --- ACTIONS ---

  // Tier 1: NFC Tap Login
  const handleNfcTapLogin = async (staff: StaffProfile) => {
    addLog(`NFC Tag tapped for ${staff.name} at Oncology Desk...`);
    try {
      const res = await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          staff_id: staff.id,
          device_id: "DEVICE_NFC_SIM_94",
          login_type: "nfc"
        })
      });
      const data = await res.json();
      if (data.ok) {
        setCurrentUser(staff);
        setSessionToken(data.session.token);
        setSessionStatus(data.status);
        setScreen("dash");
        addLog(`✓ NFC Tap logged in. Location verified. 10h shift timer started.`);
      } else {
        addLog(`❌ NFC Login failed: ${data.error}`);
      }
    } catch {
      addLog(`❌ Server API connection failed.`);
    }
  };

  // Tier 2: NFC Fallback - Request Approval Login
  const handleRequestApproval = async (staff: StaffProfile) => {
    addLog(`Remote approval requested for ${staff.name}...`);
    try {
      const res = await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          staff_id: staff.id,
          device_id: "DEVICE_SIM_FALLBACK_94",
          login_type: "approval"
        })
      });
      const data = await res.json();
      if (data.ok) {
        setCurrentUser(staff);
        setSessionToken(data.session.token);
        setSessionStatus(data.status);
        setScreen("waiting_approval");
        addLog(`Shift requested. Awaiting Floor Admin tap approval.`);
      } else {
        addLog(`❌ Request approval failed: ${data.error}`);
      }
    } catch {
      addLog(`❌ Server API connection failed.`);
    }
  };

  // credentials login for MEDCOs/Admins
  const handleMedcoLoginSubmit = async () => {
    setMedcoError("");
    addLog(`Credentials validation for ${medcoEmail}...`);
    
    try {
      const res = await fetch("/api/mobile-auth/staff?hospital_id=" + tenant.hospital_id);
      const data = await res.json();
      if (!data.ok) {
        setMedcoError("Failed to fetch staff profiles.");
        return;
      }

      if (!medcoEmail || !medcoPassword) {
        setMedcoError("All fields required.");
        return;
      }
      
      let found: StaffProfile | undefined;
      const emailLower = medcoEmail.toLowerCase();
      
      if (emailLower.includes("admin")) {
        // Resolve to Dr. Rahul Mehta (Floor Admin)
        found = data.staff.find((s: StaffProfile) => s.name.includes("Rahul") || s.role === "Floor Admin");
      } else if (emailLower.includes("richa")) {
        // Resolve to Richa Attri (Doctor/MEDCO)
        found = data.staff.find((s: StaffProfile) => s.name.includes("Richa") || s.role === "Doctor");
      }
      
      if (!found) {
        // Fallback
        found = data.staff.find((s: StaffProfile) => s.role === "Floor Admin") || data.staff[0];
      }

      if (!found) {
        setMedcoError("Unauthorized: Staff profile not found.");
        return;
      }

      // Create session
      const sessionRes = await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          staff_id: found.id,
          device_id: "DEVICE_CREDENTIALS_SIM_94",
          login_type: "credentials"
        })
      });
      const sessionData = await sessionRes.json();
      if (sessionData.ok) {
        setCurrentUser(found);
        setSessionToken(sessionData.session.token);
        setSessionStatus(sessionData.status);
        setScreen("dash");
        setMedcoEmail("");
        setMedcoPassword("");
        addLog(`✓ MEDCO logged in via credentials. Batch uploading enabled.`);
      } else {
        setMedcoError(sessionData.error || "Credentials unauthorized.");
      }
    } catch {
      setMedcoError("Connection failure.");
    }
  };

  // Submit PIN for profile
  const handlePinSubmit = async () => {
    if (!selectedStaff) return;
    
    if (pinInput === selectedStaff.pin) {
      setPinError(false);
      setPinInput("");
      
      try {
        const res = await fetch("/api/mobile-auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            staff_id: selectedStaff.id,
            device_id: "DEVICE_PIN_SIM_94",
            login_type: "credentials" // acts as password bypass
          })
        });
        const data = await res.json();
        if (data.ok) {
          setCurrentUser(selectedStaff);
          setSessionToken(data.session.token);
          setSessionStatus(data.status);
          setScreen("dash");
          addLog(`✓ PIN Login approved for ${selectedStaff.name}.`);
        }
      } catch {
        addLog("PIN Login server connection failure.");
      }
    } else {
      setPinError(true);
      setPinInput("");
      addLog(`❌ Invalid PIN entered for ${selectedStaff.name}`);
    }
  };

  // Log out button
  const handleLogout = async () => {
    if (!sessionToken) return;
    addLog(`Logging out session...`);
    try {
      await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "logout",
          token: sessionToken
        })
      });
    } catch {}
    handleLocalLogout();
    addLog(`✓ Session terminated. Sandboxed cache purged.`);
  };

  // Admin approves a pending session
  const handleApproveStaffSession = async (staffId: string) => {
    addLog(`Approving shift request for staff ID: ${staffId}...`);
    try {
      const res = await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          staff_id: staffId,
          hospital_id: tenant.hospital_id
        })
      });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ Shift request approved.`);
        // reload
        const sessRes = await fetch(`/api/mobile-auth/session?hospital_id=${tenant.hospital_id}`);
        const sessJson = await sessRes.json();
        if (sessJson.ok) setActiveSessions(sessJson.sessions);
      }
    } catch {}
  };

  // Admin force log out a staff member
  const handleForceLogoutStaff = async (staffId: string) => {
    addLog(`Admin force logout triggered for staff ID: ${staffId}...`);
    try {
      const res = await fetch("/api/mobile-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "logout-staff",
          staff_id: staffId,
          hospital_id: tenant.hospital_id
        })
      });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ Staff logged out remotely.`);
        // reload
        const sessRes = await fetch(`/api/mobile-auth/session?hospital_id=${tenant.hospital_id}`);
        const sessJson = await sessRes.json();
        if (sessJson.ok) setActiveSessions(sessJson.sessions);
      }
    } catch {}
  };

  // Admin onboards new staff member
  const handleOnboardStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName.trim()) return;
    
    addLog(`Onboarding new staff: ${newStaffName} (${newStaffRole})...`);
    try {
      const res = await fetch("/api/mobile-auth/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          name: newStaffName,
          role: newStaffRole,
          dept: newStaffDept,
          pin: newStaffPin,
          hospital_id: tenant.hospital_id
        })
      });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ Onboarded. QR Code and Activation PIN generated.`);
        const payloadObj = {
          id: data.staff.id,
          name: data.staff.name,
          role: data.staff.role,
          dept: data.staff.dept,
          hospital_id: data.staff.hospital_id,
          pin: data.staff.pin
        };
        setOnboardedQrData({
          pin: data.staff.pin,
          name: data.staff.name,
          role: data.staff.role,
          dept: data.staff.dept,
          payload: JSON.stringify(payloadObj)
        });
        setNewStaffName("");
        
        // Reload list
        const staffRes = await fetch(`/api/mobile-auth/staff?hospital_id=${tenant.hospital_id}`);
        const staffJson = await staffRes.json();
        if (staffJson.ok) setStaffList(staffJson.staff);
      }
    } catch {
      addLog("❌ Server connection error on onboarding.");
    }
  };

  // --- UPLOAD PIPELINE ---

  // Generate a mock document picture inside canvas
  const captureMockDocument = () => {
    if (!selectedPatient) return;
    addLog(`Camera capture triggered for patient ${selectedPatient.name}...`);
    
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    if (selectedDocType === "Geotag Photo") {
      // 1. Dark slate background
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, 600, 800);
      
      // 2. Map Simulation in the center
      ctx.fillStyle = "#334155";
      ctx.fillRect(30, 100, 540, 480);
      
      // Draw grid lines
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      for (let i = 60; i < 540; i += 60) {
        ctx.beginPath();
        ctx.moveTo(30 + i, 100);
        ctx.lineTo(30 + i, 580);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(30, 100 + i * (480/540));
        ctx.lineTo(570, 100 + i * (480/540));
        ctx.stroke();
      }

      // Draw red map pin
      const centerX = 300;
      const centerY = 320;
      
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + 40, 15, 6, 0, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 25, 0, Math.PI, true);
      ctx.lineTo(centerX, centerY + 40);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 10, 0, 2 * Math.PI);
      ctx.fill();

      // Location overlay banner
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(30, 480, 540, 100);
      
      const lat = tenant.latitude || "28.6292° N";
      const lng = tenant.longitude || "77.1065° E";
      const addr = tenant.address || "Action Cancer Hospital, Paschim Vihar, New Delhi";
      
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px monospace";
      ctx.fillText(`LAT: ${lat}   LNG: ${lng}`, 50, 510);
      ctx.fillText(`ALT: 215m   ACC: 3.2m`, 50, 535);
      ctx.font = "11px monospace";
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(addr, 50, 560);

      // Header details
      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText("MEDLYNQ SECURE GEOTAGGER", 40, 55);
      
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px sans-serif";
      ctx.fillText(`Patient: ${selectedPatient.name} · MRN: ${selectedPatient.mrn}`, 40, 80);

      // Metadata card
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(30, 600, 540, 160);
      
      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("GEOTAGGED EVIDENCE METADATA (DPDP COMPLIANT)", 50, 630);
      
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px monospace";
      ctx.fillText(`Timestamp:  ${new Date().toLocaleString("en-IN")}`, 50, 660);
      ctx.fillText(`Device Ref: MEDLYNQ-M-0941 (Secure Camera)`, 50, 685);
      ctx.fillText(`Status:     GPS Lock Verified (Shift: ${currentUser?.name || "Active Session"})`, 50, 710);
      ctx.fillText(`Signature:  SHA-256 Verified Cloud Integrity`, 50, 735);
    } else {
      // Background (paper style)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 600, 800);
      
      // Table border
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 4;
      ctx.strokeRect(20, 20, 560, 760);
      
      // Header
      ctx.fillStyle = "#0f766e";
      ctx.fillRect(20, 20, 560, 80);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("MEDLYNQ DIGITAL CLINICAL RECORD", 40, 65);
      
      // Patient Metadata
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("Patient Name:", 40, 150);
      ctx.font = "16px sans-serif";
      ctx.fillText(selectedPatient.name, 170, 150);
      
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("MRN / ID:", 40, 180);
      ctx.font = "16px sans-serif";
      ctx.fillText(selectedPatient.mrn, 170, 180);
      
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("Doc Type:", 40, 210);
      ctx.font = "16px sans-serif";
      ctx.fillText(selectedDocType, 170, 210);

      // Mock Document Content
      ctx.fillStyle = "#475569";
      ctx.font = "13px monospace";
      ctx.fillText("=================== DOCUMENT DETAILS ===================", 40, 270);
      ctx.fillText("DIAGNOSIS: Breast malignant neoplasm (C50.9)", 40, 300);
      ctx.fillText("REGISTRATION DATE: 2026-06-28", 40, 320);
      ctx.fillText("PREAUTH DETAILS: CCE token optimization enabled", 40, 340);
      ctx.fillText("TREATMENT PLAN: PMJAY chemo cycle 3", 40, 360);
      
      // Aadhaar / PII Mock section (For redaction test)
      ctx.fillStyle = "#b91c1c";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText("PII WATERMARK (SENSITIVE DATA):", 40, 420);
      ctx.fillStyle = "#1e293b";
      ctx.font = "14px sans-serif";
      ctx.fillText("Aadhaar Number: 3820-1928-8374", 40, 445);
      ctx.fillText("Contact Phone: +91-9988776655", 40, 470);
      ctx.fillText("Date of Birth: 1964-08-12", 40, 495);
      
      // Bottom watermark
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("Captured securely via MedLynq Cam app. Local cache only.", 40, 740);
      const latVal = tenant.latitude || "28.6292° N";
      const lngVal = tenant.longitude || "77.1065° E";
      ctx.fillText(`GPS: ${latVal}, ${lngVal} (${tenant.short_name || tenant.name || 'Hospital'})`, 40, 760);
    }

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setCapturedUrl(url);
        setScreen("confirm");
      }
    }, "image/jpeg", 0.85);
  };

  // Keeps the just-taken photo as page N of the CURRENT document and goes
  // straight back to the camera for page N+1 — same patient, same doc_type,
  // no re-selection needed. This is what makes a 3-photo consent form land
  // as ONE 3-page document instead of 3 separate ones.
  const handleAddAnotherPage = () => {
    if (capturedBlob && capturedUrl) {
      setCurrentDocPages((prev) => [...prev, { blob: capturedBlob, url: capturedUrl }]);
      setCapturedBlob(null);
      setCapturedUrl(null);
      addLog(`✓ Page ${currentDocPages.length + 1} captured. Scan next page of ${selectedDocType}...`);
      setScreen("camera");
    }
  };

  // Finalizes the current (possibly multi-page) document into the batch
  // queue and returns to patient/doc-type selection for the NEXT document.
  const handleFinalizeDocument = () => {
    if (capturedBlob && capturedUrl) {
      const pages = [...currentDocPages, { blob: capturedBlob, url: capturedUrl }];
      setBatchQueue((prev) => [...prev, { docType: selectedDocType, pages }]);
      setCurrentDocPages([]);
      setCapturedBlob(null);
      setCapturedUrl(null);
      setScreen("select_patient");
      addLog(`✓ Document queued (${pages.length} page${pages.length > 1 ? "s" : ""}). Total documents in batch: ${batchQueue.length + 1}`);
    }
  };

  // A multi-page document gets merged into ONE PDF (via the same /api/merge
  // + merger.py the desktop "Merge" toolbar already uses) BEFORE landing —
  // so a 3-photo capture creates one 3-page document, not three separate
  // ones. A single-photo document skips the merge round-trip entirely and
  // lands the image directly, same as before.
  async function mergePagesToPdf(pages: { blob: Blob; url: string }[], baseName: string): Promise<File> {
    const form = new FormData();
    pages.forEach((p, i) => form.append("file", p.blob, `${baseName}_page${i + 1}.jpg`));
    const res = await fetch("/api/merge", { method: "POST", body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Failed to merge pages");
    const mergedRes = await fetch(json.download_url);
    const mergedBlob = await mergedRes.blob();
    return new File([mergedBlob], `${baseName}.pdf`, { type: "application/pdf" });
  }

  // Perform multipart upload(s) — one land call per QUEUED DOCUMENT, not
  // per photo. A document with >1 page is merged into a single PDF first.
  const handleUpload = async () => {
    setIsUploading(true);
    setUploadError(null);

    const docs = [...batchQueue];
    if (capturedBlob && capturedUrl) {
      docs.push({ docType: selectedDocType, pages: [...currentDocPages, { blob: capturedBlob, url: capturedUrl }] });
    }

    if (docs.length === 0 || !selectedPatient) {
      setIsUploading(false);
      return;
    }

    try {
      let succeededCount = 0;

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        setUploadProgress(Math.floor((i / docs.length) * 100));
        const baseName = `${selectedPatient.mrn.replace(/[^A-Za-z0-9_-]/g, "_")}_${doc.docType.toUpperCase().replace(/\s+/g, "_")}_${Date.now()}`;

        let file: File;
        if (doc.pages.length > 1) {
          setUploadStatusMsg(`Merging ${doc.pages.length} pages into 1 PDF: ${doc.docType} (${i + 1}/${docs.length})`);
          file = await mergePagesToPdf(doc.pages, baseName);
        } else {
          file = new File([doc.pages[0].blob], `${baseName}.jpg`, { type: "image/jpeg" });
        }
        setUploadStatusMsg(`Uploading document ${i + 1} of ${docs.length}: ${doc.docType}`);

        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("mrn", selectedPatient.mrn);
        formData.append("doc_type_hint", doc.docType);
        formData.append("source", "MedCam");

        const res = await fetch("/api/mobile-upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          succeededCount++;
        } else {
          throw new Error(data.error || "Batch upload failed");
        }
      }

      setUploadProgress(100);
      addLog(`✓ Success: ${succeededCount} documents uploaded. Local sandbox cache cleared.`);

      // Clean up local URLs
      docs.forEach((d) => d.pages.forEach((p) => URL.revokeObjectURL(p.url)));
      setBatchQueue([]);
      setCurrentDocPages([]);
      setCapturedBlob(null);
      setCapturedUrl(null);

      setScreen("success");
    } catch (e: any) {
      const err = e.message || String(e);
      setUploadError(err);
      addLog(`❌ Upload error: ${err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeactivateStaffAdmin = async (staffId: string) => {
    addLog(`Deactivating staff member ID: ${staffId}...`);
    try {
      const res = await fetch("/api/mobile-auth/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", staff_id: staffId })
      });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ Profile deactivated. Device token revoked instantly.`);
        
        // Reload list
        const staffRes = await fetch(`/api/mobile-auth/staff?hospital_id=${tenant.hospital_id}`);
        const staffJson = await staffRes.json();
        if (staffJson.ok) setStaffList(staffJson.staff);
        
        // Reload sessions
        const sessRes = await fetch(`/api/mobile-auth/session?hospital_id=${tenant.hospital_id}`);
        const sessJson = await sessRes.json();
        if (sessJson.ok) setActiveSessions(sessJson.sessions);
      }
    } catch {}
  };

  const handleTriggerShiftTimeout = () => {
    addLog(`⏰ Simulating 10-hour shift timeout...`);
    // Clear state
    handleLocalLogout();
    addLog(`✓ Shift auto-expiry triggered. Sandboxed cache purged.`);
  };

  const resetFlow = () => {
    setSelectedPatient(null);
    setSelectedDocType("Consent Form");
    batchQueue.forEach((d) => d.pages.forEach((p) => URL.revokeObjectURL(p.url)));
    setBatchQueue([]);
    currentDocPages.forEach((p) => URL.revokeObjectURL(p.url));
    setCurrentDocPages([]);
    setCapturedBlob(null);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setScreen("dash");
  };

  const isMEDCO = currentUser !== null; // Allow Doctor, Nurse, OT Sister, and Admin to have identical scan/queue features

  const handleAddPatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim() || !newPatientMrn.trim()) {
      alert("Please fill in Name and MRN");
      return;
    }
    const newPat = {
      name: newPatientName.trim(),
      mrn: newPatientMrn.trim().toUpperCase(),
      age: parseInt(newPatientAge) || 30,
      gender: newPatientGender,
      department: newPatientDept,
      state: "Delhi",
      district: "Paschim Vihar"
    };

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPat)
      });
      const data = await res.json();
      if (data.ok && data.patient) {
        // Enrich with status and scheme from local defaults for instant display
        const enrichedPat = {
          ...data.patient,
          status: newPatientStatus,
          scheme: newPatientScheme
        };
        setPatients([enrichedPat, ...patients]);
        addLog(`➕ Added patient profile: ${enrichedPat.name} (MRN: ${enrichedPat.mrn})`);
      } else {
        const fallbackPat: Patient = {
          id: `P_LOCAL_${Date.now()}`,
          mrn: newPat.mrn,
          name: newPat.name,
          age: newPat.age,
          gender: newPat.gender,
          department: newPat.department,
          status: newPatientStatus,
          scheme: newPatientScheme
        };
        setPatients([fallbackPat, ...patients]);
        addLog(`➕ Added patient locally (no session): ${fallbackPat.name} (MRN: ${fallbackPat.mrn})`);
      }
    } catch (err) {
      const fallbackPat: Patient = {
        id: `P_LOCAL_${Date.now()}`,
        mrn: newPat.mrn,
        name: newPat.name,
        age: newPat.age,
        gender: newPat.gender,
        department: newPat.department,
        status: newPatientStatus,
        scheme: newPatientScheme
      };
      setPatients([fallbackPat, ...patients]);
      addLog(`➕ Added patient locally: ${fallbackPat.name} (MRN: ${fallbackPat.mrn})`);
    }
    
    // Reset form
    setNewPatientName("");
    setNewPatientMrn("");
    setNewPatientAge("");
    setShowAddPatientForm(false);
  };

  const handleDeletePatient = (patientId: string) => {
    const p = patients.find(pat => pat.id === patientId);
    setPatients(patients.filter(pat => pat.id !== patientId));
    if (selectedPatient?.id === patientId) {
      setSelectedPatient(null);
    }
    if (p) {
      addLog(`🗑️ Deleted patient profile: ${p.name} (MRN: ${p.mrn})`);
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Explanation & Log Column */}
        <div className="lg:col-span-5 space-y-5">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">MedLynq Mobile Companion</div>
            <h1 className="text-2xl font-bold text-ink-100">Mobile Scanner Simulator</h1>
            <p className="text-sm text-ink-300 mt-2">
              Use the simulated phone on the right to test onboarding, NFC Tap login, Remote approval checks, and batch document uploads.
            </p>
          </div>

          {/* SIMULATOR CONTROLS */}
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold text-ink-100 uppercase tracking-wide">Developer Simulation Controls</h2>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={handleTriggerShiftTimeout}
                disabled={!sessionToken}
                className="w-full bg-warn-soft border border-warn text-warn text-xs font-semibold py-2 rounded hover:bg-warn/10 disabled:opacity-50 text-left px-3 flex justify-between items-center"
              >
                <span>⏰ Simulate 10-hour Shift Expiry</span>
                <span className="text-[9px] bg-warn text-white px-1.5 py-0.5 rounded font-bold uppercase">Timeout</span>
              </button>
              
              <button
                onClick={() => handleDeactivateStaffAdmin("s1")}
                className="w-full bg-bad-soft border border-bad text-bad text-xs font-semibold py-2 rounded hover:bg-bad/10 text-left px-3 flex justify-between items-center"
              >
                <span>🚫 Deactivate Nurse Kavita</span>
                <span className="text-[9px] bg-bad text-white px-1.5 py-0.5 rounded font-bold uppercase">Revoke Profile</span>
              </button>
            </div>
          </div>

          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold text-ink-300">Simulator Log</div>
            <div className="bg-bone-100 rounded p-2 h-44 overflow-y-auto font-mono text-[10px] text-ink-200 space-y-1">
              {simLogs.length === 0 ? (
                <div className="text-ink-400 italic">No activity yet. Interact with the phone to begin.</div>
              ) : (
                simLogs.map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          </div>
        </div>

        {/* Device Frame Column */}
        <div className="lg:col-span-7 flex justify-center">
          
          {/* Phone mockup */}
          <div className="w-[360px] h-[720px] bg-ink-100 rounded-[48px] p-3 shadow-2xl border-4 border-slate-700 flex flex-col relative select-none">
            
            {/* Speaker & camera sensor notch */}
            <div className="absolute top-5 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-ink-100 rounded-b-2xl z-20 flex justify-center items-center gap-2">
              <div className="w-12 h-1 bg-slate-800 rounded-full"></div>
              <div className="w-2.5 h-2.5 bg-slate-900 rounded-full border border-slate-800"></div>
            </div>

            {/* Screen inner container */}
            <div className="flex-1 bg-bone-100 rounded-[38px] overflow-hidden flex flex-col pt-8 relative">
              
              {/* SCREEN: ONBOARDING WELCOME */}
              {screen === "onboard_welcome" && onboardedStaff && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200 overflow-y-auto">
                  <div className="space-y-4 pt-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-accent text-white font-bold text-base flex items-center justify-center mx-auto mb-1">
                      👋
                    </div>
                    <h3 className="text-sm font-bold text-ink-100">Welcome to MedLynq</h3>
                    <p className="text-[10px] text-ink-300 px-4 leading-tight">
                      We scanned your registration QR. Confirm details to set up your phone:
                    </p>
                    
                    <div className="bg-bone-0 border border-bone-300 rounded-xl p-3 text-left space-y-1.5 text-xs">
                      <div><span className="font-bold text-ink-300 uppercase text-[9px]">Hospital:</span> {onboardedStaff.hospital}</div>
                      <div><span className="font-bold text-ink-300 uppercase text-[9px]">Name:</span> {onboardedStaff.name}</div>
                      <div><span className="font-bold text-ink-300 uppercase text-[9px]">Designation:</span> {onboardedStaff.role}</div>
                      <div><span className="font-bold text-ink-300 uppercase text-[9px]">Department:</span> {onboardedStaff.dept}</div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <button
                      onClick={() => setScreen("onboard_biometrics")}
                      className="w-full bg-accent text-white font-bold text-xs py-2 rounded-xl hover:opacity-90"
                    >
                      Yes, Proceed
                    </button>
                    <button
                      onClick={() => setScreen("welcome")}
                      className="w-full text-ink-300 font-semibold text-[10px] text-center py-1"
                    >
                      Cancel Onboarding
                    </button>
                  </div>
                </div>
              )}
              {/* SCREEN: ONBOARDING BIOMETRICS */}
              {screen === "onboard_biometrics" && onboardedStaff && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200">
                  <div className="space-y-4 pt-4 text-center my-auto">
                    <div className="w-14 h-14 bg-accent-soft border border-accent/20 rounded-full flex items-center justify-center mx-auto mb-1 animate-pulse">
                      <span className="text-2xl">👤</span>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-ink-100">Setup Fingerprint</h3>
                      <p className="text-[10px] text-ink-300 px-4 leading-relaxed">
                        Securely bind this device to your profile to enable low-friction shift taps.
                      </p>
                    </div>
                    
                    <button
                      onClick={() => {
                        addLog(`✓ Biometrics bound to device for ${onboardedStaff.name}.`);
                        setScreen("onboard_activation");
                      }}
                      className="w-16 h-16 rounded-full bg-accent text-white font-bold text-2xl flex items-center justify-center mx-auto hover:scale-105 transition-transform border-4 border-white shadow-md active:bg-teal-800"
                    >
                      👆
                    </button>
                    <div className="text-[9px] text-ink-300">Tap the button to simulate fingerprint lock</div>
                  </div>

                  <button
                    onClick={() => setScreen("onboard_welcome")}
                    className="w-full text-ink-300 font-semibold text-[10px] text-center"
                  >
                    ← Back
                  </button>
                </div>
              )}

              {/* SCREEN: ONBOARDING ACTIVATION */}
              {screen === "onboard_activation" && onboardedStaff && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200">
                  <div className="space-y-4 pt-4 text-center">
                    <div className="w-10 h-10 rounded-full bg-accent text-white font-bold text-lg flex items-center justify-center mx-auto mb-1">
                      🔑
                    </div>
                    <h3 className="text-sm font-bold text-ink-100">Daily Shift Activation</h3>
                    <p className="text-[10px] text-ink-300 px-4 leading-tight">
                      Setup complete! To activate your first shift, tap the physical NFC sticker or request remote approval.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={async () => {
                        const res = await fetch("/api/mobile-auth/staff?hospital_id=" + tenant.hospital_id);
                        const data = await res.json();
                        const staff = data.staff.find((s: any) => s.id === onboardedStaff.id) || staffList[0];
                        if (staff) {
                          handleNfcTapLogin(staff);
                        }
                      }}
                      className="w-full bg-accent text-white font-bold text-xs py-2  rounded-xl hover:opacity-90 flex justify-center items-center gap-1.5"
                    >
                      📟 Tap NFC Tag
                    </button>
                    <button
                      onClick={async () => {
                        const res = await fetch("/api/mobile-auth/staff?hospital_id=" + tenant.hospital_id);
                        const data = await res.json();
                        const staff = data.staff.find((s: any) => s.id === onboardedStaff.id) || staffList[0];
                        if (staff) {
                          handleRequestApproval(staff);
                        }
                      }}
                      className="w-full bg-bone-0 border border-bone-300 text-ink-100 font-bold text-xs py-2 rounded-xl hover:bg-bone-100"
                    >
                      🔔 Request Admin Approval
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN: WELCOME LANDING */}
              {screen === "welcome" && (
                <div className="flex-1 p-5 flex flex-col justify-between overflow-y-auto">
                  <div className="space-y-6 pt-6 text-center">
                    <div className="flex justify-center mb-2">
                      <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center text-white text-3xl font-extrabold shadow-md">
                        M
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-ink-100">Welcome</h2>
                      <div className="text-xs font-bold text-accent">MedLynq Cam</div>
                    </div>

                    <p className="text-[10px] text-ink-300 px-4 leading-normal">
                      Link your mobile scanner companion or log in to access the patients registry.
                    </p>

                    <div className="space-y-3 pt-4">
                      {/* Scan QR to Onboard */}
                      <button
                        onClick={() => setScreen("sim_scan")}
                        className="w-full bg-accent text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90 flex justify-center items-center gap-2 shadow-sm"
                      >
                        📷 Scan QR to Onboard
                      </button>

                      {/* Admin / Medco Login */}
                      <button
                        onClick={() => {
                          setMedcoEmail("");
                          setMedcoPassword("");
                          setMedcoError("");
                          setScreen("medco_login");
                        }}
                        className="w-full bg-bone-0 border border-bone-400 text-ink-100 font-bold text-xs py-2.5 rounded-xl hover:bg-bone-100 flex justify-center items-center gap-2"
                      >
                        👤 Admin / Medco Login
                      </button>

                      {/* Return Staff Shift board */}
                      <button
                        onClick={() => setScreen("board")}
                        className="w-full text-ink-300 font-semibold text-[10px] py-1 text-center hover:text-accent"
                      >
                        Select Profile to Start Shift (Return Staff)
                      </button>
                    </div>
                  </div>

                  <div className="text-center text-[9px] text-ink-400">
                    Empanelled staff authentication. Powered by MedLynq.
                  </div>
                </div>
              )}

              {/* SCREEN: SIMULATE QR SCANNER */}
              {screen === "sim_scan" && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-black text-white relative">
                  <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col justify-between p-5 z-10">
                    <div className="flex justify-between items-center pt-2">
                      <button onClick={() => setScreen("welcome")} className="text-white text-xs font-bold bg-white/20 px-3 py-1 rounded-full">
                        ← Back
                      </button>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-accent-soft">Camera Preview</span>
                    </div>

                    <div className="w-48 h-48 border-4 border-accent rounded-2xl mx-auto my-auto flex items-center justify-center relative">
                      <div className="absolute inset-x-0 h-0.5 bg-accent top-1/2 animate-bounce"></div>
                      <span className="text-[9px] text-white/50 text-center font-semibold uppercase px-4">Scan floor onboarding QR code</span>
                    </div>

                    <div className="space-y-2 pb-4">
                      <button
                        onClick={() => {
                          const payload = {
                            id: "s2",
                            name: "Priya Kulkarni",
                            dept: "Oncology",
                            role: "Nurse",
                            hospital_id: "HOSP-BLR-49",
                            pin: "1379"
                          };
                          setOnboardedQrData({
                            name: payload.name,
                            role: payload.role,
                            dept: payload.dept,
                            pin: payload.pin,
                            payload: JSON.stringify(payload)
                          });
                          setOnboardedStaff({
                            id: payload.id,
                            name: payload.name,
                            role: payload.role,
                            dept: payload.dept,
                            pin: payload.pin,
                            hospital: "Action Cancer Hospital"
                          });
                          addLog(`📷 Scanning QR Code for: ${payload.name}`);
                          setScreen("onboard_welcome");
                        }}
                        className="w-full bg-accent text-white font-bold text-xs py-2 rounded-xl hover:opacity-90"
                      >
                        Simulate Scan (Auto-fill Demo Nurse)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN: SHIFT BOARD LOGIN */}
              {screen === "board" && (
                <div className="flex-1 p-5 flex flex-col justify-between overflow-y-auto">
                  <div className="space-y-4">
                    <div className="text-center pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-accent font-bold">MedLynq Companion</div>
                      <h2 className="text-base font-bold text-ink-100 mt-0.5">Select Profile to Start Shift</h2>
                    </div>

                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                      {staffList.filter(p => p.role === "Nurse" || p.role === "OT Sister").map((p) => (
                        <div
                          key={p.id}
                          className="bg-bone-0 border border-bone-300 rounded-xl p-3 flex flex-col gap-2"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-accent text-white font-bold text-sm flex items-center justify-center">
                              {p.name.split(" ").map(x => x[0]).join("")}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-ink-100 truncate">{p.name}</div>
                              <div className="text-[10px] text-ink-300">{p.role} · {p.dept}</div>
                            </div>
                          </div>
                          
                          {/* Login choices */}
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => handleNfcTapLogin(p)}
                              className="bg-bone-100 border border-bone-300 hover:border-accent text-[9px] font-bold py-1.5 rounded-lg text-ink-100"
                            >
                              📟 NFC Tap
                            </button>
                            <button
                              onClick={() => handleRequestApproval(p)}
                              className="bg-bone-100 border border-bone-300 hover:border-accent text-[9px] font-bold py-1.5 rounded-lg text-ink-100"
                            >
                              🔔 Request
                            </button>
                            <button
                              onClick={() => {
                                setSelectedStaff(p);
                                setScreen("pin");
                              }}
                              className="bg-bone-100 border border-bone-300 hover:border-accent text-[9px] font-bold py-1.5 rounded-lg text-ink-100"
                            >
                              🗝️ PIN
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <button
                      onClick={() => setScreen("medco_login")}
                      className="w-full bg-ink-100 text-white font-bold text-xs py-2 rounded-xl hover:bg-slate-800"
                    >
                      Login with Medco Credentials
                    </button>
                    <button
                      onClick={() => setScreen("welcome")}
                      className="w-full text-ink-300 font-semibold text-[10px] text-center hover:text-accent"
                    >
                      ← Back to Home
                    </button>
                    <div className="text-center text-[9px] text-ink-400">
                      Empanelled staff authentication. Powered by MedLynq.
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN: MEDCO CREDENTIALS LOGIN */}
              {screen === "medco_login" && (
                <div className="flex-1 p-5 flex flex-col justify-between">
                  <div className="space-y-4 pt-4">
                    <div className="text-center">
                      <h3 className="text-sm font-bold text-ink-100">MEDCO / Admin Login</h3>
                      <div className="text-[10px] text-ink-300">Enter credentials to unlock app</div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[9px] uppercase font-bold text-ink-300">Email Address</label>
                        <input
                          type="email"
                          placeholder="e.g. richa@action.in"
                          value={medcoEmail}
                          onChange={(e) => setMedcoEmail(e.target.value)}
                          className="w-full text-xs bg-bone-0 border border-bone-300 rounded-xl px-3 py-2 outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-bold text-ink-300">Password</label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={medcoPassword}
                          onChange={(e) => setMedcoPassword(e.target.value)}
                          className="w-full text-xs bg-bone-0 border border-bone-300 rounded-xl px-3 py-2 outline-none focus:border-accent"
                        />
                      </div>
                      {medcoError && (
                        <div className="text-[10px] text-warn font-semibold text-center">{medcoError}</div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={handleMedcoLoginSubmit}
                      className="w-full bg-accent text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90"
                    >
                      Login
                    </button>
                    <button
                      onClick={() => setScreen("welcome")}
                      className="w-full text-ink-300 font-semibold text-[10px] text-center hover:text-accent"
                    >
                      ← Back to Home
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN: ENTER PIN */}
              {screen === "pin" && selectedStaff && (
                <div className="flex-1 p-5 flex flex-col justify-between">
                  <div className="space-y-6 pt-4">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-full bg-accent text-white font-bold text-lg flex items-center justify-center mx-auto mb-2">
                        {selectedStaff.name.split(" ").map(x => x[0]).join("")}
                      </div>
                      <h3 className="text-sm font-bold text-ink-100">{selectedStaff.name}</h3>
                      <div className="text-[10px] text-ink-300 mt-0.5">Enter 4-digit PIN (seeded: {selectedStaff.pin})</div>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="password"
                        maxLength={4}
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                        placeholder="••••"
                        className={clsx(
                          "w-32 mx-auto text-center tracking-widest text-lg font-bold bg-bone-0 border rounded-xl py-2 block outline-none",
                          pinError ? "border-warn text-warn bg-warn-soft" : "border-bone-300 text-ink-100 focus:border-accent"
                        )}
                      />
                      {pinError && (
                        <div className="text-[10px] text-warn text-center font-semibold">Incorrect PIN.</div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={handlePinSubmit}
                      disabled={pinInput.length !== 4}
                      className="w-full bg-accent text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50"
                    >
                      Unlock App
                    </button>
                    <button
                      onClick={() => {
                        setSelectedStaff(null);
                        setPinInput("");
                        setPinError(false);
                        setScreen("board");
                      }}
                      className="w-full text-ink-300 font-semibold text-[10px] py-1 text-center"
                    >
                      ← Switch Profile
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN: WAITING APPROVAL SPINNER */}
              {screen === "waiting_approval" && currentUser && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200">
                  <div className="my-auto space-y-5 text-center">
                    <div className="animate-spin w-10 h-10 border-4 border-accent border-t-transparent rounded-full mx-auto"></div>
                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-ink-100">Shift Approval Pending</h3>
                      <p className="text-[11px] text-ink-300 leading-relaxed px-4">
                        Shift request registered for **{currentUser.name}**. Please ask the hospital floor administrator to tap **Approve** from their app dashboard.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleLocalLogout}
                    className="w-full bg-bone-0 border border-bone-300 text-ink-100 font-bold text-[10px] py-2 rounded-xl"
                  >
                    Cancel Request
                  </button>
                </div>
              )}

              {/* SCREEN: DASHBOARD */}
              {screen === "dash" && currentUser && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200 overflow-y-auto">
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex justify-between items-center bg-bone-0 border border-bone-300 rounded-xl p-3">
                      <div>
                        <div className="text-[10px] text-ink-300">Logged in as</div>
                        <div className="text-xs font-bold text-ink-100">{currentUser.name}</div>
                        <div className="text-[9px] uppercase tracking-wider text-accent font-semibold">{currentUser.role} · {currentUser.dept}</div>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="text-[10px] text-warn bg-warn-soft px-2.5 py-1 rounded-lg font-semibold"
                      >
                        Exit
                      </button>
                    </div>

                    {/* Role tabs for Admins */}
                    {currentUser.role === "Floor Admin" && (
                      <div className="flex border border-bone-300 rounded-lg overflow-hidden text-xs font-bold bg-bone-0">
                        <button
                          onClick={() => {
                            setActiveTab("patients");
                            setSelectedPatient(null);
                          }}
                          className={clsx("flex-1 py-2 text-center", activeTab === "patients" ? "bg-accent text-white" : "text-ink-200")}
                        >
                          Patients
                        </button>
                        <button
                          onClick={() => setActiveTab("admin_panel")}
                          className={clsx("flex-1 py-2 text-center", activeTab === "admin_panel" ? "bg-accent text-white" : "text-ink-200")}
                        >
                          Admin Panel
                        </button>
                      </div>
                    )}

                    {activeTab === "patients" || currentUser.role !== "Floor Admin" ? (
                      <div className="space-y-3 text-left">
                        {/* Batch Queue Status for MEDCOs */}
                        {isMEDCO && batchQueue.length > 0 && (
                          <div className="bg-accent-soft border border-accent/20 rounded-xl p-3 flex justify-between items-center mb-2">
                            <div>
                              <div className="text-[10px] font-bold text-accent uppercase font-sans">Batch Queue</div>
                              <div className="text-xs text-ink-100 font-semibold">
                                {batchQueue.length} document{batchQueue.length === 1 ? "" : "s"} queued
                                {batchQueue.some((d) => d.pages.length > 1) && ` (${batchQueue.reduce((n, d) => n + d.pages.length, 0)} pages total)`}
                              </div>
                            </div>
                            <button
                              onClick={handleUpload}
                              className="bg-accent text-white text-[10px] font-bold px-3 py-1.5 rounded-lg"
                            >
                              Upload Batch
                            </button>
                          </div>
                        )}

                        <div className="bg-bone-0 border border-bone-300 rounded-xl p-3 space-y-3">
                          <div className="text-[10px] font-bold text-ink-300 uppercase tracking-wide">Patient Registry & Scans</div>
                          
                          {/* Search Input */}
                          <input
                            type="text"
                            placeholder="Search Name or MRN..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full text-xs bg-bone-100 border border-bone-300 rounded-lg px-3 py-2 outline-none focus:border-accent font-semibold"
                          />

                          {/* Doctor (Medco) Add Patient Controls */}
                          {currentUser?.role === "Doctor" && (
                            <button
                              onClick={() => setShowAddPatientForm(!showAddPatientForm)}
                              className="w-full bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 font-bold text-[10px] py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all"
                            >
                              {showAddPatientForm ? "✕ Cancel Add" : "➕ Add New Patient"}
                            </button>
                          )}

                          {showAddPatientForm && currentUser?.role === "Doctor" && (
                            <form onSubmit={handleAddPatientSubmit} className="bg-bone-100 border border-bone-300 rounded-xl p-3 space-y-2 text-left">
                              <div className="text-[10px] font-bold text-ink-300 uppercase tracking-wide">New Patient Profile</div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Name</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Ramesh"
                                    value={newPatientName}
                                    onChange={(e) => setNewPatientName(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1.5 py-1 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">MRN</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. P12345"
                                    value={newPatientMrn}
                                    onChange={(e) => setNewPatientMrn(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1.5 py-1 outline-none font-mono"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Age</label>
                                  <input
                                    type="number"
                                    placeholder="e.g. 45"
                                    value={newPatientAge}
                                    onChange={(e) => setNewPatientAge(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1.5 py-1 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Gender</label>
                                  <select
                                    value={newPatientGender}
                                    onChange={(e) => setNewPatientGender(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1 py-1 outline-none"
                                  >
                                    <option value="M">Male</option>
                                    <option value="F">Female</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Status</label>
                                  <select
                                    value={newPatientStatus}
                                    onChange={(e) => setNewPatientStatus(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1 py-1 outline-none"
                                  >
                                    <option value="Active">Active</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Discharged">Discharged</option>
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Department</label>
                                  <select
                                    value={newPatientDept}
                                    onChange={(e) => setNewPatientDept(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1 py-1 outline-none"
                                  >
                                    {(tenant?.specialties_enabled || ["oncology", "cardiology", "gastroenterology"]).map((s: string) => (
                                      <option key={s} value={s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}>
                                        {s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[8px] uppercase font-bold text-ink-300 block mb-0.5">Scheme</label>
                                  <select
                                    value={newPatientScheme}
                                    onChange={(e) => setNewPatientScheme(e.target.value)}
                                    className="w-full text-[10px] bg-bone-0 border border-bone-300 rounded px-1 py-1 outline-none"
                                  >
                                    {(tenant?.schemes_enabled || ["CGHS", "ECHS", "TPA", "General"]).map((s: string) => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <button
                                type="submit"
                                className="w-full bg-accent text-white font-bold text-[10px] py-1.5 rounded-lg hover:opacity-90 transition-all"
                              >
                                Save Patient
                              </button>
                            </form>
                          )}

                          {/* Filter selectors: Dept, Status, Scheme */}
                          <div className="grid grid-cols-3 gap-1.5 text-[9px] font-semibold text-ink-200">
                            <div>
                              <label className="block text-[8px] uppercase font-bold text-ink-300 mb-0.5">Dept</label>
                              <select
                                value={selectedDept}
                                onChange={(e) => setSelectedDept(e.target.value)}
                                className="w-full bg-bone-100 border border-bone-300 rounded px-1 py-1 outline-none font-sans"
                              >
                                <option value="All">All</option>
                                {(tenant?.specialties_enabled || ["oncology", "cardiology", "gastroenterology"]).map((s: string) => (
                                  <option key={s} value={s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}>
                                    {s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[8px] uppercase font-bold text-ink-300 mb-0.5">Status</label>
                              <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="w-full bg-bone-100 border border-bone-300 rounded px-1 py-1 outline-none font-sans"
                              >
                                <option value="All">All</option>
                                <option value="Active">Active</option>
                                <option value="Pending">Pending</option>
                                <option value="Discharged">Discharged</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[8px] uppercase font-bold text-ink-300 mb-0.5">Scheme</label>
                              <select
                                value={selectedScheme}
                                onChange={(e) => setSelectedScheme(e.target.value)}
                                className="w-full bg-bone-100 border border-bone-300 rounded px-1 py-1 outline-none font-sans"
                              >
                                <option value="All">All</option>
                                {(tenant?.schemes_enabled || ["CGHS", "ECHS", "TPA", "General"]).map((s: string) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Patient List */}
                          <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                            {(() => {
                              const filtered = patients.filter(p => {
                                const matchesSearch = 
                                  p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  p.mrn.toLowerCase().includes(searchQuery.toLowerCase());
                                const matchesDept = selectedDept === "All" || p.department.toLowerCase() === selectedDept.toLowerCase();
                                const matchesStatus = selectedStatus === "All" || p.status?.toLowerCase() === selectedStatus.toLowerCase();
                                const matchesScheme = selectedScheme === "All" || p.scheme?.toLowerCase() === selectedScheme.toLowerCase();
                                return matchesSearch && matchesDept && matchesStatus && matchesScheme;
                              });

                              if (filtered.length === 0) {
                                return (
                                  <div className="text-xs text-warn font-semibold text-center bg-warn-soft p-3 rounded-lg border border-warn/20 italic">
                                    No Patient Found
                                  </div>
                                );
                              }

                              return filtered.map(p => {
                                const isSelected = selectedPatient?.id === p.id;
                                return (
                                  <div
                                    key={p.id}
                                    className={clsx(
                                      "border rounded-xl p-3 cursor-pointer transition-all text-xs text-left",
                                      isSelected 
                                        ? "bg-accent-soft border-accent" 
                                        : "bg-bone-100 border-bone-300 hover:border-bone-400"
                                    )}
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedPatient(null);
                                      } else {
                                        setSelectedPatient(p);
                                      }
                                    }}
                                  >
                                    <div className="flex justify-between items-center">
                                      <div>
                                        <div className="font-bold text-ink-100">{p.name}</div>
                                        <div className="text-[10px] text-ink-300 font-mono">MRN: {p.mrn}</div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {currentUser?.role === "Doctor" && (
                                          <span
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (confirm(`Are you sure you want to delete patient ${p.name} (${p.mrn})?`)) {
                                                handleDeletePatient(p.id);
                                              }
                                            }}
                                            className="text-bad hover:bg-bad-soft p-1 rounded transition-colors text-[10px] font-bold"
                                            title="Delete Patient"
                                          >
                                            🗑️
                                          </span>
                                        )}
                                        <span className="text-[10px] font-bold text-accent uppercase">
                                          {isSelected ? "Hide" : "Select"}
                                        </span>
                                      </div>
                                    </div>

                                    {isSelected && (
                                      <div className="mt-3 pt-3 border-t border-accent/10 space-y-3" onClick={(e) => e.stopPropagation()}>
                                        <div className="grid grid-cols-2 gap-2 text-[10px] text-ink-200">
                                          <div><span className="font-bold">Dept:</span> {p.department}</div>
                                          <div><span className="font-bold">Gender/Age:</span> {p.gender} · {p.age}</div>
                                          <div><span className="font-bold">Scheme:</span> {p.scheme}</div>
                                          <div><span className="font-bold">Status:</span> {p.status}</div>
                                        </div>

                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-ink-300 uppercase block">Document Classification</label>
                                          <select
                                            value={selectedDocType}
                                            onChange={(e) => setSelectedDocType(e.target.value)}
                                            className="w-full text-xs bg-bone-0 border border-bone-300 rounded-lg px-2 py-2 outline-none"
                                          >
                                            {(() => {
                                              const reqs = tenant?.document_requirements || [];
                                              const lib = tenant?.document_library || [];
                                              
                                              let matchedTypes: string[] = [];
                                              if (reqs.length === 0 || lib.length === 0) {
                                                matchedTypes = DOC_TYPES;
                                              } else {
                                                const filteredReqs = reqs.filter((req: any) => {
                                                  // Match Specialty
                                                  const matchesSpecialty = 
                                                    req.specialty?.toLowerCase() === p.department?.toLowerCase() ||
                                                    (req.specialty?.toLowerCase() === "oncology" && p.department?.toLowerCase() === "oncology") ||
                                                    (req.specialty?.toLowerCase() === "general_medicine" && p.department?.toLowerCase() === "gastroenterology") ||
                                                    (req.specialty?.toLowerCase() === "general_medicine" && p.department?.toLowerCase() === "gastro") ||
                                                    (req.specialty?.toLowerCase() === "cardiac" && p.department?.toLowerCase() === "cardiology");
                                                    
                                                  // Match Scheme
                                                  const matchesScheme = 
                                                    !req.schemes || 
                                                    req.schemes.length === 0 || 
                                                    req.schemes.some((s: string) => s?.toLowerCase() === p.scheme?.toLowerCase());
                                                    
                                                  return matchesSpecialty && matchesScheme;
                                                });
                                                
                                                matchedTypes = filteredReqs.map((req: any) => {
                                                  const libItem = lib.find((item: any) => item.doc_type?.toLowerCase() === req.doc_type?.toLowerCase());
                                                  return libItem ? libItem.label : req.doc_type.replace(/_/g, " ").toUpperCase();
                                                });
                                                
                                                if (!matchedTypes.includes("Consent Form")) matchedTypes.unshift("Consent Form");
                                                if (!matchedTypes.includes("Patient ID")) matchedTypes.unshift("Patient ID");
                                              }
                                              
                                              return matchedTypes.map(t => (
                                                <option key={t} value={t}>{t}</option>
                                              ));
                                            })()}
                                          </select>
                                        </div>

                                        <button
                                          onClick={() => setScreen("camera")}
                                          className="w-full bg-accent text-white font-bold text-xs py-2 rounded-lg hover:opacity-90 flex justify-center items-center gap-1"
                                        >
                                          📸 Scan & Capture
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      // FLOOR ADMIN PANEL
                      <div className="space-y-4">
                        {/* Staff Registry & Shift Logs */}
                        <div className="bg-bone-0 border border-bone-300 rounded-xl p-3 space-y-2">
                          <div className="text-[10px] font-bold text-ink-300 uppercase tracking-wide">Staff Registry & status</div>
                          <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1">
                            {staffList.filter(s => s.role !== "Floor Admin").map(s => {
                              const session = activeSessions.find(sess => sess.staff_id === s.id);
                              const isOnline = session && session.status === "active";
                              const isPending = session && session.status === "pending_approval";
                              const isOffline = !session;
                              const isExpanded = selectedHistoryStaffId === s.id;

                              return (
                                <div
                                  key={s.id}
                                  className={clsx(
                                    "border rounded-xl p-2.5 text-left transition-all",
                                    isPending && "bg-warn-soft/30 border-warn border-2 animate-pulse",
                                    isOnline && !isExpanded && "bg-good-soft/30 border-good/30 border",
                                    isOffline && !isExpanded && "bg-bone-100 border-bone-300 border",
                                    isExpanded && "bg-bone-0 border-accent border-2 shadow-sm"
                                  )}
                                >
                                  {/* Header Slab */}
                                  <div
                                    onClick={() => handleSelectHistoryStaff(s.id)}
                                    className="flex justify-between items-center cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2">
                                      {/* Signal Indicator */}
                                      {isOnline && <span className="w-2.5 h-2.5 rounded-full bg-good inline-block shadow-sm"></span>}
                                      {isPending && (
                                        <span className="relative flex h-2.5 w-2.5">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warn opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warn"></span>
                                        </span>
                                      )}
                                      {isOffline && <span className="w-2.5 h-2.5 rounded-full bg-bad inline-block opacity-60"></span>}
                                      
                                      <div>
                                        <div className="text-xs font-bold text-ink-100">
                                          {formatName(s.name)}
                                        </div>
                                        <div className="text-[9px] text-ink-300 uppercase leading-none mt-0.5">
                                          {s.role} · {s.dept}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-right">
                                      {isPending && (
                                        <span className="bg-warn text-white font-bold text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider animate-bounce inline-block">
                                          Request
                                        </span>
                                      )}
                                      {isOnline && (
                                        <span className="text-good font-bold text-[9px] uppercase">
                                          Online
                                        </span>
                                      )}
                                      {isOffline && (
                                        <span className="text-ink-400 text-[9px] uppercase">
                                          Offline
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Expanded Area */}
                                  {isExpanded && (
                                    <div className="mt-2.5 pt-2.5 border-t border-bone-300 space-y-2 text-[10px]">
                                      {isPending && (
                                        <div className="bg-warn-soft border border-warn/20 rounded-lg p-2 flex justify-between items-center">
                                          <div>
                                            <div className="font-bold text-warn">Pending Approval</div>
                                            <div className="text-[9px] text-ink-300">Requested access via remote fallback.</div>
                                          </div>
                                          <button
                                            onClick={() => handleApproveStaffSession(s.id)}
                                            className="bg-good text-white font-bold text-[9px] px-2.5 py-1.5 rounded-lg hover:opacity-90"
                                          >
                                            Approve Shift
                                          </button>
                                        </div>
                                      )}

                                      {isOnline && (
                                        <div className="bg-good-soft border border-good/20 rounded-lg p-2 flex justify-between items-center">
                                          <div>
                                            <div className="font-bold text-good">Active Session</div>
                                            <div className="text-[9px] text-ink-300">Logged in via {session.login_type} (PIN: {s.pin})</div>
                                          </div>
                                          <button
                                            onClick={() => handleForceLogoutStaff(session.staff_id)}
                                            className="bg-bad text-white font-bold text-[9px] px-2.5 py-1.5 rounded-lg hover:opacity-90"
                                          >
                                            Kick Staff
                                          </button>
                                        </div>
                                      )}

                                      {isOffline && (
                                        <div className="bg-bone-100 rounded-lg p-2 space-y-1.5 border border-bone-300">
                                          <div className="font-bold text-ink-300 uppercase text-[8px] tracking-wider">Today's Shift Logs</div>
                                          {isLoadingLogs ? (
                                            <div className="text-center italic text-ink-400">Loading history...</div>
                                          ) : selectedStaffLogs.length === 0 ? (
                                            <div className="text-center italic text-ink-400">No shift logs found.</div>
                                          ) : (
                                            <div className="space-y-1">
                                              {selectedStaffLogs.map(l => (
                                                <div key={l.id} className="flex justify-between border-b border-bone-200 pb-1 last:border-b-0 last:pb-0">
                                                  <span className="font-semibold text-ink-200 text-[8px]">
                                                    {l.action === "login" && "🟢 Logged In"}
                                                    {l.action === "logout" && "🔴 Logged Out"}
                                                    {l.action === "auto_logout" && "⏳ Timeout"}
                                                    {l.action === "force_logout" && "🚫 Kicked"}
                                                  </span>
                                                  <span className="text-ink-400 font-mono text-[8px]">
                                                    {new Date(l.timestamp).toLocaleTimeString("en-IN", {
                                                      hour: "2-digit",
                                                      minute: "2-digit"
                                                    })}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Deactivate / Remove Staff Option */}
                                      <div className="flex justify-end pt-2 border-t border-bone-200 mt-2">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm(`Are you sure you want to deactivate and remove ${s.name}?`)) {
                                              handleDeactivateStaffAdmin(s.id);
                                            }
                                          }}
                                          className="text-bad hover:underline font-bold text-[9.5px] uppercase flex items-center gap-1 transition-colors"
                                        >
                                          ❌ Deactivate & Remove Staff
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Onboard New Staff Form */}
                        <form onSubmit={handleOnboardStaffSubmit} className="bg-bone-0 border border-bone-300 rounded-xl p-3 space-y-2 text-left">
                          <div className="text-[10px] font-bold text-ink-300 uppercase tracking-wide">Onboard New Staff</div>
                          
                          <input
                            type="text"
                            placeholder="Full Name"
                            value={newStaffName}
                            onChange={(e) => setNewStaffName(e.target.value)}
                            className="w-full text-xs bg-bone-100 border border-bone-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-accent"
                          />
                          
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              value={newStaffRole}
                              onChange={(e) => setNewStaffRole(e.target.value)}
                              className="text-xs bg-bone-100 border border-bone-300 rounded-lg px-1.5 py-1.5"
                            >
                              <option value="Nurse">Nurse</option>
                              <option value="OT Sister">OT Sister</option>
                            </select>
                            <select
                              value={newStaffDept}
                              onChange={(e) => setNewStaffDept(e.target.value)}
                              className="text-xs bg-bone-100 border border-bone-300 rounded-lg px-1.5 py-1.5"
                            >
                              <option value="Oncology">Oncology</option>
                              <option value="Cardiology">Cardiology</option>
                              <option value="OPD">OPD</option>
                            </select>
                          </div>

                          <button
                            type="submit"
                            className="w-full bg-accent text-white font-bold text-[10px] py-2 rounded-lg hover:opacity-90"
                          >
                            Generate Onboarding QR
                          </button>
                        </form>

                        {/* Activation QR Popup simulated */}
                        {onboardedQrData && (
                          <div className="bg-bone-0 border-2 border-dashed border-accent rounded-xl p-3 text-center space-y-2">
                            <div className="text-[10px] font-bold text-accent">ONBOARDING QR GENERATED</div>
                            
                            <div className="w-28 h-28 mx-auto flex items-center justify-center bg-white border border-bone-300 p-1.5 rounded-lg">
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(onboardedQrData.payload || "")}`}
                                alt="QR Code Onboarding Payload"
                                className="w-full h-full object-contain"
                              />
                            </div>
                            
                            <div className="text-[9px] text-ink-300 font-semibold leading-tight">
                              Scan this QR on new phone to onboard.<br />
                              Or download: <a href="/app-debug.apk" download className="text-accent underline font-bold">Download MedLynq APK</a><br />
                              Pre-configured profile: **{onboardedQrData.name}**.
                            </div>
                            <button
                              onClick={() => {
                                setOnboardedStaff({
                                  id: onboardedQrData.id,
                                  name: onboardedQrData.name,
                                  role: onboardedQrData.role || newStaffRole,
                                  dept: onboardedQrData.dept || newStaffDept,
                                  pin: onboardedQrData.pin,
                                  hospital: tenant.name
                                });
                                setScreen("onboard_welcome");
                                setOnboardedQrData(null);
                                handleLocalLogout(); // Simulate logging out Admin to scan QR
                                addLog(`📱 Simulated scanning QR code for ${onboardedQrData.name}. App launch triggered.`);
                              }}
                              className="w-full bg-accent text-white font-bold text-[10px] py-2 rounded-lg hover:opacity-90"
                            >
                              📲 Scan QR (Simulate Staff Phone)
                            </button>
                            <button
                              onClick={() => setOnboardedQrData(null)}
                              className="text-[9px] font-semibold text-accent underline mt-1 block w-full text-center"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-center text-[10px] text-ink-300 bg-bone-0 border border-bone-300 rounded-lg p-2 mt-4">
                    🔄 Cloud Sync status: Connected
                  </div>
                </div>
              )}



              {/* SCREEN: CAMERA VIEWINDER */}
              {screen === "camera" && selectedPatient && (
                <div className="flex-1 bg-black flex flex-col justify-between p-5 relative">
                  
                  {/* Camera lens simulated frame */}
                  <div className="flex-1 border-2 border-dashed border-white/50 rounded-xl flex items-center justify-center p-4">
                    <div className="text-center space-y-2">
                      <div className="text-[11px] text-white/70 font-semibold uppercase tracking-wider">Document Viewfinder</div>
                      <div className="text-[10px] text-white/50">Ensure document is flat and readable.</div>
                      
                      <div className="bg-white/10 rounded-lg p-2 text-left space-y-1 font-mono text-[8px] text-white/70">
                        <div>Patient: {selectedPatient.name}</div>
                        <div>MRN: {selectedPatient.mrn}</div>
                        <div>Type: {selectedDocType}</div>
                      </div>
                    </div>
                  </div>

                  {/* Camera Controls */}
                  <div className="flex justify-between items-center pt-5">
                    <button
                      onClick={() => setScreen("dash")}
                      className="text-xs text-white"
                    >
                      Back
                    </button>
                    
                    {/* Capture button */}
                    <div
                      onClick={captureMockDocument}
                      className="w-14 h-14 rounded-full border-4 border-white flex items-center justify-center cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-full bg-white hover:bg-slate-200"></div>
                    </div>

                    <div className="w-8"></div> {/* Spacer */}
                  </div>
                </div>
              )}

              {/* SCREEN: CONFIRM CAPTURE */}
              {screen === "confirm" && selectedPatient && capturedUrl && (
                <div className="flex-1 p-5 flex flex-col justify-between bg-bone-200 overflow-y-auto">
                  <div className="space-y-4">
                    <div className="text-center">
                      <h3 className="text-sm font-bold text-ink-100">Review Capture</h3>
                      <div className="text-[10px] text-ink-300">
                        Attachment: {selectedDocType}
                        {currentDocPages.length > 0 && ` · Page ${currentDocPages.length + 1}`}
                      </div>
                    </div>

                    {/* Image Preview */}
                    <div className="relative border border-bone-300 rounded-xl overflow-hidden shadow-sm h-48 bg-white flex items-center justify-center">
                      <img src={capturedUrl} alt="Preview" className="h-full object-contain" />
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[8px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide">
                        Secure Cache Preview
                      </div>
                    </div>

                    {/* Warning Watermark */}
                    <div className="bg-warn-soft border border-warn/30 rounded-lg p-2.5 text-[10px] text-warn space-y-0.5 font-semibold">
                      <div>⚠️ Privacy Guard Active (DPDP):</div>
                      <div className="font-normal opacity-85 text-[9px] leading-tight">
                        Image resides in temporary sandboxed cache memory. It will be completely deleted from this phone upon upload success or exit.
                      </div>
                    </div>

                    {/* Upload progress or error */}
                    {isUploading && (
                      <div className="space-y-1">
                        <div className="text-[9px] font-bold text-accent uppercase tracking-wide">{uploadStatusMsg}</div>
                        <div className="w-full bg-bone-300 h-2 rounded-full overflow-hidden">
                          <div className="bg-accent h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                        </div>
                      </div>
                    )}

                    {uploadError && (
                      <div className="text-[9px] text-warn font-semibold bg-warn-soft p-2 rounded-lg border border-warn/20">
                        Error: {uploadError}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 pt-4">
                    <button
                      onClick={handleAddAnotherPage}
                      disabled={isUploading}
                      className="w-full bg-bone-0 border border-bone-300 text-ink-100 font-bold text-xs py-2.5 rounded-xl hover:bg-bone-100"
                    >
                      📎 Add Another Page{currentDocPages.length > 0 ? ` (page ${currentDocPages.length + 2} next)` : ""}
                    </button>
                    {isMEDCO ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleFinalizeDocument}
                          disabled={isUploading}
                          className="bg-bone-0 border border-accent text-accent font-bold text-xs py-2.5 rounded-xl hover:bg-accent/10"
                        >
                          ➕ Queue & Add Next Doc
                        </button>
                        <button
                          onClick={handleUpload}
                          disabled={isUploading}
                          className="bg-accent text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90"
                        >
                          Upload Batch ({batchQueue.length + 1})
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleUpload}
                        disabled={isUploading}
                        className="w-full bg-accent text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90"
                      >
                        {isUploading
                          ? "Uploading..."
                          : currentDocPages.length > 0
                          ? `Upload Document (${currentDocPages.length + 1} pages)`
                          : "Upload Document"}
                      </button>
                    )}

                    <button
                      onClick={resetFlow}
                      disabled={isUploading}
                      className="w-full text-ink-300 font-semibold text-[10px] text-center"
                    >
                      Delete Cache & Back
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN: UPLOAD SUCCESS */}
              {screen === "success" && (
                <div className="flex-1 p-5 flex flex-col justify-center items-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-good text-white font-bold text-2xl flex items-center justify-center shadow-lg">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink-100">Document Uploaded</h3>
                    <div className="text-[10px] text-ink-300 mt-1">
                      File sent to MedLynq Server.<br />
                      Local cache successfully cleared.
                    </div>
                  </div>
                  <button
                    onClick={resetFlow}
                    className="bg-accent text-white font-bold text-xs px-6 py-2 rounded-xl"
                  >
                    Done
                  </button>
                </div>
              )}

            </div>
          </div>
          
        </div>
      </div>
    </AppShell>
  );
}
