<?php

namespace App\Http\Controllers;

use App\Enums\TicketStatus;
use App\Models\Notification;
use App\Models\Ticket;
use App\Models\TicketActivity;
use App\Models\User;
use App\Services\OmniChannelService;
use App\Services\TicketService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LegacyApiController extends Controller
{
    public function __construct(
        private readonly TicketService $ticketService,
        private readonly OmniChannelService $omniChannel
    )
    {
    }

    public function health(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'app' => config('app.name', 'Connect IT Laravel'),
        ]);
    }

    public function dbTest(): JsonResponse
    {
        try {
            DB::select('SELECT 1');

            return response()->json([
                'status' => 'ok',
                'database' => config('database.connections.mysql.database'),
                'driver' => config('database.default'),
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'status' => 'error',
                'error' => $e->getMessage(),
                'database' => config('database.connections.mysql.database'),
            ], 500);
        }
    }

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($validated['email']))])
            ->where('is_active', true)
            ->first();

        if (!$user || ($user->password_hash && $user->password_hash !== $this->simpleHash($validated['password']))) {
            return response()->json(['error' => 'Invalid email or password'], 401);
        }

        $user->forceFill(['last_login' => now()])->save();

        return response()->json($this->serializeUser($user));
    }

    public function users(): JsonResponse
    {
        $users = User::query()->orderBy('name')->get();

        return response()->json($users->map(fn (User $user) => $this->serializeUser($user))->values());
    }

    public function showUser(string $uid): JsonResponse
    {
        $user = User::query()->where('uid', $uid)->first();

        if (!$user) {
            return response()->json(['error' => 'User not found'], 404);
        }

        return response()->json($this->serializeUser($user));
    }

    public function storeUser(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'uid' => 'required|string|max:128|unique:users,uid',
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email',
            'role' => 'nullable|string|max:30',
            'phone' => 'nullable|string|max:50',
            'department' => 'nullable|string|max:100',
            'password' => 'nullable|string',
            'password_hash' => 'nullable|string|max:255',
            'is_active' => 'nullable|boolean',
            'is_demo' => 'nullable|boolean',
        ]);

        $user = new User();
        $user->fill([
            'uid' => $validated['uid'],
            'name' => $validated['name'],
            'email' => mb_strtolower(trim($validated['email'])),
            'role' => $validated['role'] ?? 'user',
            'phone' => $validated['phone'] ?? null,
            'department' => $validated['department'] ?? null,
            'is_active' => $validated['is_active'] ?? true,
            'is_demo' => $validated['is_demo'] ?? false,
            'password_hash' => $validated['password_hash'] ?? (isset($validated['password']) ? $this->simpleHash($validated['password']) : null),
        ]);
        $user->save();

        return response()->json($this->serializeUser($user), 201);
    }

    public function updateUser(Request $request, string $uid): JsonResponse
    {
        $user = User::query()->where('uid', $uid)->first();

        if (!$user) {
            return response()->json(['error' => 'User not found'], 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'email' => 'sometimes|required|email|unique:users,email,' . $user->id,
            'role' => 'sometimes|required|string|max:30',
            'phone' => 'nullable|string|max:50',
            'department' => 'nullable|string|max:100',
            'password' => 'nullable|string',
            'password_hash' => 'nullable|string|max:255',
            'is_active' => 'nullable|boolean',
            'is_demo' => 'nullable|boolean',
        ]);

        if (array_key_exists('email', $validated)) {
            $validated['email'] = mb_strtolower(trim($validated['email']));
        }
        if (array_key_exists('password', $validated)) {
            $validated['password_hash'] = $this->simpleHash($validated['password']);
            unset($validated['password']);
        }

        $user->fill($validated);
        $user->save();

        return response()->json($this->serializeUser($user));
    }

    public function ticketsAll(): JsonResponse
    {
        return response()->json($this->serializeTickets(Ticket::query()->latest()->get()));
    }

    public function ticketsOpen(): JsonResponse
    {
        return response()->json($this->serializeTickets(Ticket::query()->open()->latest()->get()));
    }

    public function ticketsAssigned(string $userId): JsonResponse
    {
        return response()->json($this->serializeTickets(Ticket::query()->assignedTo($userId)->latest()->get()));
    }

    public function ticketsUnassigned(): JsonResponse
    {
        return response()->json($this->serializeTickets(Ticket::query()->unassigned()->latest()->get()));
    }

    public function ticketsResolved(): JsonResponse
    {
        return response()->json($this->serializeTickets(Ticket::query()->resolved()->latest()->get()));
    }

    public function showTicket(string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        return response()->json($this->serializeTicket($ticket));
    }

    public function createTicket(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:500',
            'caller' => 'required|string|max:255',
            'impact' => 'required|string|max:20',
            'urgency' => 'required|string|max:20',
            'category' => 'nullable|string|max:100',
            'subcategory' => 'nullable|string|max:100',
            'service' => 'nullable|string|max:100',
            'service_offering' => 'nullable|string|max:100',
            'cmdb_item' => 'nullable|string|max:100',
            'description' => 'nullable|string',
            'channel' => 'nullable|string|max:30',
            'caller_email' => 'nullable|email',
            'caller_user_id' => 'nullable|string|max:128',
            'affected_user' => 'nullable|string|max:255',
            'affected_user_id' => 'nullable|string|max:128',
            'assignment_group' => 'nullable|string|max:100',
            'assigned_to' => 'nullable|string|max:128',
            'assigned_to_name' => 'nullable|string|max:255',
            'created_by' => 'nullable|string|max:128',
            'created_by_name' => 'nullable|string|max:255',
        ]);

        $ticket = $this->ticketService->createTicket($validated);

        return response()->json($this->serializeTicket($ticket->fresh()), 201);
    }

    public function updateTicket(Request $request, string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        $validated = $request->validate([
            'caller' => 'sometimes|required|string|max:255',
            'caller_user_id' => 'nullable|string|max:128',
            'affected_user' => 'nullable|string|max:255',
            'affected_user_id' => 'nullable|string|max:128',
            'category' => 'nullable|string|max:100',
            'subcategory' => 'nullable|string|max:100',
            'service' => 'nullable|string|max:100',
            'service_offering' => 'nullable|string|max:100',
            'cmdb_item' => 'nullable|string|max:100',
            'title' => 'sometimes|required|string|max:500',
            'description' => 'nullable|string',
            'channel' => 'nullable|string|max:30',
            'status' => 'nullable|string|max:30',
            'impact' => 'nullable|string|max:20',
            'urgency' => 'nullable|string|max:20',
            'priority' => 'nullable|string|max:20',
            'assignment_group' => 'nullable|string|max:100',
            'assigned_to' => 'nullable|string|max:128',
            'assigned_to_name' => 'nullable|string|max:255',
            'approval_status' => 'nullable|string|max:20',
            'resolution_code' => 'nullable|string|max:100',
            'resolution_notes' => 'nullable|string',
            'resolution_method' => 'nullable|string|max:100',
            'closure_reason' => 'nullable|string|max:100',
            'response_sla_status' => 'nullable|string|max:20',
            'resolution_sla_status' => 'nullable|string|max:20',
            'on_hold_reason' => 'nullable|string|max:255',
        ]);

        $oldStatus = $ticket->status?->value ?? (string) $ticket->getRawOriginal('status');
        $oldAssignee = $ticket->assigned_to_name ?: $ticket->assignment_group;
        $currentPoints = (int) $ticket->points;
        $pointsAwarded = 0;
        $nextStatus = $validated['status'] ?? null;

        if (in_array($nextStatus, [TicketStatus::Resolved->value, TicketStatus::Closed->value], true) && !$ticket->resolved_at) {
            $deadline = $ticket->resolution_deadline?->getTimestamp();
            $createdAt = $ticket->created_at?->getTimestamp();
            $resolvedAt = now()->getTimestamp();

            if ($deadline && $createdAt) {
                if ($resolvedAt < $deadline) {
                    $totalSla = max(1, $deadline - $createdAt);
                    $timeSaved = max(0, $deadline - $resolvedAt);
                    $pointsAwarded = max(10, (int) round(($timeSaved / $totalSla) * 100));
                } else {
                    $pointsAwarded = 5;
                }
            }
        }

        $validated['points'] = $currentPoints + $pointsAwarded;

        if (in_array($nextStatus, [TicketStatus::Resolved->value, TicketStatus::Closed->value], true)) {
            $validated['resolved_at'] = now();
            $validated['resolved_by'] = $request->input('resolved_by', $request->input('created_by_name', $ticket->resolved_by));
        }

        $ticket->fill($validated);
        $ticket->save();

        $newStatus = $ticket->status?->value ?? (string) $ticket->getRawOriginal('status');
        $newAssignee = $ticket->assigned_to_name ?: $ticket->assignment_group;

        if ($newAssignee && $newAssignee !== $oldAssignee) {
            event(new \App\Events\TicketAssigned($ticket));
        }

        if ($nextStatus && $newStatus !== $oldStatus) {
            if ($newStatus === TicketStatus::Resolved->value) {
                event(new \App\Events\TicketResolved($ticket));
            } elseif ($newStatus === TicketStatus::Closed->value) {
                $this->omniChannel->notifyTicketClosed($ticket);
            } else {
                $this->omniChannel->notifyTicketStatusChanged($ticket, $oldStatus, $newStatus);
            }
        }

        return response()->json($this->serializeTicket($ticket->fresh()));
    }

    public function deleteTicket(string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        $ticket->delete();

        return response()->json(['message' => 'Ticket deleted successfully']);
    }

    public function ticketActivities(Request $request, string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        $query = TicketActivity::query()
            ->where('ticket_id', $ticket->id)
            ->orderBy('created_at');

        $visibility = $request->query('visibility');
        if ($visibility === 'public') {
            $query->where('visibility_type', 'public');
        } elseif ($visibility === 'internal') {
            $query->where('visibility_type', 'internal');
        }

        $activityType = $request->query('activity_type');
        if ($activityType) {
            $types = array_filter(explode(',', (string) $activityType));
            if ($types !== []) {
                $query->whereIn('activity_type', $types);
            }
        }

        if ($request->filled('offset')) {
            $query->offset((int) $request->query('offset', 0));
        }

        if ($request->filled('limit')) {
            $query->limit((int) $request->query('limit', 50));
        }

        $activities = $query->get()->map(fn (TicketActivity $activity) => $this->serializeActivity($activity))->values();

        return response()->json($activities);
    }

    public function addTicketActivity(Request $request, string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        $validated = $request->validate([
            'activity_type' => 'required|string|max:50',
            'visibility_type' => 'required|string|max:50',
            'channel' => 'nullable|string|max:50',
            'message_id' => 'nullable|string|max:255',
            'thread_id' => 'nullable|string|max:255',
            'created_by' => 'nullable|string|max:128',
            'created_by_name' => 'nullable|string|max:255',
            'message' => 'required|string',
            'metadata_json' => 'nullable',
        ]);

        $activity = TicketActivity::query()->create([
            'ticket_id' => $ticket->id,
            'activity_type' => $validated['activity_type'],
            'visibility_type' => $validated['visibility_type'],
            'channel' => $validated['channel'] ?? 'portal',
            'message_id' => $validated['message_id'] ?? null,
            'thread_id' => $validated['thread_id'] ?? null,
            'created_by' => $validated['created_by'] ?? null,
            'created_by_name' => $validated['created_by_name'] ?? null,
            'message' => $validated['message'],
            'metadata_json' => $validated['metadata_json'] ?? null,
            'created_at' => now(),
        ]);

        return response()->json($this->serializeActivity($activity), 201);
    }

    public function addTicketComment(Request $request, string $id): JsonResponse
    {
        $ticket = Ticket::query()->find($id);

        if (!$ticket) {
            return response()->json(['error' => 'Ticket not found'], 404);
        }

        $validated = $request->validate([
            'message' => 'required|string',
            'is_internal' => 'nullable|boolean',
        ]);

        $activity = $this->ticketService->addComment(
            $ticket,
            $validated['message'],
            (bool) ($validated['is_internal'] ?? false)
        );

        return response()->json($this->serializeActivity($activity), 201);
    }

    public function notifications(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required|string|max:128',
            'limit' => 'nullable|integer|min:1|max:100',
        ]);

        $notifications = Notification::query()
            ->where('user_id', $validated['user_id'])
            ->latest('created_at')
            ->limit($validated['limit'] ?? 20)
            ->get()
            ->map(fn (Notification $notification) => [
                'id' => (string) $notification->id,
                'type' => $notification->type,
                'title' => $notification->title,
                'message' => $notification->message,
                'related_ticket_id' => $notification->related_ticket_id ? (string) $notification->related_ticket_id : null,
                'is_read' => $notification->is_read,
                'created_at' => $notification->created_at,
            ])
            ->values();

        return response()->json($notifications);
    }

    public function unreadNotificationCount(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required|string|max:128',
        ]);

        $count = Notification::query()
            ->where('user_id', $validated['user_id'])
            ->where('is_read', false)
            ->count();

        return response()->json(['count' => $count]);
    }

    public function markNotificationRead(string $id): JsonResponse
    {
        $notification = Notification::query()->find($id);
        if (!$notification) {
            return response()->json(['error' => 'Notification not found'], 404);
        }

        $notification->forceFill([
            'is_read' => true,
            'read_at' => now(),
        ])->save();

        return response()->json(['status' => 'ok']);
    }

    private function serializeTickets($tickets): array
    {
        return $tickets->map(fn (Ticket $ticket) => $this->serializeTicket($ticket))->values()->all();
    }

    private function serializeTicket(Ticket $ticket): array
    {
        $data = $ticket->toArray();
        $data['id'] = (string) $ticket->id;

        return $data;
    }

    private function serializeActivity(TicketActivity $activity): array
    {
        $data = $activity->toArray();
        $data['id'] = (string) $activity->id;
        $data['ticket_id'] = (string) $activity->ticket_id;

        return $data;
    }

    private function serializeUser(User $user): array
    {
        $data = $user->toArray();

        return [
            'id' => (string) $user->id,
            'uid' => $data['uid'],
            'name' => $data['name'],
            'email' => $data['email'],
            'role' => is_array($data['role'] ?? null) ? ($data['role']['value'] ?? null) : ($data['role'] ?? null),
            'phone' => $data['phone'] ?? null,
            'department' => $data['department'] ?? null,
            'is_active' => $data['is_active'] ?? true,
            'is_demo' => $data['is_demo'] ?? false,
            'last_login' => $data['last_login'] ?? null,
        ];
    }

    private function simpleHash(string $value): string
    {
        $hash = 0;
        $length = mb_strlen($value);
        for ($i = 0; $i < $length; $i++) {
            $char = mb_substr($value, $i, 1);
            $hash = (($hash << 5) - $hash) + mb_ord($char);
            $hash &= $hash;
        }

        return 'h_' . base_convert((string) abs($hash), 10, 36) . '_' . $length;
    }
}
