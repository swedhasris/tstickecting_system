<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            if (!Schema::hasColumn('tickets', 'caller_email')) {
                $table->string('caller_email', 255)->nullable()->after('caller');
                $table->index('caller_email');
            }
        });

        Schema::create('ticket_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ticket_activity_id')->nullable()->constrained('ticket_activities')->nullOnDelete();
            $table->string('uploaded_by', 255)->nullable();
            $table->string('source', 50)->default('email');
            $table->string('original_name', 255);
            $table->string('stored_name', 255);
            $table->string('mime_type', 150)->nullable();
            $table->string('storage_disk', 50)->default('public');
            $table->text('storage_path');
            $table->text('public_url')->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->string('message_id', 255)->nullable();
            $table->timestamps();
            $table->index('ticket_id');
            $table->index('message_id');
        });

        Schema::create('email_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_id')->nullable()->constrained()->nullOnDelete();
            $table->string('message_id', 255)->unique();
            $table->string('thread_id', 255)->nullable();
            $table->string('direction', 20);
            $table->string('mailbox_folder', 100)->nullable();
            $table->string('sender_name', 255)->nullable();
            $table->string('sender_email', 255)->nullable();
            $table->text('recipient_emails')->nullable();
            $table->string('subject', 500)->nullable();
            $table->longText('body_text')->nullable();
            $table->longText('body_html')->nullable();
            $table->json('attachments_json')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->index('ticket_id');
            $table->index(['direction', 'received_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_messages');
        Schema::dropIfExists('ticket_attachments');

        Schema::table('tickets', function (Blueprint $table) {
            if (Schema::hasColumn('tickets', 'caller_email')) {
                $table->dropIndex(['caller_email']);
                $table->dropColumn('caller_email');
            }
        });
    }
};
