import React, { useEffect, useRef, useState } from "react";
import { collection, addDoc, query, onSnapshot, updateDoc, doc, serverTimestamp, orderBy, where, deleteDoc, getDocs } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { ROLE_HIERARCHY, Role } from "../lib/roles";
import { Plus, Filter, MoreVertical, Search, Edit, Trash2, Users, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { useServiceCatalog } from "../lib/serviceCatalog";
import { calculateSLADeadline } from "../lib/slaUtils";
import { createSpeechController } from "../lib/speechToEnglish";

import { Link, useSearchParams } from "react-router-dom";
import { IT_SERVICE_CATALOG } from "../lib/itServiceCatalogDefaults";

const FeatureContext = React.createContext<{ getFp: (id: string) => any }>({
  getFp: () => ({ canView: true, canUse: true, canEdit: true, isMandatory: false })
});

const FeatureGuard = ({ id, children }: { id: string, children: React.ReactNode }) => {
  const { getFp } = React.useContext(FeatureContext);
  const p = getFp(id);
  if (!p.canView) return null;
  return (
    <div 
      className={cn(
        "feature-guard-container",
        !p.canUse && "feature-disabled",
        !p.canEdit && "feature-readonly"
      )}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
};

function toMs(val: any): number {
  if (!val) return NaN;
  if (typeof val === 'object' && val.seconds !== undefined) return val.seconds * 1000 + (val.nanoseconds || 0) / 1_000_000;
  if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') return val;
  return new Date(val).getTime();
}

import { SLATimer } from "../components/SLATimer";

export function Tickets() {
  const { user, profile } = useAuth();
  const { categories, subcategories, serviceProviders, groups, members } = useServiceCatalog();
  const [searchParams] = useSearchParams();
  const filter = searchParams.get("filter");
  const action = searchParams.get("action");

  const [tickets, setTickets] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
  const [emailConfigs, setEmailConfigs] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [callerSearch, setCallerSearch] = useState("");
  const [affectedSearch, setAffectedSearch] = useState("");
  const [showCallerResults, setShowCallerResults] = useState(false);
  const [showAffectedResults, setShowAffectedResults] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewNumber, setPreviewNumber] = useState("");

  const closeModal = () => {
    speechControllerRef.current?.stop();
    setSpeechLiveText("");
    setIsModalOpen(false);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [suggestedSolution, setSuggestedSolution] = useState<string | null>(null);
  const [speechLiveText, setSpeechLiveText] = useState("");
  const [speechListening, setSpeechListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const speechControllerRef = useRef<ReturnType<typeof createSpeechController> | null>(null);
  // Holds the description text that existed BEFORE the mic was clicked,
  // so speech text is appended rather than replacing what the user typed.
  const speechDescBaseRef = useRef("");

  useEffect(() => {
    if (action === "new") {
      openModal();
    }
  }, [action]);

  useEffect(() => {
    const controller = createSpeechController({
      onInterim: (text) => {
        setSpeechLiveText(text);
        // Show live preview: base text + interim (don't permanently set yet)
        setNewTicket(prev => ({
          ...prev,
          description: speechDescBaseRef.current
            ? speechDescBaseRef.current + " " + text
            : text
        }));
      },
      onFinal: (text) => {
        setSpeechLiveText("");
        // Append final translated text to whatever was there before
        const combined = speechDescBaseRef.current
          ? speechDescBaseRef.current + " " + text
          : text;
        speechDescBaseRef.current = combined;
        setNewTicket(prev => ({ ...prev, description: combined }));
      },
      onStateChange: (listening) => {
        setSpeechListening(listening);
        if (listening) {
          // Snapshot current description as the base when mic starts
          setNewTicket(prev => {
            speechDescBaseRef.current = prev.description || "";
            return prev;
          });
        } else {
          setSpeechLiveText("");
        }
      },
      onError: (message) => {
        setSpeechListening(false);
        // Non-blocking toast instead of alert
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "position:fixed;top:16px;right:16px;z-index:9999;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:360px;";
        errDiv.textContent = "🎤 " + message;
        document.body.appendChild(errDiv);
        setTimeout(() => { try { document.body.removeChild(errDiv); } catch (_) {} }, 5000);
      }
    });

    speechControllerRef.current = controller;
    setSpeechSupported(controller.supported);

    return () => {
      controller.stop();
    };
  }, []);

  const [newTicket, setNewTicket] = useState({
    caller: profile?.name || user?.email || "",
    category: "",
    categoryId: "",
    subcategory: "",
    subcategoryId: "",
    service: "",
    serviceId: "",
    serviceProvider: "",
    serviceOffering: "",
    title: "",
    description: "",
    channel: "Self-service",
    impact: "2 - Medium",
    urgency: "2 - Medium",
    assignmentGroup: "",
    assignedTo: "",
    businessPhone: "",
    location: "",
    configurationItem: "",
    computerName: "",
    knowledgeArticleUsed: false,
    originalAssignmentGroup: "",
    acknowledged: false,
    passwordReset: "No",
    rackspaceTicketNo: "",
    additionalInformation: "",
    affectedUser: "",
    watchList: "",
    company: ""
  });

  const [assignedTo, setAssignedTo] = useState("");


  // ── Custom Dropdowns: loaded from server, filtered by company ──
  const [customDropdowns, setCustomDropdowns] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [featurePermissions, setFeaturePermissions] = useState<any[]>([]);

  useEffect(() => {
    const companyId = searchParams.get("companyId") || newTicket.company || "";
    fetch(`/api/custom-dropdowns/active${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`, {
      method: 'GET',
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setCustomDropdowns(Array.isArray(data) ? data : []))
      .catch(() => setCustomDropdowns([]));

    fetch('/api/email-configs')
      .then(r => r.ok ? r.json() : [])
      .then(data => setEmailConfigs(data))
      .catch(() => setEmailConfigs([]));

    if (companyId) {

      fetch(`/api/feature-permissions?company_id=${encodeURIComponent(companyId)}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setFeaturePermissions(Array.isArray(data) ? data : []))
        .catch(() => setFeaturePermissions([]));
    } else {
      setFeaturePermissions([]);
    }
  }, [newTicket.company, searchParams]);

  const getFp = (id: string) => {
    return featurePermissions.find(f => f.featureId === id) || { canView: true, canUse: true, canEdit: true, isMandatory: false };
  };

  const getFpProps = (id: string) => {
    const p = getFp(id);
    return {
      "data-feature-id": id,
      "data-mandatory": p.isMandatory ? "true" : "false"
    };
  };

  // Reset custom field values when modal opens

  // Reset custom field values when modal opens
  const openModal = () => {
    speechControllerRef.current?.stop();
    setSpeechLiveText("");
    setPreviewNumber(`INC${Math.floor(1000000 + Math.random() * 9000000)}`);
    const companyId = searchParams.get("companyId");
    setNewTicket(prev => ({
      ...prev,
      caller: profile?.name || user?.email || "",
      company: companyId || ""
    }));
    setCallerSearch(profile?.name || user?.email || "");
    setCustomFieldValues({});
    setIsModalOpen(true);
  };
  // INDEPENDENT DROPDOWNS (Realistic Catalog)
  const selectedCategoryData = IT_SERVICE_CATALOG.find(c => c.category === newTicket.category);
  const realisticSubcategories = selectedCategoryData?.subcategories || [];
  const selectedSubcategoryData = realisticSubcategories.find(s => s.name === newTicket.subcategory);
  const realisticServices = selectedSubcategoryData?.services || [];

  const visibleGroups = groups.filter(g => g.status === 'active');
  const displayGroups = visibleGroups;

  // DYNAMIC GROUP FILTERING (Requirement: Only users belonging to the selected group)
  const selectedGroupObj = groups.find(g => g.name === newTicket.assignmentGroup);
  const visibleMembers = allUsers.filter(u =>
    selectedGroupObj?.memberIds?.includes(u.id)
  );

  // Realistic Catalog initialization handled via state defaults

  // Removed auto-reset logic for subcategories/providers/groups to maintain independence

  useEffect(() => {
    const q = query(collection(db, "sla_policies"), where("isActive", "==", true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSlaPolicies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "sla_policies");
    });
    return unsubscribe;
  }, []);

  const [companies, setCompanies] = useState<any[]>([]);
  useEffect(() => {
    const q = query(collection(db, "companies"), orderBy("name"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCompanies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !profile) return;

    const ticketsRef = collection(db, "tickets");

    // All users (including regular users) see all open tickets
    let q = query(ticketsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ticketsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTickets(ticketsData);
    }, (error) => {
      console.error("Firestore Error in Tickets List:", error);
      // We don't throw here to avoid crashing the UI, but we log the error
    });

    return unsubscribe;
  }, [user, profile]);

  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllUsers(usersList);
      setAgents(usersList.filter((u: any) => u.role === "agent" || u.role === "admin" || u.role === "super_admin" || u.role === "ultra_super_admin"));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "users");
    });
    return unsubscribe;
  }, []);

  const formatDateTime = (date: any) => {
    if (!date) return "-";
    if (typeof date.toDate === "function") {
      return date.toDate().toISOString();
    }
    if (typeof date === "string") {
      return date;
    }
    if (date.seconds) {
      return new Date(date.seconds * 1000).toISOString();
    }
    return undefined;
  };

  const [columnFilters, setColumnFilters] = useState({
    number: "",
    title: "",
    caller: "",
    priority: "",
    status: "",
    category: "",
    assignmentGroup: "",
    assignedTo: ""
  });

  const filteredTickets = tickets.filter(t => {
    // Top-level quick filters
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;

    const getTs = (tick: any) => {
      const c = tick.createdAt;
      if (!c) return 0;
      if (c?.seconds) return c.seconds * 1000;
      if (typeof c === "string") return new Date(c).getTime();
      return 0;
    };

    if (filter === "assigned_to_me" && t.assignedTo !== user?.uid && t.assignedTo !== profile?.name && t.assignedToName !== profile?.name) return false;
    if (filter === "open" && (t.status === "Resolved" || t.status === "Closed" || t.status === "Canceled")) return false;
    if (filter === "unassigned" && t.assignedTo) return false;
    if (filter === "resolved" && t.status !== "Resolved" && t.status !== "Closed") return false;
    if (filter === "critical_open" && (t.status === "Resolved" || t.status === "Closed" || t.status === "Canceled" || !t.priority?.includes("Critical"))) return false;
    if (filter === "overdue" && (t.status === "Resolved" || t.status === "Closed" || t.status === "Canceled" || !t.resolutionDeadline || new Date(t.resolutionDeadline).getTime() > now)) return false;
    if (filter === "stale_7" && (t.status === "Resolved" || t.status === "Closed" || t.status === "Canceled" || getTs(t) >= sevenDaysAgo)) return false;
    if (filter === "older_30" && (t.status === "Resolved" || t.status === "Closed" || t.status === "Canceled" || getTs(t) >= thirtyDaysAgo)) return false;

    // Column-level search filters (case-insensitive)
    const matches = (val: string, filterVal: string) => !filterVal || (val || "").toLowerCase().includes(filterVal.toLowerCase());

    return (
      matches(t.number, columnFilters.number) &&
      matches(t.title, columnFilters.title) &&
      matches(t.caller, columnFilters.caller) &&
      matches(t.priority, columnFilters.priority) &&
      matches(t.status, columnFilters.status) &&
      matches(t.category, columnFilters.category) &&
      matches(t.assignmentGroup, columnFilters.assignmentGroup) &&
      matches(agents.find(a => a.id === t.assignedTo)?.name || t.assignedToName || t.assignedTo || "", columnFilters.assignedTo)
    );
  });

  const calculatePriority = (impact: string, urgency: string) => {
    const i = parseInt(impact[0]);
    const u = parseInt(urgency[0]);
    const sum = i + u;
    if (sum <= 2) return "1 - Critical";
    if (sum === 3) return "2 - High";
    if (sum === 4) return "3 - Moderate";
    return "4 - Low";
  };

  const handleAIAssist = async () => {
    const shortDesc = newTicket.title;
    if (!shortDesc) {
      alert("Please enter a Short Description first, then click Autofill with AI.");
      return;
    }

    setIsAiLoading(true);
    setSuggestedSolution(null);

    try {
      // Run classify + description generation in parallel using our server endpoints
      const [classifyRes, suggestRes] = await Promise.all([
        fetch('/api/ai/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: shortDesc }),
        }),
        fetch('/api/ai/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: shortDesc }),
        }),
      ]);

      const classData = await classifyRes.json();
      const suggestData = await suggestRes.json();

      if (!classifyRes.ok) throw new Error(classData.error || "Classification failed");
      if (!suggestRes.ok) throw new Error(suggestData.error || "Suggestion failed");

      setNewTicket(prev => ({
        ...prev,
        category: classData.category || prev.category,
        impact: classData.priority === 'Critical' || classData.priority === 'High' ? '1 - High' : classData.priority === 'Medium' ? '2 - Medium' : '3 - Low',
        urgency: classData.priority === 'Critical' || classData.priority === 'High' ? '1 - High' : classData.priority === 'Medium' ? '2 - Medium' : '3 - Low',
        description: suggestData.suggestion || prev.description,
      }));

      if (suggestData.suggestion) {
        setSuggestedSolution(suggestData.suggestion);
      }
    } catch (e) {
      console.error(e);
      alert("AI autofill failed. Please fill in the description manually.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!user) {
      alert("You must be logged in to create a ticket.");
      return;
    }

    // Required fields check (respecting dynamic feature permissions)
    const req = (id: string, value: any) => {
      const p = getFp(id);
      if (!p.canView || !p.canUse) return true; // skip if hidden or disabled
      if (!p.isMandatory) return true; // if not mandatory, it's valid even if empty
      return !!value;
    };

    if (!req('caller', newTicket.caller) || 
        !req('short_description', newTicket.title)) {
      alert("Please fill in all visible required fields (Reporting User, Short description).");
      return;
    }

    // Validate custom fields
    for (const dd of customDropdowns) {
      if (!req(dd.id, customFieldValues[dd.name])) {
        alert(`Please fill in the mandatory field: ${dd.label}`);
        return;
      }
    }

    setIsSubmitting(true);
    console.log("Submitting new ticket:", newTicket);

    try {
      let priority = calculatePriority(newTicket.impact, newTicket.urgency);

      // Find matching SLA policy (Prioritize Department + Priority + Category, then Department + Priority, then Priority)
      const matchingPolicy = slaPolicies.find(p => p.priority === priority && p.department === newTicket.assignmentGroup && p.category === newTicket.category)
        || slaPolicies.find(p => p.priority === priority && p.department === newTicket.assignmentGroup)
        || slaPolicies.find(p => p.priority === priority && (p.category === newTicket.category || !p.category))
        || slaPolicies.find(p => p.priority === priority)
        || { responseTimeHours: 4, resolutionTimeHours: 24 }; // Fallback

      const now = new Date();
      const responseDeadline = calculateSLADeadline(now, (matchingPolicy.responseTimeHours || 4), {
        businessHours: matchingPolicy.businessHours,
        excludeWeekends: matchingPolicy.excludeWeekends,
        excludeHolidays: matchingPolicy.excludeHolidays
      });
      // Resolution deadline is null initially as it doesn't start until first response
      const resolutionDeadline = new Date(now.getTime() + ((matchingPolicy.responseTimeHours || 4) + (matchingPolicy.resolutionTimeHours || 24)) * 60 * 60 * 1000);

      const ticketNumber = `INC${Math.floor(1000000 + Math.random() * 9000000)}`;

      // Immediate Breach Check (SLA Engine simulation for creation)
      let responseSlaStatus = "In Progress";
      let resolutionSlaStatus = "In Progress";

      if (responseDeadline.getTime() <= now.getTime()) {
        priority = "1 - Critical";
        responseSlaStatus = "Breached";
      }

      // Workflow Automation: Auto-assignment based on category
      const assignmentGroup = newTicket.assignmentGroup || visibleGroups[0]?.name || "Service Desk";

      // Determine assigned user name if applicable (fix: check both id and userId fields)
      const assignedUserName = newTicket.assignedTo
        ? visibleMembers.find(m => m.id === newTicket.assignedTo)?.name
        || visibleMembers.find(m => m.id === newTicket.assignedTo)?.userName
        || visibleMembers.find(m => m.userId === newTicket.assignedTo)?.userName
        || agents.find(a => a.id === newTicket.assignedTo)?.name
        || allUsers.find(u => u.id === newTicket.assignedTo)?.name
        || ""
        : "";

      const ticketData = {
        ...newTicket,
        customFields: customFieldValues,
        number: ticketNumber,
        assignmentGroup,
        assignedToName: assignedUserName,
        priority,
        status: newTicket.assignedTo ? "Assigned" : "New",
        createdBy: user.uid,
        company_id: newTicket.company || null,
        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp(),
        responseDeadline: responseDeadline.toISOString(),
        resolutionDeadline: null,
        responseSlaStartTime: now.toISOString(),
        resolutionSlaStartTime: null,
        responseSlaStatus,
        resolutionSlaStatus: "Pending",
        slaResolutionHours: matchingPolicy.resolutionTimeHours || 24,
        totalPausedTime: 0,
        history: [{ action: "Ticket Created (Response SLA Started)", timestamp: now.toISOString(), user: profile?.name || user.email }]
      };

      console.log("Final ticket data payload:", ticketData);

      const docRef = await addDoc(collection(db, "tickets"), ticketData);
      console.log("Ticket created successfully with ID:", docRef.id);

      // Log creation to activity timeline (Unified Activity Stream)
      try {
        await fetch(`/api/tickets/${docRef.id}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activity_type: 'system',
            visibility_type: 'public',
            created_by: user.uid,
            created_by_name: profile?.name || user.email,
            message: `Ticket Created by ${profile?.name || user.email}`,
            metadata_json: {
              priority,
              category: newTicket.category,
              assignmentGroup,
              status: ticketData.status,
              shortDescription: newTicket.title
            }
          })
        });
      } catch (e) {
        console.error("Failed to log creation activity:", e);
      }

      closeModal();
      alert(`Ticket ${ticketNumber} has been created successfully.`);

      setNewTicket({
        caller: "",
        category: "Inquiry / Help",
        categoryId: "",
        subcategory: "",
        subcategoryId: "",
        service: "",
        serviceId: "",
        serviceProvider: "",
        serviceOffering: "",
        title: "",
        description: "",
        channel: "Self-service",
        impact: "2 - Medium",
        urgency: "2 - Medium",
        assignmentGroup: "",
        assignedTo: "",
        businessPhone: "",
        location: "",
        configurationItem: "",
        computerName: "",
        knowledgeArticleUsed: false,
        originalAssignmentGroup: "",
        acknowledged: false,
        passwordReset: "No",
        rackspaceTicketNo: "",
        additionalInformation: "",
        affectedUser: "",
        watchList: "",
        company: ""
      });
      setSpeechLiveText("");
    } catch (error: any) {
      console.error("CRITICAL: Error creating ticket:", error);
      alert(`Failed to create ticket: ${error.message || "Unknown error"}. Please check your connection and try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (ticketId: string, newStatus: string) => {
    const ticketRef = doc(db, "tickets", ticketId);
    const ticket = tickets.find(t => t.id === ticketId);
    await updateDoc(ticketRef, {
      status: newStatus,
      updatedAt: serverTimestamp(),
      history: [
        ...(ticket?.history || []),
        { action: `Status updated to ${newStatus}`, timestamp: new Date().toISOString(), user: profile?.name || user?.email }
      ]
    });
  };

  const updateAssignment = async (ticketId: string, agentId: string) => {
    const ticketRef = doc(db, "tickets", ticketId);
    const ticket = tickets.find(t => t.id === ticketId);
    const agent = agents.find(a => a.id === agentId);
    await updateDoc(ticketRef, {
      assignedTo: agentId,
      assignedToName: agent?.name || "",
      status: agentId ? "Assigned" : "New",
      updatedAt: serverTimestamp(),
      history: [
        ...(ticket?.history || []),
        { action: `Assigned to ${agent?.name || "None"}`, timestamp: new Date().toISOString(), user: profile?.name || user?.email }
      ]
    });
  };

  return (
    <FeatureContext.Provider value={{ getFp }}>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
          <p className="text-muted-foreground">Manage and track IT support requests.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            className="font-bold"
            onClick={async () => {
              if (!window.confirm("Delete ALL tickets permanently?")) return;
              try {
                const snap = await getDocs(collection(db, "tickets"));
                for (const d of snap.docs) {
                  await deleteDoc(doc(db, "tickets", d.id));
                }
                alert("Cleaned " + snap.size + " tickets from Firestore.");
                // Also call SQL delete via API
                await fetch("/api/tickets/all", { method: "DELETE" }).catch(() => {});
              } catch (e) {
                alert(e.message);
              }
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete All
          </Button>
          <Button onClick={() => openModal()} className="bg-sn-green text-sn-dark font-bold">
            <Plus className="w-4 h-4 mr-2" /> Create Ticket
          </Button>
        </div>
      </div>

      <div className="sn-card overflow-hidden p-0">
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-9 pr-4 py-2 bg-white border border-border rounded-md text-sm w-64 focus:ring-2 focus:ring-sn-green outline-none"
              />
            </div>
            <Button variant="outline" size="sm"><Filter className="w-4 h-4 mr-2" /> Filter</Button>
          </div>
          <div className="text-sm text-muted-foreground">Showing {filteredTickets.length} tickets</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Number</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Short Description</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Reporting User</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Priority</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">State</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Category</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Assignment Group</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">Assigned To</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight">SLA</th>
                <th className="data-table-header p-2 text-[11px] font-bold uppercase tracking-tight text-right">Actions</th>
              </tr>
              <tr className="bg-white border-b border-border">
                <td className="p-1.5"><input value={columnFilters.number} onChange={e => setColumnFilters({ ...columnFilters, number: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.title} onChange={e => setColumnFilters({ ...columnFilters, title: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.caller} onChange={e => setColumnFilters({ ...columnFilters, caller: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.priority} onChange={e => setColumnFilters({ ...columnFilters, priority: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.status} onChange={e => setColumnFilters({ ...columnFilters, status: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.category} onChange={e => setColumnFilters({ ...columnFilters, category: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.assignmentGroup} onChange={e => setColumnFilters({ ...columnFilters, assignmentGroup: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"><input value={columnFilters.assignedTo} onChange={e => setColumnFilters({ ...columnFilters, assignedTo: e.target.value })} placeholder="Search" className="w-full p-1 border border-border rounded text-[11px] outline-none focus:ring-1 focus:ring-sn-green" /></td>
                <td className="p-1.5"></td>
                <td className="p-1.5"></td>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((ticket, idx) => {
                const assignedAgent = agents.find(a => a.id === ticket.assignedTo);
                return (
                  <tr key={ticket.id} className="data-table-row border-b border-border hover:bg-muted/10 transition-colors group">
                    <td className="p-2">
                      <Link to={`/tickets/${ticket.id}`} className="font-mono text-[11px] font-bold text-blue-600 hover:underline">
                        {ticket.number || `INC000${idx + 1}`}
                      </Link>
                    </td>
                    <td className="p-2 text-[11px] font-medium">{ticket.title}</td>
                    <td className="p-2 text-[11px]">{ticket.caller}</td>
                    <td className="p-2">
                      <span className={cn(
                        "px-1 py-0.5 rounded text-[9px] font-bold uppercase",
                        ticket.priority?.includes("Critical") ? "bg-red-600 text-white" :
                          ticket.priority?.includes("High") ? "bg-red-100 text-red-700" :
                            ticket.priority?.includes("Moderate") ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                      )}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="p-2 text-[11px]">{ticket.status}</td>
                    <td className="p-2 text-[11px]">{ticket.category}</td>
                    <td className="p-2 text-[11px]">{ticket.assignmentGroup || "(empty)"}</td>
                    <td className="p-2 text-[11px]">{assignedAgent?.name || ticket.assignedToName || ticket.assignedTo || "(empty)"}</td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        <SLATimer
                          label="Resp"
                          deadline={ticket.responseDeadline}
                          startTime={ticket.responseSlaStartTime || ticket.createdAt}
                          metAt={ticket.firstResponseAt}
                          isPaused={ticket.status === "On Hold" || ticket.status === "Waiting for Customer" || ticket.status === "Awaiting User" || ticket.status === "Awaiting Vendor"}
                          onHoldStart={ticket.onHoldStart}
                          totalPausedTime={ticket.totalPausedTime}
                        />
                        <SLATimer
                          label="Res"
                          deadline={ticket.resolutionDeadline}
                          startTime={ticket.resolutionSlaStartTime || ticket.createdAt}
                          metAt={ticket.resolvedAt}
                          isPaused={ticket.status === "On Hold" || ticket.status === "Waiting for Customer" || ticket.status === "Awaiting User" || ticket.status === "Awaiting Vendor"}
                          onHoldStart={ticket.onHoldStart}
                          totalPausedTime={ticket.totalPausedTime}
                          waitUntil={ticket.firstResponseAt ?? null}
                        />
                      </div>
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link to={`/tickets/${ticket.id}`} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors" title="Edit Ticket">
                          <Edit className="w-3.5 h-3.5" />
                        </Link>
                        <button onClick={async () => {
                          if (confirm(`Are you sure you want to delete ticket ${ticket.number}?`)) {
                            await deleteDoc(doc(db, "tickets", ticket.id));
                          }
                        }} className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors" title="Delete Ticket">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Ticket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Incident</span>
                <span className="text-sm font-bold">New Record</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={closeModal}>Cancel</Button>
                <Button size="sm" className="bg-sn-green text-sn-dark font-bold" onClick={(e: any) => handleCreateTicket(e)} disabled={isSubmitting}>
                  {isSubmitting ? "Submitting..." : "Submit"}
                </Button>
              </div>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 overflow-y-auto max-h-[85vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                {/* Left Column */}
                <div className="space-y-4">
                  {/* Company */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                      Company
                    </label>
                    <select
                      value={newTicket.company}
                      onChange={e => setNewTicket({ ...newTicket, company: e.target.value })}
                      className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8 bg-white"
                    >
                      <option value="">-- No Company Assigned --</option>
                      {emailConfigs.map(config => (
                        <option key={config.id} value={config.id}>{config.company_name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Number */}
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Number</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8"
                      value={previewNumber}
                    />
                  </div>

                  {/* Reporting User */}
                  <FeatureGuard id="caller">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                        <span className="text-red-500">*</span> Reporting User
                      </label>
                      <div className="col-span-2 relative">
                        <div className="flex gap-1">
                          <input
                            placeholder="Search for caller..."
                            value={callerSearch || newTicket.caller}
                            onChange={e => {
                              setCallerSearch(e.target.value);
                              setShowCallerResults(true);
                              setNewTicket({ ...newTicket, caller: e.target.value });
                            }}
                            onFocus={() => setShowCallerResults(true)}
                            className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8"
                          />
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setShowCallerResults(!showCallerResults)}><Search className="w-3 h-3" /></Button>
                        </div>
                        {showCallerResults && callerSearch && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                            {allUsers.filter(u =>
                              u.name?.toLowerCase().includes(callerSearch.toLowerCase()) ||
                              u.email?.toLowerCase().includes(callerSearch.toLowerCase())
                            ).map(u => (
                              <div
                                key={u.id}
                                className="p-2 hover:bg-sn-green/10 cursor-pointer text-xs"
                                onClick={() => {
                                  setNewTicket({ ...newTicket, caller: u.name || u.email });
                                  setCallerSearch(u.name || u.email);
                                  setShowCallerResults(false);
                                }}
                              >
                                <div className="font-bold">{u.name}</div>
                                <div className="text-[10px] text-muted-foreground">{u.email}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Affected User */}
                  <FeatureGuard id="affected_user">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                        <span className="text-red-500">*</span> Affected User
                      </label>
                      <div className="col-span-2 relative">
                        <div className="flex gap-1">
                          <input
                            placeholder="Search affected user..."
                            value={affectedSearch || newTicket.affectedUser || ''}
                            onChange={e => {
                              setAffectedSearch(e.target.value);
                              setShowAffectedResults(true);
                              setNewTicket({ ...newTicket, affectedUser: e.target.value });
                            }}
                            onFocus={() => setShowAffectedResults(true)}
                            className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8"
                          />
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setShowAffectedResults(!showAffectedResults)}><Search className="w-3 h-3" /></Button>
                        </div>
                        {showAffectedResults && affectedSearch && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                            {allUsers.filter(u =>
                              u.name?.toLowerCase().includes(affectedSearch.toLowerCase()) ||
                              u.email?.toLowerCase().includes(affectedSearch.toLowerCase())
                            ).map(u => (
                              <div
                                key={u.id}
                                className="p-2 hover:bg-sn-green/10 cursor-pointer text-xs"
                                onClick={() => {
                                  setNewTicket({ ...newTicket, affectedUser: u.name || u.email });
                                  setAffectedSearch(u.name || u.email);
                                  setShowAffectedResults(false);
                                }}
                              >
                                <div className="font-bold">{u.name}</div>
                                <div className="text-[10px] text-muted-foreground">{u.email}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Watch list (CC) */}
                  <FeatureGuard id="watch_list">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Watch List</label>
                      <div className="col-span-2 flex gap-1">
                        <input
                          value={newTicket.watchList}
                          onChange={e => setNewTicket({ ...newTicket, watchList: e.target.value })}
                          placeholder="Separate emails with commas"
                          className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8"
                        />
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Users className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Business Phone */}
                  <FeatureGuard id="business_phone">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Business Phone</label>
                      <input
                        value={newTicket.businessPhone}
                        onChange={e => setNewTicket({ ...newTicket, businessPhone: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      />
                    </div>
                  </FeatureGuard>

                  {/* Location */}
                  <FeatureGuard id="location">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Location</label>
                      <div className="col-span-2 flex gap-1">
                        <input
                          value={newTicket.location}
                          onChange={e => setNewTicket({ ...newTicket, location: e.target.value })}
                          className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                        />
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Company */}
                  <FeatureGuard id="company">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Company</label>
                      <select
                        value={newTicket.company}
                        onChange={e => setNewTicket({ ...newTicket, company: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8"
                      >
                        <option value="">-- None --</option>
                        {companies.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Category */}
                  <FeatureGuard id="category">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                        <span className="text-red-500 font-bold">*</span> Category
                      </label>
                      <select
                        value={newTicket.category}
                        onChange={e => {
                          setNewTicket({ 
                            ...newTicket, 
                            category: e.target.value, 
                            subcategory: "", 
                            service: "" 
                          });
                        }}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white"
                      >
                        <option value="">-- Select Category --</option>
                        {IT_SERVICE_CATALOG.map((item) => (
                          <option key={item.category} value={item.category}>{item.category}</option>
                        ))}
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Subcategory */}
                  <FeatureGuard id="subcategory">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                        <span className="text-red-500 font-bold">*</span> Subcategory
                      </label>
                      <select
                        value={newTicket.subcategory}
                        onChange={e => {
                          setNewTicket({ 
                            ...newTicket, 
                            subcategory: e.target.value, 
                            service: "" 
                          });
                        }}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white disabled:opacity-50 disabled:bg-muted"
                        disabled={!newTicket.category}
                      >
                        <option value="">-- Select Subcategory --</option>
                        {realisticSubcategories.map(s => (
                          <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Service */}
                  <FeatureGuard id="service">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                        <span className="text-red-500 font-bold">*</span> Service
                      </label>
                      <select
                        value={newTicket.service}
                        onChange={e => {
                          setNewTicket({ ...newTicket, service: e.target.value });
                        }}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white disabled:opacity-50 disabled:bg-muted"
                        disabled={!newTicket.subcategory}
                      >
                        <option value="">-- Select Service --</option>
                        {realisticServices.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Service Offering */}
                  <FeatureGuard id="service_offering">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Service Offering</label>
                      <input
                        value={newTicket.serviceOffering}
                        onChange={e => setNewTicket({ ...newTicket, serviceOffering: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      />
                    </div>
                  </FeatureGuard>

                  {/* Configuration Item */}
                  <FeatureGuard id="configuration_item">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Configuration item</label>
                      <div className="col-span-2 flex gap-1">
                        <input
                          value={newTicket.configurationItem}
                          onChange={e => setNewTicket({ ...newTicket, configurationItem: e.target.value })}
                          className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                        />
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Computer Name */}
                  <FeatureGuard id="computer_name">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Computer Name</label>
                      <div className="col-span-2 flex gap-1">
                        <input
                          value={newTicket.computerName}
                          onChange={e => setNewTicket({ ...newTicket, computerName: e.target.value })}
                          className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                        />
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Impact */}
                  <FeatureGuard id="impact">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Impact</label>
                      <select
                        value={newTicket.impact}
                        onChange={e => setNewTicket({ ...newTicket, impact: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8 transition-colors"
                      >
                        <option>1 - High</option>
                        <option>2 - Medium</option>
                        <option>3 - Low</option>
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Urgency */}
                  <FeatureGuard id="urgency">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Urgency</label>
                      <select
                        value={newTicket.urgency}
                        onChange={e => setNewTicket({ ...newTicket, urgency: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8 transition-colors"
                      >
                        <option>1 - High</option>
                        <option>2 - Medium</option>
                        <option>3 - Low</option>
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Priority */}
                  <FeatureGuard id="priority">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Priority</label>
                      <input
                        disabled
                        className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-bold text-blue-600 h-8"
                        value={calculatePriority(newTicket.impact, newTicket.urgency)}
                      />
                    </div>
                  </FeatureGuard>

                  {/* Knowledge Article Used */}
                  <FeatureGuard id="knowledge_article_used">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Knowledge Article Used?</label>
                      <input
                        type="checkbox"
                        checked={newTicket.knowledgeArticleUsed}
                        onChange={e => setNewTicket({ ...newTicket, knowledgeArticleUsed: e.target.checked })}
                        className="w-4 h-4 accent-sn-green"
                      />
                    </div>
                  </FeatureGuard>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  {/* Opened */}
                  <FeatureGuard id="opened">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened</label>
                      <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                        value={new Date().toLocaleString()}
                      />
                    </div>
                  </FeatureGuard>

                  {/* Opened by */}
                  <FeatureGuard id="opened_by">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened by</label>
                      <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                        value={profile?.name || user?.email || ""}
                      />
                    </div>
                  </FeatureGuard>

                  {/* State */}
                  <FeatureGuard id="state">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">State</label>
                      <select
                        disabled
                        className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs outline-none h-8"
                      >
                        <option>New</option>
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Assignment group */}
                  <FeatureGuard id="assignment_group">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assignment group</label>
                      <div className="col-span-2 flex gap-1">
                        <select
                          value={newTicket.assignmentGroup}
                          onChange={e => {
                            const group = visibleGroups.find(g => g.name === e.target.value);
                            setNewTicket({ ...newTicket, assignmentGroup: e.target.value, selectedGroupId: group?.id || "", assignedTo: "" });
                          }}
                          className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                        >
                          <option value="">-- Auto Assign --</option>
                          {displayGroups.map((item) => (
                            <option key={item.id} value={item.name}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Assigned to */}
                  <FeatureGuard id="assigned_to">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assigned to</label>
                      <div className="col-span-2 flex gap-1">
                        <select
                          value={newTicket.assignedTo}
                          onChange={e => setNewTicket({ ...newTicket, assignedTo: e.target.value })}
                          className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                        >
                          <option value="">-- Select Member --</option>
                          {visibleMembers.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.userName}</option>
                          ))}
                        </select>
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </FeatureGuard>

                  {/* Original Assignment Group */}
                  <FeatureGuard id="original_assignment_group">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Original Assignment Group</label>
                      <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                        value={newTicket.assignmentGroup || ""}
                      />
                    </div>
                  </FeatureGuard>

                  {/* Acknowledged */}
                  <FeatureGuard id="acknowledged">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Acknowledged</label>
                      <input
                        type="checkbox"
                        checked={newTicket.acknowledged}
                        onChange={e => setNewTicket({ ...newTicket, acknowledged: e.target.checked })}
                        className="w-4 h-4 accent-sn-green"
                      />
                    </div>
                  </FeatureGuard>

                  {/* Channel */}
                  <FeatureGuard id="channel">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Channel</label>
                      <select
                        value={newTicket.channel}
                        onChange={e => setNewTicket({ ...newTicket, channel: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      >
                        <option>Self-service</option>
                        <option>Email</option>
                        <option>Phone</option>
                        <option>Chat</option>
                        <option>Portal</option>
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Password Reset? */}
                  <FeatureGuard id="password_reset">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Password Reset?</label>
                      <select
                        value={newTicket.passwordReset}
                        onChange={e => setNewTicket({ ...newTicket, passwordReset: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      >
                        <option>No</option>
                        <option>Yes</option>
                      </select>
                    </div>
                  </FeatureGuard>

                  {/* Rackspace Ticket No */}
                  <FeatureGuard id="rackspace_ticket_no">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Rackspace Ticket No</label>
                      <input
                        value={newTicket.rackspaceTicketNo}
                        onChange={e => setNewTicket({ ...newTicket, rackspaceTicketNo: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      />
                    </div>
                  </FeatureGuard>

                  {/* Additional Information */}
                  <FeatureGuard id="additional_information">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Additional Information</label>
                      <input
                        value={newTicket.additionalInformation}
                        onChange={e => setNewTicket({ ...newTicket, additionalInformation: e.target.value })}
                        className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      />
                    </div>
                  </FeatureGuard>

                  {/* SLA due */}
                  <FeatureGuard id="sla_due">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">SLA due</label>
                      <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8"
                        value={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleString()}
                      />
                    </div>
                  </FeatureGuard>

                  {/* ── Custom Company Dropdowns ── */}
                  {customDropdowns.length > 0 && (
                    <>
                      <div className="pt-2 pb-1 border-t border-border">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Custom Fields</span>
                      </div>
                      {customDropdowns.map(dd => (
                        <FeatureGuard key={dd.id} id={dd.id}>
                          <div className="grid grid-cols-3 items-center gap-4">
                            <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                              {dd.isRequired && <span className="text-red-500 font-bold mr-0.5">*</span>}
                              {dd.label}
                            </label>
                            <select
                              value={customFieldValues[dd.name] || ""}
                              onChange={e => setCustomFieldValues(prev => ({ ...prev, [dd.name]: e.target.value }))}
                              className="col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white"
                            >
                              <option value="">-- Select {dd.label} --</option>
                              {dd.options.map((opt: any) => (
                                <option key={opt.id} value={opt.label}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                        </FeatureGuard>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* Full Width Fields */}
              <div className="mt-8 space-y-4">
                <FeatureGuard id="short_description">
                  <div className="grid grid-cols-6 items-center gap-4">
                    <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                      <span className="text-red-500">*</span> Short description
                    </label>
                    <div className="col-span-5 flex gap-2">
                      <input
                        value={newTicket.title}
                        onChange={e => setNewTicket({ ...newTicket, title: e.target.value })}
                        className="flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8"
                      />
                      <Button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={isAiLoading}
                        className="bg-purple-600 hover:bg-purple-700 text-white h-8 text-[11px]"
                      >
                        {isAiLoading ? "Analyzing..." : "Autofill with AI"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => speechControllerRef.current?.toggle()}
                        disabled={!speechSupported}
                        className={cn(
                          "p-1.5 hover:bg-muted rounded transition-colors ml-1 border border-border h-8 w-8 flex items-center justify-center",
                          speechListening && "bg-sn-green/15 text-sn-green border-sn-green"
                        )}
                        title={speechListening ? "Stop Dictation" : "Dictation"}
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </FeatureGuard>

                <FeatureGuard id="description">
                  <div className="grid grid-cols-6 items-start gap-4">
                    <label className="text-[11px] text-right font-medium uppercase leading-tight mt-1">Description</label>
                    <div className="col-span-5 space-y-1.5">
                      <textarea
                        rows={4}
                        value={newTicket.description}
                        onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                        className={`w-full p-1.5 border rounded text-xs focus:ring-1 focus:ring-sn-green resize-none h-32 transition-all ${suggestedSolution ? 'border-purple-400 ring-1 ring-purple-300 bg-purple-50' : 'border-border'}`}
                        placeholder="Describe the issue in detail... or use Autofill with AI above"
                      />
                      {speechListening && (
                        <div className="text-[10px] text-sn-green font-medium">
                          Listening{speechLiveText ? `: ${speechLiveText}` : "..."}
                        </div>
                      )}
                    </div>
                  </div>
                </FeatureGuard>
              </div>

              {/* Suggested Solution Box */}
              {suggestedSolution && (
                <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <h4 className="text-purple-800 font-semibold mb-2 flex items-center gap-2">
                    <span>✨</span> AI filled your description
                    <span className="text-[10px] font-normal text-purple-500 ml-auto">You can edit it above</span>
                  </h4>
                  <p className="text-xs text-purple-700 italic line-clamp-3">{suggestedSolution}</p>
                  <button type="button" onClick={() => setSuggestedSolution(null)}
                    className="mt-2 text-[10px] text-purple-400 hover:text-purple-600 underline">
                    Dismiss
                  </button>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex justify-end gap-3 pt-6 border-t border-border mt-8">
                <FeatureGuard id="btn_cancel">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    className="px-6 h-8 text-[11px] font-bold uppercase tracking-wider"
                  >
                    Cancel
                  </Button>
                </FeatureGuard>
                <FeatureGuard id="btn_submit">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-sn-green text-sn-dark hover:bg-sn-green/90 px-8 h-8 text-[11px] font-bold uppercase tracking-wider shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </Button>
                </FeatureGuard>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </FeatureContext.Provider>
  );
}
