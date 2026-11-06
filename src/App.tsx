import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from './supabase';
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
/*
 HYGh Cloud - complete browser prototype
 - Preserves the existing HYGhCloudDB IndexedDB stores: documents, customers, sites.
 - Adds a records store for module records and an audit store for activity history.
 - Browser-local prototype only: not a secure multi-user/cloud production system.
*/

const DB_NAME = "HYGhCloudDB";
const DB_VERSION = 3;

const sections = [
  "Dashboard", "Customers & Sites", "Chemical Management",
  "Cleaning Documents", "Pest Control", "Purchasing",
  "Micro Results", "H&S", "CIP Monitoring", "Site Visits", "Calendar", "Admin"
];

const documentSubTabs: Record<string, string[]> = {
  "Chemical Management": ["MSDS", "PI Sheets", "Titration Records", "Technical Guides", "Compliance Certificates"],
  "Cleaning Documents": ["CICs", "Sign Off Sheets", "Training Records"],
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
  "Site Visits": [
    { label: "Visit title", required: true }, { label: "Visit date", type: "date", required: true },
    { label: "Visit type", options: ["Routine hygiene", "BRCGS audit", "Retailer audit", "CIP review", "Training", "Other"] },
    { label: "Consultant / auditor" }, { label: "Findings", type: "textarea" },
    { label: "Actions required", type: "textarea" }, { label: "Next visit", type: "date" },
    { label: "Status", options: ["Planned", "Completed", "Report outstanding"] }
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

type Customer = { id: string; name: string; contact: string; email: string; phone?: string };
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
  border: "1px solid #cbd5dc", borderRadius: 6, boxSizing: "border-box",
  font: "inherit", background: "white", color: "#243447"
};
const cardBase: React.CSSProperties = {
  background: "white", padding: 20, borderRadius: 10,
  boxShadow: "0 2px 8px #00000010", marginBottom: 20
};
const primaryButton: React.CSSProperties = {
  background: "#167c80", color: "white", border: 0, borderRadius: 6,
  padding: "10px 16px", cursor: "pointer", fontWeight: 600
};

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState('Not tested');
  const [session, setSession] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [assignedCustomerId, setAssignedCustomerId] = useState<string | null>(null);
  const isAdmin = userRole === "admin" || userRole === "consultant";
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
    // Supabase may return recovery links as either an explicit type=recovery
    // URL or a PKCE callback containing ?code=... . The latter does not
    // include the word "recovery", so detect the auth callback as well.
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const recoveryType = query.get("type") === "recovery" || hash.get("type") === "recovery" || query.get("flow") === "password-reset";
    const authCallback = query.has("code") || query.has("token_hash") ||
      hash.has("access_token") || hash.has("token_hash");
    return recoveryType || authCallback;
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
      const resetUrl = new URL(window.location.origin);
      resetUrl.searchParams.set("flow", "password-reset");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: resetUrl.toString()
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
  const visibleSections = isAdmin ? sections : isCustomer ? ["Dashboard", ...Object.keys(documentSubTabs)] : ["Dashboard"];
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

  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const loadData = async () => {
      try {
        const { data: profile, error: profileError } = await supabase.from("profiles").select("role, customer_id").eq("id", session.user.id).single();
        if (profileError) throw new Error(`Could not load your user profile: ${profileError.message}`);
        if (!profile || !["admin", "consultant", "customer"].includes(profile.role)) throw new Error("Your account does not have a recognised HYGh Cloud role. Please contact your administrator.");
        setUserRole(profile.role);
        setAssignedCustomerId(profile.customer_id || null);
        if (profile.role === "customer" && !profile.customer_id) throw new Error("Your customer account has not been linked to a company yet. Please contact your administrator.");
        const [
          { data: customerRows, error: customerError },
          { data: siteRows, error: siteError },
          { data: documentRows, error: documentError },
          { data: folderRows, error: folderError },
          localRecords, localAudit
        ] = await Promise.all([
          supabase.from("customers").select("id, company_name, contact_name, email, phone").order("company_name"),
          supabase.from("sites").select("id, customer_id, site_name, address, site_reference").order("site_name"),
          supabase.from("documents").select("id, customer_id, site_id, category, title, file_name, storage_path, uploaded_by, created_at, expiry_date, folder_id").order("created_at", { ascending: false }),
          supabase.from("document_folders").select("id, customer_id, site_id, parent_category, folder_name").eq("parent_category", "CICs").order("folder_name"),
          profile.role === "customer" ? Promise.resolve([] as ModuleRecord[]) : getAll<ModuleRecord>("records"),
          profile.role === "customer" ? Promise.resolve([] as AuditRecord[]) : getAll<AuditRecord>("audit")
        ]);
        if (customerError) throw customerError;
        if (siteError) throw siteError;
        if (documentError) throw documentError;
        if (folderError) throw folderError;
        if (profile.role === "customer") {
          setDocCustomer(profile.customer_id);
          setFolderCustomerId(profile.customer_id);
        }
        setCustomers((customerRows || []).map(row => ({
          id: row.id, name: row.company_name, contact: row.contact_name || "",
          email: row.email || "", phone: row.phone || ""
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
      phone: phone.trim()
    }).select("id, company_name, contact_name, email, phone").single();
    if (error) { notify(`Could not save customer: ${error.message}`); return; }
    const item: Customer = {
      id: data.id, name: data.company_name, contact: data.contact_name || "",
      email: data.email || "", phone: data.phone || ""
    };
    setCustomers(prev => [...prev, item]);
    await log("Created", `Customer added: ${item.name}`, "Customers & Sites");
    setCustomerName(""); setContact(""); setEmail(""); setPhone("");
    notify("Customer saved to Supabase.");
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
    const { data, error } = await supabase.from("document_folders").insert({
      customer_id: folderCustomerId, site_id: folderSiteId,
      parent_category: "CICs", folder_name: name
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
        folder_id: null
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
        (activeSubTab !== "CICs" || (selectedFolderId ? d.folderId === selectedFolderId : !d.folderId)))
  ), [documents, docSearch, docFilter, activeSubTab, selectedFolderId, selectedExpiryStatus]);

  const moduleRecords = records.filter(r => r.module === active &&
    [r.title, ...Object.values(r.data)].some(v => v.toLowerCase().includes(recordSearch.toLowerCase()))
  );
  const dueDocs = documents.filter(d => ["Expired", "Urgent", "Due soon", "Upcoming"].includes(reviewStatus(d.reviewDate)));
  const openActions = records.filter(r =>
    (r.module === "Health & Safety" && !["Closed"].includes(r.data.Status || "")) ||
    (r.module === "CIP Monitoring" && r.data.Result === "Fail") ||
    (r.module === "Microbiology" && r.data["Result status"] === "Unsatisfactory")
  );

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
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102b3f", color: "white", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ color: "#63d4c2" }}>HYGh Cloud</h1>
        <p>Checking your secure sign-in...</p>
      </div>
    </div>;
  }

  if (passwordResetMode) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102b3f", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <form onSubmit={handlePasswordReset} style={{ width: "100%", maxWidth: 420, background: "white", padding: 32, borderRadius: 12, boxSizing: "border-box", boxShadow: "0 8px 30px #0003" }}>
        <h1 style={{ color: "#167c80", marginTop: 0 }}>HYGh Cloud</h1>
        <p style={{ color: "#647582", marginBottom: 24 }}>Hygiene Management System</p>
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
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#102b3f", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 420, background: "white", padding: 32, borderRadius: 12, boxSizing: "border-box", boxShadow: "0 8px 30px #0003" }}>
        <h1 style={{ color: "#167c80", marginTop: 0 }}>HYGh Cloud</h1>
        <p style={{ color: "#647582", marginBottom: 24 }}>Hygiene Management System</p>
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

  return <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Arial, sans-serif", background: "#f3f5f7", color: "#243447" }}>
    <aside style={{ width: 235, flexShrink: 0, background: "#102b3f", color: "white", padding: "22px 13px", boxSizing: "border-box" }}>
      <h1 style={{ color: "#63d4c2", marginBottom: 4 }}>HYGh Cloud</h1>
      <p style={{ color: "#b8cbd5", fontSize: 13 }}>Hygiene Management System</p><hr style={{ borderColor: "#345064" }} />
      {visibleSections.map(section => <div key={section}>
        <button onClick={() => {
          setActive(section); setMessage(""); setFormData({}); setEditingId(null);
          setActiveSubTab("");
          setDocSearch("");
        }}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 12px", margin: "4px 0", border: 0, borderRadius: 6, cursor: "pointer", color: "white", background: active === section ? "#167c80" : "transparent", fontWeight: 700 }}>{section}</button>
      </div>)}
    </aside>

    <main style={{ flex: 1, minWidth: 0, padding: "28px clamp(16px, 3vw, 36px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div><h1 style={{ marginBottom: 5 }}>{active}</h1>{documentSubTabs[active] && activeSubTab && <div style={{ color: "#167c80", fontWeight: 700 }}>{activeSubTab}</div>}<p style={{ marginTop: 0, color: "#647582" }}>HYGh Cloud – Hygiene Management System</p></div>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
            {visibleSections.filter(s => s !== "Dashboard").map(s => <button key={s} onClick={() => setActive(s)} style={{ ...cardBase, textAlign: "left", cursor: "pointer", border: 0, color: "#243447" }}><strong>{s}</strong><p style={{ color: "#687985", marginBottom: 0 }}>Open module →</p></button>)}
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
              <h3 style={{ margin: "0 0 6px" }}>{c.name}</h3><div style={{ color: "#60727e", fontSize: 13 }}>{c.contact} {c.email && `· ${c.email}`} {c.phone && `· ${c.phone}`}</div>
              <p>{sites.filter(s => s.customerId === c.id).length} site(s)</p>
              {sites.filter(s => s.customerId === c.id).map(s => <div key={s.id} style={{ background: "#f3f6f7", padding: 10, borderRadius: 6, margin: "6px 0" }}><b>{s.name}</b><div>{s.address}</div><small>Ref: {s.reference || "Not set"}</small><div style={{ marginTop: 6 }}><button style={{ ...smallButton, background: "#9b3b3b" }} onClick={() => removeSite(s.id)}>Delete site</button></div></div>)}
              <button style={{ ...smallButton, background: "#9b3b3b", marginTop: 8 }} onClick={() => removeCustomer(c.id)}>Delete customer</button>
            </div>)}
          </div>
        </div>}

        {(documentSubTabs[active] || []).length > 0 && !activeSubTab && <div style={{ marginTop: 28 }}>
          <h2 style={{ marginBottom: 8 }}>Choose a folder</h2>
          <p style={{ color: "#647582", marginTop: 0 }}>Select a category to view and manage its documents.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 18 }}>
            {documentSubTabs[active].map((sub) => <button key={sub} type="button"
              onClick={() => { setActiveSubTab(sub); setDocCategory(sub); setDocSearch(""); setMessage(""); }}
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

        {(documentSubTabs[active] || []).length > 0 && !!activeSubTab && <div style={{ marginTop: 20 }}>
          <button type="button" onClick={() => setActiveSubTab("")} style={{ ...smallButton, background: "#657681", marginBottom: 14 }}>← Back to folders</button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12 }}>
            {["Expired", "Urgent", "Due soon", "Upcoming", "Current"].map(status => <button
              key={status}
              type="button"
              onClick={() => {
                setSelectedExpiryStatus(current => current === status ? "" : status);
                setDocSearch("");
                window.setTimeout(() => {
                  document.getElementById("hygh-expiry-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 80);
              }}
              aria-pressed={selectedExpiryStatus === status}
              style={{
                ...cardBase,
                textAlign: "left",
                cursor: "pointer",
                border: selectedExpiryStatus === status ? `2px solid ${reviewStatusColor(status)}` : "2px solid transparent",
                background: selectedExpiryStatus === status ? "#f3f7f8" : "white"
              }}>
              <span style={{ color: reviewStatusColor(status), fontWeight: 700 }}>{status}</span>
              <h2 style={{ color: reviewStatusColor(status) }}>{documents.filter(d => reviewStatus(d.reviewDate) === status).length}</h2>
              <small style={{ color: "#647582" }}>
                {status === "Expired" ? "Past expiry date" : status === "Urgent" ? "0–7 days" : status === "Due soon" ? "8–30 days" : status === "Upcoming" ? "31–60 days" : "More than 60 days"}
              </small>
              <small style={{ display: "block", marginTop: 8, color: "#52636e" }}>
                {selectedExpiryStatus === status ? "Showing this status · click to clear" : "Click to view documents"}
              </small>
            </button>)}
          </div>
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
              <button type="button" style={smallButton} onClick={() => setSelectedExpiryStatus("")}>Clear expiry filter</button>
            </div>}
            {activeSubTab === "CICs" && selectedFolderId && <button type="button" style={{ ...smallButton, background: "#657681" }} onClick={() => setSelectedFolderId("")}>← Back to unassigned PDFs</button>}
            {activeSubTab === "CICs" && !selectedExpiryStatus && <p style={{ color: "#647582" }}>
              {selectedFolderId
                ? "These PDFs have been assigned to this area folder."
                : "Only PDFs waiting to be assigned are shown here. Once assigned, they disappear from this list and appear in their area folder."}
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
                          : d.category)}
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
          {activeSubTab === "CICs" && <div style={cardBase}>
            <h2>CICs area folders</h2>
            <p style={{ color: "#647582" }}>Create separate document folders for each customer's site. Folder names are saved in Supabase.</p>
            <form onSubmit={createDocumentFolder} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
              {isAdmin ? <div><label>Customer *</label><select style={inputBase} value={folderCustomerId} onChange={e => { setFolderCustomerId(e.target.value); setFolderSiteId(""); }} required><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div> : <div><label>Company</label><p>{customers.find(c => c.id === assignedCustomerId)?.name}</p></div>}
              <div><label>Site *</label><select style={inputBase} value={folderSiteId} onChange={e => setFolderSiteId(e.target.value)} required><option value="">Select site</option>{sites.filter(s => s.customerId === (isCustomer ? assignedCustomerId : folderCustomerId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label>New folder name *</label><input style={inputBase} value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Packing Hall" required /></div>
              <button style={primaryButton}>＋ Add folder</button>
            </form>
            <h3>Saved area folders</h3>
            {documentFolders.length === 0 ? <p>No CICs area folders created yet.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12 }}>
              {documentFolders.map(folder => {
                const folderCustomer = customers.find(c => c.id === folder.customerId);
                const folderSite = sites.find(s => s.id === folder.siteId);
                const count = documents.filter(d => d.folderId === folder.id).length;
                return <div key={folder.id} style={{ border: "1px solid #dce5e9", borderRadius: 9, padding: 13, background: selectedFolderId === folder.id ? "#e5f4f1" : "#f9fbfc" }}>
                  <div style={{ fontSize: 12, color: "#647582" }}>{folderCustomer?.name || "Customer"} · {folderSite?.name || "Site"}</div>
                  <strong style={{ display: "block", margin: "7px 0" }}>📁 {folder.folderName}</strong>
                  <div style={{ color: "#167c80", fontWeight: 700, fontSize: 13 }}>{count} document(s)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                    <button type="button" style={smallButton} onClick={() => { setSelectedFolderId(folder.id); setDocCustomer(folder.customerId); setDocSite(folder.siteId); notify(`Showing PDFs assigned to ${folder.folderName}.`); }}>View PDFs</button>
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
          <div style={cardBase}><h2>System administration</h2><p>This prototype currently runs in this browser only. User records below are planning records, not authenticated accounts or permissions.</p><button style={primaryButton} onClick={() => setActive("Admin")}>User management module</button></div>
          <div style={cardBase}><h2>Activity / audit trail ({audit.length})</h2>
            {audit.length === 0 ? <p>No activity recorded yet.</p> : <div style={tableWrap}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Date/time</th><th style={th}>Module</th><th style={th}>Action</th><th style={th}>Details</th></tr></thead><tbody>{audit.map(a => <tr key={a.id}><td style={td}>{new Date(a.timestamp).toLocaleString()}</td><td style={td}>{a.module}</td><td style={td}>{a.action}</td><td style={td}>{a.details}</td></tr>)}</tbody></table></div>}
          </div>
          <div style={cardBase}><h2>Data backup</h2><p>Use the export option to save a JSON snapshot of customer, site and record metadata. PDF file contents are not included in this export.</p><button style={primaryButton} onClick={() => {
            const payload = { exportedAt: new Date().toISOString(), customers, sites, records, audit, documents };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "hygh-cloud-backup.json"; a.click(); URL.revokeObjectURL(url);
          }}>Export data snapshot</button></div>
        </div>}
      </>}
      <footer style={{ color: "#7b8991", fontSize: 11, marginTop: 25 }}>HYGh Cloud · Customer and site data plus PDF documents connected to Supabase. Consultant module records and audit history remain browser-local at this stage.</footer>
    </main>
  </div>;
}