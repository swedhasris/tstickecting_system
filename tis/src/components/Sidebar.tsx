import React, { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Ticket,
  Users,
  Settings,
  LogOut,
  CheckSquare,
  BarChart3,
  History,
  Clock,
  Search,
  ChevronRight,
  ChevronDown,
  PlusCircle,
  UserCheck,
  FolderOpen,
  UserMinus,
  CheckCircle2,
  List,
  Map,
  Settings2,
  ChevronLeft,
  Menu,
  Sun,
  Moon,
  ShoppingCart,
  Database,
  AlertOctagon,
  GitPullRequest,
  BookOpen,
  HelpCircle,
  BarChart2,
  ClipboardList,
  CalendarDays,
  Trophy,
  Building2,
  KeyRound,
  Monitor,
  Tag,
  Mail,
} from "lucide-react";

import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { useTickets } from "../contexts/TicketsContext";
import { useBranding } from "../contexts/BrandingContext";
import { useTheme } from "../contexts/ThemeContext";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Palette } from "lucide-react";

interface MenuItem {
  icon?: any;
  label: string;
  path?: string;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  ultraSuperAdminOnly?: boolean;
  items?: MenuItem[];
  badge?: number;
}

export function Sidebar() {
  const { user, profile, signOut } = useAuth();
  const { openTicketsCount, assignedToMeCount } = useTickets();
  const { branding } = useBranding();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const isDarkMode = resolvedTheme === "dark";
  const [expandedSections, setExpandedSections] = useState<string[]>(() => {
    const saved = localStorage.getItem("sn-sidebar-expanded");
    return saved ? JSON.parse(saved) : ["Favorites", "Incident"];
  });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    localStorage.setItem("sn-sidebar-expanded", JSON.stringify(expandedSections));
  }, [expandedSections]);

  const menuStructure: MenuItem[] = [
    {
      label: "Favorites",
      items: [
        { icon: LayoutDashboard, label: profile?.role === 'user' ? "Service Portal" : "Incident Dashboard", path: "/" },
        { icon: Trophy, label: "Leaderboard", path: "/leaderboard" },
        { icon: CalendarDays, label: "Calendar", path: "/calendar" },
        { icon: Ticket, label: "My Tickets", path: "/timesheet" },
        { icon: BarChart2, label: "Timesheet Reports", path: "/timesheet/reports" },
        { icon: Monitor, label: "AI Activity Tracker", path: "/activity-tracker" },
      ]
    },
    {
      label: "Companies",
      ultraSuperAdminOnly: true,
      items: [
        { icon: Building2, label: "Companies", path: "/companies" },
      ]
    },
    {
      label: "Service Desk",
      items: [
        { icon: ShoppingCart, label: "Service Catalog", path: "/catalog" },
        { icon: BookOpen, label: "Knowledge Base", path: "/kb" },
        { icon: Clock, label: "SLA Policies", path: "/sla" },
        { icon: History, label: "System Activity Log", path: "/history" },
      ]
    },
    {
      label: "Incident",
      items: [
        { icon: PlusCircle, label: "Create New Incident", path: "/tickets?action=new" },
        { icon: UserCheck, label: "Assigned to Me", path: "/tickets?filter=assigned_to_me", badge: assignedToMeCount },
        { icon: FolderOpen, label: "Open Incidents", path: "/tickets?filter=open", badge: openTicketsCount },
        { icon: UserMinus, label: "Open - Unassigned", path: "/tickets?filter=unassigned" },
        { icon: CheckCircle2, label: "Resolved Incidents", path: "/tickets?filter=resolved" },
        { icon: List, label: "All Incidents", path: "/tickets" },
        { icon: Map, label: "Critical Incidents Map", path: "/reports" },
      ]
    },
    {
      label: "Problem & Change",
      items: [
        { icon: AlertOctagon, label: "Problem Management", path: "/problem" },
        { icon: GitPullRequest, label: "Change Management", path: "/change" },
      ]
    },
    {
      label: "System Administration",
      adminOnly: true,
      items: [
        { icon: Users, label: "User Management", path: "/users" },
        { icon: KeyRound, label: "Access Control", path: "/access-control" },
        { icon: Users, label: "Group Management", path: "/groups" },
        { icon: Settings2, label: "System Settings", path: "/settings" },
        { icon: CheckCircle2, label: "Approved Tickets", path: "/approved-tickets" },
        { icon: ClipboardList, label: "Ticket Approvals", path: "/timesheet/approvals" },
        { icon: CheckCircle2, label: "Approved Timesheets", path: "/timesheet/reports?status=Approved" },
        { icon: Palette, label: "Branding", path: "/branding", superAdminOnly: true },
        { icon: Tag, label: "Custom Form Dropdowns", path: "/custom-dropdowns" },
        { icon: Mail, label: "Email Integrations", path: "/email-integrations", ultraSuperAdminOnly: true },
      ]

    }
  ];

  const toggleSection = (label: string) => {
    setExpandedSections(prev =>
      prev.includes(label) ? prev.filter(s => s !== label) : [...prev, label]
    );
  };

  const hasAccess = (item: MenuItem) => {
    if (item.ultraSuperAdminOnly) return profile?.role === "ultra_super_admin";
    if (item.superAdminOnly) return profile?.role === "super_admin" || profile?.role === "ultra_super_admin";
    if (item.adminOnly) return profile?.role === "admin" || profile?.role === "super_admin" || profile?.role === "ultra_super_admin";
    return true;
  };

  const filterItems = (items: MenuItem[]): MenuItem[] => {
    return items
      .filter(item => hasAccess(item))
      .map(item => {
        if (item.items) {
          const filteredSubItems = filterItems(item.items);
          if (filteredSubItems.length > 0 || item.label.toLowerCase().includes(searchQuery.toLowerCase())) {
            return { ...item, items: filteredSubItems };
          }
        } else if (item.label.toLowerCase().includes(searchQuery.toLowerCase())) {
          return item;
        }
        return null;
      })
      .filter(Boolean) as MenuItem[];
  };

  const filteredMenu = filterItems(menuStructure);


  return (
    <aside className={cn(
      "bg-sn-sidebar text-white flex flex-col h-screen sticky top-0 transition-all duration-300 border-r border-white/10",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Sidebar Header */}
      <div className="p-4 flex items-center justify-between border-b border-white/10 h-16">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            {branding.logoBase64 ? (
              <img
                src={branding.logoBase64}
                alt="Logo"
                className="w-8 h-8 rounded object-cover"
              />
            ) : (
              <div className="w-8 h-8 bg-sn-green rounded flex items-center justify-center font-bold text-sn-dark">
                {branding.companyName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-xl font-bold tracking-tight">{branding.companyName}</span>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors"
        >
          {isCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Filter Navigator */}
      {!isCollapsed && (
        <div className="p-4">
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-dim group-focus-within:text-sn-green transition-colors" />
            <input
              type="text"
              placeholder="Filter navigator"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-sn-green focus:bg-white/10 transition-all"
            />
          </div>
        </div>
      )}

      {/* Navigation Menu */}
      <nav className="flex-grow overflow-y-auto overflow-x-hidden custom-scrollbar py-2">
        {filteredMenu.map((section) => (
          <div key={section.label} className="mb-1">
            {!isCollapsed && (
              <button
                onClick={() => toggleSection(section.label)}
                className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-text-dim hover:text-white transition-colors group"
              >
                <span>{section.label}</span>
                {expandedSections.includes(section.label) ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            )}

            {(expandedSections.includes(section.label) || isCollapsed || searchQuery) && (
              <div className="space-y-0.5">
                {section.items?.map((item) => (
                  <Link
                    key={item.label}
                    to={item.path || "#"}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 transition-all relative group",
                      location.pathname === item.path
                        ? "bg-sn-green/10 text-sn-green border-r-2 border-sn-green"
                        : "text-text-dim hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <item.icon className={cn(
                      "w-4 h-4 shrink-0",
                      location.pathname === item.path ? "text-sn-green" : "text-text-dim group-hover:text-white"
                    )} />
                    {!isCollapsed && <span className="text-sm truncate flex-grow">{item.label}</span>}
                    {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                      <span className="bg-sn-green text-sn-dark text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                        {item.badge}
                      </span>
                    )}

                    {isCollapsed && (
                      <div className="absolute left-16 bg-sn-sidebar border border-white/10 px-3 py-2 rounded shadow-xl text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                        {item.label}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <button
          onClick={() => setTheme(isDarkMode ? "light" : "dark")}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 w-full text-text-dim hover:text-white transition-colors rounded hover:bg-white/5",
            isCollapsed && "justify-center px-0"
          )}
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {!isCollapsed && <span className="text-sm">{isDarkMode ? "Light Mode" : "Dark Mode"}</span>}
        </button>
        <button
          onClick={() => signOut()}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 w-full text-text-dim hover:text-white transition-colors rounded hover:bg-white/5",
            isCollapsed && "justify-center px-0"
          )}
        >
          <LogOut className="w-4 h-4" />
          {!isCollapsed && <span className="text-sm">Logout</span>}
        </button>
      </div>
    </aside>
  );
}


