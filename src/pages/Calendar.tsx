import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Copy, RefreshCw, HelpCircle,
  Clock, CalendarDays, User, Settings, X, Save, Trash2, FileText,
  Printer, ChevronDown
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Link } from "react-router-dom";

/* ─── Timezone list ─── */
const TIMEZONES = [
  { label: "UTC-12", offset: -12 },
  { label: "UTC-11", offset: -11 },
  { label: "UTC-10", offset: -10 },
  { label: "UTC-09", offset: -9 },
  { label: "UTC-08", offset: -8 },
  { label: "UTC-07", offset: -7 },
  { label: "UTC-06", offset: -6 },
  { label: "UTC-05", offset: -5 },
  { label: "UTC-04", offset: -4 },
  { label: "UTC-03", offset: -3 },
  { label: "UTC-02", offset: -2 },
  { label: "UTC-01", offset: -1 },
  { label: "UTC+00", offset: 0 },
  { label: "UTC+01", offset: 1 },
  { label: "UTC+02", offset: 2 },
  { label: "UTC+03", offset: 3 },
  { label: "UTC+04", offset: 4 },
  { label: "UTC+05", offset: 5 },
  { label: "UTC+05:30", offset: 5.5 },
  { label: "UTC+06", offset: 6 },
  { label: "UTC+07", offset: 7 },
  { label: "UTC+08", offset: 8 },
  { label: "UTC+09", offset: 9 },
  { label: "UTC+10", offset: 10 },
  { label: "UTC+11", offset: 11 },
  { label: "UTC+12", offset: 12 },
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
function formatDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return "—";
  return d.toISOString().split("T")[0];
}

function parseTimeToHour(timeStr: string): number | null {
  if (!timeStr) return null;
  // Handle "7:07 AM", "14:30", "2:30 PM"
  const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = parseInt(match12[2]);
    const period = match12[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h + m / 60;
  }
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1]) + parseInt(match24[2]) / 60;
  }
  return null;
}

// Status/priority colors for event left border
const EVENT_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function getEventColor(index: number): string {
  return EVENT_COLORS[index % EVENT_COLORS.length];
}

/* ─── HOUR_LABELS: 6am to 8pm ─── */
const HOUR_START = 6;
const HOUR_END = 20;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => {
  const h = HOUR_START + i;
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
});
const HOUR_HEIGHT = 60; // px per hour row

/* ════════════════════════════════════════ MAIN ════════════════════════════════════════ */
export function Calendar() {
  const { user, profile } = useAuth();

  /* ── State ── */
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [timesheets, setTimesheets] = useState<any[]>([]);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"week" | "day" | "month">("week");
  const [capacityPerDay, setCapacityPerDay] = useState(480);
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [capacityInput, setCapacityInput] = useState("480");
  const [selectedTimezone, setSelectedTimezone] = useState(() => {
    const localOffset = -(new Date().getTimezoneOffset() / 60);
    const found = TIMEZONES.find(tz => tz.offset === localOffset);
    return found ? found.label : "UTC+05:30";
  });

  // Display/refresh options state
  const [displayType, setDisplayType] = useState<"overlay" | "calendar_only">("overlay");
  const [viewDetails, setViewDetails] = useState<"calendar_only" | "with_details">("calendar_only");
  const [refreshInterval, setRefreshInterval] = useState<number>(0);

  // User lists for admin calendar viewing
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  // Side panel for editing
  const [editPanel, setEditPanel] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    startTime: "", endTime: "", minutesWorked: "", workType: "Remote",
    billable: "Billable", description: "", task: "", shortDescription: ""
  });
  const [editSaving, setEditSaving] = useState(false);

  const [showAddDropdown, setShowAddDropdown] = useState(false);

  /* ── Week/Day/Month calculations ── */
  const weekDays = useMemo(() => {
    if (viewMode === "day") {
      const d = new Date(currentDate);
      return [{
        date: formatDate(d),
        dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
        shortDate: d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" }),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isToday: formatDate(d) === formatDate(new Date()),
      }];
    }

    if (viewMode === "week") {
      const mon = getMonday(currentDate);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon.getTime() + i * 86400000);
        return {
          date: formatDate(d),
          dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
          shortDate: d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" }),
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
          isToday: formatDate(d) === formatDate(new Date()),
        };
      });
    }

    // viewMode === "month"
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return {
        date: formatDate(d),
        dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
        shortDate: d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" }),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isToday: formatDate(d) === formatDate(new Date()),
      };
    });
  }, [currentDate, viewMode]);

  const weekStart = weekDays[0]?.date || formatDate(new Date());
  const weekEnd = weekDays[weekDays.length - 1]?.date || formatDate(new Date());

  /* ── Timezone offset for display ── */
  const tzOffset = useMemo(() => {
    const tz = TIMEZONES.find(t => t.label === selectedTimezone);
    const localOffset = -(new Date().getTimezoneOffset() / 60);
    return (tz?.offset ?? localOffset) - localOffset;
  }, [selectedTimezone]);

  function applyTzOffset(hourDecimal: number): number {
    return hourDecimal + tzOffset;
  }

  /* ── Fetch all users if admin/sub-admin ── */
  useEffect(() => {
    if (!user) return;
    const role = profile?.role || 'user';
    const hasAdminAccess = role === 'admin' || role === 'sub_admin' || role === 'super_admin' || role === 'ultra_super_admin';
    if (hasAdminAccess) {
      fetch("/api/users")
        .then(r => r.json())
        .then(list => setUsers(Array.isArray(list) ? list : []))
        .catch(e => console.error("Error loading users list:", e));
    }
  }, [user, profile]);

  const selectedUserProfile = useMemo(() => {
    if (!selectedUserId) return profile;
    return users.find(u => u.uid === selectedUserId) || profile;
  }, [selectedUserId, users, profile]);

  /* ── Load data ── */
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const targetUserId = selectedUserId || user.uid;
      // Fetch timesheets for user
      const tsRes = await fetch(`/api/timesheets?user_id=${targetUserId}`);
      const tsList = await tsRes.json();
      setTimesheets(tsList);

      if (tsList.length === 0) {
        setTimeCards([]);
        setLoading(false);
        return;
      }

      // Get all time cards for the current range
      const tcRes = await fetch(`/api/time-cards?user_id=${targetUserId}&start_date=${weekStart}&end_date=${weekEnd}`);
      const allCards = await tcRes.json();
      setTimeCards(Array.isArray(allCards) ? allCards : []);
    } catch (e) {
      console.error("Error loading calendar data:", e);
      setTimeCards([]);
    } finally {
      setLoading(false);
    }
  }, [user, weekStart, weekEnd, selectedUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadData]);

  // Handle auto refresh interval
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const intervalId = setInterval(() => {
      loadData();
    }, refreshInterval);
    return () => clearInterval(intervalId);
  }, [refreshInterval, loadData]);

  /* ── Filter cards for current week ── */
  const weekCards = useMemo(() => {
    if (!Array.isArray(timeCards)) return [];
    return timeCards.filter(c => {
      const d = c.entry_date;
      return d >= weekStart && d <= weekEnd;
    });
  }, [timeCards, weekStart, weekEnd]);

  /* ── Per-day stats ── */
  const dayStats = useMemo(() => {
    const stats: Record<string, { logged: number; cards: any[] }> = {};
    weekDays.forEach(day => { stats[day.date] = { logged: 0, cards: [] }; });
    weekCards.forEach(card => {
      if (stats[card.entry_date]) {
        stats[card.entry_date].logged += parseFloat(card.hours_worked) || 0;
        stats[card.entry_date].cards.push(card);
      }
    });
    return stats;
  }, [weekCards, weekDays]);

  const totalMinutes = weekCards.reduce((s, c) => s + (parseFloat(c.hours_worked) || 0), 0);

  /* ── Capacity bar color ── */
  function capacityColor(logged: number): string {
    const pct = capacityPerDay > 0 ? logged / capacityPerDay : 0;
    if (logged === 0) return "bg-gray-200";
    if (pct > 1) return "bg-blue-500";
    if (pct >= 0.9) return "bg-green-500";
    return "bg-green-400";
  }
  function capacityTextColor(logged: number): string {
    const pct = capacityPerDay > 0 ? logged / capacityPerDay : 0;
    if (pct > 1) return "text-white bg-blue-500";
    if (pct >= 0.9) return "text-white bg-green-500";
    if (logged === 0) return "text-gray-500 bg-gray-200";
    return "text-white bg-green-400";
  }

  /* ── Position events on grid ── */
  function getEventStyle(card: any): React.CSSProperties | null {
    const startH = parseTimeToHour(card.start_time);
    if (startH === null) return null;
    const endH = parseTimeToHour(card.end_time);
    const adjusted = applyTzOffset(startH);
    const top = (adjusted - HOUR_START) * HOUR_HEIGHT;
    const duration = endH !== null ? Math.max(endH - startH, 0.5) : (parseFloat(card.hours_worked) / 60 || 1);
    const height = Math.max(duration * HOUR_HEIGHT, 24);
    return { top: `${top}px`, height: `${height}px` };
  }

  /* ── Group overlapping events in sub-columns ── */
  function layoutEventsForDay(cards: any[]): { card: any; col: number; totalCols: number; style: React.CSSProperties }[] {
    const timed = cards
      .map(c => ({ card: c, style: getEventStyle(c) }))
      .filter(e => e.style !== null) as { card: any; style: React.CSSProperties }[];

    if (timed.length === 0) return [];

    // Sort by top position
    timed.sort((a, b) => parseFloat(a.style.top as string) - parseFloat(b.style.top as string));

    // Assign columns
    const result: { card: any; col: number; totalCols: number; style: React.CSSProperties }[] = [];
    const columns: { end: number }[] = [];

    timed.forEach(({ card, style }) => {
      const top = parseFloat(style.top as string);
      const height = parseFloat(style.height as string);
      const end = top + height;

      let col = columns.findIndex(c => c.end <= top);
      if (col === -1) {
        col = columns.length;
        columns.push({ end });
      }
      columns[col].end = end;
      result.push({ card, col, totalCols: 0, style });
    });

    const totalCols = columns.length;
    result.forEach(r => r.totalCols = totalCols);
    return result;
  }

  /* ── To-do entries (no time assigned) ── */
  function getTodoEntries(dayDate: string): any[] {
    const cards = dayStats[dayDate]?.cards || [];
    return cards.filter(c => !c.start_time || parseTimeToHour(c.start_time) === null);
  }

  /* ── Edit panel ── */
  function openEditPanel(card: any) {
    setEditPanel(card);
    setEditForm({
      startTime: card.start_time || "",
      endTime: card.end_time || "",
      minutesWorked: String(card.hours_worked || ""),
      workType: card.work_type || card.task || "Remote",
      billable: card.billable || "Billable",
      description: card.description || "",
      task: card.task || "",
      shortDescription: card.short_description || "",
    });
  }

  async function saveEditPanel() {
    if (!editPanel || !user) return;
    setEditSaving(true);
    try {
      const targetUserId = selectedUserId || user.uid;
      if (editPanel.id) {
        await fetch(`/api/time-cards/${editPanel.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_time: editForm.startTime,
            end_time: editForm.endTime,
            hours_worked: parseFloat(editForm.minutesWorked) || 0,
            work_type: editForm.workType,
            billable: editForm.billable,
            description: editForm.description,
            short_description: editForm.shortDescription,
            task: editForm.task,
          })
        });
      } else {
        // Create new time card
        // 1. Get or create timesheet for target user and this entry date's week
        const entryD = new Date(editPanel.entry_date);
        const entryMon = getMonday(entryD);
        const entryMonStr = formatDate(entryMon);
        const entrySun = new Date(entryMon.getTime() + 6 * 86400000);
        const entrySunStr = formatDate(entrySun);

        const tsRes = await fetch("/api/timesheets/get-or-create", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: targetUserId,
            week_start: entryMonStr,
            week_end: entrySunStr
          })
        });
        const ts = await tsRes.json();

        // 2. Post new card
        await fetch("/api/time-cards", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timesheet_id: ts.id,
            user_id: targetUserId,
            entry_date: editPanel.entry_date,
            start_time: editForm.startTime,
            end_time: editForm.endTime,
            hours_worked: parseFloat(editForm.minutesWorked) || 0,
            work_type: editForm.workType,
            billable: editForm.billable,
            description: editForm.description,
            short_description: editForm.shortDescription,
            task: editForm.task,
          })
        });
      }

      setEditPanel(null);
      loadData();
    } catch (e) { console.error(e); }
    setEditSaving(false);
  }

  async function deleteFromPanel() {
    if (!editPanel || !confirm("Delete this entry?")) return;
    try {
      await fetch(`/api/time-cards/${editPanel.id}`, { method: 'DELETE' });
      setEditPanel(null);
      loadData();
    } catch (e) { console.error(e); }
  }

  /* ── Capacity editing ── */
  function saveCapacity() {
    const val = parseFloat(capacityInput);
    if (!isNaN(val) && val > 0) setCapacityPerDay(val);
    setEditingCapacity(false);
  }

  /* ── Navigate ── */
  const goPrevious = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === "day") {
        d.setDate(d.getDate() - 1);
      } else if (viewMode === "week") {
        d.setDate(d.getDate() - 7);
      } else if (viewMode === "month") {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
  };

  const goNext = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === "day") {
        d.setDate(d.getDate() + 1);
      } else if (viewMode === "week") {
        d.setDate(d.getDate() + 7);
      } else if (viewMode === "month") {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
  };

  const goToday = () => {
    setCurrentDate(new Date());
  };

  const defaultEntryDate = useMemo(() => {
    const todayStr = formatDate(new Date());
    if (todayStr >= weekStart && todayStr <= weekEnd) {
      return todayStr;
    }
    return weekStart;
  }, [weekStart, weekEnd]);

  const handleAddNewEntry = () => {
    openEditPanel({ entry_date: defaultEntryDate });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-sn-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-0 max-w-full">
      {/* ═══ PAGE HEADER ═══ */}
      <div className="bg-white border-b border-border px-4 py-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-sn-dark">Calendar</h1>
            <p className="text-xs text-muted-foreground">
              My {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}ly Calendar View For {selectedUserProfile?.name || profile?.name || "User"},{" "}
              {weekStart === "—" ? "—" : (
                weekStart === weekEnd ? (
                  new Date(weekStart).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                ) : (
                  `${new Date(weekStart).toLocaleDateString("en-US", { month: "long", day: "numeric" })} - ${weekEnd === "—" ? "—" : new Date(weekEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                )
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ TOOLBAR ═══ */}
      <div className="bg-white border-b border-border px-4 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={handleAddNewEntry} className="p-1.5 hover:bg-muted rounded transition-colors"><Plus className="w-4 h-4" /></button>
          
          <div className="relative">
            <button 
              onClick={() => setShowAddDropdown(!showAddDropdown)}
              className="p-1.5 hover:bg-muted rounded transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            {showAddDropdown && (
              <div className="absolute left-0 mt-1 w-36 bg-white border border-border rounded shadow-lg py-1 z-50">
                <button
                  onClick={() => {
                    handleAddNewEntry();
                    setShowAddDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors font-medium text-foreground"
                >
                  New Time Entry
                </button>
                <button
                  onClick={() => {
                    openEditPanel({ entry_date: defaultEntryDate, start_time: "", end_time: "" });
                    setShowAddDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors font-medium text-foreground"
                >
                  New To-Do Item
                </button>
              </div>
            )}
          </div>

          <button onClick={loadData} className="p-1.5 hover:bg-muted rounded transition-colors"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => window.print()} className="p-1.5 hover:bg-muted rounded transition-colors"><Printer className="w-4 h-4" /></button>
          
          <select 
            value={displayType}
            onChange={e => setDisplayType(e.target.value as any)}
            className="text-xs border border-border rounded px-2 py-1 bg-white outline-none"
          >
            <option value="overlay">Display Type: Time with Schedule Overlay</option>
            <option value="calendar_only">Display Type: Calendar Only</option>
          </select>
          
          <Link
            to={`/timesheet/${weekStart}`}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide hover:bg-blue-700 transition-colors"
          >
            OPEN TIME SHEET
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={viewDetails}
            onChange={e => setViewDetails(e.target.value as any)}
            className="text-xs border border-border rounded px-2 py-1 bg-white outline-none"
          >
            <option value="calendar_only">View: Calendar Only</option>
            <option value="with_details">View: With Details</option>
          </select>
          
          <select 
            value={refreshInterval}
            onChange={e => setRefreshInterval(Number(e.target.value))}
            className="text-xs border border-border rounded px-2 py-1 bg-white outline-none"
          >
            <option value={0}>Refresh: None</option>
            <option value={30000}>Refresh: 30s</option>
            <option value={60000}>Refresh: 60s</option>
          </select>
          
          <button className="p-1.5 hover:bg-muted rounded transition-colors"><HelpCircle className="w-4 h-4 text-muted-foreground" /></button>
        </div>
      </div>

      {/* ═══ DATE NAVIGATOR ═══ */}
      <div className="bg-white border-b border-border px-4 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={goPrevious} className="p-1 hover:bg-muted rounded"><ChevronLeft className="w-4 h-4" /></button>
          <div className="flex items-center gap-1 text-sm font-medium">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            {weekStart === "—" ? "—" : (
              weekStart === weekEnd ? (
                new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              ) : (
                `${new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${weekEnd === "—" ? "—" : new Date(weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              )
            )}
          </div>
          <button onClick={goNext} className="p-1 hover:bg-muted rounded"><ChevronRight className="w-4 h-4" /></button>

          <button onClick={goToday} className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full hover:bg-blue-700 transition-colors ml-2">
            TODAY
          </button>

          <div className="flex items-center gap-1 ml-3 text-sm">
            <User className="w-4 h-4 text-muted-foreground" />
            {users.length > 0 ? (
              <select
                value={selectedUserId || user?.uid}
                onChange={e => setSelectedUserId(e.target.value)}
                className="bg-transparent border-none outline-none text-sm cursor-pointer font-medium"
              >
                {users.map(u => (
                  <option key={u.uid} value={u.uid}>{u.name || u.email || u.uid}</option>
                ))}
              </select>
            ) : (
              <span>{profile?.name || "User"}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${viewMode === v ? "bg-sn-dark text-white" : "bg-muted hover:bg-muted/80 text-foreground"}`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ INFO BANNER ═══ */}
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 flex items-center gap-2 text-xs text-blue-700">
        <Clock className="w-3.5 h-3.5" />
        Calendar is in Time Entry mode, now editing time entries. Total minutes: <strong>{totalMinutes.toFixed(0)}</strong>
      </div>

      {/* ═══ CAPACITY EDITOR (small popover) ═══ */}
      {editingCapacity && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center gap-3 text-sm">
          <Settings className="w-4 h-4 text-yellow-600" />
          <span className="font-medium">Daily Capacity:</span>
          <input
            type="number" step="15" min="0" max="1440"
            value={capacityInput}
            onChange={e => setCapacityInput(e.target.value)}
            className="w-20 p-1 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green"
          />
          <span className="text-xs text-muted-foreground">minutes/day</span>
          <button onClick={saveCapacity} className="text-xs font-bold text-blue-600 hover:underline">Save</button>
          <button onClick={() => setEditingCapacity(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
        </div>
      )}

      {/* ═══ CALENDAR GRID ═══ */}
      <div className="flex overflow-x-auto bg-white">
        {/* Timezone / Hour Column */}
        <div className="flex-shrink-0 w-16 border-r border-border">
          {/* TZ header */}
          <div className="h-[72px] border-b border-border flex flex-col items-center justify-center text-xs">
            <select
              value={selectedTimezone}
              onChange={e => setSelectedTimezone(e.target.value)}
              className="text-[10px] font-bold bg-transparent border-none outline-none cursor-pointer text-center w-full"
            >
              {TIMEZONES.map(tz => (
                <option key={tz.label} value={tz.label}>{tz.label}</option>
              ))}
            </select>
            <button
              onClick={() => { setCapacityInput(String(capacityPerDay)); setEditingCapacity(true); }}
              className="text-[9px] text-muted-foreground hover:text-blue-600 cursor-pointer mt-0.5"
              title="Edit daily capacity"
            >
              Capacity
            </button>
          </div>
          {/* Hour labels */}
          {displayType === "overlay" && HOURS.map(h => (
            <div key={h} className="border-b border-border flex items-start justify-end pr-2 pt-1 text-[10px] text-muted-foreground font-medium" style={{ height: `${HOUR_HEIGHT}px` }}>
              {h}
            </div>
          ))}
          {/* To-Do label */}
          <div className="border-b border-border flex items-center justify-end pr-2 text-[10px] text-muted-foreground font-medium h-16">
            To-Do
          </div>
        </div>

        {/* Day Columns */}
        {weekDays.map((day, dayIdx) => {
          const stats = dayStats[day.date] || { logged: 0, cards: [] };
          const utilPct = capacityPerDay > 0 ? Math.round((stats.logged / capacityPerDay) * 100) : 0;
          const remaining = Math.max(0, capacityPerDay - stats.logged);
          const overtime = Math.max(0, stats.logged - capacityPerDay);
          const events = layoutEventsForDay(stats.cards);
          const todoEntries = getTodoEntries(day.date);

          return (
            <div
              key={day.date}
              className={`flex-1 min-w-[120px] border-r border-border ${day.isWeekend ? "bg-gray-50" : ""} ${day.isToday ? "bg-sn-green/5" : ""}`}
            >
              {/* Day Header */}
              <div className="border-b border-border text-center py-1">
                <div className={`text-xs font-bold ${day.isToday ? "text-sn-green" : "text-foreground"}`}>
                  {day.dayName} {day.shortDate}
                </div>
                {/* Capacity bar */}
                <div
                  className={`mx-1 mt-1 rounded-sm text-[9px] font-bold px-1 py-0.5 flex items-center justify-between ${capacityTextColor(stats.logged)}`}
                  style={{ minHeight: "18px" }}
                >
                  <span>{stats.logged.toFixed(0)}/{capacityPerDay.toFixed(0)}</span>
                  <span>{utilPct}%</span>
                  <span>{overtime > 0 ? `+${overtime.toFixed(0)}` : remaining.toFixed(0)}</span>
                </div>
              </div>

              {/* Hour Grid with Events */}
              <div className={displayType === "overlay" ? "relative" : "p-1 space-y-1"}>
                {/* Background hour lines */}
                {displayType === "overlay" && HOURS.map(h => (
                  <div key={h} className="border-b border-border/50" style={{ height: `${HOUR_HEIGHT}px` }} />
                ))}

                {/* Event blocks */}
                {events.map(({ card, col, totalCols, style }, idx) => {
                  const width = displayType === "overlay" ? (totalCols > 1 ? `${100 / totalCols}%` : "100%") : "100%";
                  const left = displayType === "overlay" ? (totalCols > 1 ? `${(col / totalCols) * 100}%` : "0") : "0";
                  const borderColor = getEventColor(idx);

                  return (
                    <div
                      key={card.id}
                      className={displayType === "overlay" ? "absolute px-0.5 cursor-pointer group" : "cursor-pointer group"}
                      style={displayType === "overlay" ? { ...style, width, left, zIndex: 10 + col } : {}}
                      onClick={() => openEditPanel(card)}
                    >
                      <div
                        className="rounded-sm border border-border bg-white shadow-sm overflow-hidden flex hover:shadow-md transition-shadow py-1 min-h-[36px]"
                        style={{ borderLeft: `3px solid ${borderColor}` }}
                      >
                        <div className="flex-grow px-1.5 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-[10px] font-bold truncate">({card.hours_worked}m) {card.short_description || card.task || card.work_type || "Entry"}</span>
                          </div>
                          {viewDetails === "with_details" && card.description && (
                            <div className="text-[9px] text-muted-foreground truncate mt-0.5">{card.description}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* To-Do Row */}
              <div className="border-b border-border h-16 p-1 space-y-0.5 overflow-y-auto">
                {todoEntries.map((card, idx) => (
                  <div
                    key={card.id}
                    className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[9px] cursor-pointer hover:bg-muted/30 truncate flex items-center gap-1"
                    style={{ borderLeft: `3px solid ${getEventColor(idx)}` }}
                    onClick={() => openEditPanel(card)}
                  >
                    <Clock className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium truncate">{card.short_description || card.task || card.work_type || "Entry"}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ EDIT SIDE PANEL ═══ */}
      {editPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setEditPanel(null)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right">
            {/* Panel Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm">{editPanel.id ? "Edit Time Entry" : "New Time Entry"}</h3>
              </div>
              <button onClick={() => setEditPanel(null)} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
            </div>

            {/* Panel Body */}
            <div className="flex-grow overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Date</label>
                <input readOnly value={editPanel.entry_date} className="w-full p-1.5 bg-muted/20 border border-border rounded text-xs h-8" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Start Time</label>
                  <input value={editForm.startTime} onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green" placeholder="7:00 AM" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">End Time</label>
                  <input value={editForm.endTime} onChange={e => setEditForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green" placeholder="5:00 PM" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Minutes Worked</label>
                <input type="number" step="5" value={editForm.minutesWorked} onChange={e => setEditForm(f => ({ ...f, minutesWorked: e.target.value }))}
                  className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Task / Work Type</label>
                <input value={editForm.task} onChange={e => setEditForm(f => ({ ...f, task: e.target.value }))}
                  className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Short Description</label>
                <input value={editForm.shortDescription} onChange={e => setEditForm(f => ({ ...f, shortDescription: e.target.value }))}
                  placeholder="Brief description of work done..."
                  className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Billable</label>
                <select value={editForm.billable} onChange={e => setEditForm(f => ({ ...f, billable: e.target.value }))}
                  className="w-full p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green">
                  <option>Billable</option>
                  <option>Non-Billable</option>
                  <option>Internal</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1">Description</label>
                <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  rows={4} className="w-full p-2 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green resize-none" />
              </div>
            </div>

            {/* Panel Footer */}
            <div className="p-4 border-t border-border flex items-center justify-between bg-muted/10">
              <button 
                onClick={deleteFromPanel} 
                disabled={!editPanel.id}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditPanel(null)} className="px-3 py-1.5 border border-border rounded text-xs hover:bg-muted transition-colors">Cancel</button>
                <button onClick={saveEditPanel} disabled={editSaving}
                  className="flex items-center gap-1 bg-sn-green text-sn-dark px-4 py-1.5 rounded text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity">
                  <Save className="w-3.5 h-3.5" /> {editSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
