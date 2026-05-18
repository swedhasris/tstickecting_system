import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { query, execute, formatDate } from './db';

// ═══════════════════════════════════════════════════════════════════════
// Enterprise Email Engine - Queue, Threading, Retry, Templates, Logging
// ═══════════════════════════════════════════════════════════════════════

const RETRY_DELAYS = [60, 300, 900, 1800, 3600]; // 1m, 5m, 15m, 30m, 1h

// ── HTML Email Templates ─────────────────────────────────────────────
function baseTemplate(title: string, content: string, footer: string = ''): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
  body{margin:0;padding:0;font-family:'Segoe UI',Roboto,sans-serif;background:#f4f6f9}
  .wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:28px 32px;color:#fff}
  .header h1{margin:0;font-size:20px;font-weight:700;letter-spacing:-0.5px}
  .header .sub{color:#94a3b8;font-size:13px;margin-top:4px}
  .body{padding:32px}
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase}
  .badge-critical{background:#fee2e2;color:#dc2626}
  .badge-high{background:#ffedd5;color:#ea580c}
  .badge-medium{background:#fef9c3;color:#ca8a04}
  .badge-low{background:#dcfce7;color:#16a34a}
  .info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .info-label{color:#64748b;font-weight:600}
  .info-value{color:#1e293b;font-weight:500}
  .btn{display:inline-block;padding:12px 28px;background:#84cc16;color:#1a1a2e;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px}
  .footer{padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
  .sla-warn{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0}
  .sla-breach{background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0}
  </style></head><body><div style="padding:20px"><div class="wrap">
  <div class="header"><h1>🎫 ${title}</h1><div class="sub">Ticklora ITSM Platform</div></div>
  <div class="body">${content}</div>
  <div class="footer">${footer || 'This is an automated message from Ticklora. Please do not reply directly to this email unless instructed.'}</div>
  </div></div></body></html>`;
}

function priorityBadge(p: string): string {
  const c = p?.includes('1') ? 'critical' : p?.includes('2') ? 'high' : p?.includes('3') ? 'medium' : 'low';
  return `<span class="badge badge-${c}">${p || 'Low'}</span>`;
}

function ticketInfoBox(ticket: any): string {
  return `<div class="info-box">
    <div class="info-row"><span class="info-label">Ticket #</span><span class="info-value">${ticket.ticket_number}</span></div>
    <div class="info-row"><span class="info-label">Subject</span><span class="info-value">${ticket.title}</span></div>
    <div class="info-row"><span class="info-label">Status</span><span class="info-value">${ticket.status}</span></div>
    <div class="info-row"><span class="info-label">Priority</span><span class="info-value">${priorityBadge(ticket.priority)}</span></div>
    <div class="info-row"><span class="info-label">Assigned To</span><span class="info-value">${ticket.assigned_to_name || 'Unassigned'}</span></div>
    ${ticket.channel ? `<div class="info-row"><span class="info-label">Channel</span><span class="info-value">${ticket.channel}</span></div>` : ''}
  </div>`;
}

// ── Template generators ──────────────────────────────────────────────
export const EmailTemplates = {
  ticketCreated: (ticket: any, requester: string) => baseTemplate(
    'New Ticket Created',
    `<p>Hello,</p><p>A new support ticket has been created${requester ? ` by <strong>${requester}</strong>` : ''}.</p>
    ${ticketInfoBox(ticket)}
    <p>${ticket.description ? `<strong>Description:</strong><br>${String(ticket.description).substring(0, 500)}` : ''}</p>
    <p style="margin-top:24px"><a href="#" class="btn">View Ticket →</a></p>`,
    `Reply to this email with [${ticket.ticket_number}] in the subject to update the ticket.`
  ),

  ticketAssigned: (ticket: any, agent: string) => baseTemplate(
    'Ticket Assigned to You',
    `<p>Hello <strong>${agent}</strong>,</p><p>A ticket has been assigned to you for resolution.</p>
    ${ticketInfoBox(ticket)}
    <p style="margin-top:24px"><a href="#" class="btn">Accept & View →</a></p>`
  ),

  ticketUpdated: (ticket: any, changes: string) => baseTemplate(
    `Ticket Updated: ${ticket.ticket_number}`,
    `<p>The following ticket has been updated:</p>${ticketInfoBox(ticket)}
    <div class="info-box"><strong>Changes:</strong><br>${changes}</div>`
  ),

  publicComment: (ticket: any, author: string, comment: string) => baseTemplate(
    `New Comment on ${ticket.ticket_number}`,
    `<p><strong>${author}</strong> added a comment:</p>
    <div class="info-box" style="background:#f0fdf4;border-color:#bbf7d0">${comment}</div>
    ${ticketInfoBox(ticket)}
    <p style="margin-top:24px"><a href="#" class="btn">Reply →</a></p>`,
    `Reply to this email to add a comment. Include [${ticket.ticket_number}] in the subject.`
  ),

  ticketResolved: (ticket: any) => baseTemplate(
    `Ticket Resolved: ${ticket.ticket_number}`,
    `<p>Your ticket has been <strong style="color:#16a34a">resolved</strong>.</p>
    ${ticketInfoBox(ticket)}
    <p>If you need further assistance, simply reply to this email or reopen the ticket.</p>
    <p style="margin-top:24px"><a href="#" class="btn">View Resolution →</a></p>`
  ),

  ticketClosed: (ticket: any) => baseTemplate(
    `Ticket Closed: ${ticket.ticket_number}`,
    `<p>Your ticket has been <strong>closed</strong>. Thank you for contacting support.</p>${ticketInfoBox(ticket)}`
  ),

  slaWarning: (ticket: any, pct: number, type: string) => baseTemplate(
    `⚠️ SLA Warning: ${ticket.ticket_number}`,
    `<div class="sla-warn"><strong>SLA ${type} at ${pct}%</strong> — Action required before breach.</div>
    ${ticketInfoBox(ticket)}
    <p style="margin-top:24px"><a href="#" class="btn">Take Action →</a></p>`
  ),

  slaBreached: (ticket: any, type: string) => baseTemplate(
    `🚨 SLA Breached: ${ticket.ticket_number}`,
    `<div class="sla-breach"><strong>SLA ${type} has been BREACHED</strong> — Immediate escalation required.</div>
    ${ticketInfoBox(ticket)}
    <p style="margin-top:24px"><a href="#" class="btn">Escalate Now →</a></p>`
  ),

  acknowledgment: (ticket: any, companyName: string) => baseTemplate(
    `${companyName} — Ticket Received`,
    `<p>Hello,</p><p>We received your email and created a support ticket.</p>
    ${ticketInfoBox(ticket)}
    <p>Our team will review your request shortly. You can reply to this email to provide updates.</p>`,
    `Reference: [${ticket.ticket_number}] — ${companyName} Support`
  ),
};

// ── Email Logging ────────────────────────────────────────────────────
export async function logEmail(data: {
  ticket_id?: number; ticket_number?: string; direction: string;
  recipient?: string; sender?: string; subject?: string; body_preview?: string;
  message_id?: string; in_reply_to?: string; status: string;
  error_message?: string; email_type?: string; config_id?: number;
  sent_at?: string; received_at?: string;
}) {
  try {
    await execute(
      `INSERT INTO email_logs (ticket_id,ticket_number,direction,recipient,sender,subject,body_preview,message_id,in_reply_to,status,error_message,email_type,config_id,sent_at,received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [data.ticket_id||null, data.ticket_number||null, data.direction, data.recipient||null, data.sender||null,
       data.subject||null, data.body_preview?.substring(0,500)||null, data.message_id||null, data.in_reply_to||null,
       data.status, data.error_message||null, data.email_type||'notification', data.config_id||null,
       data.sent_at||null, data.received_at||null]
    );
  } catch (e: any) { console.error('[EmailLog] Error:', e.message); }
}

// ── Threading Engine ─────────────────────────────────────────────────
export async function findOrCreateThread(ticketId: number, ticketNumber: string, messageId: string, subject: string) {
  const threadId = `thread_${ticketNumber}_${Date.now()}`;
  const existing = await query("SELECT * FROM email_threads WHERE ticket_number = ?", [ticketNumber]);
  if (existing.length > 0) {
    await execute("UPDATE email_threads SET last_message_id = ?, message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE ticket_number = ?",
      [messageId, ticketNumber]);
    return existing[0];
  }
  await execute(
    "INSERT INTO email_threads (ticket_id, ticket_number, thread_id, original_message_id, subject, last_message_id) VALUES (?,?,?,?,?,?)",
    [ticketId, ticketNumber, threadId, messageId, subject, messageId]
  );
  return { thread_id: threadId, ticket_number: ticketNumber };
}

export function matchTicketFromEmail(subject: string, body: string, headers: any): string | null {
  // Match [INC1234567] or INC1234567 patterns
  const patterns = [/\[?(INC\d{5,})\]?/i, /\[TK-(\d+)\]/i];
  for (const p of patterns) {
    const m = subject?.match(p) || body?.match(p);
    if (m) return m[1].toUpperCase().startsWith('INC') ? m[1].toUpperCase() : `INC${m[1]}`;
  }
  // Check In-Reply-To / References headers
  if (headers?.['in-reply-to'] || headers?.references) {
    const ref = headers['in-reply-to'] || headers.references;
    const m = ref.match(/INC(\d+)/i);
    if (m) return `INC${m[1]}`;
  }
  return null;
}

// ── Queue-Based Delivery ─────────────────────────────────────────────
export async function enqueueEmail(eventType: string, ticketId: number|null, ticketNumber: string|null, recipient: string, subject: string, bodyHtml: string, configId?: number) {
  await execute(
    "INSERT INTO notifications_queue (event_type,ticket_id,ticket_number,recipient,subject,body_html,config_id) VALUES (?,?,?,?,?,?,?)",
    [eventType, ticketId, ticketNumber, recipient, subject, bodyHtml, configId||null]
  );
}

export async function processEmailQueue() {
  const pending = await query(
    "SELECT * FROM notifications_queue WHERE status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at <= datetime('now')) ORDER BY priority ASC, created_at ASC LIMIT 10"
  );
  if (pending.length === 0) return;
  console.log(`[EmailQueue] Processing ${pending.length} queued emails...`);

  for (const job of pending) {
    await execute("UPDATE notifications_queue SET status = 'processing' WHERE id = ?", [job.id]);
    try {
      let configs = await query("SELECT * FROM company_email_configs WHERE is_active = 1 ORDER BY is_default DESC LIMIT 1");
      let config = configs[0];
      let transporter;
      let fromAddress = "";
      
      if (!config) {
        console.log("[EmailQueue] No active DB configs. Falling back to env defaults (Support@technosprint.net)...");
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'mail.technosprint.net',
          port: parseInt(process.env.SMTP_PORT || '465'),
          secure: (process.env.SMTP_PORT || '465') === '465',
          auth: {
            user: process.env.SMTP_USER || 'Support@technosprint.net',
            pass: process.env.SMTP_PASS || '',
          },
          tls: { rejectUnauthorized: false }
        });
        fromAddress = `"Technosprint Support" <${process.env.SMTP_USER || 'Support@technosprint.net'}>`;
      } else {
        fromAddress = `"${config.company_name} Support" <${config.email_address}>`;
        try {
          transporter = nodemailer.createTransport({
            host: config.smtp_host, port: config.smtp_port, secure: config.smtp_port === 465,
            auth: { user: config.smtp_user, pass: config.smtp_pass },
            tls: { rejectUnauthorized: false }
          });
          await transporter.verify();
        } catch (verifyErr) {
          console.warn("[EmailQueue] Config transporter failed verification. Falling back to environment SMTP...", verifyErr);
          transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'mail.technosprint.net',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: (process.env.SMTP_PORT || '465') === '465',
            auth: {
              user: process.env.SMTP_USER || 'Support@technosprint.net',
              pass: process.env.SMTP_PASS || '',
            },
            tls: { rejectUnauthorized: false }
          });
          fromAddress = `"Technosprint Support" <${process.env.SMTP_USER || 'Support@technosprint.net'}>`;
        }
      }

      let info;
      try {
        info = await transporter.sendMail({
          from: fromAddress,
          to: job.recipient, subject: job.subject, html: job.body_html,
          headers: job.ticket_number ? { 'X-Ticket-Number': job.ticket_number } : {}
        });
      } catch (sendErr: any) {
        if (sendErr.message?.includes('535') || sendErr.message?.includes('Authentication')) {
          console.warn("[EmailQueue] Send failed due to auth error. Retrying with environment SMTP fallback...");
          const fallbackTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'mail.technosprint.net',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: (process.env.SMTP_PORT || '465') === '465',
            auth: {
              user: process.env.SMTP_USER || 'Support@technosprint.net',
              pass: process.env.SMTP_PASS || '',
            },
            tls: { rejectUnauthorized: false }
          });
          info = await fallbackTransporter.sendMail({
            from: `"Technosprint Support" <${process.env.SMTP_USER || 'Support@technosprint.net'}>`,
            to: job.recipient, subject: job.subject, html: job.body_html,
            headers: job.ticket_number ? { 'X-Ticket-Number': job.ticket_number } : {}
          });
        } else {
          throw sendErr;
        }
      }

      await execute("UPDATE notifications_queue SET status = 'sent', processed_at = datetime('now') WHERE id = ?", [job.id]);
      await logEmail({
        ticket_id: job.ticket_id, ticket_number: job.ticket_number, direction: 'outbound',
        recipient: job.recipient, sender: config.email_address, subject: job.subject,
        message_id: info.messageId, status: 'sent', email_type: job.event_type,
        config_id: config.id, sent_at: new Date().toISOString()
      });
      console.log(`[EmailQueue] ✓ Sent to ${job.recipient}`);
    } catch (err: any) {
      const retryCount = (job.retry_count || 0) + 1;
      const delay = RETRY_DELAYS[Math.min(retryCount - 1, RETRY_DELAYS.length - 1)];
      if (retryCount >= (job.max_retries || 5)) {
        await execute("UPDATE notifications_queue SET status = 'failed', error_message = ?, retry_count = ? WHERE id = ?",
          [err.message, retryCount, job.id]);
        await logEmail({ ticket_number: job.ticket_number, direction: 'outbound', recipient: job.recipient,
          subject: job.subject, status: 'failed', error_message: err.message, email_type: job.event_type });
      } else {
        await execute("UPDATE notifications_queue SET status = 'retry', error_message = ?, retry_count = ?, next_retry_at = datetime('now', '+' || ? || ' seconds') WHERE id = ?",
          [err.message, retryCount, delay, job.id]);
      }
      console.error(`[EmailQueue] ✗ Failed for ${job.recipient}: ${err.message} (retry ${retryCount})`);
    }
  }
}

// ── Event-Driven Notifications ───────────────────────────────────────
export async function notifyTicketCreated(ticket: any) {
  if (!ticket.caller) return;
  const html = EmailTemplates.ticketCreated(ticket, ticket.created_by_name || ticket.caller);
  await enqueueEmail('ticket_created', ticket.id, ticket.ticket_number, ticket.caller,
    `[${ticket.ticket_number}] Ticket Created: ${ticket.title}`, html);
}

export async function notifyTicketAssigned(ticket: any, agentEmail: string, agentName: string) {
  const html = EmailTemplates.ticketAssigned(ticket, agentName);
  await enqueueEmail('ticket_assigned', ticket.id, ticket.ticket_number, agentEmail,
    `[${ticket.ticket_number}] Assigned: ${ticket.title}`, html);
}

export async function notifyPublicComment(ticket: any, author: string, comment: string) {
  if (!ticket.caller) return;
  const html = EmailTemplates.publicComment(ticket, author, comment);
  await enqueueEmail('public_comment', ticket.id, ticket.ticket_number, ticket.caller,
    `Re: [${ticket.ticket_number}] ${ticket.title}`, html);
}

export async function notifyTicketResolved(ticket: any) {
  if (!ticket.caller) return;
  const html = EmailTemplates.ticketResolved(ticket);
  await enqueueEmail('ticket_resolved', ticket.id, ticket.ticket_number, ticket.caller,
    `[${ticket.ticket_number}] Resolved: ${ticket.title}`, html);
}

export async function notifySLAWarning(ticket: any, pct: number, type: string) {
  if (!ticket.assigned_to) return;
  const agents = await query("SELECT email FROM users WHERE uid = ?", [ticket.assigned_to]);
  if (agents.length === 0) return;
  const html = EmailTemplates.slaWarning(ticket, pct, type);
  await enqueueEmail('sla_warning', ticket.id, ticket.ticket_number, agents[0].email,
    `⚠️ SLA ${pct}% Warning: [${ticket.ticket_number}]`, html);
}

export async function notifySLABreached(ticket: any, type: string) {
  if (!ticket.assigned_to) return;
  const agents = await query("SELECT email FROM users WHERE uid = ?", [ticket.assigned_to]);
  if (agents.length === 0) return;
  const html = EmailTemplates.slaBreached(ticket, type);
  await enqueueEmail('sla_breached', ticket.id, ticket.ticket_number, agents[0].email,
    `🚨 SLA BREACHED: [${ticket.ticket_number}]`, html);
}

// ── Health Check ─────────────────────────────────────────────────────
export async function getEmailHealth() {
  const configs = await query("SELECT id, company_name, email_address, is_active FROM company_email_configs");
  const pending = await query("SELECT COUNT(*) as cnt FROM notifications_queue WHERE status = 'pending'");
  const failed = await query("SELECT COUNT(*) as cnt FROM notifications_queue WHERE status = 'failed'");
  const sent24h = await query("SELECT COUNT(*) as cnt FROM email_logs WHERE direction = 'outbound' AND sent_at > datetime('now', '-24 hours')");
  const received24h = await query("SELECT COUNT(*) as cnt FROM email_logs WHERE direction = 'inbound' AND received_at > datetime('now', '-24 hours')");
  const lastPoll = await query("SELECT MAX(received_at) as last FROM email_logs WHERE direction = 'inbound'");

  let smtpOk = false, imapOk = false;
  const activeConfig = configs.find((c: any) => c.is_active);
  if (activeConfig) {
    try {
      const full = await query("SELECT * FROM company_email_configs WHERE id = ?", [activeConfig.id]);
      if (full.length > 0) {
        const c = full[0];
        const t = nodemailer.createTransport({ host: c.smtp_host, port: c.smtp_port, secure: c.smtp_port===465, auth:{user:c.smtp_user,pass:c.smtp_pass}, tls:{rejectUnauthorized:false} });
        await t.verify(); smtpOk = true;
      }
    } catch {}
    try {
      const full = await query("SELECT * FROM company_email_configs WHERE id = ?", [activeConfig.id]);
      if (full.length > 0) {
        const c = full[0];
        const conn = await imaps.connect({ imap:{ user:c.imap_user, password:c.imap_pass, host:c.imap_host, port:c.imap_port, tls:true, tlsOptions:{rejectUnauthorized:false}, authTimeout:5000 }});
        conn.end(); imapOk = true;
      }
    } catch {}
  }

  return {
    status: smtpOk && imapOk ? 'healthy' : 'degraded',
    smtp: { connected: smtpOk },
    imap: { connected: imapOk },
    queue: { pending: pending[0]?.cnt || 0, failed: failed[0]?.cnt || 0 },
    stats: { sent_24h: sent24h[0]?.cnt || 0, received_24h: received24h[0]?.cnt || 0 },
    lastPollTime: lastPoll[0]?.last || null,
    configurations: configs.length
  };
}
