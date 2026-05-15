<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { width: 80%; margin: 20px auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        .header { background: #004a99; color: white; padding: 10px 20px; border-radius: 8px 8px 0 0; }
        .content { padding: 20px; }
        .footer { font-size: 0.8em; color: #777; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
        .ticket-info { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .btn { display: inline-block; padding: 10px 20px; background: #004a99; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>TechnoSprint Support</h2>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>Your ticket <strong>[{{ $ticket->ticket_number }}]</strong> has been created/updated.</p>
            
            <div class="ticket-info">
                <strong>Subject:</strong> {{ $ticket->title }}<br>
                <strong>Status:</strong> {{ $ticket->status->value ?? $ticket->status }}<br>
                <strong>Priority:</strong> {{ $ticket->priority->value ?? $ticket->priority }}<br>
            </div>

            <p><strong>Message:</strong></p>
            <p>{{ $message_body }}</p>

            <p>You can reply directly to this email from <strong>{{ config('services.support_mailbox.address') }}</strong> to add updates to your ticket.</p>

            <p><a href="{{ config('app.url') }}/tickets/{{ $ticket->id }}" class="btn">View Ticket Details</a></p>
        </div>
        <div class="footer">
            <p>This is an automated message from {{ config('services.support_mailbox.name') }}.</p>
            <p>&copy; {{ date('Y') }} TechnoSprint</p>
        </div>
    </div>
</body>
</html>
