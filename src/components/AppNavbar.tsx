import React from "react";
import { Bell, Search, User, Sun, Moon, Monitor, Play, Square } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useActivityTracker } from "../contexts/ActivityTrackerContext";

function fmtHMS(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function formatTimeAgo(dateString: string) {
  if (!dateString) return 'some time ago';
  try {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 0) return 'just now';
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } catch (e) {
    return 'some time ago';
  }
}

export function AppNavbar() {
  const { user, profile } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { status, elapsed, startWatcher, stopWatcher } = useActivityTracker();
  const [notificationCount, setNotificationCount] = React.useState(0);
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const isActive = status === 'active';

  React.useEffect(() => {
    const uid = user?.uid || profile?.uid;
    if (!uid) return;

    let disposed = false;

    // Load initial count and notifications list
    const loadData = async () => {
      try {
        // Count
        const countRes = await fetch(`/api/notifications/unread-count?user_id=${encodeURIComponent(uid)}`);
        if (countRes.ok) {
          const countData = await countRes.json();
          if (!disposed) setNotificationCount(Number(countData.count || 0));
        }

        // List
        const listRes = await fetch(`/api/notifications/list?user_id=${encodeURIComponent(uid)}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          if (!disposed) setNotifications(listData);
        }
      } catch (err) {
        console.error("Failed to load notifications:", err);
      }
    };

    loadData();

    // Establish SSE stream for real-time notifications
    const eventSource = new EventSource(`/api/notifications/stream?user_id=${encodeURIComponent(uid)}`);

    eventSource.onmessage = (event) => {
      try {
        const notif = JSON.parse(event.data);
        if (disposed) return;
        
        // Add to notifications list
        setNotifications(prev => [notif, ...prev.slice(0, 49)]);
        
        // Increment unread count
        setNotificationCount(prev => prev + 1);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("SSE connection error, closing EventSource:", err);
      eventSource.close();
    };

    return () => {
      disposed = true;
      eventSource.close();
    };
  }, [user?.uid, profile?.uid]);

  // Click outside to close dropdown
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleToggleOpen = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen) {
      const uid = user?.uid || profile?.uid;
      if (!uid) return;

      // Mark all as read
      try {
        await fetch("/api/notifications/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: uid })
        });
        
        setNotificationCount(0);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      } catch (err) {
        console.error("Failed to mark notifications as read:", err);
      }
    }
  };

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

        {/* Notifications Bell with beautiful interactive dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleToggleOpen}
            className="relative text-muted-foreground hover:text-foreground transition-colors p-1"
            title={notificationCount > 0 ? `${notificationCount} unread notifications` : "Notifications"}
          >
            <Bell className="w-5 h-5" />
            {notificationCount > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-destructive text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            ) : null}
          </button>
          
          {isOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-200">
              {/* Header */}
              <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-sn-dark to-gray-800 text-white flex items-center justify-between">
                <span className="font-bold text-sm">Notifications</span>
                {notifications.length > 0 && (
                  <span className="text-[10px] text-sn-green bg-sn-green/10 px-2 py-0.5 rounded-full font-bold">
                    {notifications.filter(n => !n.is_read).length} Unread
                  </span>
                )}
              </div>

              {/* List */}
              <div className="max-h-96 overflow-y-auto divide-y divide-border custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-xs">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map(notif => {
                    const initials = (notif.actor_name || "S")[0].toUpperCase();
                    const timeAgo = formatTimeAgo(notif.created_at);
                    const isUnread = !notif.is_read;

                    return (
                      <div 
                        key={notif.id} 
                        className={`p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors ${
                          isUnread ? 'bg-sn-green/5' : ''
                        }`}
                      >
                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-full bg-sn-dark text-sn-green text-xs font-bold flex items-center justify-center flex-shrink-0 border border-sn-green/20">
                          {initials}
                        </div>

                        {/* Content */}
                        <div className="flex-grow min-w-0">
                          <p className="text-xs text-foreground font-medium leading-relaxed break-words">
                            {notif.message}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {notif.ticket_number && (
                              <a 
                                href={`/tickets/${notif.ticket_id}`}
                                className="text-[9.5px] font-mono font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded hover:underline"
                              >
                                {notif.ticket_number}
                              </a>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {timeAgo}
                            </span>
                          </div>
                        </div>

                        {/* Unread indicator dot */}
                        {isUnread && (
                          <span className="w-2 h-2 bg-destructive rounded-full flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        
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
