export type Scheme = "PMJAY" | "CGHS" | "ESI" | "SHA" | "Railway" | "ECHS" | "Private";

// Private health insurance companies (TPA/direct)
export type TPA =
  | "Star Health"
  | "New India"
  | "United India"
  | "Oriental"
  | "National Insurance"
  | "HDFC ERGO"
  | "ICICI Lombard"
  | "Bajaj Allianz"
  | "Niva Bupa"
  | "Care Health"
  | "Aditya Birla"
  | "Tata AIG"
  | "SBI General"
  | "Manipal Cigna";

export type ClaimStatus =
  | "preauth_pending"
  | "preauth_approved"
  | "admitted"
  | "discharged"
  | "submitted"
  | "pending"
  | "query"
  | "responded"
  | "approved"
  | "paid"
  | "rejected";

export type Treatment = "chemo" | "surgery" | "radiation" | "medicine";

export type Stage = "pre_auth" | "mid_way" | "discharge";

export type Patient = {
  id: string;
  mrn: string;
  name: string;
  age: number;
  gender: "M" | "F";
  state: string;
  district: string;
};

export type Case = {
  id: string;
  patient_id: string;
  registration_id: string;
  scheme: Scheme;
  tpa?: TPA;           // set when scheme = "Private"; identifies the insurer
  is_emergency?: boolean; // waives referral requirement for CGHS / ECHS
  payer: string;
  procedure_code: string;
  procedure_name: string;
  diagnosis: string;
  treatment_type: Treatment;
  cycle?: { current: number; total: number };
  admission_date: string;
  discharge_date: string | null;
  status: ClaimStatus;
  claimed_amount: number;
  approved_amount: number | null;
  tat_days: number;
  age_days: number;
  missing_docs: number;
  open_queries: number;
};

export type KpiTile = {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type ActionTile = {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  href?: string;
};

export type ActivityEvent = {
  id: string;
  ts: string;
  text: string;
  actor?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type WorkQueueGroup = {
  title: string;
  hint: string;
  tone: "bad" | "warn" | "accent" | "neutral";
  case_ids: string[];
};

// Map case status → current journey stage
export function stageOf(status: ClaimStatus): Stage {
  if (status === "preauth_pending") return "pre_auth";
  if (status === "preauth_approved" || status === "admitted") return "mid_way";
  return "discharge";
}
