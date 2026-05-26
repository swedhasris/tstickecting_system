import React, { useEffect, useRef, useState } from "react";
import { collection, addDoc, query, onSnapshot, updateDoc, doc, serverTimestamp, orderBy, where, deleteDoc } from "firebase/firestore";
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
import { CREATE_INCIDENT_FORM_DEFAULTS, DEFAULT_COMPANY_FEATURE_PERMISSION } from "../lib/createIncidentFeatures";

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
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [callerSearch, setCallerSearch] = useState("");
  const [affectedSearch, setAffectedSearch] = useState("");
  const [showCallerResults, setShowCallerResults] = useState(false);
  const [showAffectedResults, setShowAffectedResults] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewNumber, setPreviewNumber] = useState("");

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
    setIsModalOpen(true);
  };
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

  useEffect(() => {
    if (action === "new") {
      openModal();
    }
  }, [action]);

  useEffect(() => {
    const controller = createSpeechController({
      onInterim: (text) => {
        setSpeechLiveText(text);
        setNewTicket(prev => ({ ...prev, description: text }));
      },
      onFinal: (text) => {
        setSpeechLiveText("");
        setNewTicket(prev => ({ ...prev, description: text }));
      },
      onStateChange: (listening) => {
        setSpeechListening(listening);
        if (!listening) {
          setSpeechLiveText("");
        }
      },
      onError: (message) => {
        setSpeechListening(false);
        alert(message);
      }
    });

    speechControllerRef.current = controller;
    setSpeechSupported(controller.supported);

    return () => {
      controller.stop();
    };
  }, []);

  const [newTicket, setNewTicket] = useState({
    ...CREATE_INCIDENT_FORM_DEFAULTS,
    caller: profile?.name || user?.email || "",
  });

  const [assignedTo, setAssignedTo] = useState("");
  const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
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
  const [companyFeaturePermissions, setCompanyFeaturePermissions] = useState<Record<string, any>>({});
  useEffect(() => {
    const q = query(collection(db, "companies"), orderBy("name"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCompanies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!newTicket.company) {
      setCompanyFeaturePermissions({});
      return;
    }

    const permissionsQuery = query(
      collection(db, "company_feature_permissions"),
      where("companyId", "==", newTicket.company)
    );

    const unsubscribe = onSnapshot(permissionsQuery, (snapshot) => {
      const nextPermissions = snapshot.docs.reduce((acc, permissionDoc) => {
        const data = permissionDoc.data() as any;
        acc[data.featureId] = {
          ...DEFAULT_COMPANY_FEATURE_PERMISSION,
          ...data,
        };
        return acc;
      }, {} as Record<string, any>);

      setCompanyFeaturePermissions(nextPermissions);
    });

    return unsubscribe;
  }, [newTicket.company]);

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

  const getFeaturePermission = (featureId: string) => ({
    ...DEFAULT_COMPANY_FEATURE_PERMISSION,
    ...(companyFeaturePermissions[featureId] || {}),
  });

  const isFeatureVisible = (featureId: string) => {
    const permission = getFeaturePermission(featureId);
    return permission.canView && permission.status !== "disabled";
  };

  const isFeatureDisabled = (featureId: string) => {
    const permission = getFeaturePermission(featureId);
    return permission.status === "disabled" || !permission.canUse;
  };

  const isFeatureReadOnly = (featureId: string) => {
    const permission = getFeaturePermission(featureId);
    return permission.status === "disabled" || !permission.canUse || !permission.canEdit;
  };

  const isFeatureMandatory = (featureId: string) => getFeaturePermission(featureId).isMandatory;

  const getFieldRequired = (featureId: string, baseRequired = false) => baseRequired || isFeatureMandatory(featureId);

  const getInputClassName = (featureId: string, baseClassName: string) =>
    cn(baseClassName, isFeatureReadOnly(featureId) && "bg-muted/30 cursor-not-allowed");

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

    const requiredFieldChecks = [
      { key: "field.caller", label: "Reporting User", value: newTicket.caller },
      { key: "field.affectedUser", label: "Affected User", value: newTicket.affectedUser },
      { key: "field.title", label: "Short description", value: newTicket.title },
      { key: "field.category", label: "Category", value: newTicket.category },
      { key: "field.subcategory", label: "Subcategory", value: newTicket.subcategory },
      { key: "field.service", label: "Service", value: newTicket.service },
      { key: "field.description", label: "Description", value: newTicket.description },
      { key: "field.company", label: "Company", value: newTicket.company },
      { key: "field.assignmentGroup", label: "Assignment group", value: newTicket.assignmentGroup },
      { key: "field.assignedTo", label: "Assigned to", value: newTicket.assignedTo },
    ];

    const missingRequiredField = requiredFieldChecks.find(({ key, value }) =>
      isFeatureVisible(key) && getFieldRequired(key, ["field.caller", "field.title", "field.category", "field.subcategory", "field.service"].includes(key)) && !value
    );

    if (missingRequiredField) {
      alert(`Please fill in the required field: ${missingRequiredField.label}.`);
      return;
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
        number: ticketNumber,
        assignmentGroup,
        assignedToName: assignedUserName,
        priority,
        status: newTicket.assignedTo ? "Assigned" : "New",
        createdBy: user.uid,
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

      // Dispatch real-time notification
      try {
        fetch("/api/notifications/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticket: {
              id: docRef.id,
              ticket_number: ticketNumber,
              created_by: user.uid,
              created_by_name: profile?.name || user.email,
              assigned_to: newTicket.assignedTo || null,
              assigned_to_name: assignedUserName || null,
              status: ticketData.status,
              priority: priority
            },
            actorId: user.uid,
            actorName: profile?.name || user.email,
            type: "create"
          })
        });
      } catch (e) {
        console.error("Failed to dispatch creation notification:", e);
      }

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
        ...CREATE_INCIDENT_FORM_DEFAULTS,
        caller: "",
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
    if (!ticket) return;
    await updateDoc(ticketRef, {
      status: newStatus,
      updatedAt: serverTimestamp(),
      history: [
        ...(ticket?.history || []),
        { action: `Status updated to ${newStatus}`, timestamp: new Date().toISOString(), user: profile?.name || user?.email }
      ]
    });

    // Dispatch real-time notification
    try {
      fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: {
            id: ticketId,
            ticket_number: ticket.number,
            created_by: ticket.createdBy,
            created_by_name: ticket.createdByName || ticket.caller,
            assigned_to: ticket.assignedTo || null,
            assigned_to_name: ticket.assignedToName || null,
            status: newStatus,
            priority: ticket.priority
          },
          actorId: user?.uid || "System",
          actorName: profile?.name || user?.email || "System",
          type: "update",
          oldStatus: ticket.status,
          newStatus: newStatus
        })
      });
    } catch (e) {
      console.error("Failed to dispatch status notification:", e);
    }
  };

  const updateAssignment = async (ticketId: string, agentId: string) => {
    const ticketRef = doc(db, "tickets", ticketId);
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    const agent = agents.find(a => a.id === agentId);
    const newStatus = agentId ? "Assigned" : "New";
    await updateDoc(ticketRef, {
      assignedTo: agentId,
      assignedToName: agent?.name || "",
      status: newStatus,
      updatedAt: serverTimestamp(),
      history: [
        ...(ticket?.history || []),
        { action: `Assigned to ${agent?.name || "None"}`, timestamp: new Date().toISOString(), user: profile?.name || user?.email }
      ]
    });

    // Dispatch real-time notification
    try {
      fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: {
            id: ticketId,
            ticket_number: ticket.number,
            created_by: ticket.createdBy,
            created_by_name: ticket.createdByName || ticket.caller,
            assigned_to: agentId || null,
            assigned_to_name: agent?.name || null,
            status: newStatus,
            priority: ticket.priority
          },
          actorId: user?.uid || "System",
          actorName: profile?.name || user?.email || "System",
          type: "update",
          oldAssignee: ticket.assignedTo,
          newAssignee: agentId
        })
      });
    } catch (e) {
      console.error("Failed to dispatch assignment notification:", e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
          <p className="text-muted-foreground">Manage and track IT support requests.</p>
        </div>
        <Button onClick={() => openModal()} className="bg-sn-green text-sn-dark font-bold">
          <Plus className="w-4 h-4 mr-2" /> Create Ticket
        </Button>
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
                {isFeatureVisible("button.cancel") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={closeModal}
                    disabled={isFeatureDisabled("button.cancel")}
                  >
                    Cancel
                  </Button>
                )}
                {isFeatureVisible("button.submit") && (
                  <Button
                    size="sm"
                    className="bg-sn-green text-sn-dark font-bold"
                    onClick={(e: any) => handleCreateTicket(e)}
                    disabled={isSubmitting || suggestedSolution !== null || isFeatureDisabled("button.submit")}
                  >
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </Button>
                )}
              </div>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 overflow-y-auto max-h-[85vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                {/* Left Column */}
                {isFeatureVisible("section.leftColumn") && (
                <div className="space-y-4">
                  {/* Number */}
                  {isFeatureVisible("field.number") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Number</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8"
                      value={previewNumber}
                    />
                  </div>
                  )}

                  {/* Reporting User */}
                  {isFeatureVisible("field.caller") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                      <span className="text-red-500">*</span> Reporting User
                    </label>
                    <div className="col-span-2 relative">
                      <div className="flex gap-1">
                        <input
                          required={getFieldRequired("field.caller", true)}
                          placeholder="Search for caller..."
                          value={callerSearch || newTicket.caller}
                          onChange={e => {
                            setCallerSearch(e.target.value);
                            setShowCallerResults(true);
                            setNewTicket({ ...newTicket, caller: e.target.value });
                          }}
                          onFocus={() => setShowCallerResults(true)}
                          className={getInputClassName("field.caller", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8")}
                          disabled={isFeatureDisabled("field.caller")}
                          readOnly={isFeatureReadOnly("field.caller")}
                        />
                        {isFeatureVisible("button.searchCaller") && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setShowCallerResults(!showCallerResults)}
                            disabled={isFeatureDisabled("button.searchCaller")}
                          >
                            <Search className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {showCallerResults && callerSearch && !isFeatureDisabled("button.searchCaller") && (
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
                  )}

                  {/* Affected User */}
                  {isFeatureVisible("field.affectedUser") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                      <span className="text-red-500">*</span> Affected User
                    </label>
                    <div className="col-span-2 relative">
                      <div className="flex gap-1">
                        <input
                          required={getFieldRequired("field.affectedUser")}
                          placeholder="Search affected user..."
                          value={affectedSearch || newTicket.affectedUser || ''}
                          onChange={e => {
                            setAffectedSearch(e.target.value);
                            setShowAffectedResults(true);
                            setNewTicket({ ...newTicket, affectedUser: e.target.value });
                          }}
                          onFocus={() => setShowAffectedResults(true)}
                          className={getInputClassName("field.affectedUser", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8")}
                          disabled={isFeatureDisabled("field.affectedUser")}
                          readOnly={isFeatureReadOnly("field.affectedUser")}
                        />
                        {isFeatureVisible("button.searchAffectedUser") && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setShowAffectedResults(!showAffectedResults)}
                            disabled={isFeatureDisabled("button.searchAffectedUser")}
                          >
                            <Search className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {showAffectedResults && affectedSearch && !isFeatureDisabled("button.searchAffectedUser") && (
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
                  )}

                  {/* Watch list (CC) */}
                  {isFeatureVisible("field.watchList") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Watch list</label>
                    <div className="col-span-2 flex gap-1">
                      <input
                        value={newTicket.watchList}
                        onChange={e => setNewTicket({ ...newTicket, watchList: e.target.value })}
                        placeholder="Separate emails with commas"
                        className={getInputClassName("field.watchList", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8")}
                        disabled={isFeatureDisabled("field.watchList")}
                        readOnly={isFeatureReadOnly("field.watchList")}
                      />
                      {isFeatureVisible("button.watchListLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.watchListLookup")}><Users className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Business Phone */}
                  {isFeatureVisible("field.businessPhone") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Business phone</label>
                    <input
                      value={newTicket.businessPhone}
                      onChange={e => setNewTicket({ ...newTicket, businessPhone: e.target.value })}
                      className={getInputClassName("field.businessPhone", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.businessPhone")}
                      disabled={isFeatureDisabled("field.businessPhone")}
                      readOnly={isFeatureReadOnly("field.businessPhone")}
                    />
                  </div>
                  )}

                  {/* Location */}
                  {isFeatureVisible("field.location") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Location</label>
                    <div className="col-span-2 flex gap-1">
                      <input
                        value={newTicket.location}
                        onChange={e => setNewTicket({ ...newTicket, location: e.target.value })}
                        className={getInputClassName("field.location", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                        required={getFieldRequired("field.location")}
                        disabled={isFeatureDisabled("field.location")}
                        readOnly={isFeatureReadOnly("field.location")}
                      />
                      {isFeatureVisible("button.locationLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.locationLookup")}><Search className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Company */}
                  {isFeatureVisible("field.company") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Company</label>
                    <select
                      value={newTicket.company}
                      onChange={e => setNewTicket({ ...newTicket, company: e.target.value })}
                      className={getInputClassName("field.company", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8")}
                      required={getFieldRequired("field.company")}
                      disabled={isFeatureDisabled("field.company")}
                    >
                      <option value="">-- None --</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  )}

                  {/* Category */}
                  {isFeatureVisible("field.category") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                      <span className="text-red-500 font-bold">*</span> Category
                    </label>
                    <select
                      required={getFieldRequired("field.category", true)}
                      value={newTicket.category}
                      onChange={e => {
                        setNewTicket({ 
                          ...newTicket, 
                          category: e.target.value, 
                          subcategory: "", 
                          service: "" 
                        });
                      }}
                      className={getInputClassName("field.category", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white")}
                      disabled={isFeatureDisabled("field.category")}
                    >
                      <option value="">-- Select Category --</option>
                      {IT_SERVICE_CATALOG.map((item) => (
                        <option key={item.category} value={item.category}>{item.category}</option>
                      ))}
                    </select>
                  </div>
                  )}

                  {/* Subcategory */}
                  {isFeatureVisible("field.subcategory") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                      <span className="text-red-500 font-bold">*</span> Subcategory
                    </label>
                    <select
                      required={getFieldRequired("field.subcategory", true)}
                      value={newTicket.subcategory}
                      onChange={e => {
                        setNewTicket({ 
                          ...newTicket, 
                          subcategory: e.target.value, 
                          service: "" 
                        });
                      }}
                      className={getInputClassName("field.subcategory", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white disabled:opacity-50 disabled:bg-muted")}
                      disabled={!newTicket.category || isFeatureDisabled("field.subcategory")}
                    >
                      <option value="">-- Select Subcategory --</option>
                      {realisticSubcategories.map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  )}

                  {/* Service */}
                  {isFeatureVisible("field.service") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">
                      <span className="text-red-500 font-bold">*</span> Service
                    </label>
                    <select
                      required={getFieldRequired("field.service", true)}
                      value={newTicket.service}
                      onChange={e => {
                        setNewTicket({ ...newTicket, service: e.target.value });
                      }}
                      className={getInputClassName("field.service", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green outline-none h-8 bg-white disabled:opacity-50 disabled:bg-muted")}
                      disabled={!newTicket.subcategory || isFeatureDisabled("field.service")}
                    >
                      <option value="">-- Select Service --</option>
                      {realisticServices.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  )}

                  {/* Service Offering */}
                  {isFeatureVisible("field.serviceOffering") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Service Offering</label>
                    <input
                      value={newTicket.serviceOffering}
                      onChange={e => setNewTicket({ ...newTicket, serviceOffering: e.target.value })}
                      className={getInputClassName("field.serviceOffering", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.serviceOffering")}
                      disabled={isFeatureDisabled("field.serviceOffering")}
                      readOnly={isFeatureReadOnly("field.serviceOffering")}
                    />
                  </div>
                  )}

                  {/* Configuration Item */}
                  {isFeatureVisible("field.configurationItem") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Configuration item</label>
                    <div className="col-span-2 flex gap-1">
                      <input
                        value={newTicket.configurationItem}
                        onChange={e => setNewTicket({ ...newTicket, configurationItem: e.target.value })}
                        className={getInputClassName("field.configurationItem", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                        required={getFieldRequired("field.configurationItem")}
                        disabled={isFeatureDisabled("field.configurationItem")}
                        readOnly={isFeatureReadOnly("field.configurationItem")}
                      />
                      {isFeatureVisible("button.configurationItemLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.configurationItemLookup")}><Search className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Computer Name */}
                  {isFeatureVisible("field.computerName") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Computer Name</label>
                    <div className="col-span-2 flex gap-1">
                      <input
                        value={newTicket.computerName}
                        onChange={e => setNewTicket({ ...newTicket, computerName: e.target.value })}
                        className={getInputClassName("field.computerName", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                        required={getFieldRequired("field.computerName")}
                        disabled={isFeatureDisabled("field.computerName")}
                        readOnly={isFeatureReadOnly("field.computerName")}
                      />
                      {isFeatureVisible("button.computerNameLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.computerNameLookup")}><Search className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Impact */}
                  {isFeatureVisible("field.impact") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Impact</label>
                    <select
                      value={newTicket.impact}
                      onChange={e => setNewTicket({ ...newTicket, impact: e.target.value })}
                      className={getInputClassName("field.impact", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8 transition-colors")}
                      required={getFieldRequired("field.impact")}
                      disabled={isFeatureDisabled("field.impact")}
                    >
                      <option>1 - High</option>
                      <option>2 - Medium</option>
                      <option>3 - Low</option>
                    </select>
                  </div>
                  )}

                  {/* Urgency */}
                  {isFeatureVisible("field.urgency") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Urgency</label>
                    <select
                      value={newTicket.urgency}
                      onChange={e => setNewTicket({ ...newTicket, urgency: e.target.value })}
                      className={getInputClassName("field.urgency", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8 transition-colors")}
                      required={getFieldRequired("field.urgency")}
                      disabled={isFeatureDisabled("field.urgency")}
                    >
                      <option>1 - High</option>
                      <option>2 - Medium</option>
                      <option>3 - Low</option>
                    </select>
                  </div>
                  )}

                  {/* Priority */}
                  {isFeatureVisible("field.priority") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Priority</label>
                    <input
                      disabled
                      className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-bold text-blue-600 h-8"
                      value={calculatePriority(newTicket.impact, newTicket.urgency)}
                    />
                  </div>
                  )}

                  {/* Knowledge Article Used */}
                  {isFeatureVisible("field.knowledgeArticleUsed") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Knowledge Article Used?</label>
                    <input
                      type="checkbox"
                      checked={newTicket.knowledgeArticleUsed}
                      onChange={e => setNewTicket({ ...newTicket, knowledgeArticleUsed: e.target.checked })}
                      className="w-4 h-4 accent-sn-green"
                      disabled={isFeatureDisabled("field.knowledgeArticleUsed")}
                    />
                  </div>
                  )}
                </div>
                )}

                {/* Right Column */}
                {isFeatureVisible("section.rightColumn") && (
                <div className="space-y-4">
                  {/* Opened */}
                  {isFeatureVisible("field.opened") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                      value={new Date().toLocaleString()}
                    />
                  </div>
                  )}

                  {/* Opened by */}
                  {isFeatureVisible("field.openedBy") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened by</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                      value={profile?.name || user?.email || ""}
                    />
                  </div>
                  )}

                  {/* State */}
                  {isFeatureVisible("field.state") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">State</label>
                    <select
                      disabled
                      className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs outline-none h-8"
                    >
                      <option>New</option>
                    </select>
                  </div>
                  )}

                  {/* Assignment group */}
                  {isFeatureVisible("field.assignmentGroup") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assignment group</label>
                    <div className="col-span-2 flex gap-1">
                      <select
                        value={newTicket.assignmentGroup}
                        onChange={e => {
                          const group = visibleGroups.find(g => g.name === e.target.value);
                          setNewTicket({ ...newTicket, assignmentGroup: e.target.value, selectedGroupId: group?.id || "", assignedTo: "" });
                        }}
                        className={getInputClassName("field.assignmentGroup", "flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8")}
                        required={getFieldRequired("field.assignmentGroup")}
                        disabled={isFeatureDisabled("field.assignmentGroup")}
                      >
                        <option value="">-- Auto Assign --</option>
                        {displayGroups.map((item) => (
                          <option key={item.id} value={item.name}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      {isFeatureVisible("button.assignmentGroupLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.assignmentGroupLookup")}><Search className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Assigned to */}
                  {isFeatureVisible("field.assignedTo") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assigned to</label>
                    <div className="col-span-2 flex gap-1">
                      <select
                        value={newTicket.assignedTo}
                        onChange={e => setNewTicket({ ...newTicket, assignedTo: e.target.value })}
                        className={getInputClassName("field.assignedTo", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                        required={getFieldRequired("field.assignedTo")}
                        disabled={isFeatureDisabled("field.assignedTo")}
                      >
                        <option value="">-- Select Member --</option>
                        {visibleMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.name || m.userName}</option>
                        ))}
                      </select>
                      {isFeatureVisible("button.assignedToLookup") && (
                        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={isFeatureDisabled("button.assignedToLookup")}><Search className="w-3 h-3" /></Button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Original Assignment Group */}
                  {isFeatureVisible("field.originalAssignmentGroup") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Original Assignment Group</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                      value={newTicket.assignmentGroup || ""}
                    />
                  </div>
                  )}

                  {/* Acknowledged */}
                  {isFeatureVisible("field.acknowledged") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Acknowledged</label>
                    <input
                      type="checkbox"
                      checked={newTicket.acknowledged}
                      onChange={e => setNewTicket({ ...newTicket, acknowledged: e.target.checked })}
                      className="w-4 h-4 accent-sn-green"
                      disabled={isFeatureDisabled("field.acknowledged")}
                    />
                  </div>
                  )}

                  {/* Channel */}
                  {isFeatureVisible("field.channel") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Channel</label>
                    <select
                      value={newTicket.channel}
                      onChange={e => setNewTicket({ ...newTicket, channel: e.target.value })}
                      className={getInputClassName("field.channel", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.channel")}
                      disabled={isFeatureDisabled("field.channel")}
                    >
                      <option>Self-service</option>
                      <option>Email</option>
                      <option>Phone</option>
                      <option>Chat</option>
                      <option>Portal</option>
                    </select>
                  </div>
                  )}

                  {/* Password Reset? */}
                  {isFeatureVisible("field.passwordReset") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Password Reset?</label>
                    <select
                      value={newTicket.passwordReset}
                      onChange={e => setNewTicket({ ...newTicket, passwordReset: e.target.value })}
                      className={getInputClassName("field.passwordReset", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.passwordReset")}
                      disabled={isFeatureDisabled("field.passwordReset")}
                    >
                      <option>No</option>
                      <option>Yes</option>
                    </select>
                  </div>
                  )}

                  {/* Rackspace Ticket No */}
                  {isFeatureVisible("field.rackspaceTicketNo") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Rackspace Ticket No</label>
                    <input
                      value={newTicket.rackspaceTicketNo}
                      onChange={e => setNewTicket({ ...newTicket, rackspaceTicketNo: e.target.value })}
                      className={getInputClassName("field.rackspaceTicketNo", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.rackspaceTicketNo")}
                      disabled={isFeatureDisabled("field.rackspaceTicketNo")}
                      readOnly={isFeatureReadOnly("field.rackspaceTicketNo")}
                    />
                  </div>
                  )}

                  {/* Additional Information */}
                  {isFeatureVisible("field.additionalInformation") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Additional Information</label>
                    <input
                      value={newTicket.additionalInformation}
                      onChange={e => setNewTicket({ ...newTicket, additionalInformation: e.target.value })}
                      className={getInputClassName("field.additionalInformation", "col-span-2 p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      required={getFieldRequired("field.additionalInformation")}
                      disabled={isFeatureDisabled("field.additionalInformation")}
                      readOnly={isFeatureReadOnly("field.additionalInformation")}
                    />
                  </div>
                  )}

                  {/* SLA due */}
                  {isFeatureVisible("field.slaDue") && (
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">SLA due</label>
                    <input disabled className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8"
                      value={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleString()}
                    />
                  </div>
                  )}
                </div>
                )}
              </div>

              {/* Full Width Fields */}
              {isFeatureVisible("section.fullWidth") && (
              <div className="mt-8 space-y-4">
                <div className="grid grid-cols-6 items-center gap-4">
                  {isFeatureVisible("field.title") && (
                  <>
                  <label className="text-[11px] text-right font-medium uppercase leading-tight flex items-center justify-end gap-1">
                    <span className="text-red-500">*</span> Short description
                  </label>
                  <div className="col-span-5 flex gap-2">
                    <input
                      required={getFieldRequired("field.title", true)}
                      value={newTicket.title}
                      onChange={e => setNewTicket({ ...newTicket, title: e.target.value })}
                      className={getInputClassName("field.title", "flex-grow p-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-sn-green h-8")}
                      disabled={isFeatureDisabled("field.title")}
                      readOnly={isFeatureReadOnly("field.title")}
                    />
                    {isFeatureVisible("button.aiAutofill") && (
                      <Button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={isAiLoading || isFeatureDisabled("button.aiAutofill")}
                        className="bg-purple-600 hover:bg-purple-700 text-white h-8 text-[11px]"
                      >
                        {isAiLoading ? "Analyzing..." : "Autofill with AI"}
                      </Button>
                    )}
                    {isFeatureVisible("button.dictation") && (
                      <button
                        type="button"
                        onClick={() => speechControllerRef.current?.toggle()}
                        disabled={!speechSupported || isFeatureDisabled("button.dictation")}
                        className={cn(
                          "p-1.5 hover:bg-muted rounded transition-colors ml-1 border border-border h-8 w-8 flex items-center justify-center",
                          speechListening && "bg-sn-green/15 text-sn-green border-sn-green"
                        )}
                        title={speechListening ? "Stop Dictation" : "Dictation"}
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  </>
                  )}
                </div>
                {isFeatureVisible("field.description") && (
                <div className="grid grid-cols-6 items-start gap-4">
                  <label className="text-[11px] text-right font-medium uppercase leading-tight mt-1">Description</label>
                  <div className="col-span-5 space-y-1.5">
                    <textarea
                      rows={4}
                      value={newTicket.description}
                      onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                      className={cn(
                        getInputClassName("field.description", "w-full p-1.5 border rounded text-xs focus:ring-1 focus:ring-sn-green resize-none h-32 transition-all"),
                        suggestedSolution ? 'border-purple-400 ring-1 ring-purple-300 bg-purple-50' : 'border-border'
                      )}
                      placeholder="Describe the issue in detail... or use Autofill with AI above"
                      required={getFieldRequired("field.description")}
                      disabled={isFeatureDisabled("field.description")}
                      readOnly={isFeatureReadOnly("field.description")}
                    />
                    {speechListening && (
                      <div className="text-[10px] text-sn-green font-medium">
                        Listening{speechLiveText ? `: ${speechLiveText}` : "..."}
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
              )}

              {/* Suggested Solution Box */}
              {suggestedSolution && isFeatureVisible("section.suggestedSolution") && (
                <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <h4 className="text-purple-800 font-semibold mb-2 flex items-center gap-2">
                    <span>✨</span> AI filled your description
                    <span className="text-[10px] font-normal text-purple-500 ml-auto">You can edit it above</span>
                  </h4>
                  <p className="text-xs text-purple-700 italic line-clamp-3">{suggestedSolution}</p>
                  {isFeatureVisible("button.dismissSuggestedSolution") && (
                    <button type="button" onClick={() => setSuggestedSolution(null)}
                      disabled={isFeatureDisabled("button.dismissSuggestedSolution")}
                      className="mt-2 text-[10px] text-purple-400 hover:text-purple-600 underline disabled:opacity-50">
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {/* Modal Footer */}
              {isFeatureVisible("section.footer") && (
                <div className="flex justify-end gap-3 pt-6 border-t border-border mt-8">
                  {isFeatureVisible("button.cancel") && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeModal}
                      disabled={isFeatureDisabled("button.cancel")}
                      className="px-6 h-8 text-[11px] font-bold uppercase tracking-wider"
                    >
                      Cancel
                    </Button>
                  )}
                  {isFeatureVisible("button.submit") && (
                    <Button
                      type="submit"
                      disabled={isSubmitting || suggestedSolution !== null || isFeatureDisabled("button.submit")}
                      className="bg-sn-green text-sn-dark hover:bg-sn-green/90 px-8 h-8 text-[11px] font-bold uppercase tracking-wider shadow-sm disabled:opacity-50"
                    >
                      {isSubmitting ? "Submitting..." : "Submit"}
                    </Button>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
