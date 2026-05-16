import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { query, execute, formatDate } from './db';
import { NotificationEngine } from "./notificationEngine";
import { collection, addDoc, serverTimestamp, getDocs, query as fsQuery, where, limit, updateDoc, doc } from "firebase/firestore";
import { db as firestoreDb } from "./firebase";


/**
 * OmniChannelEngine handles multi-channel communication (Email, WhatsApp, etc.)
 */
export class OmniChannelEngine {
  /**
   * Initializes the email transporter for a specific config
   */
  private static async createTransporter(config: any) {
    return nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  /**
   * Polls incoming emails for ALL active company configurations.
   */
  static async pollIncomingEmails() {
    console.log('[OmniChannel] Starting multi-tenant email polling...');
    
    try {
      // 1. Fetch all active configs
      const configs = await query("SELECT * FROM company_email_configs WHERE is_active = 1");
      
      if (configs.length === 0) {
        console.log('[OmniChannel] No active email configurations found. Falling back to env defaults.');
        // Optional: Keep existing ENV fallback if you want
        return;
      }

      for (const config of configs) {
        console.log(`[OmniChannel] Polling for ${config.company_name} (${config.email_address})...`);
        
        const imapConfig = {
          imap: {
            user: config.imap_user,
            password: config.imap_pass,
            host: config.imap_host,
            port: config.imap_port,
            tls: config.encryption !== 'None',
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
          }
        };

        try {
          const connection = await imaps.connect(imapConfig);
          await connection.openBox('INBOX');

          const searchCriteria = ['UNSEEN'];
          const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: true
          };

          const messages = await connection.search(searchCriteria, fetchOptions);
          console.log(`[OmniChannel] Found ${messages.length} new emails for ${config.company_name}.`);

          for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            if (all) {
              const parsed = await simpleParser(all.body);
              await this.processIncomingEmail(parsed, config);
            }
          }

          connection.end();
        } catch (err: any) {
          console.error(`[OmniChannel] Error polling ${config.company_name}:`, err.message);
        }
      }
    } catch (error: any) {
      console.error('[OmniChannel] Multi-tenant poll error:', error.message);
    }
  }

  /**
   * Process a single incoming email with company context
   */
  private static async processIncomingEmail(mail: any, config: any) {
    const subject = mail.subject || '(No Subject)';
    const from = mail.from?.text || mail.from?.value?.[0]?.address || 'unknown';
    const body = mail.text || mail.html || '';
    const messageId = mail.messageId;

    console.log(`[OmniChannel] Processing email from ${from}: ${subject} (Company: ${config.company_name})`);

    try {
      // 0. Handle Attachments
      const attachments: any[] = [];
      if (mail.attachments && mail.attachments.length > 0) {
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        for (const att of mail.attachments) {
          const filename = `${Date.now()}-${att.filename || 'attachment'}`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, att.content);
          attachments.push({
            filename: att.filename || 'attachment',
            stored_filename: filename,
            content_type: att.contentType,
            size: att.size,
            url: `/uploads/${filename}`
          });
        }
      }

      // 1. Check if this is a reply to an existing ticket
      const ticketMatch = subject.match(/INC(\d+)/i) || subject.match(/\[TK-(\d+)\]/i) || body.match(/INC(\d+)/i);
      
      if (ticketMatch) {
        let ticketNumber = ticketMatch[0].toUpperCase();
        if (ticketNumber.startsWith('[TK-')) {
          ticketNumber = ticketNumber.replace('[TK-', 'INC').replace(']', '');
        }

        const tickets = await query("SELECT id, assigned_to, ticket_number, title FROM tickets WHERE ticket_number = ?", [ticketNumber]);
        
        if (tickets.length > 0) {
          const ticketSqlId = tickets[0].id;
          const assignedTo = tickets[0].assigned_to;
          
          const activityData = {
            subject, from, messageId,
            body: body.substring(0, 5000),
            attachments,
            company_id: config.id,
            timestamp: new Date().toISOString()
          };

          await execute(
            "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [ticketSqlId, 'email_received', 'public', from, from, "New email reply received", JSON.stringify(activityData)]
          );
          
          await execute("UPDATE tickets SET updated_at = ? WHERE id = ?", [formatDate(new Date()), ticketSqlId]);

          // Sync to Firestore
          try {
            const fsTickets = await getDocs(fsQuery(collection(firestoreDb, "tickets"), where("number", "==", ticketNumber), limit(1)));
            if (!fsTickets.empty) {
              const fsDoc = fsTickets.docs[0];
              const currentHistory = fsDoc.data().history || [];
              await updateDoc(doc(firestoreDb, "tickets", fsDoc.id), {
                updatedAt: serverTimestamp(),
                history: [...currentHistory, {
                  action: `Email Reply Received (via ${config.company_name})`,
                  timestamp: new Date().toISOString(),
                  user: from,
                  details: subject
                }]
              });
            }
          } catch {}

          if (assignedTo) {
            await NotificationEngine.create(
              assignedTo,
              `New Reply: ${ticketNumber}`,
              `Client ${from} replied via ${config.company_name}.`,
              'email_reply',
              ticketNumber
            );
          }
          return;
        }
      }

      // 2. New Ticket Creation
      const ticketNumber = 'INC' + Math.floor(1000000 + Math.random() * 9000000);
      
      // SQL Insertion
      const sqlResult = await execute(
        "INSERT INTO tickets (ticket_number, caller, title, description, status, priority, channel, created_by, created_by_name, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [ticketNumber, from, subject, body.substring(0, 5000), 'New', '4 - Low', 'Email', from, from, config.id]
      );


      const ticketSqlId = sqlResult.insertId;

      // Store company context in activity
      await execute(
        "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [ticketSqlId, 'email_received', 'public', from, from, `Ticket created via ${config.company_name}`, JSON.stringify({
          subject, from, messageId, attachments, company_name: config.company_name
        })]
      );

      // Firestore Insertion
      try {
        await addDoc(collection(firestoreDb, "tickets"), {
          number: ticketNumber,
          caller: from,
          title: subject,
          description: body.substring(0, 5000),
          status: "New",
          priority: "4 - Low",
          channel: "Email",
          createdBy: "System",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          companyName: config.company_name, // Track which company it belongs to
          history: [{ action: "Ticket created via email", timestamp: new Date().toISOString(), user: from }]
        });
      } catch {}

      // Send Acknowledgement using THIS company's email
      await this.sendEmailByConfig(config, from, `[TK-${ticketNumber.replace('INC', '')}] Ticket Created: ${subject}`, `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb;">${config.company_name} Support</h2>
          <p>Hello,</p>
          <p>We have received your email and a new support ticket has been opened for you.</p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0;"><strong>Ticket Number:</strong> TK-${ticketNumber.replace('INC', '')}</p>
            <p style="margin: 5px 0 0 0;"><strong>Subject:</strong> ${subject}</p>
          </div>
          <p>Our team will review your request shortly.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="font-size: 12px; color: #64748b;">This is an automated notification from ${config.email_address}.</p>
        </div>
      `);

    } catch (error: any) {
      console.error('[OmniChannel] Error processing email:', error.message);
    }
  }

  /**
   * Sends an email using a specific configuration
   */
  static async sendEmailByConfig(config: any, to: string, subject: string, html: string, attachments: any[] = []) {
    try {
      const transporter = await this.createTransporter(config);
      
      const mailOptions: any = {
        from: `"${config.company_name} Support" <${config.email_address}>`,
        to,
        subject,
        html,
      };

      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments.map(att => ({
          filename: att.filename,
          path: att.url.startsWith('http') ? att.url : path.join(process.cwd(), 'public', att.url)
        }));
      }

      const info = await transporter.sendMail(mailOptions);
      console.log(`[OmniChannel] Email sent via ${config.company_name} to ${to}`);
      return info;
    } catch (error: any) {
      console.error(`[OmniChannel] Send error (${config.company_name}):`, error.message);
      throw error;
    }
  }

  /**
   * Helper to send email for a specific ticket (automatically detects company)
   */
  static async sendEmailForTicket(ticketNumber: string, to: string, subject: string, html: string, attachments: any[] = []) {
    // 1. Try to find company context from activity or ticket
    // For now, use the default config if not specified
    const configs = await query("SELECT * FROM company_email_configs WHERE is_active = 1 ORDER BY is_default DESC LIMIT 1");
    if (configs.length > 0) {
      return this.sendEmailByConfig(configs[0], to, subject, html, attachments);
    }
    // Fallback to old behavior
    return this.sendEmail(to, subject, html, attachments);
  }

  /**
   * Legacy sendEmail (uses env defaults)
   */
  static async sendEmail(to: string, subject: string, html: string, attachments: any[] = []) {
    try {
      const transporter = this.getTransporter();
      const fromEmail = process.env.SMTP_USER || 'Support@technosprint.net';
      const fromName = "Technosprint Support";

      const mailOptions: any = {
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
      };

      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments.map(att => ({
          filename: att.filename,
          path: att.url.startsWith('http') ? att.url : path.join(process.cwd(), 'public', att.url)
        }));
      }

      const info = await transporter.sendMail(mailOptions);

      console.log(`[OmniChannel] Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (error: any) {
      console.error('[OmniChannel] Send email error:', error.message);
      throw error;
    }
  }

  /**
   * Processes the notification queue to send pending emails/WhatsApp messages.
   */
  static async processNotificationQueue() {
    // console.log('[OmniChannel] Processing notification queue...');
    try {
      // In a real implementation, we would fetch unsent notifications from the DB
      // and send them here. For now, we just ensure the engine is alive.
    } catch (error: any) {
      console.error('[OmniChannel] Notification queue error:', error.message);
    }
  }
}
