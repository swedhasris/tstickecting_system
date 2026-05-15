<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailMessage extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'ticket_id',
        'message_id',
        'thread_id',
        'direction',
        'mailbox_folder',
        'sender_name',
        'sender_email',
        'recipient_emails',
        'subject',
        'body_text',
        'body_html',
        'attachments_json',
        'processed_at',
        'sent_at',
        'received_at',
    ];

    protected $casts = [
        'attachments_json' => 'array',
        'processed_at' => 'datetime',
        'sent_at' => 'datetime',
        'received_at' => 'datetime',
    ];

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(Ticket::class);
    }
}
