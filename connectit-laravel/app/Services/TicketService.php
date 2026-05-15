<?php

namespace App\Services;

use App\Models\Ticket;
use App\Models\SlaPolicy;
use App\Models\TicketHistory;
use App\Models\TicketActivity;
use App\Enums\TicketStatus;
use App\Enums\TicketPriority;
use App\Enums\ActivityType;
use App\Enums\VisibilityType;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;

class TicketService
{
    protected $omniChannel;

    public function __construct(OmniChannelService $omniChannel)
    {
        $this->omniChannel = $omniChannel;
    }

    /**
     * Calculate priority based on impact and urgency
     */
    public function calculatePriority(string $impact, string $urgency): TicketPriority
    {
        $i = (int) $impact[0];
        $u = (int) $urgency[0];
        $sum = $i + $u;

        if ($sum <= 2) return TicketPriority::Critical;
        if ($sum === 3) return TicketPriority::High;
        if ($sum === 4) return TicketPriority::Moderate;
        return TicketPriority::Low;
    }

    /**
     * Create a new ticket with full enterprise logic
     */
    public function createTicket(array $data, $user = null)
    {
        $user = $user ?: Auth::user();
        
        $ticket = DB::transaction(function () use ($data, $user) {
            $actorName = $user?->name ?? ($data['created_by_name'] ?? 'System');
            $actorId = $user?->uid ?? ($data['created_by'] ?? 'system');
            $priority = $this->calculatePriority($data['impact'], $data['urgency']);
            
            // Find SLA Policy
            $policy = SlaPolicy::where('priority', $priority->value)
                ->where(function($q) use ($data) {
                    $q->where('category', $data['category'] ?? null)
                      ->orWhereNull('category');
                })
                ->orderByRaw('category IS NULL ASC') // Prefer specific category
                ->first();

            $responseTimeHours = $policy ? $policy->response_time_hours : 4;
            $resolutionTimeHours = $policy ? $policy->resolution_time_hours : 24;

            $now = Carbon::now();
            $responseDeadline = $now->copy()->addHours($responseTimeHours);
            // Resolution deadline includes response time as per existing logic
            $resolutionDeadline = $now->copy()->addHours($responseTimeHours + $resolutionTimeHours);

            $ticketNumber = Ticket::generateNumber();

            $ticket = Ticket::create([
                'ticket_number' => $ticketNumber,
                'caller' => $data['caller'],
                'caller_email' => $data['caller_email'] ?? null,
                'caller_user_id' => $data['caller_user_id'] ?? null,
                'affected_user' => $data['affected_user'] ?? $data['caller'],
                'category' => $data['category'] ?? null,
                'subcategory' => $data['subcategory'] ?? null,
                'service' => $data['service'] ?? null,
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'channel' => $data['channel'] ?? 'Self-service',
                'status' => isset($data['assigned_to']) ? TicketStatus::Assigned : TicketStatus::New,
                'impact' => $data['impact'],
                'urgency' => $data['urgency'],
                'priority' => $priority,
                'assignment_group' => $data['assignment_group'] ?? 'Service Desk',
                'assigned_to' => $data['assigned_to'] ?? null,
                'assigned_to_name' => $data['assigned_to_name'] ?? null,
                'created_by' => $actorId,
                'created_by_name' => $actorName,
                'response_deadline' => $responseDeadline,
                'resolution_deadline' => $resolutionDeadline,
            ]);

            // Log history
            TicketHistory::create([
                'ticket_id' => $ticket->id,
                'action' => 'Ticket Created',
                'user' => $actorName,
                'user_id' => $actorId,
                'details' => "Ticket {$ticketNumber} created via portal.",
            ]);

            // Log activity stream
            TicketActivity::create([
                'ticket_id' => $ticket->id,
                'activity_type' => ActivityType::System,
                'visibility_type' => VisibilityType::Public,
                'created_by' => $actorId,
                'created_by_name' => $actorName,
                'message' => "Ticket Created by " . $actorName,
                'metadata_json' => [
                    'priority' => $priority->value,
                    'category' => $ticket->category,
                    'assignmentGroup' => $ticket->assignment_group,
                    'status' => $ticket->status->value,
                ],
            ]);

            return $ticket;
        });

        // Dispatch TicketCreated event
        event(new \App\Events\TicketCreated($ticket));

        return $ticket;
    }

    /**
     * Update ticket state and handle SLA pause/resume logic
     */
    public function updateStatus(Ticket $ticket, TicketStatus $newStatus, string $reason = null, $user = null)
    {
        $user = $user ?: Auth::user();
        $oldStatus = $ticket->status;

        if ($oldStatus === $newStatus) return $ticket;

        return DB::transaction(function () use ($ticket, $oldStatus, $newStatus, $reason, $user) {
            $now = Carbon::now();
            
            // Handle SLA Pause Logic
            if (!$oldStatus->isPaused() && $newStatus->isPaused()) {
                // Starting pause
                $ticket->on_hold_start = $now;
                $ticket->on_hold_reason = $reason;
            } elseif ($oldStatus->isPaused() && !$newStatus->isPaused()) {
                // Ending pause
                if ($ticket->on_hold_start) {
                    $pausedMs = $now->diffInMilliseconds($ticket->on_hold_start);
                    $ticket->total_paused_time_ms += $pausedMs;
                    
                    // Shift deadlines
                    $ticket->response_deadline = $ticket->response_deadline->addMilliseconds($pausedMs);
                    $ticket->resolution_deadline = $ticket->resolution_deadline->addMilliseconds($pausedMs);
                }
                $ticket->on_hold_start = null;
                $ticket->on_hold_reason = null;
            }

            // Handle Resolution
            if ($newStatus->isResolved()) {
                $ticket->resolved_at = $now;
                if ($user) {
                    $ticket->resolved_by = $user->name;
                }
            }

            $ticket->status = $newStatus;
            $ticket->save();

            // Log history
            TicketHistory::create([
                'ticket_id' => $ticket->id,
                'action' => "Status updated to {$newStatus->value}",
                'user' => $user?->name ?? 'System',
                'user_id' => $user?->uid ?? 'system',
                'details' => $reason,
            ]);

            // Activity stream entry
            TicketActivity::create([
                'ticket_id' => $ticket->id,
                'activity_type' => ActivityType::StatusChange,
                'visibility_type' => VisibilityType::Public,
                'created_by' => $user?->uid ?? 'system',
                'created_by_name' => $user?->name ?? 'System',
                'message' => "Status changed from {$oldStatus->value} to {$newStatus->value}",
                'metadata_json' => ['old_status' => $oldStatus->value, 'new_status' => $newStatus->value, 'reason' => $reason],
            ]);

            if ($newStatus === TicketStatus::Closed) {
                $this->omniChannel->notifyTicketClosed($ticket);
            } elseif ($newStatus !== TicketStatus::Resolved) {
                $this->omniChannel->notifyTicketStatusChanged($ticket, $oldStatus->value, $newStatus->value);
            }

            // Dispatch TicketResolved event if applicable
            if ($newStatus === TicketStatus::Resolved) {
                event(new \App\Events\TicketResolved($ticket));
            }

            return $ticket;
        });
    }

    /**
     * Assign ticket to a user or group
     */
    public function assignTicket(Ticket $ticket, array $data, $user = null)
    {
        $user = $user ?: Auth::user();

        $ticket->update([
            'assigned_to' => $data['assigned_to'] ?? $ticket->assigned_to,
            'assigned_to_name' => $data['assigned_to_name'] ?? $ticket->assigned_to_name,
            'assignment_group' => $data['assignment_group'] ?? $ticket->assignment_group,
            'status' => TicketStatus::Assigned,
        ]);

        TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => ActivityType::AssignmentChange,
            'visibility_type' => VisibilityType::Public,
                'created_by' => $user?->uid ?? 'system',
                'created_by_name' => $user?->name ?? 'System',
                'message' => "Ticket assigned to {$ticket->assigned_to_name}",
                'metadata_json' => ['assigned_to' => $ticket->assigned_to, 'group' => $ticket->assignment_group],
            ]);

        event(new \App\Events\TicketAssigned($ticket));

        return $ticket;
    }

    /**
     * Add a comment/activity to a ticket
     */
    public function addComment(Ticket $ticket, string $message, bool $isInternal = false, $user = null)
    {
        $user = $user ?: Auth::user();

        $activity = TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => $isInternal ? ActivityType::WorkNote : ActivityType::Comment,
            'visibility_type' => $isInternal ? VisibilityType::Internal : VisibilityType::Public,
                'created_by' => $user?->uid ?? 'system',
                'created_by_name' => $user?->name ?? 'System',
                'message' => $message,
                'channel' => 'portal',
            ]);

        event(new \App\Events\CommentAdded($ticket, $message, $isInternal));

        return $activity;
    }
}
