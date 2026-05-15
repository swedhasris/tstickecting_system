<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\LegacyApiController;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\WebhookController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/tickets', [TicketController::class, 'store']);
Route::patch('/tickets/{ticket}/status', [TicketController::class, 'updateStatus']);
Route::patch('/tickets/{ticket}/assign', [TicketController::class, 'assign']);
Route::post('/tickets/{ticket}/comments', [TicketController::class, 'comment']);

Route::post('/ai/suggest', [TicketController::class, 'suggest']);
Route::post('/ai/chat', [TicketController::class, 'chat']);
Route::post('/notify', [TicketController::class, 'notify']);
Route::post('/webhooks/whatsapp', [WebhookController::class, 'whatsapp']);

/*
|--------------------------------------------------------------------------
| Legacy API compatibility
|--------------------------------------------------------------------------
|
| The React frontend still calls the original Express-style endpoints.
| These routes keep those contracts alive while the wider Laravel port
| is completed module by module.
|
*/
Route::controller(LegacyApiController::class)->group(function () {
    Route::get('/health', 'health');
    Route::get('/db-test', 'dbTest');
    Route::post('/auth/login', 'login');

    Route::get('/users', 'users');
    Route::get('/users/{uid}', 'showUser');
    Route::post('/users', 'storeUser');
    Route::put('/users/{uid}', 'updateUser');

    Route::get('/tickets/all', 'ticketsAll');
    Route::get('/tickets/open', 'ticketsOpen');
    Route::get('/tickets/assigned/{userId}', 'ticketsAssigned');
    Route::get('/tickets/unassigned', 'ticketsUnassigned');
    Route::get('/tickets/resolved', 'ticketsResolved');
    Route::get('/tickets/{id}', 'showTicket');
    Route::post('/tickets/create', 'createTicket');
    Route::put('/tickets/{id}', 'updateTicket');
    Route::delete('/tickets/{id}', 'deleteTicket');

    Route::get('/tickets/{id}/activities', 'ticketActivities');
    Route::post('/tickets/{id}/activities', 'addTicketActivity');
    Route::post('/tickets/{id}/comments', 'addTicketComment');

    Route::get('/notifications', 'notifications');
    Route::get('/notifications/unread-count', 'unreadNotificationCount');
    Route::post('/notifications/{id}/read', 'markNotificationRead');
});
