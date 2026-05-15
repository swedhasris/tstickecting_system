<?php

namespace App\Enums;

enum ActivityType: string
{
    case WorkNote = 'work_note';
    case Comment = 'comment';
    case Email = 'email';
    case EmailReceived = 'email_received';
    case EmailSent = 'email_sent';
    case WhatsApp = 'whatsapp';
    case WhatsAppSent = 'whatsapp_sent';
    case StatusChange = 'status_change';
    case AssignmentChange = 'assignment_change';
    case SlaTriggered = 'sla_triggered';
    case Resolution = 'resolution';
    case FieldChange = 'field_change';
    case System = 'system';
}
