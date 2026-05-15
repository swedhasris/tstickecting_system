import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronUp, ChevronDown, Clock, Calendar as CalendarIcon, Plus, Save,
  RotateCcw, History, Trash2, Bold, Italic, Underline, List, ListOrdered,
  Paperclip, Link2, Image, Mic, CheckSquare, Mail, Send, Phone,
  MessageCircle, ChevronRight, FileText, Copy, Printer, RefreshCw, Ticket
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, onSnapshot, onSnapshot as listenToDoc
} from "firebase/firestore";
import { Link, useParams, useNavigate } from "react-router-dom";
import { createSpeechController } from "../lib/speechToEnglish";

/* ─── constants ─── */
const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Submitted: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
};

const DEFAULT_TASKS = [
  "General Support", "Ticket Resolution", "Project Work",
  "Training", "Meeting", "Documentation",
  "System Maintenance", "Bug Fix", "Feature Development", "Code Review"
];

const WORK_TYPES = ["Remote", "On-Site", "Hybrid", "Travel"];
const BILLABLE_OPTIONS = ["Billable", "Non-Billable", "Internal"];
const WORK_ROLES = ["ROC Technician", "Developer", "Project Manager", "Support Engineer", "Consultant"];
const LOCATIONS = ["Corporate", "Remote", "Branch Office", "Client Site"];
const GROUPS = ["Service Division", "Engineering", "Support", "Operations"];
const TICKET_STATUSES = ["In Progress", "Open", "Pending", "On Hold", "Resolved", "Closed"];
const AGREEMENTS = [
  "F12 Evolve/Davis Webb Inc. - F12 Evolve",
  "Standard Support Agreement",
  "Premium SLA",
  "Ad-hoc Billing"
];

/* ─── helpers ─── */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTimeFromSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
function formatDate(d: Date): string { return d.toISOString().split("T")[0]; }
function formatTimestamp(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
function nowTimeStr(): string {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** Robustly parse "7:00 AM", "12:40 PM", "13:40", "7.00am", etc. */
function parseTimeStr(timeStr: string): Date | null {
  if (!timeStr) return null;
  // Normalize: remove extra spaces, uppercase
  const cleanStr = timeStr.trim().toUpperCase().replace(/\s+/g, ' ');
  
  // Handle both 12:40 and 12.40
  const parts = cleanStr.match(/(\d{1,2})[:.](\d{2})/);
  if (!parts) return null;
  
  let h = parseInt(parts[1]);
  const m = parseInt(parts[2]);
  
  // Look for PM/AM anywhere in the string
  const isPM = cleanStr.includes("PM");
  const isAM = cleanStr.includes("AM");
  
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  
  // Bounds check
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/* ─── Collapsible Section ─── */
function Section({ title, icon, defaultOpen = true, headerRight, accentColor, children }: {
  title: string; icon?: React.ReactNode; defaultOpen?: boolean;
  headerRight?: React.ReactNode; accentColor?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg bg-white shadow-sm overflow-hidden">
      <div
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 bg-white hover:bg-muted/20 transition-colors cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className={`text-sm font-bold ${accentColor || "text-blue-600"}`}>{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {headerRight && <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>}
          {open ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </div>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

/* ─── Rich Text Toolbar ─── */
function RichTextToolbar({ 
  editorRef, 
  onMicClick, 
  isListening, 
  isSupported 
}: { 
  editorRef: React.RefObject<HTMLDivElement | null>;
  onMicClick?: () => void;
  isListening?: boolean;
  isSupported?: boolean;
}) {
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
  };
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-t border-border bg-muted/20 flex-wrap">
      <button type="button" onClick={() => exec("bold")} className="p-1.5 hover:bg-muted rounded transition-colors" title="Bold"><Bold className="w-4 h-4" /></button>
      <button type="button" onClick={() => exec("italic")} className="p-1.5 hover:bg-muted rounded transition-colors" title="Italic"><Italic className="w-4 h-4" /></button>
      <button type="button" onClick={() => exec("underline")} className="p-1.5 hover:bg-muted rounded transition-colors" title="Underline"><Underline className="w-4 h-4" /></button>
      <div className="w-px h-5 bg-border mx-1" />
      <button type="button" onClick={() => exec("insertUnorderedList")} className="p-1.5 hover:bg-muted rounded transition-colors" title="Bullet List"><List className="w-4 h-4" /></button>
      <button type="button" onClick={() => exec("insertOrderedList")} className="p-1.5 hover:bg-muted rounded transition-colors" title="Numbered List"><ListOrdered className="w-4 h-4" /></button>
      <div className="w-px h-5 bg-border mx-1" />
      <button type="button" className="p-1.5 hover:bg-muted rounded transition-colors" title="Attachment"><Paperclip className="w-4 h-4" /></button>
      <button type="button" onClick={() => { const url = prompt("URL:"); if (url) exec("createLink", url); }} className="p-1.5 hover:bg-muted rounded transition-colors" title="Link"><Link2 className="w-4 h-4" /></button>
      <button type="button" className="p-1.5 hover:bg-muted rounded transition-colors" title="Image"><Image className="w-4 h-4" /></button>
      <div className="w-px h-5 bg-border mx-1" />
      <select className="text-xs border border-border rounded px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-sn-green">
        <option>Choose standard note...</option>
        <option>Completed work</option>
        <option>Awaiting parts</option>
        <option>Escalated to vendor</option>
      </select>
      <button 
        type="button" 
        onClick={onMicClick}
        disabled={isSupported === false}
        className={`p-1.5 hover:bg-muted rounded transition-colors ml-1 border border-transparent ${isListening ? 'bg-sn-green/15 text-sn-green border-sn-green' : ''}`}
        title={isListening ? "Stop Dictation" : "Dictation"}
      >
        <Mic className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════ MAIN ════════════════════════════════════════ */
export function Timesheet() {
  const { user, profile } = useAuth();

  /* ── state ── */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timesheet, setTimesheet] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingCard, setEditingCard] = useState<any>(null);

  // Active timer state
  const [activeTimer, setActiveTimer] = useState<any>(null);
  const [liveElapsedTime, setLiveElapsedTime] = useState(0);

  // Overview fields
  const [company, setCompany] = useState("");
  const [entryDate, setEntryDate] = useState(formatDate(new Date()));
  const [overnight, setOvernight] = useState(false);
  const [workRole, setWorkRole] = useState("ROC Technician");
  const [agreement, setAgreement] = useState(AGREEMENTS[0]);
  const [enterTimeRecord, setEnterTimeRecord] = useState(true);
  const [location, setLocation] = useState("Corporate");
  const [groups, setGroups] = useState("Service Division");
  const [ticketStatus, setTicketStatus] = useState("In Progress");
  const [noteDiscussion, setNoteDiscussion] = useState(true);
  const [noteInternal, setNoteInternal] = useState(false);
  const [noteResolution, setNoteResolution] = useState(false);

  // Time Details
  const [activeTab, setActiveTab] = useState<"time" | "expenses">("time");
  const [startTime, setStartTime] = useState(nowTimeStr());
  const [endTime, setEndTime] = useState("");
  const [deduct, setDeduct] = useState("");
  const [actualHrs, setActualHrs] = useState("0.00");
  const [workType, setWorkType] = useState("Remote");
  const [billable, setBillable] = useState("Billable");
  const [notesContent, setNotesContent] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);

  // Speech to Text state
  const [speechListening, setSpeechListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechLiveText, setSpeechLiveText] = useState("");
  const speechControllerRef = useRef<ReturnType<typeof createSpeechController> | null>(null);

  useEffect(() => {
    const controller = createSpeechController({
      onInterim: (text) => {
        setSpeechLiveText(text);
      },
      onFinal: (text) => {
        setSpeechLiveText("");
        if (editorRef.current && text) {
          const currentHTML = editorRef.current.innerHTML || "";
          const appendText = currentHTML.endsWith(">") || !currentHTML ? text : ` ${text}`;
          editorRef.current.innerHTML = currentHTML + appendText;
          setNotesContent(editorRef.current.innerHTML);
          
          // Trigger the onInput handler manually to update any dependent state
          const event = new Event('input', { bubbles: true });
          editorRef.current.dispatchEvent(event);
        }
      },
      onStateChange: (listening) => {
        setSpeechListening(listening);
        if (!listening) setSpeechLiveText("");
      },
      onError: (msg) => {
        setSpeechListening(false);
        alert(msg);
      }
    });
    speechControllerRef.current = controller;
    setSpeechSupported(controller.supported);
    return () => controller.stop();
  }, []);

  // Email section
  const [emailFrom, setEmailFrom] = useState("");
  const [emailContact, setEmailContact] = useState(true);
  const [emailContactName, setEmailContactName] = useState("");
  const [emailResources, setEmailResources] = useState(false);
  const [emailCc, setEmailCc] = useState(false);
  const [emailCcEmails, setEmailCcEmails] = useState("");
  const [emailBundled, setEmailBundled] = useState(false);

  // WhatsApp section
  const [waCountryCode, setWaCountryCode] = useState("+91");
  const [waPhone, setWaPhone] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waAutoSync, setWaAutoSync] = useState(true);

  // Message history
  const [msgHistory, setMsgHistory] = useState<any[]>([]);
  const [msgHistoryLoading, setMsgHistoryLoading] = useState(false);

  // Clipboard attachments
  const [emailClipboard, setEmailClipboard] = useState<{ type: "text" | "image"; value: string; label: string } | null>(null);
  const [waClipboard, setWaClipboard]       = useState<{ type: "text" | "image"; value: string; label: string } | null>(null);

  // Open tickets
  const [openTickets, setOpenTickets] = useState<any[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const { weekStart: urlWeekStart } = useParams();
  const navigate = useNavigate();

  const calculateDuration = (s: string, e: string) => {
    const start = parseTimeStr(s);
    const end = parseTimeStr(e);
    if (start && end) {
      let diffMs = end.getTime() - start.getTime();
      if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      setActualHrs(diffMins.toString());
    }
  };

  /* ── Auto-Calculate Duration ── */
  useEffect(() => {
    calculateDuration(startTime, endTime);
  }, [startTime, endTime]);

  /* ── Firestore load ── */
  const monday = getMonday(new Date());
  const weekStart = urlWeekStart || formatDate(monday);
  const weekEnd = formatDate(new Date(new Date(weekStart).getTime() + 6 * 86400000));

  useEffect(() => { loadData(); }, [user, weekStart]);
  useEffect(() => { if (user) loadMessageHistory(); }, [user]);

  /* ── Listen for active timer from Firestore ── */
  useEffect(() => {
    if (!user) return;

    const unsubscribe = listenToDoc(doc(db, "users", user.uid), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const userData = docSnapshot.data();
        setActiveTimer(userData.activeTimer || null);
      }
    });

    return unsubscribe;
  }, [user]);

  /* ── Update live elapsed time every second when timer is running ── */
  useEffect(() => {
    if (!activeTimer?.isRunning) {
      setLiveElapsedTime(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date();
      const startTime = new Date(activeTimer.startTime);
      const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      setLiveElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer]);

  /* ── Fetch open tickets ── */
  useEffect(() => {
    if (!user) return;
    setTicketsLoading(true);
    console.log("[Timesheet] Fetching open tickets...");

    // Fetch all tickets and filter client-side for open (not resolved/closed)
    const q = query(collection(db, "tickets"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log("[Timesheet] Got tickets snapshot:", snapshot.docs.length);
      let tickets: any[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter: not resolved/closed (all open tickets)
      tickets = tickets.filter(t =>
        t.status !== "Resolved" && t.status !== "Closed" && t.status !== "Canceled"
      );
      // Sort client-side by createdAt
      tickets.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return bTime.getTime() - aTime.getTime();
      });
      setOpenTickets(tickets);
      setTicketsLoading(false);
    }, (error) => {
      console.error("[Timesheet] Error fetching tickets:", error);
      setTicketsLoading(false);
    });

    return unsubscribe;
  }, [user]);

  async function loadData() {
    if (!user) return;
    setLoading(true);
    try {
      // Get or create timesheet via MySQL API
      const tsRes = await fetch("/api/timesheets/get-or-create", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.uid,
          week_start: weekStart,
          week_end: weekEnd
        })
      });
      if (!tsRes.ok) throw new Error(`Timesheet fetch failed: ${tsRes.status}`);
      const ts = await tsRes.json();
      setTimesheet(ts);

      // Fetch time cards via MySQL API
      const tcRes = await fetch(`/api/time-cards?timesheet_id=${ts.id}`);
      if (!tcRes.ok) throw new Error(`Time cards fetch failed: ${tcRes.status}`);
      const cards = await tcRes.json();
      setTimeCards(Array.isArray(cards) ? cards : []);
    } catch (e: any) {
      console.error("[Timesheet] Error loading data:", e);
      alert(`Failed to load timesheet: ${e.message}`);
    } finally {
      setEmailFrom(profile?.name || user?.email || "");
      setEmailContactName(profile?.name || "");
      setLoading(false);
    }
  }

  /* ── Auto-sync notes → WhatsApp ── */
  useEffect(() => {
    if (waAutoSync) setWaMessage(notesContent);
  }, [notesContent, waAutoSync]);

  const handleEditorInput = useCallback(() => {
    if (editorRef.current) {
      setNotesContent(editorRef.current.innerText || "");
    }
  }, []);

  /* ── Save entry ── */
  async function saveEntry() {
    if (!user || !timesheet) return;
    setSaving(true);
    try {
      const data = {
        timesheet_id: timesheet.id,
        user_id: user.uid,
        entry_date: entryDate,
        task: workType,
        hours_worked: parseFloat(actualHrs) || 0, // Using hours_worked for minutes
        description: notesContent,
        short_description: shortDescription,
        start_time: startTime,
        end_time: endTime,
        deduct: parseFloat(deduct) || 0,
        work_type: workType,
        billable: billable,
        status: "Draft"
      };

      let res;
      if (editingCard) {
        res = await fetch(`/api/time-cards/${editingCard.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } else {
        res = await fetch("/api/time-cards", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
      
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);

      setEditingCard(null);
      resetTimeFields();
      await loadData();
      alert("Time entry saved successfully!");
    } catch (e: any) {
      console.error("[Timesheet] Save failed:", e);
      alert(`Failed to save time entry: ${e.message}`);
    }
    setSaving(false);
  }

  function resetTimeFields() {
    setStartTime(nowTimeStr());
    setEndTime("");
    setDeduct("");
    setActualHrs("0");
    setShortDescription("");
    setNotesContent("");
    if (editorRef.current) editorRef.current.innerHTML = "";
  }

  function loadCardForEdit(card: any) {
    setEditingCard(card);
    setEntryDate(card.entry_date || formatDate(new Date()));
    setStartTime(card.start_time || "");
    setEndTime(card.end_time || "");
    setDeduct(String(card.deduct || "0"));
    setActualHrs(String(card.hours_worked || "0"));
    setWorkType(card.work_type || card.task || "Remote");
    setBillable(card.billable || "Billable");
    setShortDescription(card.short_description || "");
    setNotesContent(card.description || "");
    if (editorRef.current) editorRef.current.innerText = card.description || "";
  }

  async function deleteEntry(cardId: string) {
    if (!confirm("Delete this entry?")) return;
    try {
      const res = await fetch(`/api/time-cards/${cardId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      await loadData();
      alert("Entry deleted successfully!");
    } catch (e: any) {
      console.error("[Timesheet] Delete failed:", e);
      alert(`Failed to delete entry: ${e.message}`);
    }
  }

  async function submitTimesheet() {
    if (!confirm("Submit this timesheet, including AI-captured screenshots and activity logs, to the Admin, Super Admin, and Ultra Super Admin for approval?")) return;
    if (timeCards.length === 0) { alert("Cannot submit empty timesheet."); return; }
    try {
      const res = await fetch(`/api/timesheets/${timesheet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: "Submitted" })
      });
      if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
      alert("Timesheet submitted successfully!");
      await loadData();
    } catch (e: any) {
      console.error("[Timesheet] Submit failed:", e);
      alert(`Failed to submit timesheet: ${e.message}`);
    }
  }

  function handleSendWhatsApp() {
    const phone = waCountryCode.replace("+", "") + waPhone.replace(/\D/g, "");
    const msg = encodeURIComponent(waMessage);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");

    // Save to history
    const recipient = `${waCountryCode} ${waPhone}`;
    saveMessageHistory("whatsapp", recipient, waMessage);
  }

  async function saveMessageHistory(type: "email" | "whatsapp", recipient: string, content: string) {
    if (!user) return;
    try {
      await fetch("/api/message-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.uid,
          user_name: profile?.name || user.email || "User",
          message_type: type,
          recipient,
          message_content: content,
        }),
      });
      loadMessageHistory();
    } catch (e) {
      console.error("[Timesheet] Failed to save message history:", e);
    }
  }

  async function loadMessageHistory() {
    if (!user) return;
    setMsgHistoryLoading(true);
    try {
      const res = await fetch(`/api/message-history?user_id=${user.uid}&limit=50`);
      if (res.ok) setMsgHistory(await res.json());
    } catch { /* silent */ } finally {
      setMsgHistoryLoading(false);
    }
  }

  function handleSendEmail() {
    // Build mailto link
    const subject = encodeURIComponent(`Timesheet Notes — ${entryDate}`);
    const body = encodeURIComponent(notesContent || waMessage);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");

    // Save to history
    const recipient = emailContactName || emailFrom || "Contact";
    saveMessageHistory("email", recipient, notesContent || waMessage);
  }

  async function pasteFromClipboard(target: "email" | "whatsapp") {
    try {
      if (!navigator.clipboard) {
        alert("Clipboard API not available. Please use Ctrl+V to paste.");
        return;
      }

      // Try reading clipboard items (supports images + text)
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          // Image types
          const imageType = item.types.find(t => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              const ext = imageType.split("/")[1] || "png";
              const payload = { type: "image" as const, value: dataUrl, label: `Pasted image.${ext}` };
              if (target === "email") setEmailClipboard(payload);
              else setWaClipboard(payload);
            };
            reader.readAsDataURL(blob);
            return;
          }
          // Plain text
          if (item.types.includes("text/plain")) {
            const blob = await item.getType("text/plain");
            const text = await blob.text();
            const payload = { type: "text" as const, value: text, label: text.slice(0, 60) + (text.length > 60 ? "…" : "") };
            if (target === "email") setEmailClipboard(payload);
            else {
              setWaMessage(prev => prev ? prev + "\n" + text : text);
              setWaAutoSync(false);
              setWaClipboard(payload);
            }
            return;
          }
        }
      }

      // Fallback: readText only
      const text = await navigator.clipboard.readText();
      if (text) {
        const payload = { type: "text" as const, value: text, label: text.slice(0, 60) + (text.length > 60 ? "…" : "") };
        if (target === "email") setEmailClipboard(payload);
        else {
          setWaMessage(prev => prev ? prev + "\n" + text : text);
          setWaAutoSync(false);
          setWaClipboard(payload);
        }
      } else {
        alert("Clipboard is empty or contains unsupported content.");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        alert("Clipboard access denied. Please allow clipboard permissions or use Ctrl+V.");
      } else {
        alert("Could not read clipboard: " + err.message);
      }
    }
  }

  const canEdit = timesheet?.status === "Draft" || timesheet?.status === "Rejected";
  const weekTotal = timeCards.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-sn-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">

      {/* ═══ TOP ACTION BAR ═══ */}
      <div className="flex items-center justify-between bg-white p-3 border border-border rounded-lg shadow-sm">
        <div className="flex items-center gap-3">
          <Link to="/timesheet/weekly" className="p-1.5 hover:bg-muted rounded transition-colors" title="Back to Weekly View">
            <ChevronRight className="w-4 h-4 rotate-180" />
          </Link>
          <button className="p-1.5 hover:bg-muted rounded transition-colors" title="New"><Plus className="w-4 h-4" /></button>
          <button className="p-1.5 hover:bg-muted rounded transition-colors" title="Copy"><Copy className="w-4 h-4" /></button>
          <button className="p-1.5 hover:bg-muted rounded transition-colors" title="Print"><Printer className="w-4 h-4" /></button>
          <button className="p-1.5 hover:bg-muted rounded transition-colors" title="Refresh" onClick={() => loadData()}><RefreshCw className="w-4 h-4" /></button>
          <button
            onClick={saveEntry}
            disabled={saving || !canEdit}
            className="flex items-center gap-2 bg-sn-green text-sn-dark px-4 py-2 rounded font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Save className="w-4 h-4" /> Save & Return
          </button>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <History className="w-4 h-4" />
            <select className="bg-transparent border-none outline-none text-sm cursor-pointer">
              <option>History</option>
            </select>
          </div>
          <button className="p-1.5 hover:bg-muted rounded transition-colors" title="Delete"><Trash2 className="w-4 h-4 text-red-500" /></button>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[timesheet?.status] || STATUS_COLORS.Draft}`}>
            {timesheet?.status || "Draft"}
          </span>
          {canEdit && (
            <button onClick={submitTimesheet} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded font-semibold text-sm hover:bg-blue-700 transition-colors">
              <Send className="w-4 h-4" /> Submit
            </button>
          )}
        </div>
      </div>



      {/* ═══ OPEN TICKETS SECTION ═══ */}
      <Section title="Open Tickets" icon={<Ticket className="w-4 h-4" />} defaultOpen={true}>
        <div className="p-5">
          {ticketsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-sn-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : openTickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No open tickets
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {openTickets.map((ticket, idx) => {
                const incidentNumber = ticket.number || ticket.ticketNumber || `INC000${idx + 1}`;
                return (
                  <div
                    key={ticket.id}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    className="flex items-center gap-4 p-3 border border-border rounded-lg hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-sn-green/10 rounded-lg flex items-center justify-center">
                        <span className="text-[10px] font-bold text-sn-green">{incidentNumber.slice(0, 7)}</span>
                      </div>
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-sn-green">{incidentNumber}</span>
                        <span className="text-xs text-muted-foreground truncate">{ticket.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.category} · {ticket.status}
                        {ticket.assignedToName && ` · Assigned: ${ticket.assignedToName}`}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${ticket.priority?.includes("Critical") ? "bg-red-600 text-white" :
                          ticket.priority?.includes("High") ? "bg-red-100 text-red-700" :
                            ticket.priority?.includes("Moderate") ? "bg-orange-100 text-orange-700" :
                              "bg-blue-100 text-blue-700"
                        }`}>
                        {ticket.priority || "4 - Low"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* ═══ TIME DETAILS SECTION ═══ */}
      <Section
        title="Time Details"
        defaultOpen={true}
        headerRight={
          canEdit ? (
            <button
              onClick={(e) => { e.stopPropagation(); resetTimeFields(); setEditingCard(null); }}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide hover:bg-blue-700 transition-colors"
            >
              ADD ANOTHER TIME ENTRY
            </button>
          ) : null
        }
      >
        <div className="px-5 pt-0 pb-5">
          {/* Tabs */}
          <div className="flex border-b border-border mb-4">
            <button
              onClick={() => setActiveTab("time")}
              className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${activeTab === "time" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Time
            </button>
            <button
              onClick={() => setActiveTab("expenses")}
              className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${activeTab === "expenses" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Expenses
            </button>
          </div>

          {activeTab === "time" && (
            <div className="space-y-4">
              {/* Time Fields Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Start Time: <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type="text" value={startTime} 
                      onChange={e => {
                        setStartTime(e.target.value);
                        calculateDuration(e.target.value, endTime);
                      }}
                      placeholder="7:00 AM"
                      className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8 pr-8" />
                    <Clock className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">End Time:</label>
                  <div className="relative">
                    <input type="text" value={endTime} 
                      onChange={e => {
                        setEndTime(e.target.value);
                        calculateDuration(startTime, e.target.value);
                      }}
                      placeholder="5:00 PM"
                      className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8 pr-8" />
                    <Clock className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Actual Mins:</label>
                  <input type="text" value={actualHrs} onChange={e => setActualHrs(e.target.value)}
                    className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Work Type: <span className="text-red-500">*</span></label>
                  <select value={workType} onChange={e => setWorkType(e.target.value)}
                    className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8">
                    {WORK_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Billable: <span className="text-red-500">*</span></label>
                  <select value={billable} onChange={e => setBillable(e.target.value)}
                    className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8">
                    {BILLABLE_OPTIONS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              {/* Short Description */}
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Short Description:</label>
                <input type="text" value={shortDescription} onChange={e => setShortDescription(e.target.value)}
                  placeholder="Brief description of work done..."
                  className="w-full p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8" />
              </div>

              {/* Notes Editor */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-xs text-muted-foreground font-medium">Notes:</label>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div
                    ref={editorRef}
                    contentEditable={canEdit}
                    onInput={handleEditorInput}
                    className="min-h-[200px] p-3 text-sm outline-none focus:ring-1 focus:ring-inset focus:ring-sn-green bg-white"
                    data-placeholder="Enter notes..."
                    suppressContentEditableWarning
                  />
                  <RichTextToolbar 
                    editorRef={editorRef} 
                    onMicClick={() => speechControllerRef.current?.toggle()}
                    isListening={speechListening}
                    isSupported={speechSupported}
                  />
                  {speechListening && (
                    <div className="px-3 py-2 text-[10px] text-sn-green font-medium border-t border-border bg-white">
                      Listening{speechLiveText ? `: ${speechLiveText}` : "..."}
                    </div>
                  )}
                </div>
              </div>

              {/* Add Internal Time Note */}
              <button className="text-sm font-bold text-sn-dark hover:underline">
                Add Internal Time Note
              </button>

              {/* Existing Time Entries */}
              {activeTimer?.isRunning && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Clock className="w-5 h-5 text-blue-600 animate-pulse" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-blue-900">Timer Running</h4>
                        <p className="text-xs text-blue-700">
                          Incident: {activeTimer.ticketNumber} · Started: {new Date(activeTimer.startTime).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-blue-700">{formatTimeFromSeconds(liveElapsedTime)}</div>
                      <button
                        onClick={() => navigate(`/tickets/${activeTimer.ticketId}`)}
                        className="text-xs text-blue-600 hover:underline font-medium"
                      >
                        Go to incident →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {timeCards.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Saved Entries ({timeCards.length})</h4>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-muted/30 text-xs font-bold uppercase text-muted-foreground border-b border-border">
                          <th className="p-2">Date</th>
                          <th className="p-2">Start</th>
                          <th className="p-2">End</th>
                          <th className="p-2">Minutes</th>
                          <th className="p-2">Work Type</th>
                          <th className="p-2">Billable</th>
                          <th className="p-2">Notes</th>
                          <th className="p-2">Short Description</th>
                          <th className="p-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {timeCards.map(card => (
                          <tr key={card.id} className="border-b border-border hover:bg-muted/10 text-xs">
                            <td className="p-2">{card.entry_date}</td>
                            <td className="p-2">{card.start_time || "-"}</td>
                            <td className="p-2">{card.end_time || "-"}</td>
                            <td className="p-2 font-bold">
                              {card.elapsedSeconds ? formatTimeFromSeconds(card.elapsedSeconds) : `${(card.hours_worked || 0).toFixed(0)} mins`}
                            </td>
                            <td className="p-2">{card.work_type || card.task || "-"}</td>
                            <td className="p-2">{card.billable || "-"}</td>
                            <td className="p-2 max-w-[200px] truncate">{card.description || "-"}</td>
                            <td className="p-2 max-w-[200px] truncate">{card.short_description || "–"}</td>
                            <td className="p-2">
                              {canEdit && (
                                <div className="flex gap-1">
                                  <button onClick={() => loadCardForEdit(card)} className="p-1 hover:bg-muted rounded" title="Edit">
                                    <FileText className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => deleteEntry(card.id)} className="p-1 hover:bg-red-100 text-red-500 rounded" title="Delete">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "expenses" && (
            <div className="py-8 text-center text-muted-foreground text-sm italic">
              No expenses recorded for this timesheet.
            </div>
          )}
        </div>
      </Section>


      {/* ═══ SEND NOTES AS EMAIL ═══ */}
      <Section title="Send Notes as Email" icon={<Mail className="w-4 h-4 text-blue-600" />} defaultOpen={false}>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">From:</label>
            <div className="col-span-5 text-sm">{emailFrom}</div>
          </div>
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">Contact:</label>
            <div className="col-span-5 flex items-center gap-2">
              <input type="checkbox" checked={emailContact} onChange={e => setEmailContact(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded" />
              <span className="text-sm">{emailContactName || "N/A"}</span>
            </div>
          </div>
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">Resources:</label>
            <div className="col-span-5 flex items-center gap-2">
              <input type="checkbox" checked={emailResources} onChange={e => setEmailResources(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded" />
              <span className="text-sm">{profile?.name || ""}</span>
            </div>
          </div>
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">Cc:</label>
            <div className="col-span-5 flex items-center gap-2">
              <input type="checkbox" checked={emailCc} onChange={e => setEmailCc(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded" />
              <input 
                type="text"
                value={emailCcEmails}
                onChange={e => setEmailCcEmails(e.target.value)}
                placeholder="Separate emails with commas"
                className="flex-1 p-1 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-600 h-8"
              />
            </div>
          </div>
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">Bundled Tickets:</label>
            <div className="col-span-5 flex items-center gap-2">
              <input type="checkbox" checked={emailBundled} onChange={e => setEmailBundled(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded" />
            </div>
          </div>
          <div className="grid grid-cols-6 items-start gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1 mt-1">Attachments:</label>
            <div className="col-span-5 space-y-2">
              <div className="flex items-center gap-3">
                <input type="file" className="text-xs" />
                <span className="text-xs text-muted-foreground">or</span>
                <button
                  type="button"
                  onClick={() => pasteFromClipboard("email")}
                  className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-xs flex items-center gap-1 transition-colors"
                >
                  <Paperclip className="w-3 h-3" /> Paste from Clipboard
                </button>
              </div>
              {/* Clipboard preview */}
              {emailClipboard && (
                <div className="flex items-start gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  {emailClipboard.type === "image" ? (
                    <img src={emailClipboard.value} alt="Pasted" className="h-16 w-auto rounded border border-blue-200 object-contain bg-white" />
                  ) : (
                    <div className="flex-1 text-xs text-gray-700 bg-white border border-blue-200 rounded p-2 font-mono max-h-16 overflow-hidden">
                      {emailClipboard.label}
                    </div>
                  )}
                  <button
                    onClick={() => setEmailClipboard(null)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-base leading-none flex-shrink-0"
                    title="Remove"
                  >×</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSendEmail}
              className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded font-semibold text-sm hover:bg-blue-700 transition-colors"
            >
              <Mail className="w-4 h-4" /> Send Email
            </button>
          </div>
        </div>
      </Section>

      {/* ═══ SEND NOTES AS WHATSAPP ═══ */}
      <Section
        title="Send Notes as WhatsApp"
        icon={<MessageCircle className="w-4 h-4 text-[#25D366]" />}
        accentColor="text-[#25D366]"
        defaultOpen={false}
      >
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-6 items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1">To:</label>
            <div className="col-span-5 flex items-center gap-2">
              <select value={waCountryCode} onChange={e => setWaCountryCode(e.target.value)}
                className="p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8 w-20">
                <option value="+91">+91</option>
                <option value="+1">+1</option>
                <option value="+44">+44</option>
                <option value="+61">+61</option>
                <option value="+971">+971</option>
              </select>
              <input type="tel" value={waPhone} onChange={e => setWaPhone(e.target.value)}
                placeholder="Phone number"
                className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8" />
            </div>
          </div>
          <div className="grid grid-cols-6 items-start gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1 mt-2">Message:</label>
            <div className="col-span-5">
              <textarea
                value={waMessage}
                onChange={e => { setWaMessage(e.target.value); setWaAutoSync(false); }}
                rows={5}
                className="w-full p-2 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-sn-green resize-none"
                placeholder="Message will auto-populate from Notes..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                {waAutoSync ? "✓ Auto-synced with Notes" : "Manual mode — "}
                {!waAutoSync && (
                  <button onClick={() => { setWaAutoSync(true); setWaMessage(notesContent); }} className="text-blue-600 hover:underline">Re-sync</button>
                )}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-6 items-start gap-3">
            <label className="text-xs text-muted-foreground font-medium col-span-1 mt-1">Attachments:</label>
            <div className="col-span-5 space-y-2">
              <div className="flex items-center gap-3">
                <input type="file" className="text-xs" />
                <span className="text-xs text-muted-foreground">or</span>
                <button
                  type="button"
                  onClick={() => pasteFromClipboard("whatsapp")}
                  className="font-medium text-xs flex items-center gap-1 transition-colors hover:underline"
                  style={{ color: "#25D366" }}
                >
                  <Paperclip className="w-3 h-3" /> Paste from Clipboard
                </button>
              </div>
              {/* Clipboard preview */}
              {waClipboard && (
                <div className="flex items-start gap-2 p-2 rounded-lg border" style={{ background: "#f0fdf4", borderColor: "#86efac" }}>
                  {waClipboard.type === "image" ? (
                    <img src={waClipboard.value} alt="Pasted" className="h-16 w-auto rounded border object-contain bg-white" style={{ borderColor: "#86efac" }} />
                  ) : (
                    <div className="flex-1 text-xs text-gray-700 bg-white rounded p-2 font-mono max-h-16 overflow-hidden border" style={{ borderColor: "#86efac" }}>
                      {waClipboard.label}
                    </div>
                  )}
                  <button
                    onClick={() => setWaClipboard(null)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-base leading-none flex-shrink-0"
                    title="Remove"
                  >×</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSendWhatsApp}
              disabled={!waPhone}
              className="flex items-center gap-2 px-5 py-2.5 rounded font-semibold text-sm text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#25D366" }}
            >
              <MessageCircle className="w-4 h-4" /> Send WhatsApp
            </button>
          </div>
        </div>
      </Section>

      {/* ═══ MESSAGE HISTORY ═══ */}
      <Section
        title="Message History"
        icon={<History className="w-4 h-4 text-purple-600" />}
        accentColor="text-purple-600"
        defaultOpen={false}
        headerRight={
          <button
            onClick={(e) => { e.stopPropagation(); loadMessageHistory(); }}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        }
      >
        <div className="p-5">
          {msgHistoryLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : msgHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No messages sent yet. Send an Email or WhatsApp message to see history here.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {msgHistory.map((item) => {
                const isWA = item.message_type === "whatsapp";
                const sentAt = new Date(item.sent_at);
                return (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-white hover:bg-muted/10 transition-colors">
                    {/* Icon */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm
                      ${isWA ? "bg-[#25D366]/10" : "bg-blue-50"}`}>
                      {isWA
                        ? <MessageCircle className="w-4 h-4 text-[#25D366]" />
                        : <Mail className="w-4 h-4 text-blue-500" />}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs font-bold uppercase tracking-wide
                          ${isWA ? "text-[#25D366]" : "text-blue-600"}`}>
                          {isWA ? "WhatsApp" : "Email"}
                        </span>
                        {item.recipient && (
                          <span className="text-xs text-muted-foreground">→ {item.recipient}</span>
                        )}
                      </div>
                      {item.message_content && (
                        <p className="text-xs text-gray-600 truncate max-w-xl">{item.message_content}</p>
                      )}
                    </div>
                    {/* Timestamp */}
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[10px] text-muted-foreground">
                        {sentAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {sentAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* ═══ QUICK STATS FOOTER ═══ */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Week Total", value: `${weekTotal.toFixed(0)} mins`, color: "text-sn-dark" },
          { label: "Daily Average", value: `${(weekTotal / 7).toFixed(0)} mins`, color: "text-blue-600" },
          { label: "Entries", value: timeCards.length, color: "text-purple-600" },
          { label: "Status", value: timesheet?.status || "Draft", color: timesheet?.status === "Approved" ? "text-green-600" : timesheet?.status === "Rejected" ? "text-red-600" : "text-gray-700" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground uppercase font-bold tracking-wide">{s.label}</div>
            <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
