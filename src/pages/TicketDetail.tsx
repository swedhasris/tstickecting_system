import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, addDoc, query, orderBy, getDocs, where, setDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { ROLE_HIERARCHY, Role } from "../lib/roles";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send, History, MessageSquare, Save, Trash2, CheckCircle2, Clock, Plus, Star, Play, Square, Eye, AlertCircle, Lock, Globe, Users, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLATimer } from "../components/SLATimer";
import { useServiceCatalog } from "../lib/serviceCatalog";
import { calculateSLADeadline } from "../lib/slaUtils";
import confetti from "canvas-confetti";
import { captureScreenshot, analyzeWorkContext, saveWorkSession, type WorkAnalysis } from "../lib/workSessionAI";
import { ActivityTimeline } from "../components/ActivityTimeline";

export function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { categories, subcategories, serviceProviders, groups } = useServiceCatalog();

  const [ticket, setTicket] = useState<any>(null);
  const [editedTicket, setEditedTicket] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [workNote, setWorkNote] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);

  // Timer state
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStartTime, setTimerStartTime] = useState<Date | null>(null);
  const timerStartTimeRef = useRef<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [workDescription, setWorkDescription] = useState("");
  const [workSummary, setWorkSummary] = useState("");

  // AI Work Session state
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiNotes, setAiNotes] = useState<WorkAnalysis | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = useState("");

  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const [isPosting, setIsPosting] = useState(false);
  const [postMessage, setPostMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);


  const visibleCategories = categories.filter((item) => item.status === 'active');
  const visibleSubcategories = subcategories.filter(s => s.categoryId === editedTicket?.categoryId && s.status === 'active');
  const visibleProviders = serviceProviders.filter(p => p.subcategoryId === editedTicket?.subcategoryId && p.status === 'active');
  const visibleGroups = groups.filter(g => g.serviceProviderId === editedTicket?.serviceId && g.status === 'active');

  useEffect(() => {
    getDocs(collection(db, "users")).then(snap => {
      const usersList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAgents(usersList.filter((u: any) => ROLE_HIERARCHY[u.role as Role] >= ROLE_HIERARCHY["agent"]));
    }).catch(() => {
      // Fallback: load agents from MySQL API
      fetch('/api/users').then(r => r.json()).then((usersList: any[]) => {
        setAgents(usersList.filter((u: any) => ['agent', 'admin', 'sub_admin', 'super_admin', 'ultra_super_admin'].includes(u.role)));
      }).catch(() => { });
    });
  }, []);

  // DYNAMIC GROUP FILTERING: Only show users belonging to the selected group
  const selectedGroupObj = groups.find(g => g.name === editedTicket?.assignmentGroup);
  const filteredAgents = agents.filter(a =>
    selectedGroupObj?.memberIds?.includes(a.id) || selectedGroupObj?.memberIds?.includes(a.uid)
  );

  // Load active timer state from Firestore on mount
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const userData = docSnapshot.data();
        const activeTimer = userData.activeTimer;
        if (activeTimer && activeTimer.isRunning) {
          const startTime = new Date(activeTimer.startTime);
          const now = new Date();
          const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
          setIsTimerRunning(true);
          setTimerStartTime(startTime);
          timerStartTimeRef.current = startTime;
          setElapsedTime(elapsed);
        } else {
          setIsTimerRunning(false);
          // Don't clear timerStartTime or elapsedTime here - preserve it for the modal/saving
        }
      }
    });

    return unsubscribe;
  }, [user]);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning && timerStartTime) {
      interval = setInterval(() => {
        const now = new Date();
        const elapsed = now.getTime() - timerStartTime.getTime();
        setElapsedTime(Math.floor(elapsed / 1000)); // in seconds
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerStartTime]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = onSnapshot(doc(db, "tickets", id), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = { id: docSnapshot.id, ...docSnapshot.data() };
        setTicket(data);
        setEditedTicket((prev: any) => prev ? prev : data);
      } else {
        navigate("/tickets");
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `tickets/${id}`);
    });
    return unsubscribe;
  }, [id, navigate]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "tickets", id, "comments"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `tickets/${id}/comments`);
    });
    return unsubscribe;
  }, [id]);

  const handleUpdate = async () => {
    if (!id || !user || !editedTicket) return;
    setIsUpdating(true);

    // Auto-save timer time to timesheet if timer has been running
    if (elapsedTime > 0 && (timerStartTime || timerStartTimeRef.current)) {
      try {
        await saveTimerEntry(
          `Work on incident ${ticket.number}`,
          `Ticket ${ticket.number}`
        );
      } catch (e) {
        console.error("[TicketDetail] Auto-save timer failed:", e);
      }
    }

    try {
      const historyEntries: any[] = [];
      const fields = ["category", "categoryId", "subcategory", "subcategoryId", "service", "serviceId", "serviceProvider", "status", "impact", "urgency", "assignmentGroup", "title", "description", "assignedTo", "affectedUser", "resolutionCode", "resolutionNotes", "resolutionMethod", "closureReason", "watchList", "workNotesList", "businessPhone", "location", "configurationItem", "computerName", "knowledgeArticleUsed", "originalAssignmentGroup", "acknowledged", "passwordReset", "rackspaceTicketNo", "additionalInformation"];

      const fieldChanges: any[] = [];

      fields.forEach(field => {
        if (editedTicket[field] !== (ticket[field] || "")) {
          const entry = {
            action: `Field ${field} updated from ${ticket[field] || "none"} to ${editedTicket[field] || "none"}`,
            timestamp: new Date().toISOString(),
            user: profile?.name || user.email
          };
          historyEntries.push(entry);

          // Capture for activities API
          fieldChanges.push({
            fieldName: field,
            oldValue: ticket[field] || "none",
            newValue: editedTicket[field] || "none"
          });
        }
      });

      // Special check: If only resolution notes/code were changed, but no other fields in the list, we still want to save.
      // The 'Submit' button should always save editedTicket.

      const { id: _, ...payload } = editedTicket;

      const assignedUserName = editedTicket.assignedTo
        ? agents.find(a => a.id === editedTicket.assignedTo)?.name
        || agents.find(a => a.id === editedTicket.assignedTo)?.email
        || editedTicket.assignedToName || ""
        : "";

      const updates: any = {
        ...payload,
        assignedToName: assignedUserName,
        updatedAt: serverTimestamp(),
        history: [...(ticket.history || []), ...historyEntries]
      };

      const isResolved = editedTicket.status === "Resolved" || editedTicket.status === "Closed";
      const isPaused = editedTicket.status === "On Hold" || editedTicket.status === "Waiting for Customer" || editedTicket.status === "Awaiting User" || editedTicket.status === "Awaiting Vendor";

      if (editedTicket.status !== ticket.status) {

        // Stop Response SLA if the state is changed out of "New" (i.e. acknowledging the ticket)
        if (editedTicket.status !== "New" && !ticket.firstResponseAt) {
          const responseNow = new Date();
          updates.firstResponseAt = responseNow.toISOString();
          updates.responseSlaStatus = "Completed";

          // START Resolution SLA from this moment using stored SLA metadata
          updates.resolutionSlaStatus = "In Progress";
          const resHours = ticket.slaResolutionHours || 24;
          updates.resolutionDeadline = calculateSLADeadline(responseNow, resHours, {
            businessHours: ticket.businessHours,
            excludeWeekends: ticket.excludeWeekends,
            excludeHolidays: ticket.excludeHolidays
          }).toISOString();
          updates.resolutionSlaStartTime = responseNow.toISOString();
        }

        if (isResolved && !ticket.resolvedAt) {
          updates.resolvedAt = new Date().toISOString();
          updates.resolvedBy = profile?.name || user.email;
          updates.resolutionSlaStatus = "Completed";
          updates.onHoldStart = null;

          // Ensure resolution fields are present if being resolved
          if (!editedTicket.resolutionCode || !editedTicket.resolutionNotes || !editedTicket.resolutionMethod) {
            alert("Please provide Resolution Code, Resolution Method, and Resolution Notes before resolving.");
            setIsUpdating(false);
            return;
          }

          // Calculate resolution duration
          const createdAtMs = ticket.createdAt?.seconds ? ticket.createdAt.seconds * 1000 : (typeof ticket.createdAt === 'string' ? new Date(ticket.createdAt).getTime() : Date.now());
          const resolvedAtMs = Date.now();
          const durationMs = resolvedAtMs - createdAtMs;
          updates.resolutionDuration = Math.max(0, durationMs);
        } else if (!isResolved && ticket.resolvedAt) {
          updates.resolvedAt = null;
          updates.resolvedBy = null;
          updates.resolutionDuration = null;
          updates.resolutionSlaStatus = "In Progress";
        }

        if (isPaused && !isResolved) {
          updates.onHoldStart = new Date().toISOString();
        } else if ((ticket.status === "On Hold" || ticket.status === "Waiting for Customer" || ticket.status === "Awaiting User" || ticket.status === "Awaiting Vendor") && !isPaused) {
          const onHoldStartStr = ticket.onHoldStart || new Date().toISOString();
          const onHoldStart = new Date(onHoldStartStr).getTime();
          const now = new Date().getTime();
          const pauseDuration = Math.max(0, now - onHoldStart);

          const totalPaused = (Number(ticket.totalPausedTime) || 0) + pauseDuration;
          updates.totalPausedTime = totalPaused;
          updates.onHoldStart = null;

          if (ticket.resolutionDeadline) {
            const oldRes = new Date(ticket.resolutionDeadline).getTime();
            if (!isNaN(oldRes)) updates.resolutionDeadline = new Date(oldRes + pauseDuration).toISOString();
          }
          if (ticket.responseDeadline && !ticket.firstResponseAt) {
            const oldResp = new Date(ticket.responseDeadline).getTime();
            if (!isNaN(oldResp)) updates.responseDeadline = new Date(oldResp + pauseDuration).toISOString();
          }
        }
      }

      // --- ADVANCED SCORING LOGIC ---
      let pointsAwarded = 0;
      if (isResolved && !ticket.resolvedAt) {
        // 1. Priority Base Points
        const priorityStr = ticket.priority || "4 - Low";
        let basePoints = 10;
        if (priorityStr.includes("1")) basePoints = 100;
        else if (priorityStr.includes("2")) basePoints = 50;
        else if (priorityStr.includes("3")) basePoints = 25;

        pointsAwarded += basePoints;

        // 2. Response Bonus (if acknowledged on time)
        if (ticket.responseSlaStatus === "Completed") {
          pointsAwarded += 50;
        }

        // 3. Resolution Speed Bonus
        if (ticket.resolutionDeadline) {
          const deadline = new Date(ticket.resolutionDeadline).getTime();
          const resolvedAtMs = new Date().getTime();
          const createdAtMs = ticket.createdAt?.seconds ? ticket.createdAt.seconds * 1000 : (typeof ticket.createdAt === 'string' ? new Date(ticket.createdAt).getTime() : 0);

          if (createdAtMs > 0 && resolvedAtMs < deadline) {
            const totalSla = deadline - createdAtMs;
            const timeSaved = deadline - resolvedAtMs;
            const speedBonus = Math.round((timeSaved / totalSla) * 100);
            pointsAwarded += Math.max(speedBonus, 10); // Min 10 points for meeting SLA
          } else if (resolvedAtMs >= deadline) {
            pointsAwarded = Math.round(pointsAwarded * 0.5); // Penalty: 50% points if breached
          }
        }
      }

      const ticketRef = doc(db, "tickets", id);
      const finalUpdates = {
        ...updates,
        points: pointsAwarded > 0 ? (ticket.points || 0) + pointsAwarded : (ticket.points || 0)
      };

      await updateDoc(ticketRef, finalUpdates);

      // Dispatch real-time notification
      try {
        fetch("/api/notifications/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticket: {
              id: id,
              ticket_number: ticket.number,
              created_by: ticket.createdBy,
              created_by_name: ticket.createdByName || ticket.caller,
              assigned_to: finalUpdates.assignedTo !== undefined ? finalUpdates.assignedTo : ticket.assignedTo,
              assigned_to_name: finalUpdates.assignedToName !== undefined ? finalUpdates.assignedToName : ticket.assignedToName,
              status: finalUpdates.status !== undefined ? finalUpdates.status : ticket.status,
              priority: finalUpdates.priority !== undefined ? finalUpdates.priority : ticket.priority
            },
            actorId: user.uid,
            actorName: profile?.name || user.email,
            type: "update",
            oldStatus: ticket.status,
            newStatus: finalUpdates.status !== undefined ? finalUpdates.status : ticket.status,
            oldAssignee: ticket.assignedTo,
            newAssignee: finalUpdates.assignedTo !== undefined ? finalUpdates.assignedTo : ticket.assignedTo
          })
        });
      } catch (e) {
        console.error("Failed to dispatch update notification:", e);
      }

      // Log status change and other field changes to activity timeline
      if (fieldChanges.length > 0) {
        try {
          const isResolving = (editedTicket.status === "Resolved" || editedTicket.status === "Closed") && ticket.status !== "Resolved" && ticket.status !== "Closed";

          // Log each field change individually for the timeline
          for (const change of fieldChanges) {
            await fetch(`/api/tickets/${id}/activities`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                activity_type: change.fieldName === 'status' ? (isResolving ? 'resolution' : 'status_change') : 'field_change',
                visibility_type: 'public',
                created_by: user.uid,
                created_by_name: profile?.name || user.email,
                message: change.fieldName === 'status' && isResolving
                  ? `Ticket resolved with code: ${editedTicket.resolutionCode}. Method: ${editedTicket.resolutionMethod}`
                  : `Changed ${change.fieldName.replace(/([A-Z])/g, ' $1').trim()} from "${change.oldValue}" to "${change.newValue}"`,
                metadata_json: {
                  fieldName: change.fieldName,
                  oldValue: change.oldValue,
                  newValue: change.newValue,
                  resolutionCode: editedTicket.resolutionCode,
                  resolutionMethod: editedTicket.resolutionMethod,
                  closureReason: editedTicket.closureReason,
                  resolutionNotes: editedTicket.resolutionNotes
                }
              })
            });
          }
          setTimelineRefresh(prev => prev + 1);
        } catch (e) { /* non-critical */ }
      }

      // Log assignment change to activity timeline
      if (editedTicket.assignedTo !== ticket.assignedTo) {
        try {
          const newAgent = agents.find(a => a.id === editedTicket.assignedTo);
          const oldAgent = agents.find(a => a.id === ticket.assignedTo);
          await fetch(`/api/tickets/${id}/activities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activity_type: 'assignment_change',
              visibility_type: 'internal',
              created_by: user.uid,
              created_by_name: profile?.name || user.email,
              message: `Assignment changed from "${oldAgent?.name || ticket.assignedToName || 'Unassigned'}" to "${newAgent?.name || assignedUserName || 'Unassigned'}"`,
              metadata_json: { oldAssignee: oldAgent?.name || ticket.assignedToName, newAssignee: newAgent?.name || assignedUserName }
            })
          });
          setTimelineRefresh(prev => prev + 1);
        } catch (e) { /* non-critical */ }
      }

      if (pointsAwarded > 0) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#22c55e", "#fbbf24", "#3b82f6"]
        });
        alert(`Awesome resolution! You earned ${pointsAwarded} points!\n\nBreakdown:\n- Priority Base: Included\n- Response Bonus: ${ticket.responseSlaStatus === "Completed" ? "Yes" : "No"}\n- Speed Bonus: Applied`);
        setTimeout(() => navigate("/tickets"), 1500);
      } else {
        alert("Incident updated successfully");
        if (isResolved) navigate("/tickets");
      }
    } catch (error: any) {
      console.error("Error updating ticket:", error);
      alert(`Failed to update incident: ${error.message || "Unknown error"}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !id || !user) return;
    setIsPosting(true);
    try {
      // Post to API-backed activity timeline (customer-visible comment)
      const res = await fetch(`/api/tickets/${id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type: 'comment',
          visibility_type: 'public',
          created_by: user.uid,
          created_by_name: profile?.name || user.email,
          message: newComment.trim()
        })
      });
      if (!res.ok) throw new Error('Failed to post comment');

      // Update Firestore ticket metadata (SLA first response)
      try {
        const now = new Date().toISOString();
        const updates: any = { updatedAt: serverTimestamp(), history: [...(ticket.history || []), { action: "Comment Added", timestamp: now, user: profile?.name || user.email }] };
        if (!ticket.firstResponseAt) {
          updates.firstResponseAt = now;
          updates.responseSlaStatus = "Completed";
          // START Resolution SLA from this moment
          updates.resolutionSlaStatus = "In Progress";
          const resHours = ticket.slaResolutionHours || 24;
          const resolutionWindowMs = resHours * 60 * 60 * 1000;
          updates.resolutionDeadline = new Date(new Date(now).getTime() + resolutionWindowMs).toISOString();
          updates.resolutionSlaStartTime = now;
        }
        await updateDoc(doc(db, "tickets", id), updates);
      } catch (e) { /* Firestore update non-critical */ }

      setNewComment("");
      setTimelineRefresh(prev => prev + 1);
      setPostMessage({ text: 'Comment posted successfully', type: 'success' });
      setTimeout(() => setPostMessage(null), 3000);
    } catch (error: any) {
      console.error(error);
      setPostMessage({ text: 'Failed to post comment', type: 'error' });
      setTimeout(() => setPostMessage(null), 4000);
    } finally {
      setIsPosting(false);
    }
  };

  const handleAddWorkNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workNote.trim() || !id || !user) return;
    setIsPosting(true);
    try {
      // Post to API-backed activity timeline (internal/private work note)
      const res = await fetch(`/api/tickets/${id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type: 'work_note',
          visibility_type: 'internal',
          created_by: user.uid,
          created_by_name: profile?.name || user.email,
          message: workNote.trim()
        })
      });
      if (!res.ok) throw new Error('Failed to post work note');

      // Update Firestore ticket metadata
      try {
        const now = new Date().toISOString();
        const updates: any = { updatedAt: serverTimestamp(), history: [...(ticket.history || []), { action: "Work Note Added", timestamp: now, user: profile?.name || user.email }] };
        if (!ticket.firstResponseAt) {
          updates.firstResponseAt = now;
          updates.responseSlaStatus = "Completed";
          // START Resolution SLA from this moment
          updates.resolutionSlaStatus = "In Progress";
          const resHours = ticket.slaResolutionHours || 24;
          updates.resolutionDeadline = calculateSLADeadline(new Date(now), resHours, {
            businessHours: ticket.businessHours,
            excludeWeekends: ticket.excludeWeekends,
            excludeHolidays: ticket.excludeHolidays
          }).toISOString();
          updates.resolutionSlaStartTime = now;
        }
        await updateDoc(doc(db, "tickets", id), updates);
      } catch (e) { /* Firestore update non-critical */ }

      setWorkNote("");
      setTimelineRefresh(prev => prev + 1);
      setPostMessage({ text: 'Work note added successfully', type: 'success' });
      setTimeout(() => setPostMessage(null), 3000);
    } catch (error: any) {
      console.error(error);
      setPostMessage({ text: 'Failed to add work note', type: 'error' });
      setTimeout(() => setPostMessage(null), 4000);
    } finally {
      setIsPosting(false);
    }
  };

  const updateLocalField = (field: string, value: string) => {
    setEditedTicket((prev: any) => ({ ...prev, [field]: value }));
  };

  // Timer functions — AI-Enhanced
  const handleStartTimer = async () => {
    const startTime = new Date();
    setIsTimerRunning(true);
    setTimerStartTime(startTime);
    timerStartTimeRef.current = startTime;
    setElapsedTime(0);
    setAiProcessing(true);
    setAiStatusMessage("📸 Capturing work context...");

    // Save active timer state to Firestore for real-time sync
    try {
      await setDoc(doc(db, "users", user.uid), {
        activeTimer: {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          startTime: startTime.toISOString(),
          isRunning: true
        }
      }, { merge: true });
    } catch (error) {
      console.error("Error saving active timer state:", error);
    }

    // AI: Capture screenshot context + analyze
    try {
      setAiStatusMessage("🔍 Analyzing your current work...");
      const context = await captureScreenshot();

      setAiStatusMessage("🤖 AI is generating work notes...");
      const analysis = await analyzeWorkContext(
        context,
        ticket.number,
        ticket.title || '',
        'start'
      );

      setAiNotes(analysis);

      // Auto-populate work note
      const noteText = `▶ [${startTime.toLocaleTimeString()}] ${analysis.summary}`;
      setWorkNote(prev => prev ? `${prev}\n${noteText}` : noteText);

      // Save work session
      setAiStatusMessage("💾 Saving work session...");
      const session = await saveWorkSession({
        user_id: user.uid,
        user_name: profile?.name || user.email || '',
        ticket_id: ticket.id,
        ticket_number: ticket.number,
        start_time: startTime.toISOString(),
        start_context: context,
        ai_notes_start: analysis.summary,
        status: 'active'
      });
      setActiveSessionId(session.id);

      setAiStatusMessage("✅ AI notes generated successfully!");
      setTimeout(() => setAiStatusMessage(""), 3000);
    } catch (error) {
      console.error("[AI WorkSession] Start analysis failed:", error);
      setAiStatusMessage("⚠️ AI notes unavailable — timer running");
      setTimeout(() => setAiStatusMessage(""), 3000);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleStopTimer = async () => {
    const stopTime = new Date();
    let finalElapsed = elapsedTime;

    if (timerStartTime) {
      finalElapsed = Math.floor((stopTime.getTime() - timerStartTime.getTime()) / 1000);
      setElapsedTime(finalElapsed);
    }
    setIsTimerRunning(false);
    setAiProcessing(true);
    setAiStatusMessage("📸 Capturing final work context...");

    // Clear active timer state from Firestore
    try {
      await setDoc(doc(db, "users", user.uid), {
        activeTimer: null
      }, { merge: true });
    } catch (error) {
      console.error("Error clearing active timer state:", error);
    }

    // AI: Capture stop screenshot context + analyze
    try {
      setAiStatusMessage("🔍 Analyzing completed work...");
      const stopContext = await captureScreenshot();

      setAiStatusMessage("🤖 AI is generating completion notes...");
      const analysis = await analyzeWorkContext(
        stopContext,
        ticket.number,
        ticket.title || '',
        'stop',
        finalElapsed
      );

      setAiNotes(analysis);

      // Auto-append stop note to work notes
      const stopNote = `⏹ [${stopTime.toLocaleTimeString()}] ${analysis.summary}`;
      setWorkNote(prev => prev ? `${prev}\n${stopNote}` : stopNote);

      // Pre-fill the modal
      setWorkDescription(analysis.summary);
      setWorkSummary(`${analysis.actionVerb} — ${ticket.number}`);

      // Update work session
      if (activeSessionId) {
        setAiStatusMessage("💾 Saving completed session...");
        try {
          await fetch(`/api/work-sessions/${activeSessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stop_time: stopTime.toISOString(),
              duration: finalElapsed,
              stop_context: stopContext,
              ai_notes_stop: analysis.summary,
              status: 'completed'
            })
          });
        } catch (e) {
          console.error("[AI WorkSession] Failed to update session:", e);
        }
      }

      setAiStatusMessage("✅ Work notes generated! Review and save.");
      setTimeout(() => setAiStatusMessage(""), 4000);
    } catch (error) {
      console.error("[AI WorkSession] Stop analysis failed:", error);
      setAiStatusMessage("⚠️ AI notes unavailable");
      setTimeout(() => setAiStatusMessage(""), 3000);
    } finally {
      setAiProcessing(false);
    }

    setShowTimerModal(true);
  };

  const formatElapsedTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleViewTimer = () => {
    // Navigate to timesheet or show current time entries
    navigate("/timesheet");
  };

  const saveTimerEntry = async (desc?: string, summary?: string) => {
    const startTimeToSave = timerStartTimeRef.current || timerStartTime;
    if (!user || !ticket || !startTimeToSave || elapsedTime <= 0) return;

    const minutes = Math.floor(elapsedTime / 60);
    if (minutes <= 0) return;

    const dateStr = new Date().toISOString().split("T")[0];

    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    const weekStart = monday.toISOString().split("T")[0];
    const weekEnd = new Date(monday.getTime() + 6 * 86400000).toISOString().split("T")[0];

    const tsRes = await fetch("/api/timesheets/get-or-create", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.uid,
        week_start: weekStart,
        week_end: weekEnd
      })
    });
    if (!tsRes.ok) throw new Error("Failed to get/create timesheet");
    const ts = await tsRes.json();

    const tcRes = await fetch("/api/time-cards", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timesheet_id: ts.id,
        user_id: user.uid,
        entry_date: dateStr,
        task: summary || `Ticket ${ticket.ticket_number || ticket.number}`,
        description: desc || `Work on incident ${ticket.number}`,
        hours_worked: minutes,
        start_time: startTimeToSave.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        end_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        work_type: "Remote",
        billable: "Billable"
      })
    });
    if (!tcRes.ok) throw new Error("Failed to create time card");

    // Reset timer state
    setIsTimerRunning(false);
    setTimerStartTime(null);
    timerStartTimeRef.current = null;
    setElapsedTime(0);
    try {
      await setDoc(doc(db, "users", user.uid), { activeTimer: null }, { merge: true });
    } catch (error) {
      console.error("Error clearing active timer:", error);
    }
  };

  const handleSaveTimeEntry = async () => {
    const startTimeToSave = timerStartTimeRef.current || timerStartTime;
    if (!user || !ticket || !startTimeToSave) {
      alert("Timer start time not found. Please try starting the timer again.");
      return;
    }

    try {
      await saveTimerEntry(workDescription, workSummary || workDescription);
      setShowTimerModal(false);
      setWorkDescription("");
      setWorkSummary("");
      alert("Time entry saved to timesheet!");
    } catch (error: any) {
      console.error("Error saving time entry:", error);
      alert(`Failed to save time entry: ${error.message}`);
    }
  };

  const handleCancelTimer = async () => {
    setIsTimerRunning(false);
    setTimerStartTime(null);
    timerStartTimeRef.current = null;
    setElapsedTime(0);
    setShowTimerModal(false);
    setWorkDescription("");
    setWorkSummary("");

    // Clear active timer state from Firestore
    try {
      await setDoc(doc(db, "users", user.uid), {
        activeTimer: null
      }, { merge: true });
    } catch (error) {
      console.error("Error clearing active timer state:", error);
    }
  };

  const formatDate = (date: any) => {
    if (!date) return "-";
    try {
      if (typeof date.toDate === "function") {
        const d = date.toDate();
        return isNaN(d.getTime()) ? "-" : d.toLocaleString();
      }
      if (typeof date === "string") {
        const d = new Date(date);
        return isNaN(d.getTime()) ? "-" : d.toLocaleString();
      }
      if (date.seconds !== undefined) {
        const d = new Date(Number(date.seconds) * 1000);
        return isNaN(d.getTime()) ? "-" : d.toLocaleString();
      }
    } catch (e) {
      return "-";
    }
    return "-";
  };

  const [activeTab, setActiveTab] = useState("Notes");

  if (!ticket) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-3 border border-border rounded-lg shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/tickets")} className="gap-2 h-8 px-2">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider leading-none mb-1">Incident</span>
            <span className="text-sm font-bold leading-none">{ticket.number}</span>
          </div>
          {ticket.points > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow-400/10 text-yellow-600 border border-yellow-400/20 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">
              <Star className="w-3 h-3 fill-current" />
              {ticket.points} Points Earned
            </div>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 border-r border-border pr-6 hidden md:flex">
            <SLATimer
              label="Resp SLA"
              deadline={ticket.responseDeadline}
              startTime={ticket.responseSlaStartTime || ticket.createdAt}
              metAt={ticket.firstResponseAt || (editedTicket.status !== "New" ? new Date().toISOString() : undefined)}
              isPaused={editedTicket.status === "On Hold" || editedTicket.status === "Waiting for Customer" || editedTicket.status === "Awaiting User" || editedTicket.status === "Awaiting Vendor"}
              onHoldStart={ticket.onHoldStart}
              totalPausedTime={ticket.totalPausedTime}
            />
            <SLATimer
              label="Res SLA"
              deadline={ticket.resolutionDeadline}
              startTime={ticket.resolutionSlaStartTime || ticket.createdAt}
              metAt={ticket.resolvedAt || (editedTicket.status === "Resolved" || editedTicket.status === "Closed" ? new Date().toISOString() : undefined)}
              isPaused={editedTicket.status === "On Hold" || editedTicket.status === "Waiting for Customer" || editedTicket.status === "Awaiting User" || editedTicket.status === "Awaiting Vendor"}
              onHoldStart={ticket.onHoldStart}
              totalPausedTime={ticket.totalPausedTime}
              waitUntil={ticket.firstResponseAt || (editedTicket.status !== "New" ? new Date().toISOString() : null)}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* AI Status Message */}
            {aiStatusMessage && (
              <div className="mr-4 flex items-center gap-2 animate-in fade-in slide-in-from-right-4">
                <div className="w-2 h-2 bg-sn-green rounded-full animate-ping" />
                <span className="text-[10px] font-bold text-sn-green uppercase tracking-wider">{aiStatusMessage}</span>
              </div>
            )}

            {/* Timer Display */}
            {isTimerRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg shadow-sm">
                <div className="relative">
                  <Clock className="w-4 h-4 text-red-600" />
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-600 rounded-full animate-ping" />
                </div>
                <span className="font-mono text-sm font-bold text-red-700">{formatElapsedTime(elapsedTime)}</span>
              </div>
            )}

            {/* Timer Buttons */}
            {!isTimerRunning ? (
              <Button
                size="sm"
                onClick={handleStartTimer}
                disabled={aiProcessing}
                className={cn(
                  "h-8 px-4 font-bold text-white shadow-md transition-all duration-300",
                  aiProcessing ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700 hover:shadow-green-200 active:scale-95"
                )}
              >
                {aiProcessing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5" />
                ) : (
                  <Play className="w-3 h-3 mr-1.5 fill-current" />
                )}
                {aiProcessing ? "Capturing..." : "Start"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleStopTimer}
                disabled={aiProcessing}
                className={cn(
                  "h-8 px-4 font-bold text-white shadow-md transition-all duration-300",
                  aiProcessing ? "bg-gray-400 cursor-not-allowed" : "bg-red-600 hover:bg-red-700 hover:shadow-red-200 active:scale-95"
                )}
              >
                {aiProcessing ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5" />
                ) : (
                  <Square className="w-3 h-3 mr-1.5 fill-current" />
                )}
                {aiProcessing ? "Analyzing..." : "Stop"}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleViewTimer}
              className="h-8 px-4 font-bold border-border bg-white text-sn-dark hover:bg-gray-50 transition-colors"
            >
              <Eye className="w-3 h-3 mr-1.5" />
              View
            </Button>

            <Button variant="outline" size="sm" onClick={handleUpdate} disabled={isUpdating} className="h-8 px-4 font-bold border-border bg-white text-sn-dark">Update</Button>
            <Button size="sm" onClick={handleUpdate} disabled={isUpdating} className="h-8 px-4 font-bold bg-sn-green text-sn-dark shadow-sm hover:bg-sn-green/90 transition-all hover:shadow-sn-green/20">Submit</Button>
          </div>
        </div>
      </div>

      {/* Main Form Section */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <div className="bg-white border border-border rounded-lg shadow-sm p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
            <div className="space-y-4">
              {/* Number */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Number</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8" value={ticket.number} />
              </div>

              {/* Reporting User */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Reporting User</label>
                <div className="col-span-2 flex gap-1">
                  <input readOnly className="flex-grow p-1.5 bg-muted/30 border border-border rounded text-xs h-8" value={ticket.caller || ''} />
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Affected User */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Affected User</label>
                <div className="col-span-2 flex gap-1">
                  <input
                    value={editedTicket?.affectedUser || ""}
                    onChange={(e) => updateLocalField("affectedUser", e.target.value)}
                    className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                  />
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Business Phone */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Business phone</label>
                <input
                  value={editedTicket?.businessPhone || ""}
                  onChange={(e) => updateLocalField("businessPhone", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                />
              </div>

              {/* Location */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Location</label>
                <div className="col-span-2 flex gap-1">
                  <input
                    value={editedTicket?.location || ""}
                    onChange={(e) => updateLocalField("location", e.target.value)}
                    className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                  />
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Category */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Category</label>
                <select
                  value={editedTicket?.categoryId || ""}
                  onChange={(e) => {
                    const category = visibleCategories.find((item) => item.id === e.target.value);
                    setEditedTicket((prev: any) => ({ ...prev, categoryId: e.target.value, category: category?.name || "", subcategoryId: "", subcategory: "", serviceId: "", service: "", serviceProvider: "", assignmentGroup: "" }));
                  }}
                  className="col-span-2 p-1.5 border border-border rounded text-xs outline-none h-8 transition-colors focus:ring-1 focus:ring-sn-green"
                >
                  {visibleCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>

              {/* Configuration Item */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Configuration item</label>
                <div className="col-span-2 flex gap-1">
                  <input
                    value={editedTicket?.configurationItem || ""}
                    onChange={(e) => updateLocalField("configurationItem", e.target.value)}
                    className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                  />
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Computer Name */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Computer Name</label>
                <div className="col-span-2 flex gap-1">
                  <input
                    value={editedTicket?.computerName || ""}
                    onChange={(e) => updateLocalField("computerName", e.target.value)}
                    className="flex-grow p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8"
                  />
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Impact */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Impact</label>
                <select
                  value={editedTicket?.impact || ""}
                  onChange={(e) => updateLocalField("impact", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green transition-colors"
                >
                  <option>1 - High</option>
                  <option>2 - Medium</option>
                  <option>3 - Low</option>
                </select>
              </div>

              {/* Urgency */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Urgency</label>
                <select
                  value={editedTicket?.urgency || ""}
                  onChange={(e) => updateLocalField("urgency", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 outline-none focus:ring-1 focus:ring-sn-green transition-colors"
                >
                  <option>1 - High</option>
                  <option>2 - Medium</option>
                  <option>3 - Low</option>
                </select>
              </div>

              {/* Priority */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Priority</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-bold text-blue-600 h-8" value={editedTicket?.priority || ""} />
              </div>

              {/* Knowledge Article Used */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Knowledge Article Used?</label>
                <input
                  type="checkbox"
                  checked={editedTicket?.knowledgeArticleUsed || false}
                  onChange={(e) => updateLocalField("knowledgeArticleUsed", e.target.checked as any)}
                  className="w-4 h-4 accent-sn-green"
                />
              </div>
            </div>

            <div className="space-y-4">
              {/* Opened */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8" value={formatDate(ticket.createdAt)} />
              </div>

              {/* Opened by */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Opened by</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8" value={ticket.createdByEmail || ticket.createdBy || '-'} />
              </div>

              {/* State */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">State</label>
                <select value={editedTicket?.status || ""} onChange={(e) => updateLocalField("status", e.target.value)} className="col-span-2 p-1.5 border border-border rounded text-xs outline-none h-8 focus:ring-1 focus:ring-sn-green transition-colors">
                  {["New", "In Progress", "On Hold", "Awaiting User", "Awaiting Vendor", "Resolved", "Closed", "Canceled"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Assignment group */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assignment group</label>
                <div className="col-span-2 flex gap-1">
                  <select className="flex-grow p-1.5 border border-border rounded text-xs outline-none h-8 focus:ring-1 focus:ring-sn-green" value={editedTicket?.assignmentGroup || ""} onChange={(e) => updateLocalField("assignmentGroup", e.target.value)}>
                    <option value="">-- None --</option>
                    {editedTicket?.assignmentGroup && !visibleGroups.some(g => g.name === editedTicket.assignmentGroup) && (
                      <option value={editedTicket.assignmentGroup}>{editedTicket.assignmentGroup}</option>
                    )}
                    {(visibleGroups.length > 0 ? visibleGroups : groups.filter(g => g.status === 'active')).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Search className="w-3 h-3" /></Button>
                </div>
              </div>

              {/* Assigned to */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Assigned to</label>
                <div className="col-span-2 flex gap-1">
                  <select className="flex-grow p-1.5 border border-border rounded text-xs outline-none h-8 focus:ring-1 focus:ring-sn-green" value={editedTicket?.assignedTo || ""} onChange={(e) => updateLocalField("assignedTo", e.target.value)}>
                    <option value="">-- None --</option>
                    {editedTicket?.assignedTo && !filteredAgents.some(a => a.id === editedTicket.assignedTo || a.uid === editedTicket.assignedTo) && (
                      <option value={editedTicket.assignedTo}>{editedTicket.assignedToName || editedTicket.assignedTo} (Current)</option>
                    )}
                    {filteredAgents.map(agent => (
                      <option key={agent.id} value={agent.uid || agent.id}>
                        {agent.name || agent.email}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 bg-sn-green/10 text-sn-green border-sn-green/20 hover:bg-sn-green/20"
                    title="Auto-Assign"
                    onClick={() => {
                      if (filteredAgents.length === 0) return;
                      const leastLoaded = [...filteredAgents].sort((a, b) => (a.currentWorkload || 0) - (b.currentWorkload || 0))[0];
                      updateLocalField("assignedTo", leastLoaded.uid || leastLoaded.id);
                      updateLocalField("assignedToName", leastLoaded.name || leastLoaded.email);
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Original Assignment Group */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Original Assignment Group</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs h-8"
                  value={editedTicket?.originalAssignmentGroup || editedTicket?.assignmentGroup || ""}
                />
              </div>

              {/* Acknowledged */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Acknowledged</label>
                <input
                  type="checkbox"
                  checked={editedTicket?.acknowledged || false}
                  onChange={(e) => updateLocalField("acknowledged", e.target.checked as any)}
                  className="w-4 h-4 accent-sn-green"
                />
              </div>

              {/* Channel */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Channel</label>
                <select
                  value={editedTicket?.channel || "Self-service"}
                  onChange={(e) => updateLocalField("channel", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 focus:ring-1 focus:ring-sn-green"
                >
                  <option>Self-service</option>
                  <option>Email</option>
                  <option>Phone</option>
                  <option>Chat</option>
                  <option>Portal</option>
                </select>
              </div>

              {/* Password Reset? */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Password Reset?</label>
                <select
                  value={editedTicket?.passwordReset || "No"}
                  onChange={(e) => updateLocalField("passwordReset", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 focus:ring-1 focus:ring-sn-green"
                >
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </div>

              {/* Rackspace Ticket No */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Rackspace Ticket No</label>
                <input
                  value={editedTicket?.rackspaceTicketNo || ""}
                  onChange={(e) => updateLocalField("rackspaceTicketNo", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 focus:ring-1 focus:ring-sn-green"
                />
              </div>

              {/* Additional Information */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Additional Information</label>
                <input
                  value={editedTicket?.additionalInformation || ""}
                  onChange={(e) => updateLocalField("additionalInformation", e.target.value)}
                  className="col-span-2 p-1.5 border border-border rounded text-xs h-8 focus:ring-1 focus:ring-sn-green"
                />
              </div>

              {/* SLA due */}
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">SLA due</label>
                <input readOnly className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono h-8"
                  value={formatDate(ticket.resolutionDeadline)}
                />
              </div>
            </div>

            <div className="col-span-1 md:col-span-2 mt-4 space-y-4">
              <div className="grid grid-cols-6 items-center gap-4">
                <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Short description</label>
                <input className="col-span-5 p-1.5 border border-border rounded text-xs outline-none focus:ring-1 focus:ring-sn-green h-8" value={editedTicket?.title || ""} onChange={(e) => updateLocalField("title", e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden mt-6">
        {/* Tab Headers */}
        <div className="flex bg-muted/30 border-b border-border">
          {["Notes", "Related Records", "Resolution Information", "SLA Monitoring"].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-6 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors border-r border-border h-full",
                activeTab === tab
                  ? "bg-white text-sn-dark border-b-white -mb-px"
                  : "text-muted-foreground hover:bg-white/50"
              )}
            >
              {tab}
            </button>
          ))}
          <div className="flex-grow border-b border-border"></div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "Notes" ? (
            <div className="space-y-6">
              {/* Toast Notification */}
              {postMessage && (
                <div className={cn(
                  "flex items-center gap-2 p-3 rounded-lg text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-300",
                  postMessage.type === 'success' ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                )}>
                  {postMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {postMessage.text}
                </div>
              )}

              {/* Dual-Note Input Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Work Notes (Internal/Private) */}
                <div className="rounded-lg border-2 border-amber-200 bg-gradient-to-br from-amber-50/80 to-yellow-50/30 overflow-hidden">
                  <div className="px-4 py-2.5 bg-amber-100/60 border-b border-amber-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Work Notes</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold uppercase">Internal Only</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <textarea
                      value={workNote}
                      onChange={(e) => setWorkNote(e.target.value)}
                      placeholder="Type internal work notes here... (visible only to agents)"
                      className="w-full p-3 border border-amber-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-amber-300 min-h-[120px] resize-none bg-white/80 placeholder:text-amber-400"
                    />
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[9px] text-amber-600 font-medium flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Not visible to customer
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!workNote.trim() || isPosting}
                        onClick={(e) => handleAddWorkNote(e)}
                        className="bg-amber-500 hover:bg-amber-600 text-white font-bold gap-1.5 h-8 px-4 shadow-sm disabled:opacity-50 transition-all"
                      >
                        {isPosting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-3 h-3" />}
                        Post Work Note
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Additional Comments (External/Customer Visible) */}
                <div className="rounded-lg border-2 border-blue-200 bg-gradient-to-br from-blue-50/80 to-slate-50/30 overflow-hidden">
                  <div className="px-4 py-2.5 bg-blue-100/60 border-b border-blue-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wider">Additional Comments</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 font-bold uppercase">Customer Visible</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Type comments visible to the customer here..."
                      className="w-full p-3 border border-blue-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-300 min-h-[120px] resize-none bg-white/80 placeholder:text-blue-400"
                    />
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[9px] text-blue-600 font-medium flex items-center gap-1">
                        <Globe className="w-3 h-3" /> Visible to customer
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!newComment.trim() || isPosting}
                        onClick={(e) => handleAddComment(e)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold gap-1.5 h-8 px-4 shadow-sm disabled:opacity-50 transition-all"
                      >
                        {isPosting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-3 h-3" />}
                        Post Comment
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity Timeline (API-backed) */}
              <ActivityTimeline
                ticketId={id || ''}
                createdAt={ticket.createdAt}
                refreshTrigger={timelineRefresh}
                userRole={profile?.role}
              />
            </div>
          ) : activeTab === "Related Records" ? (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* Task SLAs Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Service Level Agreements</h3>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SLATimer 
                    label="Response" 
                    deadline={ticket.responseDeadline} 
                    metAt={ticket.firstResponseAt}
                    startTime={ticket.responseSlaStartTime}
                    isPaused={ticket.status === 'On Hold' || ticket.status === 'Awaiting User'}
                    onHoldStart={ticket.onHoldStart}
                    totalPausedTime={ticket.totalPausedTime}
                  />
                  <SLATimer 
                    label="Resolution" 
                    deadline={ticket.resolutionDeadline} 
                    metAt={ticket.resolvedAt}
                    startTime={ticket.resolutionSlaStartTime}
                    waitUntil={!ticket.firstResponseAt ? 'handover' : null}
                    isPaused={ticket.status === 'On Hold' || ticket.status === 'Awaiting User'}
                    onHoldStart={ticket.onHoldStart}
                    totalPausedTime={ticket.totalPausedTime}
                  />
                </div>
              </div>

              {/* Other Related Records */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Parent Incident</h3>
                  </div>
                  <div className="p-4 bg-muted/10 rounded border border-border border-dashed text-center">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">No Parent Incident</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Child Incidents</h3>
                  </div>
                  <div className="p-4 bg-muted/10 rounded border border-border border-dashed text-center">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">No Child Incidents</p>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === "SLA Monitoring" ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-700">Detailed SLA Analytics</h3>
                <div className="flex gap-2">
                  <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded text-[9px] font-black border border-emerald-100 uppercase tracking-tighter">L1 Escalation: 80%</div>
                  <div className="px-3 py-1 bg-orange-50 text-orange-700 rounded text-[9px] font-black border border-orange-100 uppercase tracking-tighter">L2 Escalation: 90%</div>
                  <div className="px-3 py-1 bg-red-50 text-red-700 rounded text-[9px] font-black border border-red-100 uppercase tracking-tighter">Breach: 100%</div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase text-slate-500">Response Performance</span>
                        <span className="text-xs font-mono font-bold text-slate-700">Target: {ticket.responseDeadline ? new Date(ticket.responseDeadline).toLocaleTimeString() : '--'}</span>
                      </div>
                      <SLATimer 
                        label="Live Response" 
                        deadline={ticket.responseDeadline} 
                        metAt={ticket.firstResponseAt}
                        startTime={ticket.responseSlaStartTime}
                        isPaused={ticket.status === 'On Hold'}
                        onHoldStart={ticket.onHoldStart}
                        totalPausedTime={ticket.totalPausedTime}
                      />
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-[10px] text-slate-500 italic">
                        The Response SLA tracks the time from ticket creation until the first meaningful update by an agent.
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase text-slate-500">Resolution Performance</span>
                        <span className="text-xs font-mono font-bold text-slate-700">Target: {ticket.resolutionDeadline ? new Date(ticket.resolutionDeadline).toLocaleTimeString() : '--'}</span>
                      </div>
                      <SLATimer 
                        label="Live Resolution" 
                        deadline={ticket.resolutionDeadline} 
                        metAt={ticket.resolvedAt}
                        startTime={ticket.resolutionSlaStartTime}
                        waitUntil={!ticket.firstResponseAt ? 'handover' : null}
                        isPaused={ticket.status === 'On Hold'}
                        onHoldStart={ticket.onHoldStart}
                        totalPausedTime={ticket.totalPausedTime}
                      />
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-[10px] text-slate-500 italic">
                        The Resolution SLA starts after the first response and tracks the total time until the incident is marked as Resolved.
                      </div>
                    </div>
                 </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">SLA Transition History</h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs bg-white">
                    <thead className="bg-slate-50 font-bold text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3 uppercase tracking-tighter">Event Description</th>
                        <th className="p-3 uppercase tracking-tighter">Timestamp</th>
                        <th className="p-3 uppercase tracking-tighter">Actor</th>
                        <th className="p-3 uppercase tracking-tighter">Audit Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ticket.history?.filter((h: any) => h.action.includes('SLA') || h.action.includes('Breach')).map((h: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className={cn("w-1.5 h-1.5 rounded-full", h.action.includes('Breach') ? "bg-red-500" : "bg-blue-500")} />
                              <span className="font-semibold text-slate-700">{h.action}</span>
                            </div>
                          </td>
                          <td className="p-3 text-slate-500 font-mono">{new Date(h.timestamp).toLocaleString()}</td>
                          <td className="p-3 text-slate-600 font-medium">{h.user}</td>
                          <td className="p-3">
                            <span className="text-[10px] text-blue-600 font-bold cursor-pointer hover:underline uppercase tracking-tighter">Verify Log</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === "Resolution Information" ? (
            <div className="animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase">Knowledge</label>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" className="w-3.5 h-3.5 rounded" />
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Knowledge base</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Resolution code</label>
                    <select
                      value={editedTicket?.resolutionCode || ""}
                      onChange={(e) => updateLocalField("resolutionCode", e.target.value)}
                      className="col-span-2 p-1.5 border border-border rounded text-xs outline-none h-8 font-semibold text-blue-600"
                    >
                      <option value="">-- None --</option>
                      {[
                        "Permanent Fix Applied",
                        "Temporary Workaround Provided",
                        "Configuration Change",
                        "Software Patch Applied",
                        "Hardware Replaced",
                        "Access / Permission Corrected",
                        "Network Issue Resolved",
                        "User Guidance Provided",
                        "Third-Party Vendor Resolution",
                        "Monitoring / No Issue Found",
                        "Auto Resolved",
                        "Duplicate Ticket",
                        "Cancelled by User",
                        "Cannot Reproduce",
                        "No Response from User"
                      ].map(code => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                      {/* Backward compatibility for old codes */}
                      {editedTicket?.resolutionCode && ![
                        "Permanent Fix Applied",
                        "Temporary Workaround Provided",
                        "Configuration Change",
                        "Software Patch Applied",
                        "Hardware Replaced",
                        "Access / Permission Corrected",
                        "Network Issue Resolved",
                        "User Guidance Provided",
                        "Third-Party Vendor Resolution",
                        "Monitoring / No Issue Found",
                        "Auto Resolved",
                        "Duplicate Ticket",
                        "Cancelled by User",
                        "Cannot Reproduce",
                        "No Response from User"
                      ].includes(editedTicket.resolutionCode) && (
                          <option value={editedTicket.resolutionCode}>{editedTicket.resolutionCode} (Legacy)</option>
                        )}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Resolution method</label>
                    <select
                      value={editedTicket?.resolutionMethod || ""}
                      onChange={(e) => updateLocalField("resolutionMethod", e.target.value)}
                      className="col-span-2 p-1.5 border border-border rounded text-xs outline-none h-8"
                    >
                      <option value="">-- None --</option>
                      {[
                        "Remote Support",
                        "Onsite Support",
                        "Phone Support",
                        "Email Support",
                        "Chat Support",
                        "Self-Service",
                        "Automated Resolution",
                        "Third-Party Vendor",
                        "Field Engineer Visit"
                      ].map(method => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </div>
                  {(editedTicket?.resolutionCode === "Duplicate Ticket" ||
                    editedTicket?.resolutionCode === "Cancelled by User" ||
                    editedTicket?.resolutionCode === "Cannot Reproduce" ||
                    editedTicket?.resolutionCode === "No Response from User") && (
                      <div className="grid grid-cols-3 items-center gap-4 animate-in slide-in-from-top-1 duration-200">
                        <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Closure reason</label>
                        <select
                          value={editedTicket?.closureReason || ""}
                          onChange={(e) => updateLocalField("closureReason", e.target.value)}
                          className="col-span-2 p-1.5 border border-border rounded text-xs outline-none h-8"
                        >
                          <option value="">-- None --</option>
                          {[
                            "Duplicate Ticket",
                            "Cancelled by User",
                            "Rejected Request",
                            "No Response from User",
                            "Cannot Reproduce",
                            "Invalid Request"
                          ].map(reason => (
                            <option key={reason} value={reason}>{reason}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  <div className="grid grid-cols-3 items-start gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase mt-1.5 leading-tight">Resolution notes</label>
                    <textarea
                      value={editedTicket?.resolutionNotes || ""}
                      onChange={(e) => updateLocalField("resolutionNotes", e.target.value)}
                      className="col-span-2 p-2 border border-border rounded text-xs outline-none min-h-[80px] resize-none focus:ring-1 focus:ring-blue-500 transition-all"
                      placeholder="Explain how the issue was resolved..."
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Resolution duration</label>
                    <input readOnly value={ticket.resolutionDuration ? `${Math.round(ticket.resolutionDuration / 3600000)}h ${Math.round((ticket.resolutionDuration % 3600000) / 60000)}m` : "—"} className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono" />
                  </div>
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Resolved by</label>
                    <input readOnly value={ticket.resolvedBy || profile?.name || "-"} className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs" />
                  </div>
                  <div className="grid grid-cols-3 items-center gap-4">
                    <label className="text-[11px] text-right font-medium text-muted-foreground uppercase leading-tight">Resolved at</label>
                    <input readOnly value={ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : "—"} className="col-span-2 p-1.5 bg-muted/30 border border-border rounded text-xs font-mono" />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Timer Modal */}
      {showTimerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Add Time Entry</h3>
                  <p className="text-sm text-muted-foreground">
                    Incident: {ticket?.number} · Time: {formatElapsedTime(elapsedTime)}
                  </p>
                </div>
                <button onClick={handleCancelTimer} className="text-muted-foreground hover:text-foreground">
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Description Input */}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase mb-2 block">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  className="w-full p-3 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-none"
                  placeholder="Describe the work you did on this incident..."
                />
              </div>

              {/* Summary Input */}
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase mb-2 block">
                  Summary
                </label>
                <input
                  type="text"
                  value={workSummary}
                  onChange={(e) => setWorkSummary(e.target.value)}
                  className="w-full p-3 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief summary of the work..."
                />
              </div>
            </div>

            <div className="p-6 border-t border-border flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleCancelTimer}
                className="h-10 px-6 font-bold border-border text-sn-dark"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveTimeEntry}
                disabled={!workDescription.trim()}
                className="h-10 px-6 font-bold bg-blue-600 text-white shadow-md hover:bg-blue-700"
              >
                Save to Timesheet
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
