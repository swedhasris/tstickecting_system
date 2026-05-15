<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6; }
        .header { color: #2F3B4C; border-bottom: 2px solid #2F3B4C; padding-bottom: 10px; margin-bottom: 20px; }
        table { border-collapse: collapse; width: 100%; max-width: 600px; }
        td { padding: 10px; border: 1px solid #ddd; }
        .label { font-weight: bold; background: #f8f9fa; width: 150px; }
        .footer { margin-top: 20px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h2>Your ticket has been created</h2>
    </div>
    <table>
        <tr><td class="label">Ticket ID</td><td>{{ $ticket->ticket_number }}</td></tr>
        <tr><td class="label">Title</td><td>{{ $ticket->title }}</td></tr>
        <tr><td class="label">Caller</td><td>{{ $ticket->caller }}</td></tr>
        <tr><td class="label">Priority</td><td>{{ $ticket->priority->value }}</td></tr>
        <tr><td class="label">Status</td><td>{{ $ticket->status->value }}</td></tr>
        <tr><td class="label">Category</td><td>{{ $ticket->category }}</td></tr>
        <tr><td class="label">Description</td><td>{!! nl2br(e($ticket->description)) !!}</td></tr>
        <tr><td class="label">Created</td><td>{{ $ticket->created_at->format('M d, Y — h:i A') }}</td></tr>
    </table>
    <p class="footer">Reply to {{ config('services.support_mailbox.address') }} to add updates to this ticket.</p>
</body>
</html>
