<?php

namespace App\Services;

use App\Enums\ActivityType;
use App\Enums\NotificationChannel;
use App\Enums\QueueStatus;
use App\Enums\VisibilityType;
use App\Events\TicketAssigned;
use App\Models\EmailMessage;
use App\Models\Notification;
use App\Models\NotificationQueue;
use App\Models\Ticket;
use App\Models\TicketActivity;
use App\Models\TicketAttachment;
use App\Models\User;
use Exception;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Twilio\Rest\Client as TwilioClient;

class OmniChannelService
{
    protected ?TwilioClient $twilio = null;

    public function __construct()
    {
        $sid = config('services.twilio.sid');
        $token = config('services.twilio.token');

        if ($sid && $token) {
            $options = [
                'httpClient' => new \Twilio\Http\GuzzleClient(new \GuzzleHttp\Client(['verify' => false])),
            ];
            $this->twilio = new TwilioClient($sid, $token, null, null, $options['httpClient']);
        }
    }

    public function pollIncomingEmails(): void
    {
        $username = config('imap.accounts.default.username');
        $password = config('imap.accounts.default.password');

        if (!$username || !$password) {
            Log::info('[OmniChannel] IMAP credentials not configured. Skipping mailbox sync.');
            return;
        }

        try {
            $clientManager = app(\Webklex\IMAP\ClientManager::class);
            $client = $clientManager->account(config('imap.default', 'default'));
            $client->connect();

            $this->syncFolder($client, 'INBOX', 'inbound');
            $this->syncFolder($client, config('services.support_mailbox.sent_folder', 'Sent'), 'outbound');
        } catch (\Throwable $e) {
            Log::error('[OmniChannel] Mailbox sync failed: ' . $e->getMessage());
        }
    }

    public function sendEmail(
        Ticket $ticket,
        string $recipient,
        string $subject,
        string $body,
        array $metadata = []
    ): bool {
        $subjectWithTicket = $this->ensureTicketReferenceInSubject($ticket, $subject);
        $log = NotificationQueue::create([
            'ticket_id' => $ticket->id,
            'recipient' => $recipient,
            'channel' => NotificationChannel::EmailChannel->value,
            'subject' => $subjectWithTicket,
            'body' => $body,
            'status' => QueueStatus::Pending,
        ]);

        try {
            Mail::to($recipient)->send(new \App\Mail\OmnichannelMail(
                $subjectWithTicket,
                'emails.ticket_notification',
                [
                    'ticket' => $ticket,
                    'message_body' => $body,
                ]
            ));

            $log->update([
                'status' => QueueStatus::Sent,
                'sent_at' => now(),
            ]);

            EmailMessage::updateOrCreate(
                ['message_id' => $metadata['message_id'] ?? $this->buildSyntheticMessageId($ticket, $recipient, $subjectWithTicket)],
                [
                    'ticket_id' => $ticket->id,
                    'thread_id' => $metadata['thread_id'] ?? $ticket->ticket_number,
                    'direction' => 'outbound',
                    'mailbox_folder' => config('services.support_mailbox.sent_folder', 'Sent'),
                    'sender_name' => config('services.support_mailbox.name'),
                    'sender_email' => config('services.support_mailbox.address'),
                    'recipient_emails' => $recipient,
                    'subject' => $subjectWithTicket,
                    'body_text' => $body,
                    'body_html' => $body,
                    'attachments_json' => $metadata['attachments'] ?? [],
                    'processed_at' => now(),
                    'sent_at' => now(),
                ]
            );

            $this->logActivity(
                $ticket,
                "Email sent to {$recipient}: {$subjectWithTicket}",
                ActivityType::EmailSent,
                VisibilityType::Public,
                array_merge($metadata, [
                    'from' => config('services.support_mailbox.address'),
                    'to' => $recipient,
                    'subject' => $subjectWithTicket,
                    'body' => $body,
                    'status' => 'delivered',
                    'channel' => 'email',
                ])
            );

            return true;
        } catch (Exception $e) {
            Log::error("Failed to send email to {$recipient}: " . $e->getMessage());
            $log->update([
                'status' => QueueStatus::Failed,
                'last_error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    public function sendWhatsApp(Ticket $ticket, string $phone, string $message): bool
    {
        $formattedPhone = $this->normalizePhoneNumber($phone);

        $log = NotificationQueue::create([
            'ticket_id' => $ticket->id,
            'recipient' => $formattedPhone,
            'channel' => NotificationChannel::WhatsAppChannel->value,
            'body' => $message,
            'status' => QueueStatus::Pending,
        ]);

        if (!$this->twilio) {
            $error = 'Twilio credentials not configured';
            Log::error($error);
            $log->update(['status' => QueueStatus::Failed, 'last_error' => $error]);
            return false;
        }

        try {
            $from = config('services.twilio.from');
            $response = $this->twilio->messages->create(
                "whatsapp:{$formattedPhone}",
                [
                    'from' => $from,
                    'body' => $message,
                ]
            );

            $log->update([
                'status' => QueueStatus::Sent,
                'sent_at' => now(),
            ]);

            $this->logActivity($ticket, "WhatsApp message sent to {$formattedPhone}", ActivityType::WhatsAppSent, VisibilityType::Public, [
                'recipient' => $formattedPhone,
                'sid' => $response->sid,
                'channel' => 'whatsapp',
            ]);

            return true;
        } catch (Exception $e) {
            Log::error("Failed to send WhatsApp to {$formattedPhone}: " . $e->getMessage());
            $log->update([
                'status' => QueueStatus::Failed,
                'last_error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    public function notifyTicketCreated(Ticket $ticket): void
    {
        $contacts = $this->resolveContacts($ticket);
        $subject = "Your ticket #{$ticket->ticket_number} has been created";
        $body = "Your ticket #{$ticket->ticket_number} has been created.\n\nSubject: {$ticket->title}\nStatus: {$ticket->status->value}\nReply to this email to add updates to the ticket.";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $target = $ticket->assigned_to_name ?: $ticket->assignment_group ?: 'Service Desk';
        $senderLabel = $ticket->caller_email ?: $ticket->caller;
        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'new_ticket_received',
            'New Ticket Received',
            "{$senderLabel} created a new ticket and assigned it to {$target}.",
            $ticket
        );
    }

    public function notifyTicketAssigned(Ticket $ticket): void
    {
        if (!$ticket->assigned_to_name && !$ticket->assignment_group) {
            return;
        }

        $contacts = $this->resolveContacts($ticket);
        $target = $ticket->assigned_to_name ?: $ticket->assignment_group;
        $subject = "Your ticket #{$ticket->ticket_number} has been assigned";
        $body = "Your ticket #{$ticket->ticket_number} has been assigned to {$target}.";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'ticket_assigned',
            'Ticket Assigned',
            "Ticket {$ticket->ticket_number} has been assigned to {$target}.",
            $ticket
        );
    }

    public function notifyCommentAdded(Ticket $ticket, string $comment): void
    {
        $contacts = $this->resolveContacts($ticket);
        $subject = "Your ticket #{$ticket->ticket_number} has a new reply";
        $body = "A new update has been added to your ticket #{$ticket->ticket_number}:\n\n{$comment}";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'ticket_replied',
            'Ticket Updated',
            "A new reply was added to ticket {$ticket->ticket_number}.",
            $ticket
        );
    }

    public function notifyTicketResolved(Ticket $ticket): void
    {
        $contacts = $this->resolveContacts($ticket);
        $subject = "Your ticket #{$ticket->ticket_number} has been resolved";
        $body = "Your ticket #{$ticket->ticket_number} has been resolved. Reply to this email if you need the issue reopened.";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'ticket_resolved',
            'Ticket Resolved',
            "Ticket {$ticket->ticket_number} has been resolved.",
            $ticket
        );
    }

    public function notifyTicketStatusChanged(Ticket $ticket, string $oldStatus, string $newStatus): void
    {
        $contacts = $this->resolveContacts($ticket);
        $subject = "Your ticket #{$ticket->ticket_number} status changed to {$newStatus}";
        $body = "Your ticket #{$ticket->ticket_number} status changed from {$oldStatus} to {$newStatus}.";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'ticket_status_changed',
            'Ticket Updated',
            "Ticket {$ticket->ticket_number} status changed to {$newStatus}.",
            $ticket
        );
    }

    public function notifyTicketClosed(Ticket $ticket): void
    {
        $contacts = $this->resolveContacts($ticket);
        $subject = "Your ticket #{$ticket->ticket_number} has been closed";
        $body = "Your ticket #{$ticket->ticket_number} has been closed. Reply to this email if you need further assistance.";

        if ($contacts['email']) {
            \App\Jobs\SendEmailNotification::dispatch($ticket, $contacts['email'], $subject, $body);
        }

        if ($contacts['phone']) {
            \App\Jobs\SendWhatsAppNotification::dispatch($ticket, $contacts['phone'], $body);
        }

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'ticket_closed',
            'Ticket Closed',
            "Ticket {$ticket->ticket_number} has been closed.",
            $ticket
        );
    }

    public function normalizePhoneNumber(string $phone): string
    {
        $phone = preg_replace('/[^0-9]/', '', $phone);

        if (strlen($phone) === 11 && str_starts_with($phone, '0')) {
            $phone = '91' . substr($phone, 1);
        }

        if (strlen($phone) === 10) {
            $phone = '91' . $phone;
        }

        return '+' . $phone;
    }

    public function createInAppNotifications(iterable $userIds, string $type, string $title, string $message, ?Ticket $ticket = null): void
    {
        $uniqueIds = collect($userIds)
            ->filter()
            ->unique()
            ->values();

        foreach ($uniqueIds as $userId) {
            Notification::create([
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'message' => $message,
                'related_ticket_id' => $ticket?->id,
                'related_entity_type' => $ticket ? 'ticket' : null,
                'related_entity_id' => $ticket ? (string) $ticket->id : null,
                'is_read' => false,
                'created_at' => now(),
            ]);
        }
    }

    protected function syncFolder($client, string $folderName, string $direction): void
    {
        try {
            $folder = $client->getFolder($folderName);
            $query = $folder->messages();
            if ($direction === 'inbound' && method_exists($query, 'unseen')) {
                $query = $query->unseen();
            }
            if ($direction === 'outbound' && method_exists($query, 'since')) {
                $query = $query->since(now()->subDay());
            }

            $messages = $query->get();
            foreach ($messages as $message) {
                $payload = $this->extractImapPayload($message, $folderName, $direction);
                if (!$payload['message_id'] || EmailMessage::where('message_id', $payload['message_id'])->exists()) {
                    if (method_exists($message, 'setFlag') && $direction === 'inbound') {
                        $message->setFlag('Seen');
                    }
                    continue;
                }

                if ($direction === 'outbound') {
                    $this->processOutboundEmail($payload);
                } else {
                    $this->processInboundEmail($payload);
                    if (method_exists($message, 'setFlag')) {
                        $message->setFlag('Seen');
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::warning("[OmniChannel] Failed syncing {$folderName}: " . $e->getMessage());
        }
    }

    protected function processInboundEmail(array $payload): void
    {
        $ticket = $this->matchTicketFromEmail($payload);

        if ($ticket) {
            $this->appendReplyToTicket($ticket, $payload);
            return;
        }

        $senderEmail = $payload['from_email'] ?: 'unknown@unknown.local';
        $senderName = $payload['from_name'] ?: $senderEmail;
        $description = trim($payload['body_text'] ?: strip_tags($payload['body_html'] ?: ''));

        $ticket = app(TicketService::class)->createTicket([
            'title' => $payload['subject'] ?: 'Email Ticket',
            'caller' => $senderName,
            'caller_email' => $senderEmail,
            'caller_user_id' => null,
            'affected_user' => $senderName,
            'description' => Str::limit($description, 10000, ''),
            'channel' => 'Email',
            'impact' => '3 - Low',
            'urgency' => '3 - Low',
            'assignment_group' => 'Service Desk',
            'created_by' => $senderEmail,
            'created_by_name' => $senderName,
        ]);

        $activity = TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => ActivityType::EmailReceived->value,
            'visibility_type' => VisibilityType::Public->value,
            'channel' => 'email',
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'created_by' => $senderEmail,
            'created_by_name' => $senderName,
            'message' => 'Ticket created from email',
            'metadata_json' => [
                'from' => $senderEmail,
                'subject' => $payload['subject'],
                'body' => $description,
                'attachments' => [],
            ],
        ]);

        $attachments = $this->persistAttachments($ticket, $activity, $payload);
        if ($attachments !== []) {
            $activity->metadata_json = array_merge($activity->metadata_json ?? [], ['attachments' => $attachments]);
            $activity->save();
        }

        EmailMessage::create([
            'ticket_id' => $ticket->id,
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'direction' => 'inbound',
            'mailbox_folder' => $payload['folder'],
            'sender_name' => $senderName,
            'sender_email' => $senderEmail,
            'recipient_emails' => implode(', ', $payload['to']),
            'subject' => $payload['subject'],
            'body_text' => $payload['body_text'],
            'body_html' => $payload['body_html'],
            'attachments_json' => $attachments,
            'processed_at' => now(),
            'received_at' => now(),
        ]);

        if ($ticket->assigned_to || $ticket->assignment_group) {
            event(new TicketAssigned($ticket));
        }
    }

    protected function processOutboundEmail(array $payload): void
    {
        $ticket = $this->matchTicketFromEmail($payload);
        if (!$ticket) {
            EmailMessage::create([
                'message_id' => $payload['message_id'],
                'thread_id' => $payload['thread_id'],
                'direction' => 'outbound',
                'mailbox_folder' => $payload['folder'],
                'sender_name' => $payload['from_name'],
                'sender_email' => $payload['from_email'],
                'recipient_emails' => implode(', ', $payload['to']),
                'subject' => $payload['subject'],
                'body_text' => $payload['body_text'],
                'body_html' => $payload['body_html'],
                'attachments_json' => [],
                'processed_at' => now(),
                'sent_at' => now(),
            ]);
            return;
        }

        $alreadyLogged = EmailMessage::where('ticket_id', $ticket->id)
            ->where('direction', 'outbound')
            ->where('subject', $payload['subject'])
            ->where('sent_at', '>=', now()->subMinutes(5))
            ->exists();

        if ($alreadyLogged) {
            return;
        }

        $body = trim($payload['body_text'] ?: strip_tags($payload['body_html'] ?: ''));
        $activity = TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => ActivityType::EmailSent->value,
            'visibility_type' => VisibilityType::Public->value,
            'channel' => 'email',
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'created_by' => $payload['from_email'] ?: config('services.support_mailbox.address'),
            'created_by_name' => $payload['from_name'] ?: config('services.support_mailbox.name'),
            'message' => Str::limit($body, 5000, ''),
            'metadata_json' => [
                'from' => $payload['from_email'],
                'to' => implode(', ', $payload['to']),
                'subject' => $payload['subject'],
                'body' => $body,
                'attachments' => [],
                'status' => 'delivered',
            ],
        ]);

        $attachments = $this->persistAttachments($ticket, $activity, $payload);
        if ($attachments !== []) {
            $activity->metadata_json = array_merge($activity->metadata_json ?? [], ['attachments' => $attachments]);
            $activity->save();
        }

        EmailMessage::create([
            'ticket_id' => $ticket->id,
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'direction' => 'outbound',
            'mailbox_folder' => $payload['folder'],
            'sender_name' => $payload['from_name'],
            'sender_email' => $payload['from_email'],
            'recipient_emails' => implode(', ', $payload['to']),
            'subject' => $payload['subject'],
            'body_text' => $payload['body_text'],
            'body_html' => $payload['body_html'],
            'attachments_json' => $attachments,
            'processed_at' => now(),
            'sent_at' => now(),
        ]);
    }

    protected function appendReplyToTicket(Ticket $ticket, array $payload): void
    {
        $senderEmail = $payload['from_email'] ?: 'unknown@unknown.local';
        $senderName = $payload['from_name'] ?: $senderEmail;
        $body = trim($payload['body_text'] ?: strip_tags($payload['body_html'] ?: ''));

        $activity = TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => ActivityType::EmailReceived->value,
            'visibility_type' => VisibilityType::Public->value,
            'channel' => 'email',
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'created_by' => $senderEmail,
            'created_by_name' => $senderName,
            'message' => Str::limit($body, 5000, ''),
            'metadata_json' => [
                'from' => $senderEmail,
                'to' => implode(', ', $payload['to']),
                'subject' => $payload['subject'],
                'body' => $body,
                'attachments' => [],
            ],
        ]);

        $attachments = $this->persistAttachments($ticket, $activity, $payload);
        if ($attachments !== []) {
            $activity->metadata_json = array_merge($activity->metadata_json ?? [], ['attachments' => $attachments]);
            $activity->save();
        }

        $ticket->touch();

        EmailMessage::create([
            'ticket_id' => $ticket->id,
            'message_id' => $payload['message_id'],
            'thread_id' => $payload['thread_id'],
            'direction' => 'inbound',
            'mailbox_folder' => $payload['folder'],
            'sender_name' => $senderName,
            'sender_email' => $senderEmail,
            'recipient_emails' => implode(', ', $payload['to']),
            'subject' => $payload['subject'],
            'body_text' => $payload['body_text'],
            'body_html' => $payload['body_html'],
            'attachments_json' => $attachments,
            'processed_at' => now(),
            'received_at' => now(),
        ]);

        $this->createInAppNotifications(
            $this->staffRecipients($ticket),
            'email_reply_received',
            'Email Reply Received',
            "{$senderName} replied through email on ticket {$ticket->ticket_number}.",
            $ticket
        );
    }

    protected function matchTicketFromEmail(array $payload): ?Ticket
    {
        $haystacks = [
            (string) ($payload['subject'] ?? ''),
            (string) ($payload['body_text'] ?? ''),
            (string) ($payload['body_html'] ?? ''),
        ];

        foreach ($haystacks as $text) {
            if (preg_match('/\b(?:INC|TK)[-#\s]?(\d{4,})\b/i', $text, $matches)) {
                $ticketNumber = strtoupper(str_starts_with(strtoupper($matches[0]), 'TK') ? 'TK-' . $matches[1] : 'INC' . $matches[1]);
                $ticket = Ticket::where('ticket_number', $ticketNumber)->first();
                if ($ticket) {
                    return $ticket;
                }
            }
        }

        if (!empty($payload['thread_id'])) {
            $message = EmailMessage::where('thread_id', $payload['thread_id'])->latest('id')->first();
            if ($message?->ticket_id) {
                return Ticket::find($message->ticket_id);
            }
        }

        return null;
    }

    protected function persistAttachments(Ticket $ticket, TicketActivity $activity, array $payload): array
    {
        $saved = [];

        foreach ($payload['attachments'] as $attachment) {
            $originalName = $attachment['name'] ?: ('attachment-' . Str::random(6));
            $storedName = now()->format('YmdHis') . '-' . Str::random(8) . '-' . Str::slug(pathinfo($originalName, PATHINFO_FILENAME));
            $extension = pathinfo($originalName, PATHINFO_EXTENSION);
            if ($extension) {
                $storedName .= '.' . $extension;
            }

            $relativePath = 'ticket-attachments/' . $ticket->ticket_number . '/' . $storedName;
            Storage::disk('public')->put($relativePath, $attachment['content']);

            $record = TicketAttachment::create([
                'ticket_id' => $ticket->id,
                'ticket_activity_id' => $activity->id,
                'uploaded_by' => $payload['from_email'],
                'source' => 'email',
                'original_name' => $originalName,
                'stored_name' => $storedName,
                'mime_type' => $attachment['mime_type'] ?? null,
                'storage_disk' => 'public',
                'storage_path' => $relativePath,
                'public_url' => Storage::disk('public')->url($relativePath),
                'size_bytes' => strlen($attachment['content'] ?? ''),
                'message_id' => $payload['message_id'],
            ]);

            $saved[] = [
                'id' => (string) $record->id,
                'name' => $record->original_name,
                'url' => $record->public_url,
                'mime_type' => $record->mime_type,
                'size_bytes' => $record->size_bytes,
            ];
        }

        return $saved;
    }

    protected function resolveContacts(Ticket $ticket): array
    {
        $email = $ticket->caller_email ?? null;
        $phone = null;

        if ($ticket->caller_user_id) {
            $user = User::where('uid', $ticket->caller_user_id)->first();
            if ($user) {
                $email = $email ?: $user->email;
                $phone = $user->phone;
            }
        }

        if (!$email && filter_var($ticket->caller, FILTER_VALIDATE_EMAIL)) {
            $email = $ticket->caller;
        }

        if (!$phone && preg_match('/^\+?[0-9]{10,15}$/', (string) $ticket->caller)) {
            $phone = $ticket->caller;
        }

        return [
            'email' => $email,
            'phone' => $phone,
        ];
    }

    protected function staffRecipients(Ticket $ticket): Collection
    {
        $query = User::query()->where('is_active', true)->whereIn('role', [
            'agent',
            'sub_admin',
            'admin',
            'super_admin',
            'ultra_super_admin',
        ]);

        $ids = $query->pluck('uid');
        if ($ticket->assigned_to) {
            $ids->push($ticket->assigned_to);
        }

        return $ids->unique()->values();
    }

    protected function logActivity(Ticket $ticket, string $message, ActivityType $type, VisibilityType $visibility, array $metadata = []): void
    {
        TicketActivity::create([
            'ticket_id' => $ticket->id,
            'activity_type' => $type->value,
            'visibility_type' => $visibility->value,
            'channel' => 'system',
            'message' => $message,
            'metadata_json' => $metadata,
            'created_by' => 'system',
            'created_by_name' => 'Omnichannel Service',
        ]);
    }

    protected function ensureTicketReferenceInSubject(Ticket $ticket, string $subject): string
    {
        if (str_contains($subject, $ticket->ticket_number)) {
            return $subject;
        }

        return "[{$ticket->ticket_number}] {$subject}";
    }

    protected function buildSyntheticMessageId(Ticket $ticket, string $recipient, string $subject): string
    {
        return sprintf(
            '<%s-%s-%s@technosprint.net>',
            $ticket->ticket_number,
            substr(md5($recipient), 0, 12),
            substr(md5($subject . microtime(true)), 0, 12)
        );
    }

    protected function extractImapPayload($message, string $folderName, string $direction): array
    {
        $subject = $this->stringValue($message, ['getSubject', 'subject']);
        $messageId = $this->stringValue($message, ['getMessageId', 'message_id']) ?: Str::uuid()->toString() . '@mailbox.local';
        $htmlBody = $this->stringValue($message, ['getHTMLBody', 'getHtmlBody', 'html_body']);
        $textBody = $this->stringValue($message, ['getTextBody', 'text_body']);

        $fromEntry = $this->firstMailboxEntry($message, 'getFrom');
        $toEntries = $this->mailboxEntries($message, 'getTo');
        $references = $this->mailboxValue($message, 'getReferences');
        $inReplyTo = $this->mailboxValue($message, 'getInReplyTo');

        return [
            'folder' => $folderName,
            'direction' => $direction,
            'message_id' => $messageId,
            'thread_id' => $inReplyTo ?: $references ?: $messageId,
            'subject' => $subject,
            'body_text' => $textBody,
            'body_html' => $htmlBody,
            'from_name' => $fromEntry['name'] ?? null,
            'from_email' => $fromEntry['email'] ?? null,
            'to' => collect($toEntries)->pluck('email')->filter()->values()->all(),
            'attachments' => $this->extractAttachments($message),
        ];
    }

    protected function extractAttachments($message): array
    {
        $attachments = [];
        if (!method_exists($message, 'getAttachments')) {
            return $attachments;
        }

        foreach ($message->getAttachments() as $attachment) {
            $content = null;
            if (method_exists($attachment, 'getContent')) {
                $content = $attachment->getContent();
            } elseif (isset($attachment->content)) {
                $content = $attachment->content;
            }

            if ($content === null) {
                continue;
            }

            $attachments[] = [
                'name' => method_exists($attachment, 'getName') ? $attachment->getName() : ($attachment->name ?? 'attachment'),
                'mime_type' => method_exists($attachment, 'getMimeType') ? $attachment->getMimeType() : ($attachment->content_type ?? null),
                'content' => $content,
            ];
        }

        return $attachments;
    }

    protected function mailboxEntries($message, string $method): array
    {
        if (!method_exists($message, $method)) {
            return [];
        }

        $items = $message->{$method}();
        $result = [];
        foreach ($items as $item) {
            $result[] = [
                'name' => $item->personal ?? $item->name ?? null,
                'email' => $item->mail ?? $item->email ?? null,
            ];
        }

        return $result;
    }

    protected function firstMailboxEntry($message, string $method): array
    {
        return $this->mailboxEntries($message, $method)[0] ?? [];
    }

    protected function mailboxValue($message, string $method): ?string
    {
        if (!method_exists($message, $method)) {
            return null;
        }

        $value = $message->{$method}();
        if (is_string($value)) {
            return $value;
        }
        if (is_array($value)) {
            return implode(', ', $value);
        }

        return method_exists($value, '__toString') ? (string) $value : null;
    }

    protected function stringValue($target, array $accessors): ?string
    {
        foreach ($accessors as $accessor) {
            if (method_exists($target, $accessor)) {
                $value = $target->{$accessor}();
            } elseif (isset($target->{$accessor})) {
                $value = $target->{$accessor};
            } else {
                continue;
            }

            if (is_string($value)) {
                return $value;
            }
            if ($value && method_exists($value, '__toString')) {
                return (string) $value;
            }
        }

        return null;
    }
}
