import React from "react";
import { Bell, Search, User, Sun, Moon, Monitor, Play, Square } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useActivityTracker } from "../contexts/ActivityTrackerContext";

function fmtHMS(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

export function AppNavbar() {
  const { user, profile } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { status, elapsed, startWatcher, stopWatcher } = useActivityTracker();
  const [notificationCount, setNotificationCount] = React.useState(0);

  const isActive = status === 'active';

  React.useEffect(() => {
    const uid = user?.uid || profile?.uid;
    if (!uid) return;

    let disposed = false;

    const loadCount = async () => {
      try {
        const res = await fetch(`/api/notifications/unread-count?user_id=${encodeURIComponent(uid)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!disposed) {
          setNotificationCount(Number(data.count || 0));
        }
      } catch {
        // keep navbar quiet if notifications are unavailable
      }
    };

    loadCount();
    const timer = setInterval(loadCount, 30000);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [user?.uid, profile?.uid]);

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-8 sticky top-0 z-10">
      <div className="flex items-center gap-4 bg-muted/50 px-4 py-2 rounded-md w-96">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search tickets, users..." 
          className="bg-transparent border-none outline-none text-sm w-full"
        />
      </div>

      <div className="flex items-center gap-4">

        {/* ── Global AI Activity Tracker Toggle ── */}
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all duration-300 ${
          isActive
            ? 'bg-green-50 border-green-300 shadow-sm shadow-green-100'
            : 'bg-muted/40 border-border'
        }`}>
          {isActive && (
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse inline-block flex-shrink-0" />
          )}
          {isActive && (
            <span className="font-mono text-xs font-bold text-green-700 tabular-nums min-w-[3.5rem]">
              {fmtHMS(elapsed)}
            </span>
          )}
          {!isActive ? (
            <button
              id="global-ai-tracker-start"
              onClick={() => startWatcher()}
              title="Start AI Activity Tracker"
              className="flex items-center gap-1.5 text-xs font-semibold text-green-700 hover:text-green-800 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-green-600 text-green-600" />
              <span className="hidden sm:inline">Start Tracker</span>
            </button>
          ) : (
            <button
              id="global-ai-tracker-stop"
              onClick={() => stopWatcher()}
              title="Stop AI Activity Tracker"
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-red-500 text-red-500" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          )}
        </div>

        {/* Theme Toggle */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          <button
            onClick={() => setTheme("light")}
            className={`p-1.5 rounded-md transition-colors ${theme === "light" ? "bg-white shadow-sm text-sn-green" : "text-muted-foreground hover:text-foreground"}`}
            title="Light mode"
          >
            <Sun className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={`p-1.5 rounded-md transition-colors ${theme === "dark" ? "bg-white shadow-sm text-sn-green" : "text-muted-foreground hover:text-foreground"}`}
            title="Dark mode"
          >
            <Moon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTheme("system")}
            className={`p-1.5 rounded-md transition-colors ${theme === "system" ? "bg-white shadow-sm text-sn-green" : "text-muted-foreground hover:text-foreground"}`}
            title="System preference"
          >
            <Monitor className="w-4 h-4" />
          </button>
        </div>

        <button
          className="relative text-muted-foreground hover:text-foreground transition-colors"
          title={notificationCount > 0 ? `${notificationCount} unread notifications` : "Notifications"}
        >
          <Bell className="w-5 h-5" />
          {notificationCount > 0 ? (
            <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 bg-destructive text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          ) : (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full opacity-60" />
          )}
        </button>
        
        <div className="flex items-center gap-3 pl-6 border-l border-border">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold">{profile?.name || "User"}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{profile?.role || "Guest"}</div>
          </div>
          <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
            <User className="w-6 h-6 text-muted-foreground" />
          </div>
        </div>
      </div>
    </header>
  );
}
