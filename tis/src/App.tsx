import React, { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { TicketsProvider } from "./contexts/TicketsContext";
import { BrandingProvider } from "./contexts/BrandingContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ActivityTrackerProvider } from "./contexts/ActivityTrackerContext";
import { Sidebar } from "./components/Sidebar";
import { AppNavbar } from "./components/AppNavbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AIChatbot } from "./components/AIChatbot";
import { seedInitialData } from "./lib/seed";
import { useEffect } from "react";
import { ROLE_HIERARCHY, Role } from "./lib/roles";

// Lazy loaded components
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Tickets = lazy(() => import("./pages/Tickets").then(m => ({ default: m.Tickets })));
const TicketDetail = lazy(() => import("./pages/TicketDetail").then(m => ({ default: m.TicketDetail })));
const GlobalHistory = lazy(() => import("./pages/GlobalHistory").then(m => ({ default: m.GlobalHistory })));
const SLAManagement = lazy(() => import("./pages/SLAManagement").then(m => ({ default: m.SLAManagement })));
const Approvals = lazy(() => import("./pages/Approvals").then(m => ({ default: m.Approvals })));
const Users = lazy(() => import("./pages/Users").then(m => ({ default: m.Users })));
const Reports = lazy(() => import("./pages/Reports").then(m => ({ default: m.Reports })));
const Settings = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })));
const ServiceCatalog = lazy(() => import("./pages/ServiceCatalog").then(m => ({ default: m.ServiceCatalog })));
const CMDB = lazy(() => import("./pages/CMDB").then(m => ({ default: m.CMDB })));
const Conversations = lazy(() => import("./pages/Conversations").then(m => ({ default: m.Conversations })));
const ProblemManagement = lazy(() => import("./pages/ProblemManagement").then(m => ({ default: m.ProblemManagement })));
const ChangeManagement = lazy(() => import("./pages/ChangeManagement").then(m => ({ default: m.ChangeManagement })));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase").then(m => ({ default: m.KnowledgeBase })));
const ServicePortal = lazy(() => import("./pages/ServicePortal").then(m => ({ default: m.ServicePortal })));
const Login = lazy(() => import("./pages/Login").then(m => ({ default: m.Login })));
const Register = lazy(() => import("./pages/Register").then(m => ({ default: m.Register })));
const Timesheet = lazy(() => import("./pages/Timesheet").then(m => ({ default: m.Timesheet })));
const TimesheetWeekly = lazy(() => import("./pages/TimesheetWeekly").then(m => ({ default: m.TimesheetWeekly })));
const TimesheetReports = lazy(() => import("./pages/TimesheetReports").then(m => ({ default: m.TimesheetReports })));
const Calendar = lazy(() => import("./pages/Calendar").then(m => ({ default: m.Calendar })));
const AccessControl = lazy(() => import("./pages/AccessControl").then(m => ({ default: m.AccessControl })));
const Leaderboard = lazy(() => import("./pages/Leaderboard").then(m => ({ default: m.Leaderboard })));
const ApprovedTickets = lazy(() => import("./pages/ApprovedTickets").then(m => ({ default: m.ApprovedTickets })));
const Companies = lazy(() => import("./pages/Companies").then(m => ({ default: m.Companies })));
const TimesheetApprovals = lazy(() => import("./pages/TimesheetApprovals").then(m => ({ default: m.TimesheetApprovals })));
const Groups = lazy(() => import("./pages/Groups").then(m => ({ default: m.Groups })));
const ClearUsers = lazy(() => import("./pages/ClearUsers").then(m => ({ default: m.ClearUsers })));
const BrandingSettings = lazy(() => import("./pages/BrandingSettings").then(m => ({ default: m.BrandingSettings })));
const ActivityTracker = lazy(() => import("./pages/ActivityTracker").then(m => ({ default: m.ActivityTracker })));
const CustomDropdownManager = lazy(() => import("./pages/CustomDropdownManager").then(m => ({ default: m.CustomDropdownManager })));
const EmailIntegrations = lazy(() => import("./pages/EmailIntegrations").then(m => ({ default: m.EmailIntegrations })));


function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sn-dark">
      <div className="w-12 h-12 border-4 border-sn-green border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!user) return <Navigate to="/login" />;

  const isAgent = profile?.role === "agent" || profile?.role === "admin" || profile?.role === "super_admin" || profile?.role === "ultra_super_admin";

  return (
    <TicketsProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-grow flex flex-col overflow-hidden">
          <AppNavbar />
          <main className="flex-grow p-8 overflow-y-auto">
            <ErrorBoundary>
              <Suspense fallback={<LoadingScreen />}>
                {children}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        <AIChatbot />
      </div>
    </TicketsProvider>
  );
}

function HomeRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;

  const isAgent = ROLE_HIERARCHY[profile?.role as Role] >= ROLE_HIERARCHY["agent"];
  return isAgent ? <Dashboard /> : <ServicePortal />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppBody />
    </AuthProvider>
  );
}

function AppBody() {
  const { user } = useAuth();

  // Demo data seeding removed for production
  return (
    <ThemeProvider>
      <BrandingProvider>
        <ActivityTrackerProvider>
          <Router>
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomeRedirect />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <ProtectedRoute>
                <Tickets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <ProtectedRoute>
                <TicketDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <GlobalHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sla"
            element={
              <ProtectedRoute>
                <SLAManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/approvals"
            element={
              <ProtectedRoute>
                <Approvals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <Users />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet"
            element={
              <ProtectedRoute>
                <Timesheet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet/:weekStart"
            element={
              <ProtectedRoute>
                <Timesheet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet/weekly"
            element={
              <ProtectedRoute>
                <TimesheetWeekly />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet/reports"
            element={
              <ProtectedRoute>
                <TimesheetReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/catalog"
            element={
              <ProtectedRoute>
                <ServiceCatalog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cmdb"
            element={
              <ProtectedRoute>
                <CMDB />
              </ProtectedRoute>
            }
          />
          <Route
            path="/conversations"
            element={
              <ProtectedRoute>
                <Conversations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/problem"
            element={
              <ProtectedRoute>
                <ProblemManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/change"
            element={
              <ProtectedRoute>
                <ChangeManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kb"
            element={
              <ProtectedRoute>
                <KnowledgeBase />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet/approvals"
            element={
              <ProtectedRoute>
                <TimesheetApprovals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <Calendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/access-control"
            element={
              <ProtectedRoute>
                <AccessControl />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <ProtectedRoute>
                <Leaderboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/approved-tickets"
            element={
              <ProtectedRoute>
                <ApprovedTickets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/companies"
            element={
              <ProtectedRoute>
                <Companies />
              </ProtectedRoute>
            }
          />
          <Route
            path="/companies/:id"
            element={
              <ProtectedRoute>
                <Companies />
              </ProtectedRoute>
            }
          />
          <Route
            path="/timesheet-approvals"
            element={
              <ProtectedRoute>
                <TimesheetApprovals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups"
            element={
              <ProtectedRoute>
                <Groups />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clear-users"
            element={
              <ProtectedRoute>
                <ClearUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/branding"
            element={
              <ProtectedRoute>
                <BrandingSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity-tracker"
            element={
              <ProtectedRoute>
                <ActivityTracker />
              </ProtectedRoute>
            }
          />
          <Route
            path="/custom-dropdowns"
            element={
              <ProtectedRoute>
                <CustomDropdownManager />
              </ProtectedRoute>
            }
          />
          <Route
            path="/email-integrations"
            element={
              <ProtectedRoute>
                <EmailIntegrations />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" />} />

          </Routes>
        </Suspense>
          </Router>
        </ActivityTrackerProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}

