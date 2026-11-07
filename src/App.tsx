import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from './supabase';
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
/*
 HYGh Cloud - Complete Hygiene Management System
 - Preserves the existing HYGhCloudDB IndexedDB stores: documents, customers, sites.
 - Adds a records store for module records and an audit store for activity history.
 - Browser-local prototype only: not a secure multi-user/cloud production system.
*/

const DB_NAME = "HYGhCloudDB";
const DB_VERSION = 3;

const sections = [
  "Dashboard", "Customers & Sites", "Chemical Management",
  "Cleaning Documents", "Pest Control", "Purchasing",
  "Micro Results", "H&S", "Hygiene Calendar", "Useful Links", "Admin"
];

const documentSubTabs: Record<string, string[]> = {
  "Chemical Management": ["MSDS", "PI Sheets", "Titration Records", "Technical Guides", "Compliance Certificates", "Site Visits"],
  "Cleaning Documents": ["CICs", "Sign Off Sheets", "Training Records", "CIP Monitoring", "Cleaning Validation Records", "Cleaning Frequency Validation Records"],
  "Pest Control": ["Documents"],
  "Purchasing": ["Chemical", "PPE", "Waste Management", "Equipment"],
  "Micro Results": ["Micro Results"],
  "H&S": ["H&S"]
};

const documentCategories = Object.values(documentSubTabs).flat();

const moduleFields: Record<string, { label: string; type?: string; required?: boolean; options?: string[] }[]> = {
  "Chemical Management": [
    { label: "Product name", required: true }, { label: "Manufacturer" },
    { label: "Supplier" }, { label: "Chemical type", options: ["Detergent", "Disinfectant", "Sanitiser", "Descaler", "Lubricant", "Other"] },
    { label: "Dilution rate" }, { label: "COSHH assessment reference" },
    { label: "SDS review date", type: "date" }, { label: "Approved status", options: ["Approved", "Under review", "Not approved"] },
    { label: "Notes", type: "textarea" }
  ],
  "CIP Monitoring": [
    { label: "CIP circuit", required: true }, { label: "Production line" },
    { label: "Date/time", type: "datetime-local", required: true },
    { label: "Detergent" }, { label: "Target concentration" }, { label: "Actual concentration" },
    { label: "Target temperature (°C)" }, { label: "Actual temperature (°C)" },
    { label: "Target contact time (minutes)" }, { label: "Actual contact time (minutes)" },
    { label: "Result", options: ["Pass", "Fail", "Pending"] }, { label: "Operator" },
    { label: "Comments", type: "textarea" }
  ],
  "Microbiology": [
    { label: "Sample reference", required: true }, { label: "Site / area" },
    { label: "Sample type", options: ["Listeria", "TVc", "Enterobacteriaceae", "E. coli", "ATP", "Other"] },
    { label: "Sample date", type: "date" }, { label: "Result" },
    { label: "Limit / specification" }, { label: "Result status", options: ["Satisfactory", "Unsatisfactory", "Pending"] },
    { label: "Corrective action", type: "textarea" }
  ],
  "Pest Control": [
    { label: "Contractor" }, { label: "Visit date", type: "date" },
    { label: "Visit type", options: ["Routine", "Call-out", "Trend review", "Other"] },
    { label: "Pest activity", options: ["None", "Low", "Medium", "High"] },
    { label: "Findings", type: "textarea" }, { label: "Actions required", type: "textarea" },
    { label: "Next visit", type: "date" }
  ],
  "Purchases": [
    { label: "Supplier", required: true }, { label: "Purchase order reference" },
    { label: "Item / service" }, { label: "Order date", type: "date" },
    { label: "Delivery date", type: "date" }, { label: "Value (£)", type: "number" },
    { label: "Status", options: ["Requested", "Ordered", "Delivered", "On hold"] },
    { label: "Notes", type: "textarea" }
  ],
  "Waste Management": [
    { label: "Waste stream", required: true }, { label: "Waste contractor" },
    { label: "Collection date", type: "date" }, { label: "Quantity" },
    { label: "Unit", options: ["kg", "tonnes", "litres", "bins", "other"] },
    { label: "Waste transfer note reference" }, { label: "Next review date", type: "date" },
    { label: "Notes", type: "textarea" }
  ],
  "Health & Safety": [
    { label: "Record type", options: ["Risk assessment", "Incident", "Near miss", "Training", "Inspection", "Action"] },
    { label: "Title", required: true }, { label: "Date", type: "date" },
    { label: "Responsible person" }, { label: "Risk level", options: ["Low", "Medium", "High", "Critical"] },
    { label: "Status", options: ["Open", "In progress", "Closed"] },
    { label: "Actions / details", type: "textarea" }, { label: "Review date", type: "date" }
  ],

  "Calendar": [
    { label: "Event title", required: true }, { label: "Date", type: "date", required: true },
    { label: "Time", type: "time" }, { label: "Customer / site" },
    { label: "Event type", options: ["Site visit", "Audit", "Training", "Document review", "CIP review", "Other"] },
    { label: "Notes", type: "textarea" }
  ],
  "Admin": [
    { label: "User name", required: true }, { label: "Email", type: "email" },
    { label: "Role", options: ["Administrator", "Consultant", "Customer manager", "Read only"] },
    { label: "Account status", options: ["Active", "Invited", "Disabled"] },
    { label: "Notes", type: "textarea" }
  ]
};

type Customer = {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone?: string;
  accountStatus: "active" | "pending" | "suspended";
};
type Site = { id: string; customerId: string; name: string; address: string; reference: string };
type DocumentRecord = {
  id: string; title: string; customer: string; site: string; category: string;
  uploaded: string; reviewDate: string; fileName: string; storagePath: string; folderId?: string | null; uploadedBy?: string;
};
type DocumentFolder = { id: string; customerId: string; siteId: string; parentCategory: string; folderName: string };
type ModuleRecord = {
  id: string; module: string; title: string; customerId: string; siteId: string;
  createdAt: string; data: Record<string, string>;
};
type AuditRecord = { id: string; timestamp: string; action: string; details: string; module: string };
type CalendarTaskRow = { id: string; customer_id: string; site_id: string | null; title: string; task_date: string; task_time: string | null; assigned_to: string | null; priority: string; reminder_date: string | null; status: string; notes: string | null; series_id: string | null; created_at: string };
type UsefulLinkRow = { id: string; customer_id: string; title: string; url: string; description: string | null; created_at: string };
type PlatformUser = { id: string; full_name: string; email: string; role: string; customer_id: string | null; customer_permission: string | null; account_status: string };

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("customers")) db.createObjectStore("customers", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sites")) db.createObjectStore("sites", { keyPath: "id" });
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audit")) db.createObjectStore("audit", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(store: string, value: object): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRecord(store: string, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

// Reads selectable text from a PDF and looks for a date immediately after
// an expiry/review label. Scanned image-only PDFs need OCR and may return blank.
function normalisePdfDate(value: string): string {
  const trimmed = value.trim();
  let year = 0, month = 0, day = 0;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const uk = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (uk) {
    day = Number(uk[1]); month = Number(uk[2]); year = Number(uk[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
  } else {
    return "";
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function detectPdfExpiryDate(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = "";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items
        .map(item => ("str" in item ? item.str : ""))
        .join(" ") + "\\n";
    }

    const labels = /(expiry\\s*date|expiration\\s*date|expires?\\s*on|valid\\s*until|valid\\s*to|review\\s*date|next\\s*review|renewal\\s*date)/ig;
    const datePattern = /(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})/g;
    let match: RegExpExecArray | null;
    while ((match = labels.exec(text)) !== null) {
      const nearby = text.slice(match.index, match.index + 140);
      const dateMatch = datePattern.exec(nearby);
      datePattern.lastIndex = 0;
      if (dateMatch) {
        const parsed = normalisePdfDate(dateMatch[1]);
        if (parsed) return parsed;
      }
    }
    return "";
  } catch (error) {
    console.warn("Could not read PDF text for expiry date:", error);
    return "";
  }
}
const inputBase: React.CSSProperties = {
  width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 14,
  border: "1px solid #d8e2e7", borderRadius: 9, boxSizing: "border-box",
  font: "inherit", background: "white", color: "#243447"
};
const cardBase: React.CSSProperties = {
  background: "white", padding: 20, borderRadius: 16,
  border: "1px solid #e5ecef", boxShadow: "0 8px 24px #102c3a0b", marginBottom: 20
};
const primaryButton: React.CSSProperties = {
  background: "#087f83", color: "white", border: 0, borderRadius: 6,
  padding: "10px 16px", cursor: "pointer", fontWeight: 600
};

function HYGhBrand({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  const main = dark ? "#ffffff" : "#123746";
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: main }}>
    <svg width={compact ? 44 : 54} height={compact ? 44 : 54} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="hyghMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#24d0c7" />
          <stop offset="100%" stopColor="#087f91" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#hyghMark)" />
      <path d="M19 45h26a9 9 0 0 0 1-18 15 15 0 0 0-28-2 10 10 0 0 0 1 20Z" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 29h13M25 35h9M34 41l4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <div style={{ lineHeight: 1.02, textAlign: "left" }}>
      <div style={{ fontSize: compact ? 22 : 28, fontWeight: 850, letterSpacing: -1.1, whiteSpace: "nowrap" }}>
        <span style={{ color: main }}>HYGh</span><span style={{ color: "#20c6c4" }}> Cloud</span>
      </div>
      {!compact && <div style={{ fontSize: 8.5, letterSpacing: 1.8, fontWeight: 750, marginTop: 7, opacity: .78, whiteSpace: "nowrap" }}>COMPLETE HYGIENE MANAGEMENT SYSTEM</div>}
    </div>
  </div>;
}

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState('Not tested');
  const [session, setSession] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [assignedCustomerId, setAssignedCustomerId] = useState<string | null>(null);
  const isAdmin = userRole === "admin";
const isConsultant = userRole === "consultant";
  const isCustomer = userRole === "customer";
  const [authReady, setAuthReady] = useState(false);
  const [authCallbackError, setAuthCallbackError] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [resetEmailBusy, setResetEmailBusy] = useState(false);
  const [resetEmailMessage, setResetEmailMessage] = useState('');
  const [resetEmailError, setResetEmailError] = useState('');
  const [passwordResetMode, setPasswordResetMode] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return query.get("type") === "recovery" || hash.get("type") === "recovery";
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordResetError, setPasswordResetError] = useState("");
  const [passwordResetSuccess, setPasswordResetSuccess] = useState("");
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);

  // Supabase processes magic-link / invitation callback URLs when the client
  // is created (detectSessionInUrl). This bootstrap waits for that process,
  // then reads the resulting session and listens for future auth changes.
  useEffect(() => {
    let mounted = true;

    const readCallbackError = () => {
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const message =
        params.get("error_description") ||
        params.get("error") ||
        hash.get("error_description") ||
        hash.get("error");
      if (message && mounted) {
        setAuthCallbackError(decodeURIComponent(message.replace(/\+/g, " ")));
      }
    };

    readCallbackError();

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordResetMode(true);
        setPasswordResetError("");
        setPasswordResetSuccess("");
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setAuthCallbackError("");
        setLoginError("");
      }
      setAuthReady(true);
    });

    // getSession also waits for Supabase's URL callback processing to finish.
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setAuthCallbackError(error.message);
        setSession(data.session);
        setAuthReady(true);
      })
      .catch((error) => {
        if (!mounted) return;
        setAuthCallbackError(error instanceof Error ? error.message : "Unable to complete sign-in.");
        setAuthReady(true);
      });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword
      });
      if (error) setLoginError(error.message);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(`Could not sign out: ${error.message}`);
  };

  const handleRequestPasswordReset = async () => {
    setResetEmailError('');
    setResetEmailMessage('');
    const email = loginEmail.trim();
    if (!email) {
      setResetEmailError('Enter your email address above first.');
      return;
    }
    setResetEmailBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      setResetEmailMessage('Password reset email sent. Open the newest email and follow its link to create your password.');
    } catch (error) {
      setResetEmailError(error instanceof Error ? error.message : 'Could not send the password reset email. Please try again.');
    } finally {
      setResetEmailBusy(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordResetError("");
    setPasswordResetSuccess("");
    if (newPassword.length < 8) {
      setPasswordResetError("Your password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordResetError("The passwords do not match. Please try again.");
      return;
    }
    setPasswordResetBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordResetSuccess("Your password has been updated. You can now sign in using your new password.");
      setNewPassword("");
      setConfirmNewPassword("");
      await supabase.auth.signOut();
      setPasswordResetMode(false);
    } catch (error) {
      setPasswordResetError(error instanceof Error ? error.message : "We could not update your password. Please request a new reset email and try again.");
    } finally {
      setPasswordResetBusy(false);
    }
  };

const testSupabase = async () => {
  const { error } = await supabase
    .from('customers')
    .select('id')
    .limit(1);

  setConnectionStatus(error ? error.message : 'Connected successfully');
};
  const [active, setActive] = useState("Dashboard");
  const visibleSections = isAdmin
  ? sections
  : isConsultant
    ? sections.filter(section => section !== "Admin")
    : isCustomer
      ? ["Dashboard", ...Object.keys(documentSubTabs), "Hygiene Calendar", "Useful Links"]
      : ["Dashboard"];
  useEffect(() => { if (userRole && !visibleSections.includes(active)) { setActive("Dashboard"); setActiveSubTab(""); } }, [userRole, active]);
  const [activeSubTab, setActiveSubTab] = useState("MSDS");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentFolders, setDocumentFolders] = useState<DocumentFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [folderCustomerId, setFolderCustomerId] = useState("");
  const [folderSiteId, setFolderSiteId] = useState("");
  const [records, setRecords] = useState<ModuleRecord[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviteCustomerId, setInviteCustomerId] = useState("");
  const [invitePermission, setInvitePermission] = useState("customer_admin");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userActionId, setUserActionId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [siteCustomer, setSiteCustomer] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteReference, setSiteReference] = useState("");

  const [docCustomer, setDocCustomer] = useState("");
  const [docSite, setDocSite] = useState("");
  const [, setDocCategory] = useState("MSDS");
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSearch, setDocSearch] = useState("");
  const [docFilter] = useState("All");
  const [selectedExpiryStatus, setSelectedExpiryStatus] = useState("");
  const [reviewDateDrafts, setReviewDateDrafts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [recordCustomer, setRecordCustomer] = useState("");
  const [recordSite, setRecordSite] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calendarTask, setCalendarTask] = useState({ title: "", date: "", time: "", assigned: "", priority: "Medium", reminder: "", status: "Outstanding", notes: "", repeat: "Never", repeatUntil: "" });
  const [calendarTasks, setCalendarTasks] = useState<ModuleRecord[]>([]);
  const [usefulLinks, setUsefulLinks] = useState<ModuleRecord[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(today());
  const [usefulLink, setUsefulLink] = useState({ title: "", url: "", description: "" });

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const loadData = async () => {
      try {
        const { data: profile, error: profileError } = await supabase.from("profiles").select("role, customer_id, account_status").eq("id", session.user.id).single();
        if (profileError) throw new Error(`Could not load your user profile: ${profileError.message}`);
        if (!profile || !["admin", "consultant", "customer"].includes(profile.role)) throw new Error("Your account does not have a recognised HYGh Cloud role. Please contact your administrator.");
        if (profile.account_status === "suspended") {
          setLoginError("Your HYGh Cloud account has been suspended. Please contact your administrator.");
          await supabase.auth.signOut();
          return;
        }
        setUserRole(profile.role);
        setAssignedCustomerId(profile.customer_id || null);
        if (profile.role === "customer" && !profile.customer_id) throw new Error("Your customer account has not been linked to a company yet. Please contact your administrator.");
        const [
          { data: customerRows, error: customerError },
          { data: siteRows, error: siteError },
          { data: documentRows, error: documentError },
          { data: folderRows, error: folderError },
          { data: calendarRows, error: calendarError },
          { data: usefulLinkRows, error: usefulLinkError },
          localRecords, localAudit
        ] = await Promise.all([
          supabase.from("customers").select("id, company_name, contact_name, email, phone, account_status").order("company_name"),
          supabase.from("sites").select("id, customer_id, site_name, address, site_reference").order("site_name"),
          supabase.from("documents").select("id, customer_id, site_id, category, title, file_name, storage_path, uploaded_by, created_at, expiry_date, folder_id").order("created_at", { ascending: false }),
          supabase.from("document_folders").select("id, customer_id, site_id, parent_category, folder_name").order("folder_name"),
          supabase.from("hygiene_calendar_tasks").select("*").order("task_date"),
          supabase.from("customer_useful_links").select("*").order("title"),
          profile.role === "customer" ? Promise.resolve([] as ModuleRecord[]) : getAll<ModuleRecord>("records"),
          profile.role === "customer" ? Promise.resolve([] as AuditRecord[]) : getAll<AuditRecord>("audit")
        ]);
        if (customerError) throw customerError;
        if (siteError) throw siteError;
        if (documentError) throw documentError;
        if (folderError) throw folderError;
        if (calendarError) throw new Error(`Could not load Hygiene Calendar: ${calendarError.message}`);
        if (usefulLinkError) throw new Error(`Could not load Useful Links: ${usefulLinkError.message}`);
        setCalendarTasks((calendarRows || []).map((row: CalendarTaskRow) => ({
          id: row.id, module: "Hygiene Calendar", title: row.title, customerId: row.customer_id, siteId: row.site_id || "",
          createdAt: row.created_at, data: { Task: row.title, Date: row.task_date, Time: row.task_time || "", "Assigned to": row.assigned_to || "", Priority: row.priority || "Medium", Reminder: row.reminder_date || "", Status: row.status || "Outstanding", Notes: row.notes || "", "Series ID": row.series_id || "" }
        })));
        setUsefulLinks((usefulLinkRows || []).map((row: UsefulLinkRow) => ({
          id: row.id, module: "Useful Links", title: row.title, customerId: row.customer_id, siteId: "",
          createdAt: row.created_at, data: { URL: row.url, Description: row.description || "" }
        })));
        if (profile.role === "customer") {
          setDocCustomer(profile.customer_id);
          setFolderCustomerId(profile.customer_id);
        }
        if (profile.role === "customer") {
          const linkedCustomer = (customerRows || []).find(row => row.id === profile.customer_id);
          if (!linkedCustomer || linkedCustomer.account_status !== "active") {
            setLoginError(
              linkedCustomer
                ? "Your HYGh Cloud account is not active. Please contact your administrator."
                : "Your HYGh Cloud customer account could not be found. Please contact your administrator."
            );
            await supabase.auth.signOut();
            return;
          }
        }

        setCustomers((customerRows || []).map(row => ({
          id: row.id,
          name: row.company_name,
          contact: row.contact_name || "",
          email: row.email || "",
          phone: row.phone || "",
          accountStatus: row.account_status || "active"
        })));
        setSites((siteRows || []).map(row => ({
          id: row.id, customerId: row.customer_id, name: row.site_name,
          address: row.address || "", reference: row.site_reference || ""
        })));
        setDocuments((documentRows || []).map(row => ({
          id: row.id,
          title: row.title,
          customer: (customerRows || []).find(c => c.id === row.customer_id)?.company_name || "",
          site: (siteRows || []).find(site => site.id === row.site_id)?.site_name || "",
          category: row.category,
          uploaded: row.created_at,
          reviewDate: row.expiry_date || "",
          fileName: row.file_name,
          storagePath: row.storage_path,
          folderId: row.folder_id || null,
          uploadedBy: row.uploaded_by || ""
        })));
        setDocumentFolders((folderRows || []).map(row => ({
          id: row.id,
          customerId: row.customer_id,
          siteId: row.site_id,
          parentCategory: row.parent_category,
          folderName: row.folder_name
        })));
        setRecords(localRecords); setAudit(localAudit);
      } catch (error) {
        console.error("HYGh Cloud data load failed:", error);
        setMessage(error instanceof Error ? error.message : "Could not load HYGh Cloud data.");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [session]);

  // Load customer user profiles only when a platform administrator opens Admin.
  useEffect(() => {
    if (!session || !isAdmin || active !== "Admin") return;
    let cancelled = false;
    const loadPlatformUsers = async () => {
      setUsersLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, customer_id, customer_permission, account_status")
        .eq("role", "customer")
        .order("full_name");
      if (cancelled) return;
      if (error) {
        notify(`Could not load customer users: ${error.message}`);
      } else {
        setPlatformUsers((data || []).map((row: any) => ({
          id: row.id,
          full_name: row.full_name || "Unnamed user",
          email: row.email || "",
          role: row.role || "customer",
          customer_id: row.customer_id || null,
          customer_permission: row.customer_permission || "view_only",
          account_status: row.account_status || "active"
        })));
      }
      setUsersLoading(false);
    };
    loadPlatformUsers();
    return () => { cancelled = true; };
  }, [session, isAdmin, active]);

  const log = async (action: string, details: string, module: string) => {
    const item: AuditRecord = { id: uid(), timestamp: new Date().toISOString(), action, details, module };
    await putRecord("audit", item);
    setAudit(prev => [item, ...prev]);
  };

  const notify = (text: string) => setMessage(text);

  const addCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;
    if (customers.some(c => c.name.toLowerCase() === customerName.trim().toLowerCase())) {
      notify("That customer already exists."); return;
    }
    const { data, error } = await supabase.from("customers").insert({
      company_name: customerName.trim(),
      contact_name: contact.trim(),
      email: email.trim(),
      phone: phone.trim(),
      account_status: "active"
    }).select("id, company_name, contact_name, email, phone, account_status").single();
    if (error) { notify(`Could not save customer: ${error.message}`); return; }
    const item: Customer = {
      id: data.id,
      name: data.company_name,
      contact: data.contact_name || "",
      email: data.email || "",
      phone: data.phone || "",
      accountStatus: data.account_status || "active"
    };
    setCustomers(prev => [...prev, item]);
    await log("Created", `Customer added: ${item.name}`, "Customers & Sites");
    setCustomerName(""); setContact(""); setEmail(""); setPhone("");
    notify("Customer saved to Supabase.");
  };

  const startEditCustomer = (customer: Customer) => {
    setEditingCustomerId(customer.id);
    setEditCustomerName(customer.name);
    setEditContact(customer.contact);
    setEditEmail(customer.email);
    setEditPhone(customer.phone || "");
  };

  const cancelEditCustomer = () => {
    setEditingCustomerId(null);
    setEditCustomerName("");
    setEditContact("");
    setEditEmail("");
    setEditPhone("");
  };

  const saveCustomerEdit = async (customer: Customer) => {
    if (!editCustomerName.trim()) {
      notify("Company name is required.");
      return;
    }
    const duplicate = customers.some(item => item.id !== customer.id && item.name.toLowerCase() === editCustomerName.trim().toLowerCase());
    if (duplicate) {
      notify("Another customer already uses that company name.");
      return;
    }
    const { data, error } = await supabase
      .from("customers")
      .update({
        company_name: editCustomerName.trim(),
        contact_name: editContact.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim()
      })
      .eq("id", customer.id)
      .select("id, company_name, contact_name, email, phone, account_status")
      .single();
    if (error) {
      notify(`Could not update customer: ${error.message}`);
      return;
    }
    setCustomers(prev => prev.map(item => item.id === customer.id ? {
      ...item,
      name: data.company_name,
      contact: data.contact_name || "",
      email: data.email || "",
      phone: data.phone || "",
      accountStatus: data.account_status || item.accountStatus
    } : item));
    await log("Updated", `Customer details updated: ${data.company_name}`, "Customers & Sites");
    cancelEditCustomer();
    notify("Customer details updated successfully.");
  };

  const updateCustomerStatus = async (
    customer: Customer,
    nextStatus: Customer["accountStatus"]
  ) => {
    if (!isAdmin) {
      notify("Only a platform administrator can change customer account status.");
      return;
    }
    const previousStatus = customer.accountStatus;
    if (previousStatus === nextStatus) return;

    const { data, error } = await supabase
      .from("customers")
      .update({ account_status: nextStatus })
      .eq("id", customer.id)
      .select("id, account_status")
      .single();

    if (error) {
      notify(`Could not update ${customer.name}: ${error.message}`);
      return;
    }

    setCustomers(prev => prev.map(item =>
      item.id === customer.id
        ? { ...item, accountStatus: data.account_status }
        : item
    ));

    await log(
      "Account status changed",
      `${customer.name}: ${previousStatus} → ${data.account_status}`,
      "Platform Admin"
    );

    notify(`${customer.name} account status updated to ${data.account_status}.`);
  };

  const inviteCustomerUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAdmin) {
      notify("Only a platform administrator can invite users.");
      return;
    }

    if (!inviteEmail.trim() || !inviteFullName.trim() || !inviteCustomerId) {
      notify("Complete the name, email and customer fields.");
      return;
    }

    setInviteBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("hygh-invite-colleague", {
        body: {
          email: inviteEmail.trim(),
          fullName: inviteFullName.trim(),
          customerId: inviteCustomerId,
          permission: invitePermission
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await log(
        "User invited",
        `${inviteFullName.trim()} (${inviteEmail.trim()}) invited to ${customers.find(c => c.id === inviteCustomerId)?.name || "customer"} with ${invitePermission} permission`,
        "Platform Admin"
      );

      setInviteEmail("");
      setInviteFullName("");
      setInviteCustomerId("");
      setInvitePermission("customer_admin");
      notify("Invitation sent successfully.");
    } catch (error) {
      notify(error instanceof Error ? `Invitation failed: ${error.message}` : "Invitation failed. Please try again.");
    } finally {
      setInviteBusy(false);
    }
  };

  const updatePlatformUser = async (user: PlatformUser, changes: Partial<Pick<PlatformUser, "customer_permission" | "account_status">>) => {
    if (!isAdmin) { notify("Only a platform administrator can manage customer users."); return; }
    setUserActionId(user.id);
    const { data, error } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", user.id)
      .select("id, customer_permission, account_status")
      .single();
    if (error) {
      notify(`Could not update ${user.full_name}: ${error.message}`);
      setUserActionId(null);
      return;
    }
    setPlatformUsers(prev => prev.map(item => item.id === user.id ? {
      ...item,
      customer_permission: data.customer_permission || item.customer_permission,
      account_status: data.account_status || item.account_status
    } : item));
    await log("Customer user updated", `${user.full_name} (${user.email || user.id}) – ${Object.entries(changes).map(([key, value]) => `${key}: ${value}`).join(", ")}`, "Platform Admin");
    notify(`${user.full_name}'s account has been updated.`);
    setUserActionId(null);
  };

  const addSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteCustomer || !siteName.trim()) return;
    const duplicate = sites.some(s => s.customerId === siteCustomer && s.name.toLowerCase() === siteName.trim().toLowerCase());
    if (duplicate) { notify("That site already exists for this customer."); return; }
    const { data, error } = await supabase.from("sites").insert({
      customer_id: siteCustomer,
      site_name: siteName.trim(),
      address: siteAddress.trim(),
      site_reference: siteReference.trim()
    }).select("id, customer_id, site_name, address, site_reference").single();
    if (error) { notify(`Could not save site: ${error.message}`); return; }
    const item: Site = {
      id: data.id, customerId: data.customer_id, name: data.site_name,
      address: data.address || "", reference: data.site_reference || ""
    };
    setSites(prev => [...prev, item]);
    await log("Created", `Site added: ${item.name}`, "Customers & Sites");
    setSiteName(""); setSiteAddress(""); setSiteReference("");
    notify("Site saved to Supabase.");
  };

  const removeCustomer = async (id: string) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    if (sites.some(s => s.customerId === id) || documents.some(d => d.customer === c.name) ||
        records.some(r => r.customerId === id)) {
      notify("Cannot delete: this customer has sites, documents or module records."); return;
    }
    if (!window.confirm(`Delete customer ${c.name}?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) { notify(`Could not delete customer: ${error.message}`); return; }
    setCustomers(prev => prev.filter(x => x.id !== id));
    await log("Deleted", `Customer deleted: ${c.name}`, "Customers & Sites");
    notify("Customer deleted.");
  };

  const removeSite = async (id: string) => {
    const s = sites.find(x => x.id === id);
    if (!s) return;
    if (documents.some(d => d.site === s.name && d.customer === customers.find(c => c.id === s.customerId)?.name) ||
        records.some(r => r.siteId === id)) {
      notify("Cannot delete: this site has documents or module records."); return;
    }
    if (!window.confirm(`Delete site ${s.name}?`)) return;
    const { error } = await supabase.from("sites").delete().eq("id", id);
    if (error) { notify(`Could not delete site: ${error.message}`); return; }
    setSites(prev => prev.filter(x => x.id !== id));
    await log("Deleted", `Site deleted: ${s.name}`, "Customers & Sites");
    notify("Site deleted.");
  };

  const createDocumentFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!folderCustomerId || !folderSiteId || !name) {
      notify("Choose a customer, site and enter a folder name."); return;
    }
    const site = sites.find(s => s.id === folderSiteId && s.customerId === folderCustomerId);
    if (!site) { notify("Choose a site belonging to the selected customer."); return; }
    const folderCategory = activeSubTab === "CICs" ? "CICs" : `${active}::${activeSubTab}`;
    const { data, error } = await supabase.from("document_folders").insert({
      customer_id: folderCustomerId, site_id: folderSiteId,
      parent_category: folderCategory, folder_name: name
    }).select("id, customer_id, site_id, parent_category, folder_name").single();
    if (error) { notify(`Could not create folder: ${error.message}`); return; }
    const folder: DocumentFolder = {
      id: data.id, customerId: data.customer_id, siteId: data.site_id,
      parentCategory: data.parent_category, folderName: data.folder_name
    };
    setDocumentFolders(prev => [...prev, folder].sort((a, b) => a.folderName.localeCompare(b.folderName)));
    setNewFolderName(""); setFolderCustomerId(""); setFolderSiteId("");
    notify(`Folder "${name}" created.`);
  };

  const renameDocumentFolder = async (folder: DocumentFolder) => {
    const name = window.prompt("Enter the new folder name:", folder.folderName)?.trim();
    if (!name || name === folder.folderName) return;
    const { error } = await supabase.from("document_folders").update({ folder_name: name }).eq("id", folder.id);
    if (error) { notify(`Could not rename folder: ${error.message}`); return; }
    setDocumentFolders(prev => prev.map(f => f.id === folder.id ? { ...f, folderName: name } : f));
    notify("Folder renamed.");
  };

  const deleteDocumentFolder = async (folder: DocumentFolder) => {
    const count = documents.filter(d => d.folderId === folder.id).length;
    if (count > 0) { notify("This folder contains documents. Delete or move its documents before deleting the folder."); return; }
    if (!window.confirm(`Delete folder "${folder.folderName}"?`)) return;
    const { error } = await supabase.from("document_folders").delete().eq("id", folder.id);
    if (error) { notify(`Could not delete folder: ${error.message}`); return; }
    setDocumentFolders(prev => prev.filter(f => f.id !== folder.id));
    if (selectedFolderId === folder.id) setSelectedFolderId("");
    notify("Folder deleted.");
  };

  const uploadDocument = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const effectiveCustomerId = isCustomer ? assignedCustomerId : docCustomer;
    const customer = customers.find(c => c.id === effectiveCustomerId);
    const site = sites.find(s => s.id === docSite && s.customerId === effectiveCustomerId);
    if (!customer || !site || docFiles.length === 0) {
      notify("Choose a customer, site and at least one PDF document."); return;
    }
    const invalid = docFiles.filter(f => f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"));
    if (invalid.length) { notify("Only PDF files are accepted. Remove: " + invalid.map(f => f.name).join(", ")); return; }
    const uploadedDocs: DocumentRecord[] = [];
    for (const file of docFiles) {
      // Suggest an expiry/review date from selectable PDF text.
      // The user can confirm it, correct it, or leave the field blank.
      const detectedDate = await detectPdfExpiryDate(file);
      const enteredDate = window.prompt(
        detectedDate
          ? `We found this possible expiry/review date in "${file.name}". Confirm or correct it using YYYY-MM-DD. Leave blank if it is not correct.`
          : `No expiry/review date was detected in "${file.name}". Enter one using YYYY-MM-DD, or leave blank.`,
        detectedDate
      );
      const confirmedExpiryDate = enteredDate === null ? "" : normalisePdfDate(enteredDate);

      const id = uid();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${customer.id}/${site.id}/${id}-${safeName}`;
      const { error: storageError } = await supabase.storage.from("hygh-documents").upload(storagePath, file, {
        contentType: "application/pdf", upsert: false
      });
      if (storageError) { notify(`Could not upload ${file.name}: ${storageError.message}`); return; }
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("documents").insert({
        id, customer_id: customer.id, site_id: site.id, category: activeSubTab,
        title: file.name.replace(/\.pdf$/i, ""), file_name: file.name,
        storage_path: storagePath, uploaded_by: userData.user?.id,
        expiry_date: confirmedExpiryDate || null,
        folder_id: (activeSubTab !== "CICs" && ["H&S", "Pest Control", "Purchasing"].includes(active)) ? (selectedFolderId || null) : null
      }).select("id, customer_id, site_id, category, title, file_name, storage_path, created_at, expiry_date, folder_id").single();
      if (error) {
        await supabase.storage.from("hygh-documents").remove([storagePath]);
        notify(`File uploaded but its document record could not be saved: ${error.message}`); return;
      }
      uploadedDocs.push({
        id: data.id, title: data.title, customer: customer.name, site: site.name,
        category: data.category, uploaded: data.created_at, reviewDate: data.expiry_date || "",
        fileName: data.file_name, storagePath: data.storage_path,
        folderId: data.folder_id || null, uploadedBy: userData.user?.id || ""
      });
    }
    setDocuments(prev => [...uploadedDocs, ...prev]);
    if (activeSubTab === "CICs") setSelectedFolderId("");
    setDocFiles([]);
    if (fileRef.current) fileRef.current.value = "";
    notify(`${uploadedDocs.length} PDF document(s) uploaded to secure cloud storage.`);
  };

  const saveDocumentReviewDate = async (doc: DocumentRecord) => {
    const newDate = Object.prototype.hasOwnProperty.call(reviewDateDrafts, doc.id)
      ? reviewDateDrafts[doc.id]
      : doc.reviewDate;
    const { error } = await supabase
      .from("documents")
      .update({ expiry_date: newDate || null })
      .eq("id", doc.id);
    if (error) {
      notify(`Could not save review date: ${error.message}`);
      return;
    }
    setDocuments(prev => prev.map(item =>
      item.id === doc.id ? { ...item, reviewDate: newDate || "" } : item
    ));
    setReviewDateDrafts(prev => {
      const next = { ...prev };
      delete next[doc.id];
      return next;
    });
    notify(newDate ? "Review/expiry date saved." : "Review/expiry date cleared.");
  };

  const assignDocumentToFolder = async (doc: DocumentRecord, folderId: string) => {
    if (!folderId) return;
    const folder = documentFolders.find(f =>
      f.id === folderId &&
      f.customerId === customers.find(c => c.name === doc.customer)?.id &&
      f.siteId === sites.find(s => s.name === doc.site && s.customerId === f.customerId)?.id
    );
    if (!folder) {
      notify("Choose an area folder belonging to the same customer and site as this PDF.");
      return;
    }
    const { error } = await supabase
      .from("documents")
      .update({ folder_id: folder.id })
      .eq("id", doc.id);
    if (error) {
      notify(`Could not assign PDF: ${error.message}`);
      return;
    }
    setDocuments(prev => prev.map(item =>
      item.id === doc.id ? { ...item, folderId: folder.id } : item
    ));
    notify(`"${doc.fileName}" assigned to ${folder.folderName}. It has been removed from the unassigned list.`);
  };

  const deleteDocument = async (doc: DocumentRecord) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    const { error: storageError } = await supabase.storage.from("hygh-documents").remove([doc.storagePath]);
    if (storageError) { notify(`Could not delete PDF from storage: ${storageError.message}`); return; }
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) { notify(`PDF removed from storage, but its database record could not be deleted: ${error.message}`); return; }
    setDocuments(prev => prev.filter(d => d.id !== doc.id));
    notify("Document deleted from cloud storage.");
  };

  const openDocument = async (doc: DocumentRecord, download = false) => {
    const { data, error } = await supabase.storage.from("hygh-documents").createSignedUrl(doc.storagePath, 60);
    if (error || !data?.signedUrl) { notify(`Could not open document: ${error?.message || "No secure link returned."}`); return; }
    if (download) {
      const a = document.createElement("a"); a.href = data.signedUrl; a.download = doc.fileName; a.target = "_blank"; a.click();
    } else {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  };

  const reviewStatus = (date: string) => {
    if (!date) return "No review date";
    if (date < today()) return "Expired";
    const days = Math.ceil((new Date(date + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);
    if (days <= 7) return "Urgent";
    if (days <= 30) return "Due soon";
    if (days <= 60) return "Upcoming";
    return "Current";
  };

  const reviewStatusColor = (status: string) => {
    if (status === "Expired" || status === "Urgent") return "#b23b35";
    if (status === "Due soon") return "#c18419";
    if (status === "Upcoming") return "#2876a5";
    if (status === "Current") return "#16834a";
    return "#657681";
  };

  const saveModuleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const fields = moduleFields[active] || [];
    const titleField = fields.find(f => f.required) || fields[0];
    if (titleField && !formData[titleField.label]?.trim()) {
      notify(`Please complete ${titleField.label}.`); return;
    }
    const existing = editingId ? records.find(r => r.id === editingId) : undefined;
    const item: ModuleRecord = {
      id: editingId || uid(), module: active,
      title: formData[titleField?.label || "Title"] || active,
      customerId: recordCustomer, siteId: recordSite,
      createdAt: existing?.createdAt || new Date().toISOString(),
      data: { ...formData }
    };
    await putRecord("records", item);
    setRecords(prev => editingId ? prev.map(r => r.id === editingId ? item : r) : [item, ...prev]);
    await log(editingId ? "Updated" : "Created", `${active} record: ${item.title}`, active);
    setFormData({}); setEditingId(null);
    notify(`${active} record ${editingId ? "updated" : "saved"}.`);
  };

  const editRecord = (record: ModuleRecord) => {
    setFormData(record.data); setRecordCustomer(record.customerId); setRecordSite(record.siteId);
    setEditingId(record.id); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeModuleRecord = async (record: ModuleRecord) => {
    if (!window.confirm(`Delete this ${record.module} record?`)) return;
    await deleteRecord("records", record.id);
    setRecords(prev => prev.filter(r => r.id !== record.id));
    await log("Deleted", `${record.module} record deleted: ${record.title}`, record.module);
    notify("Record deleted.");
  };

  const filteredDocs = useMemo(() => documents.filter(d =>
    [d.title, d.customer, d.site, d.category].some(v => v.toLowerCase().includes(docSearch.toLowerCase())) &&
    (selectedExpiryStatus
      ? reviewStatus(d.reviewDate) === selectedExpiryStatus
      : (documentCategories.includes(activeSubTab) ? d.category === activeSubTab : docFilter === "All" || d.category === docFilter) &&
        ((activeSubTab === "CICs" || ["H&S", "Pest Control", "Purchasing"].includes(active))
          ? (selectedFolderId ? d.folderId === selectedFolderId : !d.folderId)
          : true))
  ), [documents, docSearch, docFilter, activeSubTab, active, selectedFolderId, selectedExpiryStatus]);

  const moduleRecords = records.filter(r => r.module === active &&
    [r.title, ...Object.values(r.data)].some(v => v.toLowerCase().includes(recordSearch.toLowerCase()))
  );
  const dueDocs = documents.filter(d => ["Expired", "Urgent", "Due soon", "Upcoming"].includes(reviewStatus(d.reviewDate)));
  const openActions = records.filter(r =>
    (r.module === "Health & Safety" && !["Closed"].includes(r.data.Status || "")) ||
    (r.module === "CIP Monitoring" && r.data.Result === "Fail") ||
    (r.module === "Microbiology" && r.data["Result status"] === "Unsatisfactory")
  );

  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const visibleCalendarTasks = calendarTasks.filter(r => isAdmin || r.customerId === assignedCustomerId);
  const visibleUsefulLinks = usefulLinks.filter(r => isAdmin || r.customerId === assignedCustomerId);
  // Future recurring occurrences stay hidden until their due date.
  // Due today and overdue occurrences remain visible until completed.
  const dueCalendarTasks = visibleCalendarTasks.filter(r =>
    r.data.Status !== "Completed" && !!r.data.Date && r.data.Date <= today()
  );
  const thisWeeksTasks = dueCalendarTasks.filter(r => {
    const due = new Date(`${r.data.Date || ""}T00:00:00`);
    return due >= startOfWeek && due < endOfWeek;
  }).sort((a, b) => (a.data.Date || "").localeCompare(b.data.Date || ""));

  const saveCalendarTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerId = isCustomer ? assignedCustomerId : recordCustomer;
    if (!customerId || !calendarTask.title.trim() || !calendarTask.date) {
      notify("Please choose a customer and enter a task name and due date."); return;
    }
    const site = recordSite ? sites.find(x => x.id === recordSite && x.customerId === customerId) : undefined;
    if (recordSite && !site) { notify("Choose a site belonging to this customer."); return; }
    if (editingId) {
      const existing = visibleCalendarTasks.find(r => r.id === editingId);
      if (!existing) { notify("This task could not be found."); return; }
      const { error } = await supabase.from("hygiene_calendar_tasks").update({
        title: calendarTask.title.trim(), task_date: calendarTask.date, task_time: calendarTask.time || null,
        assigned_to: calendarTask.assigned || null, priority: calendarTask.priority, reminder_date: calendarTask.reminder || null,
        status: calendarTask.status, notes: calendarTask.notes || null
      }).eq("id", editingId).eq("customer_id", customerId);
      if (error) { notify(`Could not update task: ${error.message}`); return; }
      const updated = { ...existing, title: calendarTask.title.trim(), data: { ...existing.data, Task: calendarTask.title.trim(), Date: calendarTask.date, Time: calendarTask.time, "Assigned to": calendarTask.assigned, Priority: calendarTask.priority, Reminder: calendarTask.reminder, Status: calendarTask.status, Notes: calendarTask.notes } };
      setCalendarTasks(prev => prev.map(r => r.id === editingId ? updated : r));
      notify("Hygiene task updated.");
    } else {
      const seriesId = calendarTask.repeat === "Never" ? null : uid();
      const dates: string[] = [calendarTask.date];
      if (calendarTask.repeat !== "Never" && calendarTask.repeatUntil) {
        const cursor = new Date(`${calendarTask.date}T12:00:00`);
        const end = new Date(`${calendarTask.repeatUntil}T12:00:00`);
        let guard = 0;
        while (cursor < end && guard++ < 365) {
          if (calendarTask.repeat === "Daily") cursor.setDate(cursor.getDate() + 1);
          else if (calendarTask.repeat === "Weekdays") { cursor.setDate(cursor.getDate() + 1); while (cursor.getDay() === 0 || cursor.getDay() === 6) cursor.setDate(cursor.getDate() + 1); }
          else if (calendarTask.repeat === "Weekly") cursor.setDate(cursor.getDate() + 7);
          else if (calendarTask.repeat === "Fortnightly") cursor.setDate(cursor.getDate() + 14);
          else if (calendarTask.repeat === "Monthly") cursor.setMonth(cursor.getMonth() + 1);
          else if (calendarTask.repeat === "Every 3 months") cursor.setMonth(cursor.getMonth() + 3);
          else if (calendarTask.repeat === "Every 6 months") cursor.setMonth(cursor.getMonth() + 6);
          else if (calendarTask.repeat === "Annually") cursor.setFullYear(cursor.getFullYear() + 1);
          dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,"0")}-${String(cursor.getDate()).padStart(2,"0")}`);
        }
      }
      const rows = dates.map(date => ({
        customer_id: customerId, site_id: site?.id || null, title: calendarTask.title.trim(), task_date: date,
        task_time: calendarTask.time || null, assigned_to: calendarTask.assigned || null, priority: calendarTask.priority,
        reminder_date: calendarTask.reminder || null, status: calendarTask.status, notes: calendarTask.notes || null, series_id: seriesId
      }));
      const { data, error } = await supabase.from("hygiene_calendar_tasks").insert(rows).select("*");
      if (error) { notify(`Could not save hygiene tasks: ${error.message}`); return; }
      const mapped = (data || []).map((row: CalendarTaskRow) => ({
        id: row.id, module: "Hygiene Calendar", title: row.title, customerId: row.customer_id, siteId: row.site_id || "",
        createdAt: row.created_at, data: { Task: row.title, Date: row.task_date, Time: row.task_time || "", "Assigned to": row.assigned_to || "", Priority: row.priority, Reminder: row.reminder_date || "", Status: row.status, Notes: row.notes || "", "Series ID": row.series_id || "" }
      }));
      setCalendarTasks(prev => [...prev, ...mapped]);
      notify(`${mapped.length} hygiene task occurrence(s) saved.`);
    }
    setEditingId(null);
    setCalendarTask({ title: "", date: "", time: "", assigned: "", priority: "Medium", reminder: "", status: "Outstanding", notes: "", repeat: "Never", repeatUntil: "" });
  };

  const editCalendarTask = (r: ModuleRecord) => {
    setEditingId(r.id); setRecordCustomer(r.customerId); setRecordSite(r.siteId);
    setCalendarTask({ title: r.data.Task || r.title, date: r.data.Date || "", time: r.data.Time || "", assigned: r.data["Assigned to"] || "", priority: r.data.Priority || "Medium", reminder: r.data.Reminder || "", status: r.data.Status || "Outstanding", notes: r.data.Notes || "", repeat: "Never", repeatUntil: "" });
  };
  const completeCalendarTask = async (r: ModuleRecord) => {
    const { error } = await supabase.from("hygiene_calendar_tasks").update({ status: "Completed" }).eq("id", r.id).eq("customer_id", r.customerId);
    if (error) { notify(`Could not complete task: ${error.message}`); return; }
    setCalendarTasks(prev => prev.map(x => x.id === r.id ? { ...x, data: { ...x.data, Status: "Completed" } } : x));
    notify("Hygiene task marked completed.");
  };
  const deleteCalendarTask = async (r: ModuleRecord) => {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    const { error } = await supabase.from("hygiene_calendar_tasks").delete().eq("id", r.id).eq("customer_id", r.customerId);
    if (error) { notify(`Could not delete task: ${error.message}`); return; }
    setCalendarTasks(prev => prev.filter(x => x.id !== r.id));
    notify("Hygiene task deleted.");
  };
  const saveUsefulLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerId = isCustomer ? assignedCustomerId : recordCustomer;
    if (!customerId || !usefulLink.title.trim() || !/^https?:\/\//i.test(usefulLink.url.trim())) { notify("Choose a customer, enter a link name and a full website address starting with https://"); return; }
    const { data, error } = await supabase.from("customer_useful_links").insert({
      customer_id: customerId, title: usefulLink.title.trim(), url: usefulLink.url.trim(), description: usefulLink.description.trim() || null
    }).select("*").single();
    if (error) { notify(`Could not save link: ${error.message}`); return; }
    const item: ModuleRecord = { id: data.id, module: "Useful Links", title: data.title, customerId: data.customer_id, siteId: "", createdAt: data.created_at, data: { URL: data.url, Description: data.description || "" } };
    setUsefulLinks(prev => [...prev, item]);
    setUsefulLink({ title: "", url: "", description: "" }); notify("Useful link saved for this customer.");
  };
  const deleteUsefulLink = async (r: ModuleRecord) => {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    const { error } = await supabase.from("customer_useful_links").delete().eq("id", r.id).eq("customer_id", r.customerId);
    if (error) { notify(`Could not delete link: ${error.message}`); return; }
    setUsefulLinks(prev => prev.filter(x => x.id !== r.id)); notify("Useful link deleted.");
  };

    const renderField = (field: typeof moduleFields[string][number]) => {
    const value = formData[field.label] || "";
    const common = {
      style: inputBase, value,
      required: !!field.required,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setFormData(prev => ({ ...prev, [field.label]: e.target.value }))
    };
    return <div key={field.label} style={{ minWidth: 0 }}>
      <label style={{ fontWeight: 600, fontSize: 13 }}>{field.label}{field.required ? " *" : ""}</label>
      {field.options ? <select {...common}><option value="">Select...</option>{field.options.map(o => <option key={o}>{o}</option>)}</select>
        : field.type === "textarea" ? <textarea {...common} rows={3} />
        : <input {...common} type={field.type || "text"} />}
    </div>;
  };

  const tableWrap: React.CSSProperties = { overflowX: "auto" };
  const th: React.CSSProperties = { textAlign: "left", padding: 11, background: "#edf3f5", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: 11, borderBottom: "1px solid #edf0f2", verticalAlign: "top" };
  const smallButton: React.CSSProperties = { ...primaryButton, padding: "7px 10px", fontSize: 12, marginRight: 5 };

  if (!authReady) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102c3a", color: "white", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <HYGhBrand dark />
        <p>Checking your secure sign-in...</p>
      </div>
    </div>;
  }

  if (passwordResetMode) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102c3a", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <form onSubmit={handlePasswordReset} style={{ width: "100%", maxWidth: 420, background: "white", padding: 32, borderRadius: 12, boxSizing: "border-box", boxShadow: "0 8px 30px #0003" }}>
        <HYGhBrand />
        <p style={{ color: "#647582", marginBottom: 24 }}>Complete Hygiene Management System</p>
        <h2 style={{ marginBottom: 10 }}>Create a new password</h2>
        <p style={{ color: "#647582", lineHeight: 1.5 }}>Choose a new password for your HYGh Cloud account. It must be at least 8 characters long.</p>
        <label style={{ fontWeight: 600 }}>New password</label>
        <input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputBase} />
        <label style={{ fontWeight: 600 }}>Confirm new password</label>
        <input type="password" required minLength={8} autoComplete="new-password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} style={inputBase} />
        {passwordResetError && <p role="alert" style={{ color: "#b42318", background: "#fff0ee", padding: 10, borderRadius: 6 }}>{passwordResetError}</p>}
        {passwordResetSuccess && <p role="status" style={{ color: "#12665f", background: "#e5f4f1", padding: 10, borderRadius: 6 }}>{passwordResetSuccess}</p>}
        <button type="submit" disabled={passwordResetBusy} style={{ ...primaryButton, width: "100%", opacity: passwordResetBusy ? 0.7 : 1 }}>{passwordResetBusy ? "Saving password..." : "Save new password"}</button>
      </form>
    </div>;
  }

  if (!session) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102c3a", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 420, background: "white", padding: 32, borderRadius: 12, boxSizing: "border-box", boxShadow: "0 8px 30px #0003" }}>
        <HYGhBrand />
        <p style={{ color: "#647582", marginBottom: 24 }}>Complete Hygiene Management System</p>
        <h2 style={{ marginBottom: 18 }}>Sign in</h2>
        {passwordResetSuccess && <p role="status" style={{ color: "#12665f", background: "#e5f4f1", padding: 10, borderRadius: 6 }}>{passwordResetSuccess}</p>}
        {authCallbackError && <p role="alert" style={{ color: "#b42318", background: "#fff0ee", padding: 10, borderRadius: 6 }}>The sign-in link could not be completed: {authCallbackError}</p>}
        <label style={{ fontWeight: 600 }}>Email address</label>
        <input type="email" required autoComplete="username" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={inputBase} />
        <label style={{ fontWeight: 600 }}>Password</label>
        <input type="password" required autoComplete="current-password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={inputBase} />
        {loginError && <p role="alert" style={{ color: "#b42318", background: "#fff0ee", padding: 10, borderRadius: 6 }}>{loginError}</p>}
        {resetEmailError && <p role="alert" style={{ color: "#b42318", background: "#fff0ee", padding: 10, borderRadius: 6 }}>{resetEmailError}</p>}
        {resetEmailMessage && <p role="status" style={{ color: "#12665f", background: "#e5f4f1", padding: 10, borderRadius: 6 }}>{resetEmailMessage}</p>}
        <button type="submit" disabled={loginBusy} style={{ ...primaryButton, width: "100%", opacity: loginBusy ? 0.7 : 1 }}>{loginBusy ? "Signing in..." : "Sign in"}</button>
        <button type="button" onClick={handleRequestPasswordReset} disabled={resetEmailBusy} style={{ display: "block", width: "100%", marginTop: 14, padding: 8, border: 0, background: "transparent", color: "#167c80", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}>
          {resetEmailBusy ? "Sending reset email..." : "Forgot password?"}
        </button>
      </form>
    </div>;
  }

  return <div className="hygh-app" style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, Segoe UI, Arial, sans-serif", background: "#f5f8fb", color: "#263b4a" }}>
    <style>{`
      * { box-sizing: border-box; }
      html { background: #f5f8fb; }
      body { margin: 0; background: #f5f8fb; }
      .hygh-app { background: #f5f8fb !important; color: #263b4a !important; }
      .hygh-app button { transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
      .hygh-app button:hover { filter: brightness(1.035); box-shadow: 0 5px 14px #173b4920; transform: translateY(-1px); }
      .hygh-app button:focus-visible, .hygh-app input:focus-visible, .hygh-app select:focus-visible, .hygh-app textarea:focus-visible { outline: 3px solid #9bdcda; outline-offset: 2px; }
      .hygh-app input, .hygh-app select, .hygh-app textarea { border-radius: 10px !important; border-color: #d9e4ea !important; background: #fff; }
      .hygh-app input, .hygh-app select, .hygh-app textarea { min-height: 40px; }
      .hygh-app textarea { min-height: 86px; }
      .hygh-app label { color: #385465; font-size: 13px; font-weight: 650; }
      .hygh-app h1 { font-size: clamp(25px, 3vw, 32px); font-weight: 800; letter-spacing: -1px; }
      .hygh-app h1, .hygh-app h2, .hygh-app h3 { color: #173b49; letter-spacing: -.45px; }
      .hygh-app h2 { font-size: 19px; font-weight: 750; }
      .hygh-app h3 { font-size: 16px; }
      .hygh-app p { line-height: 1.55; }
      .hygh-app main { max-width: 1800px; }
      .hygh-app main > div:first-child { background: linear-gradient(115deg,#ffffff 0%,#f0fbfa 100%); border: 1px solid #e1ecee; border-radius: 18px; padding: 20px 22px; box-shadow: 0 8px 24px #102c3a09; margin-bottom: 20px; }
      .hygh-app main > div[role="status"] { border: 1px solid #bce7dd; }
      .hygh-app main form, .hygh-app main > div > div { min-width: 0; }
      .hygh-app table { border-collapse: separate !important; border-spacing: 0; width: 100%; background: #fff; }
      .hygh-app th { background: #eff6f7 !important; color: #31515d; font-size: 11px; text-transform: uppercase; letter-spacing: .65px; }
      .hygh-app td, .hygh-app th { padding: 13px !important; border-bottom: 1px solid #e8eef0; }
      .hygh-app tbody tr:hover { background: #f7fbfc; }
      .hygh-app aside { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: linear-gradient(180deg,#123746 0%,#102c3a 100%) !important; box-shadow: 5px 0 24px #102c3a12; }
      .hygh-app aside button { border-radius: 11px !important; font-size: 13px; letter-spacing: .05px; }
      .hygh-app aside button:hover { background: #244e5c !important; }
      .hygh-app aside button[aria-current="page"] { background: #087f83 !important; }
      .hygh-app main form, .hygh-app main section { border-radius: 16px; }
      .hygh-app main > div > div, .hygh-app main form { box-shadow: 0 5px 20px #102c3a08; }
      .hygh-app main button { border-radius: 9px; }
      .hygh-app small { color: #71838d; }
      @media (max-width: 760px) {
        .hygh-app { display: block !important; }
        .hygh-app aside { position: relative !important; width: 100% !important; height: auto !important; padding: 14px !important; }
        .hygh-app aside > div { display: inline-block; width: auto; }
        .hygh-app aside button { width: auto !important; display: inline-block !important; padding: 9px 11px !important; }
        .hygh-app main { padding: 16px !important; }
        .hygh-app main > div:first-child { padding: 16px !important; }
      }
    `}</style>
    <aside style={{ width: 258, flexShrink: 0, background: "#102c3a", color: "white", padding: "24px 15px", boxSizing: "border-box" }}>
      <div style={{ padding: "4px 8px 20px", borderBottom: "1px solid #31515d", marginBottom: 16 }}><HYGhBrand dark /></div>
      {visibleSections.map(section => <div key={section}>
        <button onClick={() => {
          setActive(section); setMessage(""); setFormData({}); setEditingId(null);
          setActiveSubTab("");
          setDocSearch("");
        }}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 12px", margin: "4px 0", border: 0, borderRadius: 6, cursor: "pointer", color: "white", background: active === section ? "#087f83" : "transparent", fontWeight: 700 }}>{section}</button>
      </div>)}
    </aside>

    <main style={{ flex: 1, minWidth: 0, padding: "24px clamp(16px, 3vw, 38px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div><h1 style={{ marginBottom: 5 }}>{active}</h1>{documentSubTabs[active] && activeSubTab && <div style={{ color: "#167c80", fontWeight: 700 }}>{activeSubTab}</div>}<p style={{ marginTop: 0, color: "#647582" }}>HYGh Cloud – Complete Hygiene Management System</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 12, color: "#647582" }}>{session.user.email}</span><button type="button" onClick={handleLogout} style={smallButton}>Sign out</button></div>
      </div>
      {message && <div role="status" style={{ background: "#e5f4f1", color: "#12665f", padding: 12, borderRadius: 7, margin: "12px 0" }}>{message}</div>}
      {isAdmin && <div style={{ background: "#fff", padding: 15, margin: "12px 0", borderRadius: 8 }}>
  <button type="button" onClick={testSupabase}>
    Test Supabase Connection
  </button>
  <p>Connection: {connectionStatus}</p>
</div>}
      {loading ? <div style={cardBase}>Loading your HYGh Cloud records...</div> : <>
        {active === "Dashboard" && <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 14, marginTop: 20 }}>
            {[
              ["Customers", customers.length], ["Sites", sites.length], ["Documents", documents.length],
              ["Expiry alerts (60 days)", dueDocs.length], ...(isAdmin ? [["Open actions", openActions.length], ["Module records", records.length]] : [])
            ].map(([label, value]) => <div key={label} style={cardBase}><div style={{ color: "#60727e", fontSize: 13 }}>{label}</div><div style={{ fontSize: 30, fontWeight: 700, color: "#167c80", marginTop: 7 }}>{value}</div></div>)}
          </div>
          <div style={cardBase}><h2>Attention required</h2>
            {dueDocs.length === 0 && openActions.length === 0 ? <p>No outstanding alerts recorded.</p> : <>
              {dueDocs.map(d => <p key={d.id} style={{ borderLeft: `4px solid ${reviewStatusColor(reviewStatus(d.reviewDate))}`, paddingLeft: 10 }}>
                📄 <b>{reviewStatus(d.reviewDate)}:</b> {d.title} – {d.customer} / {d.site} {d.reviewDate ? `(date: ${d.reviewDate})` : ""}
              </p>)}
              {openActions.map(r => <p key={r.id}>⚠ {r.module}: {r.title}</p>)}
            </>}
          </div>
          <div style={cardBase}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><h2 style={{ margin: 0 }}>This week's calendar reminders</h2><button type="button" style={smallButton} onClick={() => { setActive("Hygiene Calendar"); setActiveSubTab(""); }}>Open calendar</button></div>
            {thisWeeksTasks.length === 0 ? <p>No outstanding calendar tasks due this week.</p> : thisWeeksTasks.map(task => <div key={task.id} style={{ borderLeft: `4px solid ${task.data.Priority === "High" ? "#b23b35" : task.data.Priority === "Low" ? "#2876a5" : "#c18419"}`, padding: "8px 12px", marginTop: 10, background: "#f7f9fa" }}><b>{task.title}</b><div>{new Date(`${task.data.Date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}{task.data.Time ? ` · ${task.data.Time}` : ""} · {task.data.Priority} priority</div><small>{task.data["Assigned to"] || "Unassigned"}</small></div>)}
          </div>
        </div>}

        {isAdmin && active === "Customers & Sites" && <div style={{ marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14 }}>
            <div style={cardBase}><b>Total customers</b><h2 style={{ color: "#167c80" }}>{customers.length}</h2></div>
            <div style={cardBase}><b>Total sites</b><h2 style={{ color: "#167c80" }}>{sites.length}</h2></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
            <form style={cardBase} onSubmit={addCustomer}><h2>Register customer</h2>
              <label>Company name *</label><input style={inputBase} value={customerName} onChange={e => setCustomerName(e.target.value)} required />
              <label>Contact name</label><input style={inputBase} value={contact} onChange={e => setContact(e.target.value)} />
              <label>Email</label><input style={inputBase} type="email" value={email} onChange={e => setEmail(e.target.value)} />
              <label>Telephone</label><input style={inputBase} value={phone} onChange={e => setPhone(e.target.value)} />
              <button style={primaryButton}>Save customer</button>
            </form>
            <form style={cardBase} onSubmit={addSite}><h2>Register site</h2>
              <label>Customer *</label><select style={inputBase} value={siteCustomer} onChange={e => setSiteCustomer(e.target.value)} required><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <label>Site / factory name *</label><input style={inputBase} value={siteName} onChange={e => setSiteName(e.target.value)} required />
              <label>Address</label><textarea style={inputBase} rows={2} value={siteAddress} onChange={e => setSiteAddress(e.target.value)} />
              <label>Site reference</label><input style={inputBase} value={siteReference} onChange={e => setSiteReference(e.target.value)} />
              <button style={primaryButton}>Save site</button>
            </form>
          </div>
          <div style={cardBase}><h2>Customer directory</h2>
            {customers.length === 0 ? <p>No customers yet. Register your first customer above.</p> : customers.map(c => <div key={c.id} style={{ padding: "14px 0", borderBottom: "1px solid #e8edef" }}>
              {editingCustomerId === c.id ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 10 }}>
                <label>Company name *<input style={inputBase} value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)} /></label>
                <label>Contact name<input style={inputBase} value={editContact} onChange={e => setEditContact(e.target.value)} /></label>
                <label>Email<input style={inputBase} type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></label>
                <label>Telephone<input style={inputBase} value={editPhone} onChange={e => setEditPhone(e.target.value)} /></label>
                <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                  <button type="button" style={primaryButton} onClick={() => saveCustomerEdit(c)}>Save changes</button>
                  <button type="button" style={smallButton} onClick={cancelEditCustomer}>Cancel</button>
                </div>
              </div> : <><h3 style={{ margin: "0 0 6px" }}>{c.name}</h3><div style={{ color: "#60727e", fontSize: 13 }}>{c.contact} {c.email && `· ${c.email}`} {c.phone && `· ${c.phone}`}</div></>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
                <span style={{ fontSize: 13 }}>Account status:</span>
                <select aria-label={`Account status for ${c.name}`} value={c.accountStatus} onChange={e => updateCustomerStatus(c, e.target.value as Customer["accountStatus"])} style={{ ...inputBase, width: 145, margin: 0 }}>
                  <option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option>
                </select>
              </div>
              <p>{sites.filter(s => s.customerId === c.id).length} site(s)</p>
              {sites.filter(s => s.customerId === c.id).map(s => <div key={s.id} style={{ background: "#f3f6f7", padding: 10, borderRadius: 6, margin: "6px 0" }}><b>{s.name}</b><div>{s.address}</div><small>Ref: {s.reference || "Not set"}</small><div style={{ marginTop: 6 }}><button type="button" style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => removeSite(s.id)}>Delete site</button></div></div>)}
              {editingCustomerId !== c.id && <button type="button" style={{ ...smallButton, marginTop: 8 }} onClick={() => startEditCustomer(c)}>Edit customer</button>}
              <button type="button" style={{ ...smallButton, background: "#9b3b3b", marginTop: 8, marginLeft: 8 }} onClick={() => removeCustomer(c.id)}>Delete customer</button>
            </div>)}
          </div>
        </div>}

        {active === "Hygiene Calendar" && <div style={{ marginTop: 20 }}>
          <div style={cardBase}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div><h2 style={{ margin: 0 }}>Hygiene Calendar</h2><p style={{ color: "#647582", margin: "5px 0 0" }}>Select a date to add or view scheduled tasks.</p></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" style={smallButton} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button>
                <strong style={{ minWidth: 145, textAlign: "center" }}>{calendarMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</strong>
                <button type="button" style={smallButton} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button>
                <button type="button" style={{ ...smallButton, background: "#657681" }} onClick={() => { const now = new Date(); setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setCalendarSelectedDate(today()); }}>Today</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5, marginTop: 18 }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <div key={day} style={{ textAlign: "center", padding: 7, fontWeight: 700, color: "#647582", fontSize: 12 }}>{day}</div>)}
              {Array.from({ length: 42 }, (_, index) => {
                const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
                const offset = (firstDay.getDay() + 6) % 7;
                const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index - offset + 1);
                const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
                const dayTasks = visibleCalendarTasks.filter(t => t.data.Date === key);
                const inMonth = date.getMonth() === calendarMonth.getMonth();
                const selected = calendarSelectedDate === key;
                return <button key={key} type="button" onClick={() => { setCalendarSelectedDate(key); setCalendarTask(v => ({ ...v, date: key })); }} style={{ minHeight: 86, padding: 6, textAlign: "left", border: selected ? "2px solid #167c80" : "1px solid #dce5e9", borderRadius: 7, background: selected ? "#e8f5f3" : "white", color: inMonth ? "#243447" : "#aab4ba", cursor: "pointer", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ fontSize: 13 }}>{date.getDate()}</b>{dayTasks.length > 0 && <span style={{ fontSize: 10, background: "#e5f4f1", color: "#12665f", borderRadius: 10, padding: "2px 5px" }}>{dayTasks.length}</span>}</div>
                  {dayTasks.slice(0,2).map(t => <div key={t.id} title={t.title} style={{ marginTop: 5, padding: "3px 4px", borderRadius: 3, background: t.data.Priority === "High" ? "#fde8e7" : "#e8f1f7", color: t.data.Priority === "High" ? "#9b2c26" : "#245b7a", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>)}
                  {dayTasks.length > 2 && <small>+{dayTasks.length-2} more</small>}
                </button>;
              })}
            </div>
            <p style={{ color: "#647582", fontSize: 12, marginBottom: 0 }}>Select a day to prefill the task date. Task markers show all scheduled tasks, including future recurring tasks.</p>
          </div>
          {(isAdmin || isCustomer) && <form style={cardBase} onSubmit={saveCalendarTask}><h2>{editingId ? "Edit calendar task" : `Add task – ${new Date(`${calendarSelectedDate}T00:00:00`).toLocaleDateString("en-GB")}`}</h2>
            <label>Task name *</label><input style={inputBase} value={calendarTask.title} onChange={e => setCalendarTask(v => ({ ...v, title: e.target.value }))} required />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "0 14px" }}>
              <div><label>Due date *</label><input type="date" style={inputBase} value={calendarTask.date} onChange={e => setCalendarTask(v => ({ ...v, date: e.target.value }))} required /></div>
              <div><label>Time</label><input type="time" style={inputBase} value={calendarTask.time} onChange={e => setCalendarTask(v => ({ ...v, time: e.target.value }))} /></div>
              <div><label>Assigned to</label><input style={inputBase} value={calendarTask.assigned} onChange={e => setCalendarTask(v => ({ ...v, assigned: e.target.value }))} /></div>
              <div><label>Priority</label><select style={inputBase} value={calendarTask.priority} onChange={e => setCalendarTask(v => ({ ...v, priority: e.target.value }))}><option>Low</option><option>Medium</option><option>High</option></select></div>
              <div><label>Reminder date</label><input type="date" style={inputBase} value={calendarTask.reminder} onChange={e => setCalendarTask(v => ({ ...v, reminder: e.target.value }))} /></div>
              <div><label>Status</label><select style={inputBase} value={calendarTask.status} onChange={e => setCalendarTask(v => ({ ...v, status: e.target.value }))}><option>Outstanding</option><option>Completed</option></select></div>
              {isAdmin && <div><label>Customer *</label><select style={inputBase} value={recordCustomer} onChange={e => { setRecordCustomer(e.target.value); setRecordSite(""); }} required><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
              <div><label>Site</label><select style={inputBase} value={recordSite} onChange={e => setRecordSite(e.target.value)}><option value="">All sites / not linked</option>{sites.filter(s => s.customerId === (isCustomer ? assignedCustomerId : recordCustomer)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label>Repeat</label><select style={inputBase} value={calendarTask.repeat} onChange={e => setCalendarTask(v => ({ ...v, repeat: e.target.value }))}><option>Never</option><option>Daily</option><option>Weekdays</option><option>Weekly</option><option>Fortnightly</option><option>Monthly</option><option>Every 3 months</option><option>Every 6 months</option><option>Annually</option></select></div>
              {calendarTask.repeat !== "Never" && <div><label>Repeat until *</label><input type="date" style={inputBase} min={calendarTask.date} value={calendarTask.repeatUntil} onChange={e => setCalendarTask(v => ({ ...v, repeatUntil: e.target.value }))} required /></div>}
            </div>
            <label>Notes</label><textarea style={inputBase} rows={3} value={calendarTask.notes} onChange={e => setCalendarTask(v => ({ ...v, notes: e.target.value }))} />
            <button style={primaryButton}>{editingId ? "Save changes" : "Add task"}</button>{editingId && <button type="button" style={{ ...smallButton, background: "#657681" }} onClick={() => { setEditingId(null); setCalendarTask({ title: "", date: "", time: "", assigned: "", priority: "Medium", reminder: "", status: "Outstanding", notes: "" }); }}>Cancel</button>}
          </form>}
          <div style={cardBase}><h2>Tasks due now ({dueCalendarTasks.length})</h2>
            {dueCalendarTasks.sort((a,b) => (a.data.Date || "").localeCompare(b.data.Date || "")).map(t => <div key={t.id} style={{ padding: 12, borderBottom: "1px solid #e8edef" }}><b>{t.title}</b>{t.data.Date && t.data.Date < today() && <span style={{ color: "#b23b35", fontWeight: 700, marginLeft: 8 }}>OVERDUE</span>}<div>{t.data.Date ? new Date(`${t.data.Date}T00:00:00`).toLocaleDateString("en-GB") : "No date"}{t.data.Time ? ` · ${t.data.Time}` : ""} · {t.data.Priority} priority</div><small>{t.data["Assigned to"] || "Unassigned"}{t.data.Notes ? ` · ${t.data.Notes}` : ""}</small>{(isAdmin || isCustomer) && <div style={{ marginTop: 8 }}><button type="button" style={smallButton} onClick={() => editCalendarTask(t)}>Edit</button><button type="button" style={{ ...smallButton, background: "#16834a" }} onClick={() => completeCalendarTask(t)}>Mark completed</button><button type="button" style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => deleteCalendarTask(t)}>Delete</button></div>}</div>)}
            {dueCalendarTasks.length === 0 && <p>No hygiene tasks are due yet. Future recurring tasks will appear here automatically when their due date arrives.</p>}
          </div>
          <div style={cardBase}><h2>Completed tasks</h2>{visibleCalendarTasks.filter(t => t.data.Status === "Completed").map(t => <p key={t.id}>✓ {t.title} — {t.data.Date}</p>)}{visibleCalendarTasks.every(t => t.data.Status !== "Completed") && <p>No completed tasks yet.</p>}</div>
        </div>}

        {active === "Useful Links" && <div style={{ marginTop: 20 }}>
          {(isAdmin || isCustomer) && <form style={cardBase} onSubmit={saveUsefulLink}><h2>Add useful link</h2>
            {isAdmin && <><label>Customer *</label><select style={inputBase} value={recordCustomer} onChange={e => setRecordCustomer(e.target.value)} required><option value="">Choose customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></>}
            {isCustomer && <p><b>Company:</b> {customers.find(c => c.id === assignedCustomerId)?.name || "Your company"}</p>}<label>Link name *</label><input style={inputBase} value={usefulLink.title} onChange={e => setUsefulLink(v => ({ ...v, title: e.target.value }))} required /><label>Website address *</label><input style={inputBase} type="url" placeholder="https://example.com" value={usefulLink.url} onChange={e => setUsefulLink(v => ({ ...v, url: e.target.value }))} required /><label>Description</label><textarea style={inputBase} rows={2} value={usefulLink.description} onChange={e => setUsefulLink(v => ({ ...v, description: e.target.value }))} /><button style={primaryButton}>Save link</button></form>}
          <div style={cardBase}><h2>Useful links</h2>{visibleUsefulLinks.length === 0 ? <p>No links added yet.</p> : visibleUsefulLinks.map(l => <p key={l.id}><a href={l.data.URL} target="_blank" rel="noreferrer">{l.title}</a>{l.data.Description ? ` — ${l.data.Description}` : ""}{(isAdmin || isCustomer) && <button type="button" style={{ ...smallButton, background: "#9b3b3b", marginLeft: 8 }} onClick={() => deleteUsefulLink(l)}>Delete</button>}</p>)}</div>
        </div>}

        {(documentSubTabs[active] || []).length > 0 && !activeSubTab && <div style={{ marginTop: 28 }}>
          <h2 style={{ marginBottom: 8 }}>Choose a folder</h2>
          <p style={{ color: "#647582", marginTop: 0 }}>Select a category to view and manage its documents.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 18 }}>
            {documentSubTabs[active].map((sub) => <button key={sub} type="button"
              onClick={() => { setSelectedExpiryStatus(""); setSelectedFolderId(""); setActiveSubTab(sub); setDocCategory(sub); setDocSearch(""); setMessage(""); }}
              style={{ minHeight: 155, padding: 22, border: "1px solid #dce5e9", borderRadius: 12, background: "white", boxShadow: "0 3px 12px #0000000d", cursor: "pointer", textAlign: "left", color: "#243447", transition: "transform 0.15s" }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: "#e5f4f1", color: "#167c80", display: "grid", placeItems: "center", fontSize: 22, marginBottom: 18 }}>▤</div>
              <strong style={{ fontSize: 17 }}>{sub}</strong>
              <div style={{ color: "#167c80", fontSize: 14, fontWeight: 700, marginTop: 8 }}>
                {documents.filter(doc => doc.category === sub).length} document(s)
              </div>
              <div style={{ color: "#647582", fontSize: 13, marginTop: 5 }}>Open folder →</div>
            </button>)}
          </div>
        </div>}

        {(documentSubTabs[active] || []).length > 0 && !!activeSubTab && !(["Calendar", "Useful Links"].includes(activeSubTab) && active === "H&S") && <div style={{ marginTop: 20 }}>
          <button type="button" onClick={() => { setSelectedExpiryStatus(""); setSelectedFolderId(""); setActiveSubTab(""); setDocSearch(""); }} style={{ ...smallButton, background: "#657681", marginBottom: 14 }}>← Back to folders</button>
          <div style={cardBase}>
            <h2 id="hygh-expiry-results">{selectedExpiryStatus
              ? `${selectedExpiryStatus} expiry results – all document categories`
              : activeSubTab === "CICs"
                ? (selectedFolderId
                    ? `Assigned PDFs – ${documentFolders.find(f => f.id === selectedFolderId)?.folderName || "Area folder"}`
                    : "Unassigned CICs PDFs")
                : `${activeSubTab} – Document library`} ({filteredDocs.length})</h2>
            {selectedExpiryStatus && <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <b style={{ color: reviewStatusColor(selectedExpiryStatus) }}>Showing: {selectedExpiryStatus} documents</b>
              <button type="button" style={smallButton} onClick={() => { setSelectedExpiryStatus(""); setDocSearch(""); }}>Clear expiry filter</button>
            </div>}
            {(activeSubTab === "CICs" || ["H&S", "Pest Control", "Purchasing"].includes(active)) && selectedFolderId && <button type="button" style={{ ...smallButton, background: "#657681" }} onClick={() => setSelectedFolderId("")}>← Back to unassigned PDFs</button>}
            {(activeSubTab === "CICs" || ["H&S", "Pest Control", "Purchasing"].includes(active)) && !selectedExpiryStatus && <p style={{ color: "#647582" }}>
              {selectedFolderId
                ? "These PDFs have been assigned to this folder."
                : "Unassigned PDFs are shown here. Select a saved folder below to view its documents, or choose a folder when uploading."}
            </p>}
            <input style={inputBase} placeholder="Search title, customer, site..." value={docSearch} onChange={e => setDocSearch(e.target.value)} />
            <div style={tableWrap}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Title", "Customer", "Site", ...(selectedExpiryStatus ? ["Category / area"] : activeSubTab === "CICs" && !selectedFolderId ? ["Assign to area folder"] : ["Area folder"]), "Deadline / review date", "Status", "Actions"].map(h => <th style={th} key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {filteredDocs.map(d => <tr key={d.id}>
                  <td style={td}>{d.title}<br /><small>{d.fileName}</small></td>
                  <td style={td}>{d.customer}</td>
                  <td style={td}>{d.site}</td>
                  <td style={td}>
                    {selectedExpiryStatus
                      ? `${d.category}${d.category === "CICs" && d.folderId ? ` – ${documentFolders.find(folder => folder.id === d.folderId)?.folderName || "Area folder"}` : ""}`
                      : activeSubTab === "CICs" && !selectedFolderId && (isAdmin || d.uploadedBy === session.user.id)
                      ? <select
                          style={{ ...inputBase, minWidth: 190, margin: 0 }}
                          defaultValue=""
                          onChange={e => assignDocumentToFolder(d, e.target.value)}
                        >
                          <option value="">Select area folder...</option>
                          {documentFolders
                            .filter(folder => folder.customerId === customers.find(c => c.name === d.customer)?.id &&
                              folder.siteId === sites.find(s => s.name === d.site && s.customerId === folder.customerId)?.id)
                            .map(folder => <option key={folder.id} value={folder.id}>{folder.folderName}</option>)}
                        </select>
                      : (activeSubTab === "CICs"
                          ? (documentFolders.find(folder => folder.id === d.folderId)?.folderName || "Unassigned")
                          : (documentFolders.find(folder => folder.id === d.folderId)?.folderName || d.category))}
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {(isAdmin || d.uploadedBy === session.user.id) && <><input
                        type="date"
                        style={{ ...inputBase, width: 155, margin: 0 }}
                        value={Object.prototype.hasOwnProperty.call(reviewDateDrafts, d.id) ? reviewDateDrafts[d.id] : d.reviewDate}
                        onChange={e => setReviewDateDrafts(prev => ({ ...prev, [d.id]: e.target.value }))}
                        aria-label={`Review or expiry date for ${d.title}`}
                      />
                      <button
                        type="button"
                        style={smallButton}
                        onClick={() => saveDocumentReviewDate(d)}
                        disabled={!Object.prototype.hasOwnProperty.call(reviewDateDrafts, d.id) || reviewDateDrafts[d.id] === d.reviewDate}
                      >Save date</button></>}
                    </div>
                    {!d.reviewDate && <small style={{ color: "#647582" }}>No review date set</small>}
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: reviewStatusColor(reviewStatus(d.reviewDate)) }}>{reviewStatus(d.reviewDate)}</td>
                  <td style={td}>
                    <button style={smallButton} onClick={() => openDocument(d)}>View</button>
                    <button style={smallButton} onClick={() => openDocument(d, true)}>Download</button>
                    {(isAdmin || d.uploadedBy === session.user.id) && <button style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => deleteDocument(d)}>Delete</button>}
                  </td>
                </tr>)}
              </tbody>
            </table></div>
            {filteredDocs.length === 0 && <p>{activeSubTab === "CICs" && !selectedFolderId ? "No unassigned CICs PDFs. Upload PDFs below to add them to this list." : "No documents found."}</p>}
          </div>
          {(activeSubTab === "CICs" || ["H&S", "Pest Control", "Purchasing"].includes(active)) && <div style={cardBase}>
            <h2>{activeSubTab === "CICs" ? "CICs area folders" : `${active} folders`}</h2>
            <p style={{ color: "#647582" }}>Create separate document folders for each customer's site. Folder names are saved in Supabase.</p>
            <form onSubmit={createDocumentFolder} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
              {isAdmin ? <div><label>Customer *</label><select style={inputBase} value={folderCustomerId} onChange={e => { setFolderCustomerId(e.target.value); setFolderSiteId(""); }} required><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div> : <div><label>Company</label><p>{customers.find(c => c.id === assignedCustomerId)?.name}</p></div>}
              <div><label>Site *</label><select style={inputBase} value={folderSiteId} onChange={e => setFolderSiteId(e.target.value)} required><option value="">Select site</option>{sites.filter(s => s.customerId === (isCustomer ? assignedCustomerId : folderCustomerId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label>New folder name *</label><input style={inputBase} value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Packing Hall" required /></div>
              <button style={primaryButton}>＋ Add folder</button>
            </form>
            <h3>Saved area folders</h3>
            {documentFolders.filter(folder => folder.parentCategory === (activeSubTab === "CICs" ? "CICs" : `${active}::${activeSubTab}`)).length === 0 ? <p>No folders created for this area yet.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12 }}>
              {documentFolders.filter(folder => folder.parentCategory === (activeSubTab === "CICs" ? "CICs" : `${active}::${activeSubTab}`)).map(folder => {
                const folderCustomer = customers.find(c => c.id === folder.customerId);
                const folderSite = sites.find(s => s.id === folder.siteId);
                const count = documents.filter(d => d.folderId === folder.id).length;
                return <div key={folder.id} style={{ border: "1px solid #dce5e9", borderRadius: 9, padding: 13, background: selectedFolderId === folder.id ? "#e5f4f1" : "#f9fbfc" }}>
                  <div style={{ fontSize: 12, color: "#647582" }}>{folderCustomer?.name || "Customer"} · {folderSite?.name || "Site"}</div>
                  <strong style={{ display: "block", margin: "7px 0" }}>📁 {folder.folderName}</strong>
                  <div style={{ color: "#167c80", fontWeight: 700, fontSize: 13 }}>{count} document(s)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                    <button type="button" style={smallButton} onClick={() => { setSelectedExpiryStatus(""); setDocSearch(""); setSelectedFolderId(folder.id); setDocCustomer(folder.customerId); setDocSite(folder.siteId); notify(`Showing PDFs assigned to ${folder.folderName}.`); }}>View PDFs</button>
                    <button type="button" style={{ ...smallButton, background: "#657681" }} onClick={() => renameDocumentFolder(folder)}>Rename</button>
                    <button type="button" style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => deleteDocumentFolder(folder)}>Delete</button>
                  </div>
                </div>;
              })}
            </div>}
            {selectedFolderId && <p><b>Selected upload folder:</b> {documentFolders.find(f => f.id === selectedFolderId)?.folderName}</p>}
          </div>}
          <form style={cardBase} onSubmit={uploadDocument}><h2>Upload PDF documents</h2>
            <p style={{ color: "#647582", marginTop: 0 }}>Folder: <b>{activeSubTab}</b> · PDF files only · Files are saved in private Supabase cloud storage. HYGh Cloud will look for a date in selectable PDF text and ask you to confirm it.</p>
            {isAdmin ? <><label>Customer *</label><select style={inputBase} value={docCustomer} onChange={e => { setDocCustomer(e.target.value); setDocSite(""); setSelectedFolderId(""); }} required><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></> : <p><b>Company:</b> {customers.find(c => c.id === assignedCustomerId)?.name || "Your company"}</p>}
            <label>Site *</label><select style={inputBase} value={docSite} onChange={e => { setDocSite(e.target.value); setSelectedFolderId(""); }} required><option value="">Select site</option>{sites.filter(s => s.customerId === (isCustomer ? assignedCustomerId : docCustomer)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            {activeSubTab === "CICs" && <p style={{ color: "#647582", marginTop: 0 }}>
              CICs PDFs are uploaded as unassigned. After uploading, use the “Assign to area folder” list above to file each PDF in the correct customer/site folder.
            </p>}
            <div onDragOver={e => { e.preventDefault(); setDraggingFiles(true); }}
              onDragLeave={() => setDraggingFiles(false)}
              onDrop={e => { e.preventDefault(); setDraggingFiles(false); const incoming = Array.from(e.dataTransfer.files); setDocFiles(prev => [...prev, ...incoming]); }}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${draggingFiles ? "#167c80" : "#8aa6b4"}`, background: draggingFiles ? "#e5f4f1" : "#f7fafb", borderRadius: 10, padding: "30px 18px", textAlign: "center", cursor: "pointer", margin: "12px 0" }}>
              <div style={{ fontSize: 34 }}>☁</div>
              <b>Drag and drop PDF documents here</b>
              <p style={{ color: "#647582", margin: "7px 0" }}>or click to browse your computer</p>
              <small style={{ color: "#647582" }}>Multiple PDF files supported</small>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }}
                onChange={e => setDocFiles(prev => [...prev, ...Array.from(e.target.files || [])])} onClick={e => e.stopPropagation()} />
            </div>
            {docFiles.length > 0 && <div style={{ marginBottom: 14 }}>
              <b>{docFiles.length} file(s) selected</b>
              {docFiles.map((f, i) => <div key={`${f.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #edf0f2" }}>
                <span>📄 {f.name}</span><button type="button" style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => setDocFiles(prev => prev.filter((_, index) => index !== i))}>Remove</button>
              </div>)}
            </div>}
            <button style={primaryButton} disabled={!docFiles.length || !docCustomer || !docSite}>Upload {docFiles.length || ""} PDF document(s)</button>
          </form>
        </div>}

        {isAdmin && moduleFields[active] && !documentSubTabs[active] && <div style={{ marginTop: 20 }}>
          <form style={cardBase} onSubmit={saveModuleRecord}>
            <h2>{editingId ? "Edit record" : `Add ${active} record`}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: "0 16px" }}>
              <div><label>Customer (optional)</label><select style={inputBase} value={recordCustomer} onChange={e => { setRecordCustomer(e.target.value); setRecordSite(""); }}><option value="">Not linked</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label>Site (optional)</label><select style={inputBase} value={recordSite} onChange={e => setRecordSite(e.target.value)}><option value="">Not linked</option>{sites.filter(s => !recordCustomer || s.customerId === recordCustomer).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              {moduleFields[active].map(renderField)}
            </div>
            <button style={primaryButton}>{editingId ? "Save changes" : "Save record"}</button>
            {editingId && <button type="button" style={{ ...primaryButton, background: "#657681", marginLeft: 8 }} onClick={() => { setEditingId(null); setFormData({}); }}>Cancel edit</button>}
            {active === "CIP Monitoring" && <p style={{ color: "#657681", fontSize: 12 }}>Prototype control: saved readings are recorded in the activity log. Production CIP integration requires validated instrument data capture and access controls.</p>}
          </form>
          <div style={cardBase}><h2>{active} records ({moduleRecords.length})</h2>
            <input style={inputBase} placeholder="Search records..." value={recordSearch} onChange={e => setRecordSearch(e.target.value)} />
            {moduleRecords.length === 0 ? <p>No records saved yet.</p> : <div style={tableWrap}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Record</th><th style={th}>Customer / site</th><th style={th}>Details</th><th style={th}>Actions</th></tr></thead><tbody>
              {moduleRecords.map(r => <tr key={r.id}><td style={td}><b>{r.title}</b><br /><small>{new Date(r.createdAt).toLocaleString()}</small></td><td style={td}>{customers.find(c => c.id === r.customerId)?.name || "—"}<br />{sites.find(s => s.id === r.siteId)?.name || "—"}</td><td style={td}>{Object.entries(r.data).filter(([,v]) => v).slice(0, 5).map(([k,v]) => <div key={k}><b>{k}:</b> {v}</div>)}</td><td style={td}><button style={smallButton} onClick={() => editRecord(r)}>Edit</button><button style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => removeModuleRecord(r)}>Delete</button></td></tr>)}
            </tbody></table></div>}
          </div>
        </div>}

        {isAdmin && active === "Admin" && <div style={{ marginTop: 20 }}>
          <div style={cardBase}>
            <h2>Customer User Management</h2>
            <p>Invite individual users to access a customer's HYGh Cloud account. Each user is linked to one customer.</p>
            <form onSubmit={inviteCustomerUser}>
              <label>Full name</label>
              <input
                style={inputBase}
                value={inviteFullName}
                onChange={e => setInviteFullName(e.target.value)}
                placeholder="Enter user's full name"
                required
              />

              <label>Email address</label>
              <input
                style={inputBase}
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="Enter user's email address"
                required
              />

              <label>Customer account</label>
              <select
                style={inputBase}
                value={inviteCustomerId}
                onChange={e => setInviteCustomerId(e.target.value)}
                required
              >
                <option value="">Choose a customer</option>
                {customers.map(customer => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>

              <label>Permission level</label>
              <select
                style={inputBase}
                value={invitePermission}
                onChange={e => setInvitePermission(e.target.value)}
              >
                <option value="customer_admin">Customer Administrator</option>
                <option value="site_manager">Site Manager</option>
                <option value="document_manager">Document Manager</option>
                <option value="view_only">View Only</option>
              </select>

              <button type="submit" style={primaryButton} disabled={inviteBusy}>
                {inviteBusy ? "Sending invitation..." : "Send User Invitation"}
              </button>
            </form>
          </div>

          <div style={cardBase}>
            <h2>Customer Users ({platformUsers.length})</h2>
            <p>View invited users, the customer account they belong to, their access level and account status.</p>
            {usersLoading ? <p>Loading customer users...</p> : platformUsers.length === 0 ? <p>No customer user profiles found yet. Newly invited users will appear here once their invitation profile has been created.</p> : (
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={th}>Name</th><th style={th}>Email</th><th style={th}>Customer</th>
                    <th style={th}>Permission</th><th style={th}>Account status</th>
                  </tr></thead>
                  <tbody>
                    {platformUsers.map(user => (
                      <tr key={user.id}>
                        <td style={td}><strong>{user.full_name}</strong></td>
                        <td style={td}>{user.email || "Email not yet recorded"}</td>
                        <td style={td}>{customers.find(c => c.id === user.customer_id)?.name || "Customer not linked"}</td>
                        <td style={td}>
                          <select aria-label={`Permission for ${user.full_name}`} style={{ ...inputBase, minWidth: 175, margin: 0 }}
                            value={user.customer_permission || "view_only"} disabled={userActionId === user.id}
                            onChange={e => updatePlatformUser(user, { customer_permission: e.target.value })}>
                            <option value="customer_admin">Customer Administrator</option>
                            <option value="site_manager">Site Manager</option>
                            <option value="document_manager">Document Manager</option>
                            <option value="view_only">View Only</option>
                          </select>
                        </td>
                        <td style={td}>
                          <select aria-label={`Account status for ${user.full_name}`} style={{ ...inputBase, minWidth: 125, margin: 0 }}
                            value={user.account_status || "active"} disabled={userActionId === user.id}
                            onChange={e => updatePlatformUser(user, { account_status: e.target.value })}>
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ color: "#657681", fontSize: 12, marginBottom: 0 }}>Changes are saved to the Supabase profiles table. Suspended users are signed out when their account profile is next checked; database access policies must also enforce suspension.</p>
          </div>

          <div style={cardBase}>
    <h2>HYGh Cloud – Platform Admin Centre</h2>
    <p>Manage customer accounts, sites and platform activity.</p>

    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      gap: 12,
      marginTop: 20
    }}>
      <div style={cardBase}>
        <h3>{customers.length}</h3>
        <p>Customer Accounts</p>
      </div>

      <div style={cardBase}>
        <h3>{sites.length}</h3>
        <p>Registered Sites</p>
      </div>

      <div style={cardBase}>
        <h3>{documents.length}</h3>
        <p>Uploaded Documents</p>
      </div>
    </div>
  </div>

  <div style={cardBase}>
    <h2>Customer Accounts</h2>
    <p>View your customers and access their site management records.</p>

    <button
      style={primaryButton}
      onClick={() => setActive("Customers & Sites")}
    >
      Add or Manage Customers
    </button>

    <div style={tableWrap}>
      <table>
        <thead>
          <tr>
            <th style={th}>Customer</th>
            <th style={th}>Main Contact</th>
            <th style={th}>Email</th>
            <th style={th}>Phone</th>
            <th style={th}>Sites</th>
            <th style={th}>Documents</th>
            <th style={th}>Account Status</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {customers.map(customer => (
            <tr key={customer.id}>
              <td style={td}>{customer.name}</td>
              <td style={td}>{customer.contact || "-"}</td>
              <td style={td}>{customer.email || "-"}</td>
              <td style={td}>{customer.phone || "-"}</td>
              <td style={td}>
                {sites.filter(site => site.customerId === customer.id).length}
              </td>
              <td style={td}>
                {documents.filter(doc => doc.customer === customer.name).length}
              </td>
              <td style={td}>
                <select
                  aria-label={`Account status for ${customer.name}`}
                  value={customer.accountStatus}
                  onChange={e => updateCustomerStatus(customer, e.target.value as Customer["accountStatus"])}
                  style={{ ...inputBase, minWidth: 125, margin: 0 }}
                >
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="suspended">Suspended</option>
                </select>
              </td>
              <td style={td}>
                <button
                  style={smallButton}
                  onClick={() => setActive("Customers & Sites")}
                >
                  Manage
                </button>
              </td>
            </tr>
          ))}

          {customers.length === 0 && (
            <tr>
              <td style={td} colSpan={8}>
                No customer accounts have been created yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>

  <div style={cardBase}>
    <h2>Activity / Audit Trail ({audit.length})</h2>

    <div style={tableWrap}>
      <table>
        <thead>
          <tr>
            <th style={th}>Date</th>
            <th style={th}>Action</th>
            <th style={th}>Details</th>
            <th style={th}>Module</th>
          </tr>
        </thead>

        <tbody>
          {audit.slice(0, 20).map((item, index) => (
            <tr key={index}>
              <td style={td}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "-"}</td>
              <td style={td}>{item.action || "-"}</td>
              <td style={td}>{item.details || "-"}</td>
              <td style={td}>{item.module || "-"}</td>
            </tr>
          ))}

          {audit.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>No activity recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>

  <div style={cardBase}>
    <h2>Data Backup</h2>
    <p>Export your current platform data for backup purposes.</p>

    <button
  style={primaryButton}
  onClick={() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      customers,
      sites,
      records,
      audit,
      documents
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "hygh-cloud-backup.json";
    a.click();

    URL.revokeObjectURL(url);
  }}
>
  Export Data Backup
</button>
  </div>

  <div style={cardBase}>
    <h2>Billing and Account Controls</h2>
    <p>
      Subscription plans, Stripe payments, automatic account activation
      and account suspension will be added in the next development stages.
    </p>
  </div>

</div>}

      </>}
      <footer style={{ color: "#7b8991", fontSize: 11, marginTop: 25 }}>HYGh Cloud · Complete Hygiene Management System · Customer and site data plus PDF documents connected to Supabase. Consultant module records and audit history remain browser-local at this stage.</footer>
    </main>
  </div>;
}