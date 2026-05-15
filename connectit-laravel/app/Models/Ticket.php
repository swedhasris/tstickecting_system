<?php

namespace App\Models;

use App\Enums\TicketStatus;
use App\Enums\{TicketPriority, TicketImpact, TicketUrgency, TicketChannel, SlaStatus, ApprovalStatus};
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\{HasMany, BelongsTo};

class Ticket extends Model
{
    use HasFactory;

    protected $fillable = [
        'ticket_number', 'caller', 'caller_user_id', 'affected_user', 'affected_user_id',
        'category', 'subcategory', 'service', 'service_offering', 'cmdb_item',
        'title', 'description', 'channel', 'status', 'impact', 'urgency', 'priority',
        'assignment_group', 'assigned_to', 'assigned_to_name',
        'created_by', 'created_by_name',
        'first_response_at', 'resolved_at', 'closed_at',
        'response_deadline', 'resolution_deadline',
        'on_hold_start', 'on_hold_reason', 'total_paused_time_ms',
        'response_sla_status', 'resolution_sla_status',
        'points', 'approval_status', 'parent_ticket_id',
        'resolution_code', 'resolution_notes', 'resolution_method',
        'closure_reason', 'resolution_duration', 'resolved_by',
    ];

    protected $casts = [
        'status' => TicketStatus::class,
        'priority' => TicketPriority::class,
        'impact' => TicketImpact::class,
        'urgency' => TicketUrgency::class,
        'channel' => TicketChannel::class,
        'response_sla_status' => SlaStatus::class,
        'resolution_sla_status' => SlaStatus::class,
        'approval_status' => ApprovalStatus::class,
        'first_response_at' => 'datetime',
        'resolved_at' => 'datetime',
        'closed_at' => 'datetime',
        'response_deadline' => 'datetime',
        'resolution_deadline' => 'datetime',
        'on_hold_start' => 'datetime',
        'total_paused_time_ms' => 'integer',
        'points' => 'integer',
        'resolution_duration' => 'integer',
    ];

    // Relationships
    public function activities(): HasMany { return $this->hasMany(TicketActivity::class)->orderBy('created_at', 'asc'); }
    public function history(): HasMany { return $this->hasMany(TicketHistory::class)->orderByDesc('timestamp'); }
    public function comments(): HasMany { return $this->hasMany(Comment::class)->orderBy('created_at', 'asc'); }
    public function approvals(): HasMany { return $this->hasMany(Approval::class); }
    public function assignee(): BelongsTo { return $this->belongsTo(User::class, 'assigned_to', 'uid'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by', 'uid'); }
    public function parent(): BelongsTo { return $this->belongsTo(Ticket::class, 'parent_ticket_id'); }
    public function children(): HasMany { return $this->hasMany(Ticket::class, 'parent_ticket_id'); }
    public function notificationsQueue(): HasMany { return $this->hasMany(NotificationQueue::class); }
    public function attachments(): HasMany { return $this->hasMany(TicketAttachment::class); }
    public function emailMessages(): HasMany { return $this->hasMany(EmailMessage::class); }

    // Scopes (mirror existing API filters)
    public function scopeOpen($q) { return $q->whereNotIn('status', ['Resolved', 'Closed', 'Canceled']); }
    public function scopeResolved($q) { return $q->whereIn('status', ['Resolved', 'Closed']); }
    public function scopeAssignedTo($q, string $uid) { return $q->where('assigned_to', $uid); }
    public function scopeUnassigned($q) { return $q->where(fn($q) => $q->whereNull('assigned_to')->orWhere('assigned_to', '')); }

    // Business logic helpers
    public function isPaused(): bool { return $this->status->isPaused(); }
    public function isResolved(): bool { return $this->status->isResolved(); }
    public function isOpen(): bool { return $this->status->isOpen(); }

    /** Generate ticket number — mirrors existing generateTicketNumber() */
    public static function generateNumber(): string
    {
        $prefix = 'INC';
        $latest = static::orderByDesc('id')->value('ticket_number');
        if ($latest && preg_match('/INC(\d+)/', $latest, $m)) {
            return $prefix . str_pad((int)$m[1] + 1, 7, '0', STR_PAD_LEFT);
        }
        return $prefix . '1000001';
    }
}
