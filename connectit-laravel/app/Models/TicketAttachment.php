<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TicketAttachment extends Model
{
    protected $fillable = [
        'ticket_id',
        'ticket_activity_id',
        'uploaded_by',
        'source',
        'original_name',
        'stored_name',
        'mime_type',
        'storage_disk',
        'storage_path',
        'public_url',
        'size_bytes',
        'message_id',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
    ];

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(Ticket::class);
    }

    public function activity(): BelongsTo
    {
        return $this->belongsTo(TicketActivity::class, 'ticket_activity_id');
    }
}
