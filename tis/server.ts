import express from "express";
import { createServer as createViteServer } from "vite";
import https from "https";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import mysql from 'mysql2/promise';
import { GoogleGenAI } from "@google/genai";
import { config as loadEnv } from "dotenv";
import multer from "multer";
import fs from "fs";
import { OmniChannelEngine } from "./src/lib/omniChannelEngine";
import { SLAEngine } from "./src/lib/slaEngine";
import { uIOhook } from "uiohook-napi";
import { setUseSQLite } from "./src/lib/db";
import { NotificationEngine } from "./src/lib/notificationEngine";
import nodemailer from 'nodemailer';
import imaps from 'imap-simple';


// SQLite will be imported dynamically when needed

// Load environment variables from .env file
loadEnv();

// Log API key status at startup (masked for security)
const geminiKey = process.env.GEMINI_API_KEY;
console.log(`[Kiru AI] GEMINI_API_KEY: ${geminiKey && geminiKey !== "MY_GEMINI_API_KEY" && geminiKey !== "your_gemini_api_key_here" ? "✓ Loaded" : "✗ NOT SET — Kiru AI will not work"}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'connectit_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

let pool: mysql.Pool;
let sqliteDb: any = null;
let useSQLite = false;

async function getSQLiteDb() {
  if (!sqliteDb) {
    const { open } = await import('sqlite');
    const sqlite3Module = await import('sqlite3');
    const sqlite3 = sqlite3Module.default || sqlite3Module;
    sqliteDb = await open({
      filename: './timesheet.sqlite',
      driver: sqlite3.Database
    });
    // Create tables if not exist
    await sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT UNIQUE NOT NULL,
        name TEXT,
        email TEXT UNIQUE,
        role TEXT DEFAULT 'user',
        phone TEXT,
        password_hash TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT UNIQUE,
        caller TEXT,
        category TEXT,
        subcategory TEXT,
        service TEXT,
        service_offering TEXT,
        cmdb_item TEXT,
        title TEXT,
        description TEXT,
        status TEXT DEFAULT 'New',
        priority TEXT DEFAULT '4 - Low',
        impact TEXT,
        urgency TEXT,
        channel TEXT,
        assignment_group TEXT,
        assigned_to TEXT,
        assigned_to_name TEXT,
        points INTEGER DEFAULT 0,
        response_deadline DATETIME,
        resolution_deadline DATETIME,
        first_response_at DATETIME,
        resolved_at DATETIME,
        response_sla_status TEXT,
        resolution_sla_status TEXT,
        created_by TEXT,
        created_by_name TEXT,
        company_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        start_time DATETIME,
        stop_time DATETIME,
        duration INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sla_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        sla_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT
      );
      CREATE TABLE IF NOT EXISTS activity_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        user_id TEXT NOT NULL,
        screenshot_url TEXT,
        screenshot_filename TEXT,
        screenshot_format TEXT,
        screenshot_size_kb INTEGER,
        activity_label TEXT,
        description TEXT,
        confidence REAL,
        captured_at DATETIME,
        keystrokes INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS timesheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        status TEXT DEFAULT 'Draft',
        total_hours REAL DEFAULT 0.00,
        screenshot_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        submitted_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_user_week ON timesheets(user_id, week_start);
      CREATE TABLE IF NOT EXISTS sla_configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        priority TEXT NOT NULL,
        department TEXT,
        response_time_hours INTEGER,
        resolution_time_hours INTEGER,
        business_hours_only INTEGER DEFAULT 0,
        exclude_weekends INTEGER DEFAULT 0,
        exclude_holidays INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS time_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timesheet_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        task TEXT,
        hours_worked REAL DEFAULT 0.00,
        description TEXT,
        short_description TEXT,
        start_time TEXT,
        end_time TEXT,
        deduct REAL DEFAULT 0.00,
        work_type TEXT,
        billable TEXT,
        status TEXT DEFAULT 'Draft',
        elapsed_seconds INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ticket_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        visibility_type TEXT NOT NULL,
        created_by TEXT,
        created_by_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        message TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        ticket_id TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company_email_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        email_address TEXT NOT NULL UNIQUE,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        smtp_user TEXT NOT NULL,
        smtp_pass TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_user TEXT NOT NULL,
        imap_pass TEXT NOT NULL,
        encryption TEXT DEFAULT 'TLS',
        is_active INTEGER DEFAULT 1,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS custom_dropdowns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        label TEXT NOT NULL,
        options_json TEXT DEFAULT '[]',
        enabled_for_all INTEGER DEFAULT 1,
        enabled_company_ids_json TEXT DEFAULT '[]',
        is_required INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS feature_master (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        default_view INTEGER DEFAULT 1,
        default_use INTEGER DEFAULT 1,
        default_edit INTEGER DEFAULT 1,
        default_mandatory INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS company_feature_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        can_view INTEGER DEFAULT 1,
        can_use INTEGER DEFAULT 1,
        can_edit INTEGER DEFAULT 1,
        is_mandatory INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, feature_id)
      );
    `);
    // Migrate: add screenshot_url column if missing (safe to re-run)
    try { await sqliteDb.exec("ALTER TABLE timesheets ADD COLUMN screenshot_url TEXT;"); } catch (e) {}
    // Ensure tables have latest columns
    try {
      await sqliteDb.exec("ALTER TABLE activity_entries ADD COLUMN keystrokes INTEGER DEFAULT 0");
    } catch (e) {}
    try {
      await sqliteDb.exec("ALTER TABLE activity_entries ADD COLUMN clicks INTEGER DEFAULT 0");
    } catch (e) {}
    
    console.log('[SQLite] Timesheet database initialized');
  }
  return sqliteDb;
}

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
    console.log(`[MySQL] Connection pool created: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  }
  return pool;
}

async function initDatabase(): Promise<void> {
  try {
    // Connect without database to create it if needed
    const tempConfig = { ...dbConfig };
    delete (tempConfig as any).database;
    const tempConnection = await mysql.createConnection(tempConfig);
    await tempConnection.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await tempConnection.end();
    console.log(`[MySQL] Database '${dbConfig.database}' ensured`);
  } catch (error: any) {
    console.error('[MySQL] Database init failed:', error.message);
    console.log('[SQLite] Will use SQLite fallback for timesheets');
    useSQLite = true;
    setUseSQLite(true);
    await getSQLiteDb();
  }
}

async function testConnection(): Promise<boolean> {
  if (useSQLite) return true;
  try {
    const connection = await getPool().getConnection();
    await connection.query('SELECT 1');
    connection.release();
    console.log('[MySQL] Connection test successful');
    return true;
  } catch (error) {
    console.error('[MySQL] Connection test failed:', error);
    console.log('[SQLite] Falling back to SQLite for timesheets');
    useSQLite = true;
    setUseSQLite(true);
    await getSQLiteDb();
    return true;
  }
}

export async function query(sql: string, values?: any[]): Promise<any[]> {
  if (useSQLite) {
    const db = await getSQLiteDb();
    return await db.all(sql, values || []);
  }
  const [rows] = await getPool().execute(sql, values);
  return rows as any[];
}

export async function execute(sql: string, values?: any[]): Promise<any> {
  if (useSQLite) {
    const db = await getSQLiteDb();
    const result = await db.run(sql, values || []);
    return { insertId: result.lastID, affectedRows: result.changes };
  }
  const [result] = await getPool().execute(sql, values);
  return result as mysql.ResultSetHeader;
}

function formatDate(date: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function generateTicketNumber(): Promise<string> {
  const prefix = 'INC';
  const random = Math.floor(1000000 + Math.random() * 9000000);
  return `${prefix}${random}`;
}

// SLA Escalation Engine
async function escalateStaleTickets() {
  console.log(`[SLA Engine] Checking tickets...`);
  const now = new Date();
  const nowStr = formatDate(now);

  try {
    // Get all non-closed tickets
    const tickets = await query(
      "SELECT * FROM tickets WHERE status NOT IN ('Resolved', 'Closed', 'Canceled')"
    );

    console.log(`[SLA Engine] Fetched ${tickets.length} tickets.`);

    for (const ticket of tickets) {
      if (ticket.status === 'On Hold' || ticket.status === 'Waiting for Customer') continue;

      const updates: any = {};
      const historyEntries: any[] = [];

      // Response SLA Check
      if (ticket.response_deadline && !ticket.first_response_at &&
        ticket.response_sla_status !== 'Breached' && ticket.response_sla_status !== 'Completed') {
        try {
          const deadline = new Date(ticket.response_deadline).getTime();
          const createdAt = new Date(ticket.created_at).getTime();
          if (!isNaN(deadline) && !isNaN(createdAt)) {
            const diff = deadline - now.getTime();

            if (diff <= 0) {
              updates.response_sla_status = 'Breached';
              historyEntries.push({
                action: "Response SLA BREACHED",
                timestamp: now.toISOString(),
                user: "SLA Engine"
              });
            } else {
              const totalWindow = deadline - createdAt;
              if (totalWindow > 0 && diff < totalWindow * 0.2) {
                if (ticket.response_sla_status !== 'At Risk') {
                  updates.response_sla_status = 'At Risk';
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[SLA Engine] Could not parse response deadline for ticket ${ticket.id}:`, e);
        }
      }

      // Resolution SLA Check
      if (ticket.resolution_deadline && !ticket.resolved_at &&
        ticket.resolution_sla_status !== 'Breached' && ticket.resolution_sla_status !== 'Completed') {
        try {
          const deadline = new Date(ticket.resolution_deadline).getTime();
          const createdAt = new Date(ticket.created_at).getTime();
          if (!isNaN(deadline) && !isNaN(createdAt)) {
            const diff = deadline - now.getTime();

            if (diff <= 0) {
              updates.resolution_sla_status = 'Breached';
              updates.priority = '1 - Critical';
              historyEntries.push({
                action: "Resolution SLA BREACHED: Ticket escalated to Critical",
                timestamp: now.toISOString(),
                user: "SLA Engine"
              });
            } else {
              const totalWindow = deadline - createdAt;
              if (totalWindow > 0 && diff < totalWindow * 0.2) {
                if (ticket.resolution_sla_status !== 'At Risk') {
                  updates.resolution_sla_status = 'At Risk';
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[SLA Engine] Could not parse resolution deadline for ticket ${ticket.id}:`, e);
        }
      }

      if (Object.keys(updates).length > 0) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        await execute(`UPDATE tickets SET ${fields}, updated_at = ? WHERE id = ?`, [...Object.values(updates), formatDate(new Date()), ticket.id]);

        // Add history entries to activities
        for (const entry of historyEntries) {
          await execute(
            "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [ticket.id, 'sla_triggered', 'internal', 'System Engine', entry.user, entry.action, JSON.stringify(entry)]
          );
        }
      }
    }
  } catch (error: any) {
    console.error(`[SLA Engine] Error: ${error.message}`);
  }
}

// Schedule SLA check to run every 15 minutes
cron.schedule("*/15 * * * *", () => {
  escalateStaleTickets();
});

async function startServer() {
  const app = express();
  const PORT = 3001;

  app.use(express.json());

  // Initialize database connection
  await initDatabase();
  await testConnection();

  // Auto-create timesheet tables if they don't exist
  if (!useSQLite) {
    try {
      await execute(`
        CREATE TABLE IF NOT EXISTS timesheets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          week_start DATE NOT NULL,
          week_end DATE NOT NULL,
          status ENUM('Draft', 'Submitted', 'Approved', 'Rejected') DEFAULT 'Draft',
          total_hours DECIMAL(10, 2) DEFAULT 0.00,
          screenshot_url LONGTEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          submitted_at TIMESTAMP NULL,
          INDEX idx_user_week (user_id, week_start),
          INDEX idx_status (status)
        ) ENGINE=InnoDB
      `);
      try { await execute("ALTER TABLE timesheets ADD COLUMN screenshot_url LONGTEXT;"); } catch(e) {}

      await execute(`
        CREATE TABLE IF NOT EXISTS ticket_activities (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticket_id VARCHAR(128) NOT NULL,
          activity_type VARCHAR(50) NOT NULL,
          visibility_type VARCHAR(50) NOT NULL,
          created_by VARCHAR(128),
          created_by_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          message TEXT NOT NULL,
          metadata_json JSON,
          INDEX idx_ticket_id (ticket_id),
          INDEX idx_created_at (created_at),
          INDEX idx_visibility (visibility_type)
        ) ENGINE=InnoDB
      `);

      await execute(`
        CREATE TABLE IF NOT EXISTS time_cards (
          id INT AUTO_INCREMENT PRIMARY KEY,
          timesheet_id INT NOT NULL,
          user_id VARCHAR(128) NOT NULL,
          entry_date DATE NOT NULL,
          task VARCHAR(255),
          hours_worked DECIMAL(10, 2) DEFAULT 0.00,
          description TEXT,
          short_description VARCHAR(255),
          start_time VARCHAR(20),
          end_time VARCHAR(20),
          deduct DECIMAL(10, 2) DEFAULT 0.00,
          work_type VARCHAR(50),
          billable VARCHAR(50),
          status ENUM('Draft', 'Submitted', 'Approved', 'Rejected') DEFAULT 'Draft',
          elapsed_seconds INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_timesheet_id (timesheet_id),
          INDEX idx_user_date (user_id, entry_date)
        ) ENGINE=InnoDB
      `);
      console.log('[MySQL] Timesheet tables initialized');

      // ═══ MASTER DATA TABLES ═══
      
      // Standalone tables
      const standaloneTables = [
        'mst_groups', 'mst_statuses', 'mst_roles', 'mst_departments', 
        'mst_ticket_types', 'mst_projects', 'mst_priorities', 
        'mst_sources', 'mst_tags', 'mst_categories'
      ];

      for (const table of standaloneTables) {
        await execute(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            status ENUM('active', 'inactive') DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_by VARCHAR(128),
            UNIQUE(name)
          ) ENGINE=InnoDB
        `);
      }

      // Specialized standalone tables (extra columns)
      await execute(`
        CREATE TABLE IF NOT EXISTS mst_priorities (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          level INT DEFAULT 0,
          color VARCHAR(50),
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(128),
          UNIQUE(name)
        ) ENGINE=InnoDB
      `).catch(() => {});

      // Hierarchical tables
      await execute(`
        CREATE TABLE IF NOT EXISTS mst_subcategories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          category_id INT NOT NULL,
          description TEXT,
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(128),
          UNIQUE(name, category_id)
        ) ENGINE=InnoDB
      `);

      await execute(`
        CREATE TABLE IF NOT EXISTS mst_providences (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          subcategory_id INT NOT NULL,
          description TEXT,
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(128),
          UNIQUE(name, subcategory_id)
        ) ENGINE=InnoDB
      `);

      // Group Members (User-Group junction)
      await execute(`
        CREATE TABLE IF NOT EXISTS mst_members (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          group_id INT NOT NULL,
          role VARCHAR(100),
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(128),
          UNIQUE(user_id, group_id)
        ) ENGINE=InnoDB
      `);

      console.log('[MySQL] Master data tables initialized');

      // Activity Tracker Tables
      await execute(`
        CREATE TABLE IF NOT EXISTS activity_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id VARCHAR(128) NOT NULL,
          user_id VARCHAR(128) NOT NULL,
          user_name VARCHAR(255),
          start_time TIMESTAMP NULL,
          stop_time TIMESTAMP NULL,
          duration INT DEFAULT 0,
          status ENUM('active', 'completed', 'canceled') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_session (user_id, session_id),
          INDEX idx_status (status)
        ) ENGINE=InnoDB
      `);

      await execute(`
        CREATE TABLE IF NOT EXISTS activity_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id VARCHAR(128),
          user_id VARCHAR(128) NOT NULL,
          screenshot_url VARCHAR(255),
          screenshot_filename VARCHAR(255),
          screenshot_format VARCHAR(10),
          screenshot_size_kb INT,
          activity_label VARCHAR(100),
          description TEXT,
          confidence DECIMAL(3, 2),
          captured_at TIMESTAMP NULL,
          keystrokes INT DEFAULT 0,
          clicks INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_session (session_id),
          INDEX idx_user (user_id),
          INDEX idx_captured (captured_at)
        ) ENGINE=InnoDB
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          ticket_id VARCHAR(128),
          is_read TINYINT(1) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_id (user_id),
          INDEX idx_is_read (is_read)
        ) ENGINE=InnoDB
      `);
      console.log('[MySQL] Activity tracker and notification tables initialized');
    } catch (e: any) {
      console.error('[MySQL] Failed to initialize timesheet tables:', e.message);
    }
  }

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", database: "mysql" });
  });

  app.get("/api/test-email", async (req, res) => {
    try {
      const email = req.query.email as string || process.env.SMTP_USER;
      if (!email) return res.status(400).json({ error: "No email provided" });
      
      await OmniChannelEngine.sendEmail(
        email, 
        "Ticklora Test Email", 
        "<h1>It works!</h1><p>The email system is now functional.</p>"
      );
      res.json({ message: `Test email sent to ${email}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/db-test", async (req, res) => {
    try {
      const result = await query("SELECT COUNT(*) as count FROM tickets");
      res.json({
        status: "connected",
        database: dbConfig.database,
        host: dbConfig.host,
        count: result[0]?.count || 0
      });
    } catch (error: any) {
      console.error("[Diagnostic] DB Test failed:", error.message);
      res.status(500).json({
        status: "error",
        error: error.message,
        database: dbConfig.database,
        host: dbConfig.host
      });
    }
  });

  // ═══ Custom Dropdown CRUD Endpoints ═══
  app.get("/api/custom-dropdowns", async (req, res) => {
    try {
      const rows = await query("SELECT * FROM custom_dropdowns ORDER BY created_at ASC");
      const result = rows.map(r => ({
        id: r.id,
        name: r.name,
        label: r.label,
        options: JSON.parse(r.options_json || '[]'),
        enabledForAll: Boolean(r.enabled_for_all),
        enabledCompanyIds: JSON.parse(r.enabled_company_ids_json || '[]'),
        isRequired: Boolean(r.is_required),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/custom-dropdowns", async (req, res) => {
    try {
      const id = `dd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const { name, label, options = [], enabledForAll = true, enabledCompanyIds = [], isRequired = false, isActive = true } = req.body;
      await execute(
        `INSERT INTO custom_dropdowns (id, name, label, options_json, enabled_for_all, enabled_company_ids_json, is_required, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, label, JSON.stringify(options), enabledForAll ? 1 : 0, JSON.stringify(enabledCompanyIds), isRequired ? 1 : 0, isActive ? 1 : 0]
      );
      res.json({ id, name, label, options, enabledForAll, enabledCompanyIds, isRequired, isActive, createdAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/custom-dropdowns/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, label, options = [], enabledForAll = true, enabledCompanyIds = [], isRequired = false, isActive = true } = req.body;
      await execute(
        `UPDATE custom_dropdowns SET name=?, label=?, options_json=?, enabled_for_all=?, enabled_company_ids_json=?, is_required=?, is_active=?, updated_at=? WHERE id=?`,
        [name, label, JSON.stringify(options), enabledForAll ? 1 : 0, JSON.stringify(enabledCompanyIds), isRequired ? 1 : 0, isActive ? 1 : 0, formatDate(new Date()), id]
      );
      res.json({ id, name, label, options, enabledForAll, enabledCompanyIds, isRequired, isActive });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/custom-dropdowns/:id", async (req, res) => {
    try {
      await execute("DELETE FROM custom_dropdowns WHERE id = ?", [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Public endpoint: get active dropdowns for a given companyId (used in ticket form)
  app.get("/api/custom-dropdowns/active", async (req, res) => {
    try {
      const { company_id } = req.query;
      const rows = await query("SELECT * FROM custom_dropdowns WHERE is_active = 1 ORDER BY created_at ASC");
      const result = rows
        .map(r => ({
          id: r.id,
          name: r.name,
          label: r.label,
          options: JSON.parse(r.options_json || '[]'),
          enabledForAll: Boolean(r.enabled_for_all),
          enabledCompanyIds: JSON.parse(r.enabled_company_ids_json || '[]'),
          isRequired: Boolean(r.is_required),
        }))
        .filter(d => {
          if (!company_id) return d.enabledForAll;
          return d.enabledForAll || d.enabledCompanyIds.includes(company_id as string);
        });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══ Feature Permissions Endpoints ═══
  app.get("/api/feature-permissions", async (req, res) => {
    try {
      const { company_id } = req.query;
      if (!company_id) return res.status(400).json({ error: "Missing company_id" });
      const rows = await query("SELECT * FROM company_feature_permissions WHERE company_id = ?", [company_id]);
      res.json(rows.map(r => ({
        companyId: r.company_id,
        featureId: r.feature_id,
        canView: Boolean(r.can_view),
        canUse: Boolean(r.can_use),
        canEdit: Boolean(r.can_edit),
        isMandatory: Boolean(r.is_mandatory)
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/feature-permissions", async (req, res) => {
    try {
      const { companyId, featureId, canView, canUse, canEdit, isMandatory } = req.body;
      if (!companyId || !featureId) return res.status(400).json({ error: "Missing required fields" });
      
      // Upsert
      const existing = await query("SELECT id FROM company_feature_permissions WHERE company_id = ? AND feature_id = ?", [companyId, featureId]);
      if (existing.length > 0) {
        await execute(
          "UPDATE company_feature_permissions SET can_view=?, can_use=?, can_edit=?, is_mandatory=?, updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND feature_id=?",
          [canView ? 1 : 0, canUse ? 1 : 0, canEdit ? 1 : 0, isMandatory ? 1 : 0, companyId, featureId]
        );
      } else {
        await execute(
          "INSERT INTO company_feature_permissions (company_id, feature_id, can_view, can_use, can_edit, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)",
          [companyId, featureId, canView ? 1 : 0, canUse ? 1 : 0, canEdit ? 1 : 0, isMandatory ? 1 : 0]
        );
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Notification Endpoints
  app.get("/api/notifications/unread-count", async (req, res) => {
    try {
      const { user_id } = req.query;
      if (!user_id) return res.status(400).json({ error: "user_id required" });
      const results = await query("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0", [user_id]);
      res.json({ count: results[0]?.count || 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/notifications", async (req, res) => {
    try {
      const { user_id } = req.query;
      if (!user_id) return res.status(400).json({ error: "user_id required" });
      const results = await query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [user_id]);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notifications/mark-read", async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error: "user_id required" });
      await execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [user_id]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ticket Endpoints
  app.get("/api/tickets/all", async (req, res) => {
    try {
      const tickets = await query("SELECT * FROM tickets ORDER BY created_at DESC");
      res.json(tickets.map(t => ({ id: t.id.toString(), ...t })));
    } catch (error: any) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  app.get("/api/tickets/open", async (req, res) => {
    try {
      const tickets = await query(
        "SELECT * FROM tickets WHERE status NOT IN ('Resolved', 'Closed', 'Canceled') ORDER BY created_at DESC"
      );
      res.json(tickets.map(t => ({ id: t.id.toString(), ...t })));
    } catch (error: any) {
      console.error("Error fetching open tickets:", error);
      res.status(500).json({ error: "Failed to fetch open tickets" });
    }
  });

  app.get("/api/tickets/assigned/:userId", async (req, res) => {
    try {
      const tickets = await query(
        "SELECT * FROM tickets WHERE assigned_to = ? ORDER BY created_at DESC",
        [req.params.userId]
      );
      res.json(tickets.map(t => ({ id: t.id.toString(), ...t })));
    } catch (error: any) {
      console.error("Error fetching assigned tickets:", error);
      res.status(500).json({ error: "Failed to fetch assigned tickets" });
    }
  });

  app.get("/api/tickets/unassigned", async (req, res) => {
    try {
      const tickets = await query(
        "SELECT * FROM tickets WHERE assigned_to IS NULL OR assigned_to = '' ORDER BY created_at DESC"
      );
      res.json(tickets.map(t => ({ id: t.id.toString(), ...t })));
    } catch (error: any) {
      console.error("Error fetching unassigned tickets:", error);
      res.status(500).json({ error: "Failed to fetch unassigned tickets" });
    }
  });

  app.get("/api/tickets/resolved", async (req, res) => {
    try {
      const tickets = await query(
        "SELECT * FROM tickets WHERE status IN ('Resolved', 'Closed') ORDER BY resolved_at DESC"
      );
      res.json(tickets.map(t => ({ id: t.id.toString(), ...t })));
    } catch (error: any) {
      console.error("Error fetching resolved tickets:", error);
      res.status(500).json({ error: "Failed to fetch resolved tickets" });
    }
  });

  app.get("/api/tickets/:id", async (req, res) => {
    try {
      const tickets = await query("SELECT * FROM tickets WHERE id = ?", [req.params.id]);
      if (tickets.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const ticket = tickets[0];

      // Get comments
      const comments = await query("SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC", [ticket.id]);

      // Get history
      const history = await query("SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY timestamp DESC", [ticket.id]);

      res.json({
        id: ticket.id.toString(),
        ...ticket,
        comments: comments.map(c => ({ id: c.id.toString(), ...c })),
        history: history.map(h => ({ id: h.id.toString(), ...h }))
      });
    } catch (error: any) {
      console.error("Error fetching ticket:", error);
      res.status(500).json({ error: "Failed to fetch ticket" });
    }
  });

  app.post("/api/tickets/create", async (req, res) => {
    try {
      console.log("Creating ticket with data:", JSON.stringify(req.body));

      // Generate ticket number
      const ticketNumber = await generateTicketNumber();

      // Workflow Automation: Auto-assignment based on category
      let assignmentGroup = req.body.assignmentGroup;
      if (!assignmentGroup) {
        switch (req.body.category) {
          case "Network": assignmentGroup = "Network Team"; break;
          case "Hardware": assignmentGroup = "Hardware Support"; break;
          case "Software": assignmentGroup = "App Support"; break;
          case "Database": assignmentGroup = "DBA Team"; break;
          default: assignmentGroup = "Service Desk";
        }
      }

      const ticketData = {
        ticket_number: ticketNumber,
        caller: req.body.caller || "System",
        category: req.body.category || "Inquiry / Help",
        title: req.body.title,
        description: req.body.description,
        status: "New",
        priority: req.body.priority || "4 - Low",
        impact: req.body.impact || "3 - Low",
        urgency: req.body.urgency || "3 - Low",
        channel: req.body.channel || "Self-service",
        assignment_group: assignmentGroup,
        assigned_to: req.body.assignedTo || null,
        assigned_to_name: req.body.assignedToName || null,
        created_by: req.body.createdBy || req.body.caller || "System",
        created_by_name: req.body.createdByName || req.body.caller || "System",
        service: req.body.service || null,
        service_offering: req.body.serviceOffering || null,
        cmdb_item: req.body.cmdbItem || null,
        subcategory: req.body.subcategory || null
      };

      // Insert ticket
      const fields = Object.keys(ticketData).filter(k => ticketData[k] !== null);
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(k => ticketData[k]);

      const result = await execute(
        `INSERT INTO tickets (${fields.join(', ')}) VALUES (${placeholders})`,
        values
      );

      const ticketId = result.insertId;

      // Add creation activity to timeline
      await execute(
        "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [ticketId, "system", "public", req.body.caller || "System", req.body.createdByName || req.body.caller || "System", "Ticket created", JSON.stringify(ticketData)]
      );

      // Workflow Automation: Notify Manager for High Priority
      if (req.body.priority === "1 - Critical" || req.body.priority === "2 - High") {
        await execute(
          "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [ticketId, "system", "internal", "System Automation", "System Automation", "Manager Notified (High Priority)", JSON.stringify({ reason: "High priority ticket created" })]
        );
      }

      // Return created ticket
      const tickets = await query("SELECT * FROM tickets WHERE id = ?", [ticketId]);
      const createdTicket = tickets[0];

      // Send auto-acknowledgement email if caller is an email address
      if (createdTicket.caller && createdTicket.caller.includes('@')) {
        try {
          await OmniChannelEngine.sendEmail(
            createdTicket.caller,
            `[TK-${createdTicket.ticket_number.replace('INC', '')}] Ticket Created: ${createdTicket.title}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #2563eb;">Incident Created</h2>
              <p>Hello,</p>
              <p>A new support ticket has been created for you.</p>
              <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Ticket Number:</strong> ${createdTicket.ticket_number}</p>
                <p style="margin: 5px 0 0 0;"><strong>Subject:</strong> ${createdTicket.title}</p>
                <p style="margin: 5px 0 0 0;"><strong>Priority:</strong> ${createdTicket.priority}</p>
              </div>
              <p>Our team is working on your request. You can track the status by replying to this email.</p>
              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="font-size: 12px; color: #64748b;">This is an automated notification from Ticklora ITSM.</p>
            </div>`
          );
        } catch (mailErr: any) {
          console.error("[Mail] Failed to send auto-ack:", mailErr.message);
        }
      }

      // Send auto-notifications
      try {
        // Notify creator
        if (req.body.createdBy) {
          await NotificationEngine.create(
            req.body.createdBy,
            "Ticket Created Successfully",
            `Ticket ID: ${ticketNumber}. Assigned to: ${assignmentGroup || "Support Team"}`,
            'ticket_created',
            ticketNumber
          );
        }

        // Notify assigned user if any
        if (req.body.assignedTo) {
          await NotificationEngine.create(
            req.body.assignedTo,
            "A ticket has been assigned to you",
            `Ticket ID: ${ticketNumber}. Created by: ${req.body.createdByName || req.body.caller}`,
            'ticket_assigned',
            ticketNumber
          );
        } else {
          // Notify all admins/agents of unassigned ticket
          const agents = await query("SELECT uid FROM users WHERE role IN ('admin', 'agent', 'super_admin', 'ultra_super_admin')");
          for (const agent of agents) {
            await NotificationEngine.create(
              agent.uid,
              "New Unassigned Ticket",
              `${req.body.createdByName || req.body.caller} created ticket ${ticketNumber}`,
              'ticket_unassigned',
              ticketNumber
            );
          }
        }
      } catch (notifErr: any) {
        console.error("[Notification] Failed to send create notifications:", notifErr.message);
      }

      res.json({ id: ticketId.toString(), ...createdTicket });

    } catch (error: any) {
      console.error("Error creating ticket:", error);
      res.status(500).json({ error: "Failed to create ticket: " + error.message });
    }
  });

  app.post("/api/email/send-note", async (req, res) => {
    try {
      const { to, subject, body, attachments } = req.body;
      await OmniChannelEngine.sendEmail(to, subject, body, attachments);
      res.json({ message: "Email sent successfully" });
    } catch (error: any) {
      console.error("[Email] Send note failed:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  app.put("/api/tickets/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // Get current ticket
      const tickets = await query("SELECT * FROM tickets WHERE id = ?", [id]);
      if (tickets.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      const ticket = tickets[0];

      // Calculate points if the ticket is being resolved
      let points = 0;
      if ((req.body.status === "Resolved" || req.body.status === "Closed") && !ticket.resolved_at) {
        if (ticket.resolution_deadline) {
          const deadline = new Date(ticket.resolution_deadline).getTime();
          const resolvedAt = new Date().getTime();
          const createdAt = new Date(ticket.created_at).getTime();

          if (resolvedAt < deadline) {
            // Award points based on speed: (Time Saved / Total SLA Time) * 100
            const totalSla = deadline - createdAt;
            const timeSaved = deadline - resolvedAt;
            points = Math.round((timeSaved / totalSla) * 100);
            if (points < 10) points = 10;
          } else {
            points = 5;
          }
        }
      }

      const updateData: any = {
        ...req.body,
        points: ticket.points + points,
        updated_at: formatDate(new Date())
      };

      if (req.body.status === "Resolved" || req.body.status === "Closed") {
        updateData.resolved_at = formatDate(new Date());
      }

      // Build update query
      const fields = Object.keys(updateData).filter(k => k !== 'id' && updateData[k] !== undefined);
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => updateData[k]), id];

      await execute(`UPDATE tickets SET ${setClause} WHERE id = ?`, values);

      // Add activity entry for status/field changes
      if (Object.keys(updateData).length > 0) {
        let actionMsg = "Ticket updated";
        if (req.body.status && req.body.status !== ticket.status) {
          actionMsg = `Status changed to ${req.body.status}`;
        } else if (req.body.assignedTo && req.body.assignedTo !== ticket.assigned_to) {
          actionMsg = `Assigned to updated`;
        } else if (req.body.priority && req.body.priority !== ticket.priority) {
          actionMsg = `Priority changed to ${req.body.priority}`;
        }

        await execute(
          "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, "status_change", "public", req.body.updatedById || "System", req.body.updatedBy || "System", actionMsg, JSON.stringify({ oldStatus: ticket.status, newStatus: req.body.status, updates: updateData })]
        );
      }

      // Return updated ticket
      const updatedTickets = await query("SELECT * FROM tickets WHERE id = ?", [id]);
      const updatedTicket = updatedTickets[0];

      // ── Send Notifications & Emails ──
      try {
        // 1. Status Change Notification
        if (req.body.status && req.body.status !== ticket.status) {
          await NotificationEngine.create(
            ticket.created_by,
            "Ticket Status Updated",
            `Your ticket ${ticket.ticket_number} status changed to ${req.body.status}`,
            'status_changed',
            ticket.ticket_number
          );

          // Email for status change
          if (ticket.caller && ticket.caller.includes('@')) {
            await OmniChannelEngine.sendEmail(
              ticket.caller,
              `[TK-${ticket.ticket_number.replace('INC', '')}] Ticket Status Updated`,
              `<div style="font-family: sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">Status Update</h2>
                <p>Hello,</p>
                <p>The status of your ticket <strong>${ticket.ticket_number}</strong> has been updated to: <strong>${req.body.status}</strong>.</p>
                <p>Title: ${ticket.title}</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 12px; color: #64748b;">Technosprint Support Team</p>
              </div>`
            );
          }
        }

        // 2. Assignment Change Notification
        if (req.body.assignedTo && req.body.assignedTo !== ticket.assigned_to) {
          await NotificationEngine.create(
            req.body.assignedTo,
            "Ticket Assigned to You",
            `Ticket ${ticket.ticket_number} has been assigned to you by System.`,
            'ticket_assigned',
            ticket.ticket_number
          );

          // Email to assigned agent
          const assignedAgent = await query("SELECT email FROM users WHERE uid = ?", [req.body.assignedTo]);
          if (assignedAgent.length > 0 && assignedAgent[0].email) {
            await OmniChannelEngine.sendEmail(
              assignedAgent[0].email,
              `[TK-${ticket.ticket_number.replace('INC', '')}] New Ticket Assigned`,
              `<div style="font-family: sans-serif; padding: 20px;">
                <h2 style="color: #2563eb;">New Assignment</h2>
                <p>A new ticket has been assigned to you.</p>
                <p><strong>Ticket:</strong> ${ticket.ticket_number}</p>
                <p><strong>Subject:</strong> ${ticket.title}</p>
                <p><strong>Priority:</strong> ${ticket.priority}</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="font-size: 12px; color: #64748b;">Internal Notification</p>
              </div>`
            );
          }
        }
      } catch (notifErr: any) {
        console.error("[Notification] Error in update route:", notifErr.message);
      }

      res.json({ id: id.toString(), ...updatedTicket, pointsAwarded: points });

    } catch (error: any) {
      console.error("Error updating ticket:", error);
      res.status(500).json({ error: "Failed to update ticket" });
    }
  });

  app.delete("/api/tickets/all", async (req, res) => {
    try {
      await execute("DELETE FROM tickets");
      res.json({ message: "All tickets deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting all tickets:", error);
      res.status(500).json({ error: "Failed to delete all tickets" });
    }
  });

  app.delete("/api/tickets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await execute("DELETE FROM tickets WHERE id = ?", [id]);
      res.json({ message: "Ticket deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting ticket:", error);
      res.status(500).json({ error: "Failed to delete ticket" });
    }
  });

  // Manual trigger for testing escalation
  app.post("/api/tickets/trigger-escalation", async (req, res) => {
    await escalateStaleTickets();
    res.json({ message: "Escalation check triggered manually" });
  });

  // Leaderboard Endpoint
  app.get("/api/leaderboard/daily", async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const rows = await query(
        `SELECT assigned_to, assigned_to_name, 
                SUM(points) as total_points, 
                COUNT(*) as resolved_count
         FROM tickets 
         WHERE status IN ('Resolved', 'Closed') 
           AND resolved_at >= ?
           AND assigned_to IS NOT NULL
         GROUP BY assigned_to, assigned_to_name
         ORDER BY total_points DESC`,
        [formatDate(today)]
      );

      const leaderboard = rows.map(row => ({
        id: row.assigned_to,
        name: row.assigned_to_name || row.assigned_to,
        points: row.total_points || 0,
        resolvedCount: row.resolved_count || 0
      }));

      res.json(leaderboard);
    } catch (error: any) {
      console.error("Leaderboard Error:", error);
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // User Endpoints
  app.get("/api/users", async (req, res) => {
    try {
      const users = await query("SELECT id, uid, name, email, role, phone, is_active, created_at FROM users ORDER BY name");
      res.json(users.map(u => ({ id: u.id.toString(), ...u })));
    } catch (error: any) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:uid", async (req, res) => {
    try {
      const users = await query("SELECT id, uid, name, email, role, phone, is_active, created_at FROM users WHERE uid = ?", [req.params.uid]);
      if (users.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ id: users[0].id.toString(), ...users[0] });
    } catch (error: any) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { uid, name, email, role, phone, password_hash } = req.body;

      const result = await execute(
        "INSERT INTO users (uid, name, email, role, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
        [uid, name, email, role || 'user', phone, password_hash]
      );

      const users = await query("SELECT * FROM users WHERE id = ?", [result.insertId]);
      res.json({ id: result.insertId.toString(), ...users[0] });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user: " + error.message });
    }
  });

  app.put("/api/users/:uid", async (req, res) => {
    try {
      const { name, email, role, phone, is_active } = req.body;

      await execute(
        "UPDATE users SET name = ?, email = ?, role = ?, phone = ?, is_active = ? WHERE uid = ?",
        [name, email, role, phone, is_active, req.params.uid]
      );

      const users = await query("SELECT * FROM users WHERE uid = ?", [req.params.uid]);
      res.json({ id: users[0].id.toString(), ...users[0] });
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Authentication Endpoints
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Simple hash function (same as frontend)
      function simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
      }

      const users = await query("SELECT * FROM users WHERE email = ? AND is_active = 1", [email.toLowerCase().trim()]);


      if (users.length === 0) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const user = users[0];

      if (user.password_hash && user.password_hash !== simpleHash(password)) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Update last login
      await execute("UPDATE users SET last_login = ? WHERE id = ?", [formatDate(new Date()), user.id]);

      res.json({
        id: user.id.toString(),
        uid: user.uid,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Activities Timeline Endpoints
  app.get("/api/tickets/:id/activities", async (req, res) => {
    try {
      const { id } = req.params;
      const { visibility, activity_type, limit, offset } = req.query;

      let sql = "SELECT * FROM ticket_activities WHERE ticket_id = ?";
      const params: any[] = [id];

      // Visibility filter: 'public' hides internal notes (for customer-facing views)
      if (visibility === 'public') {
        sql += " AND visibility_type = 'public'";
      } else if (visibility === 'internal') {
        sql += " AND visibility_type = 'internal'";
      }

      // Activity type filter for frontend filter tabs
      if (activity_type) {
        const types = (activity_type as string).split(',');
        sql += ` AND activity_type IN (${types.map(() => '?').join(',')})`;
        params.push(...types);
      }

      sql += " ORDER BY created_at ASC";

      // Pagination support
      if (limit) {
        sql += " LIMIT ?";
        params.push(parseInt(limit as string) || 50);
        if (offset) {
          sql += " OFFSET ?";
          params.push(parseInt(offset as string) || 0);
        }
      }

      const activities = await query(sql, params);
      res.json(activities.map(a => ({ id: a.id.toString(), ...a })));
    } catch (error: any) {
      console.error("Error fetching activities:", error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  app.post("/api/tickets/:id/activities", async (req, res) => {
    try {
      const { id } = req.params;
      const { activity_type, visibility_type, created_by, created_by_name, message, metadata_json } = req.body;

      // Validate required fields
      if (!message || !message.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }

      const actType = activity_type || 'comment';
      const visType = visibility_type || (actType === 'work_note' ? 'internal' : 'public');

      const result = await execute(
        "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, actType, visType, created_by || 'System', created_by_name || 'System', message.trim(), metadata_json ? JSON.stringify(metadata_json) : null]
      );

      // Update ticket's updated_at timestamp when a note is added
      try {
        await execute("UPDATE tickets SET updated_at = ? WHERE id = ?", [formatDate(new Date()), id]);
      } catch (e) {
        // Non-critical — ticket may be Firestore-only
      }

      const activities = await query("SELECT * FROM ticket_activities WHERE id = ?", [result.insertId]);
      
      // ═══ CUSTOMER NOTIFICATION LOGIC ═══
      if (visType === 'public' && actType !== 'system') {
        try {
          // 1. Fetch ticket details
          const ticketRows = await query("SELECT ticket_number, caller, title, company_id FROM tickets WHERE id = ?", [id]);
          if (ticketRows.length > 0) {
            const ticket = ticketRows[0];
            
            // 2. Fetch company email config
            let configRows = [];
            if (ticket.company_id) {
              configRows = await query("SELECT * FROM company_email_configs WHERE id = ?", [ticket.company_id]);
            } else {
              // Fallback to default
              configRows = await query("SELECT * FROM company_email_configs WHERE is_active = 1 ORDER BY is_default DESC LIMIT 1");
            }

            if (configRows.length > 0) {
              const config = configRows[0];
              const ticketNum = ticket.ticket_number;
              const cleanNum = ticketNum.replace('INC', '');
              
              await OmniChannelEngine.sendEmailByConfig(
                config,
                ticket.caller,
                `[TK-${cleanNum}] Update: ${ticket.title}`,
                `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2 style="color: #2563eb;">${config.company_name} Support</h2>
                  <p>Hello,</p>
                  <p>A new update has been added to your support ticket <strong>TK-${cleanNum}</strong>.</p>
                  <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0; white-space: pre-wrap;">
                    ${message.trim()}
                  </div>
                  <p style="font-size: 14px; color: #64748b;">You can reply to this email to add more information to your ticket.</p>
                  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                  <p style="font-size: 11px; color: #94a3b8;">Ref ID: [TK-${cleanNum}] | Message sent via ${config.email_address}</p>
                </div>`
              );
            }
          }
        } catch (emailErr) {
          console.error("[Email Notification] Failed to send update email:", emailErr);
        }
      }

      res.json({ id: result.insertId.toString(), ...activities[0] });

    } catch (error: any) {
      console.error("Error adding activity:", error);
      res.status(500).json({ error: "Failed to add activity" });
    }
  });

  // Comments Endpoint (Legacy)
  app.post("/api/tickets/:id/comments", async (req, res) => {
    try {
      const { id } = req.params;
      const { user_id, user_name, message, is_internal } = req.body;

      // Keep legacy support but also insert into new table
      const result = await execute(
        "INSERT INTO comments (ticket_id, user_id, user_name, message, is_internal) VALUES (?, ?, ?, ?, ?)",
        [id, user_id, user_name, message, is_internal ? 1 : 0]
      );

      await execute(
        "INSERT INTO ticket_activities (ticket_id, activity_type, visibility_type, created_by, created_by_name, message) VALUES (?, ?, ?, ?, ?, ?)",
        [id, is_internal ? 'work_note' : 'comment', is_internal ? 'internal' : 'public', user_id, user_name, message]
      );

      const comments = await query("SELECT * FROM comments WHERE id = ?", [result.insertId]);
      res.json({ id: result.insertId.toString(), ...comments[0] });
    } catch (error: any) {
      console.error("Error adding comment:", error);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  // Timesheet Endpoints
  app.get("/api/timesheets", async (req, res) => {
    try {
      const { user_id, week_start, status } = req.query;
      let sql = "SELECT * FROM timesheets WHERE 1=1";
      const values = [];

      if (user_id) {
        sql += " AND user_id = ?";
        values.push(user_id);
      }
      if (week_start) {
        sql += " AND week_start = ?";
        values.push(week_start);
      }
      if (status) {
        sql += " AND status = ?";
        values.push(status);
      }

      const rows = await query(sql, values);
      res.json(rows.map(r => ({ id: r.id.toString(), ...r })));
    } catch (error: any) {
      console.error("Error fetching timesheets:", error);
      res.status(500).json({ error: "Failed to fetch timesheets" });
    }
  });

  app.get("/api/timesheets/all", async (req, res) => {
    try {
      const rows = await query("SELECT * FROM timesheets ORDER BY updated_at DESC");
      res.json(rows.map(r => ({ id: r.id.toString(), ...r })));
    } catch (error: any) {
      console.error("Error fetching all timesheets:", error);
      res.status(500).json({ error: "Failed to fetch all timesheets" });
    }
  });

  app.post("/api/timesheets/get-or-create", async (req, res) => {
    try {
      const { user_id, week_start, week_end } = req.body;

      const existing = await query(
        "SELECT * FROM timesheets WHERE user_id = ? AND week_start = ?",
        [user_id, week_start]
      );

      if (existing.length > 0) {
        return res.json({ id: existing[0].id.toString(), ...existing[0] });
      }

      const result = await execute(
        "INSERT INTO timesheets (user_id, week_start, week_end, status) VALUES (?, ?, ?, 'Draft')",
        [user_id, week_start, week_end]
      );

      const created = await query("SELECT * FROM timesheets WHERE id = ?", [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error("Error get-or-create timesheet:", error);
      res.status(500).json({ error: "Failed to manage timesheet" });
    }
  });

  app.put("/api/timesheets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fields = Object.keys(req.body).filter(k => k !== 'id');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => req.body[k]), id];

      if (req.body.status === 'Submitted') {
        const now = formatDate(new Date());
        await execute(`UPDATE timesheets SET ${setClause}, submitted_at = ? WHERE id = ?`, [...values.slice(0, -1), now, id]);

        // Notify admins
        try {
          const admins = await query("SELECT email, name FROM users WHERE role IN ('admin', 'super_admin', 'ultra_super_admin')");
          const ts = await query("SELECT * FROM timesheets WHERE id = ?", [id]);
          const user = await query("SELECT name FROM users WHERE uid = ?", [ts[0].user_id]);
          
          for (const admin of admins) {
            await OmniChannelEngine.sendEmail(
              admin.email,
              `Timesheet Submitted: ${user[0]?.name || 'Employee'}`,
              `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #2563eb;">Timesheet Approval Required</h2>
                <p>Hello ${admin.name},</p>
                <p><strong>${user[0]?.name || 'An employee'}</strong> has submitted their timesheet for the week of ${ts[0].week_start} for your review.</p>
                <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
                  <p style="margin: 0;"><strong>Employee:</strong> ${user[0]?.name || 'Unknown'}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Period:</strong> ${ts[0].week_start} to ${ts[0].week_end}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Total Minutes:</strong> ${ts[0].total_hours}</p>
                </div>
                <p>This timesheet includes <strong>AI-captured screenshots and activity evidence</strong> for verification.</p>
                <a href="http://localhost:3000/timesheet/approvals" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px;">Review & Approve</a>
              </div>`
            );
          }
        } catch (err: any) {
          console.error("[Notify Admins] Failed:", err.message);
        }
      } else {
        await execute(`UPDATE timesheets SET ${setClause} WHERE id = ?`, values);
      }

      const updated = await query("SELECT * FROM timesheets WHERE id = ?", [id]);

      // Sync status to time cards if changed
      if (req.body.status) {
        await execute("UPDATE time_cards SET status = ? WHERE timesheet_id = ?", [req.body.status, id]);
      }

      res.json({ id: id.toString(), ...updated[0] });
    } catch (error: any) {
      console.error("Error updating timesheet:", error);
      res.status(500).json({ error: "Failed to update timesheet" });
    }
  });

  // Time Card Endpoints
  app.get("/api/time-cards", async (req, res) => {
    try {
      const { timesheet_id, user_id, start_date, end_date } = req.query;
      let sql = "SELECT * FROM time_cards WHERE 1=1";
      const values = [];

      if (timesheet_id) {
        sql += " AND timesheet_id = ?";
        values.push(timesheet_id);
      }
      if (user_id) {
        sql += " AND user_id = ?";
        values.push(user_id);
      }
      if (start_date && end_date) {
        sql += " AND entry_date BETWEEN ? AND ?";
        values.push(start_date, end_date);
      }

      const rows = await query(sql, values);
      res.json(rows.map(r => ({ id: r.id.toString(), ...r })));
    } catch (error: any) {
      console.error("Error fetching time cards:", error);
      res.status(500).json({ error: "Failed to fetch time cards" });
    }
  });

  app.post("/api/time-cards", async (req, res) => {
    try {
      const fields = Object.keys(req.body);
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(k => req.body[k]);

      const result = await execute(
        `INSERT INTO time_cards (${fields.join(', ')}) VALUES (${placeholders})`,
        values
      );

      const created = await query("SELECT * FROM time_cards WHERE id = ?", [result.insertId]);

      // Update timesheet total hours
      if (req.body.timesheet_id) {
        const cards = await query("SELECT SUM(hours_worked) as total FROM time_cards WHERE timesheet_id = ?", [req.body.timesheet_id]);
        await execute("UPDATE timesheets SET total_hours = ? WHERE id = ?", [cards[0].total || 0, req.body.timesheet_id]);
      }

      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error("Error creating time card:", error);
      res.status(500).json({ error: "Failed to create time card" });
    }
  });

  app.put("/api/time-cards/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fields = Object.keys(req.body).filter(k => k !== 'id');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => req.body[k]), id];

      await execute(`UPDATE time_cards SET ${setClause} WHERE id = ?`, values);

      const updated = await query("SELECT * FROM time_cards WHERE id = ?", [id]);

      // Update timesheet total hours
      if (updated[0].timesheet_id) {
        const cards = await query("SELECT SUM(hours_worked) as total FROM time_cards WHERE timesheet_id = ?", [updated[0].timesheet_id]);
        await execute("UPDATE timesheets SET total_hours = ? WHERE id = ?", [cards[0].total || 0, updated[0].timesheet_id]);
      }

      res.json({ id: id.toString(), ...updated[0] });
    } catch (error: any) {
      console.error("Error updating time card:", error);
      res.status(500).json({ error: "Failed to update time card" });
    }
  });

  app.delete("/api/time-cards/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const card = await query("SELECT timesheet_id FROM time_cards WHERE id = ?", [id]);

      await execute("DELETE FROM time_cards WHERE id = ?", [id]);

      if (card.length > 0 && card[0].timesheet_id) {
        const cards = await query("SELECT SUM(hours_worked) as total FROM time_cards WHERE timesheet_id = ?", [card[0].timesheet_id]);
        await execute("UPDATE timesheets SET total_hours = ? WHERE id = ?", [cards[0].total || 0, card[0].timesheet_id]);
      }

      res.json({ message: "Time card deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting time card:", error);
      res.status(500).json({ error: "Failed to delete time card" });
    }
  });

  // ═══ WORK SESSIONS TABLE ═══
  try {
    if (useSQLite) {
      const db = await getSQLiteDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS work_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          user_name TEXT,
          ticket_id TEXT,
          ticket_number TEXT,
          start_time DATETIME NOT NULL,
          stop_time DATETIME,
          duration INTEGER DEFAULT 0,
          start_context TEXT,
          stop_context TEXT,
          ai_notes_start TEXT,
          ai_notes_stop TEXT,
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      await execute(`
        CREATE TABLE IF NOT EXISTS work_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          user_name VARCHAR(255),
          ticket_id VARCHAR(128),
          ticket_number VARCHAR(50),
          start_time TIMESTAMP NOT NULL,
          stop_time TIMESTAMP NULL,
          duration INT DEFAULT 0,
          start_context TEXT,
          stop_context TEXT,
          ai_notes_start TEXT,
          ai_notes_stop TEXT,
          status ENUM('active', 'completed') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_ws_user (user_id),
          INDEX idx_ws_ticket (ticket_id),
          INDEX idx_ws_status (status)
        ) ENGINE=InnoDB
      `);
    }
    console.log('[DB] Work sessions table initialized');
  } catch (e: any) {
    console.error('[DB] Work sessions table init failed:', e.message);
  }

  // ═══ AI Work Analysis Endpoint ═══
  app.post("/api/ai/analyze-work", async (req, res) => {
    try {
      const { context, ticketNumber, ticketTitle, action, elapsedTime } = req.body;

      if (!ticketNumber) {
        return res.status(400).json({ error: "Missing ticket number" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "your_gemini_api_key_here") {
        // Return intelligent fallback when API key is not configured
        const fallback = generateSmartFallback(ticketNumber, ticketTitle, action, elapsedTime, context);
        return res.json(fallback);
      }

      let pageContext: any = {};
      try { pageContext = JSON.parse(context || '{}'); } catch { }

      const actionStr = action === 'start' ? 'STARTING work on' : 'STOPPING work on';
      const durationStr = elapsedTime ? `\nTotal time worked: ${Math.floor(elapsedTime / 60)} minutes ${elapsedTime % 60} seconds` : '';

      const prompt = `You are an IT service management work notes assistant. Generate a concise, professional work note for a technician who is ${actionStr} incident ${ticketNumber}.

Ticket: ${ticketNumber} - ${ticketTitle || 'Incident'}${durationStr}

Page context the technician is viewing:
- Page type: ${pageContext.pageType || 'unknown'}
- Current URL: ${pageContext.url || 'unknown'}
- Visible headings: ${(pageContext.headings || []).join(', ')}
- Form data visible: ${JSON.stringify(pageContext.formData || {}).substring(0, 300)}
- Status indicators: ${(pageContext.badges || []).join(', ')}

Generate a JSON response with these fields:
- "summary": A 1-2 sentence professional work note using action verbs (Investigated, Updated, Reviewed, Configured, Troubleshooted, Analyzed, Implemented, Documented, Verified, Resolved). Be specific about what was done.
- "activityType": One of "ticket_resolution", "configuration", "investigation", "documentation", "communication", "development", "testing"
- "confidence": A number 0-1 indicating how confident you are
- "actionVerb": The primary action verb used
- "detectedActivities": An array of detected activities like ["Reviewed ticket details", "Checked SLA status"]

Respond ONLY with valid JSON.`;

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      const raw = (result.text || "").replace(/```json\s*/g, "").replace(/```/g, "").trim();
      let analysis: any;
      try {
        analysis = JSON.parse(raw);
      } catch {
        analysis = generateSmartFallback(ticketNumber, ticketTitle, action, elapsedTime, context);
      }

      res.json(analysis);
    } catch (error: any) {
      console.error("[AI Work Analysis] Error:", error.message);
      const fallback = generateSmartFallback(
        req.body.ticketNumber, req.body.ticketTitle,
        req.body.action, req.body.elapsedTime, req.body.context
      );
      res.json(fallback);
    }
  });

  // Smart fallback note generation (no AI needed)
  function generateSmartFallback(
    ticketNumber: string, ticketTitle: string,
    action: string, elapsedTime?: number, contextStr?: string
  ) {
    let pageContext: any = {};
    try { pageContext = JSON.parse(contextStr || '{}'); } catch { }

    const startVerbs = [
      'Initiated investigation of', 'Began troubleshooting',
      'Started working on', 'Commenced review of',
      'Opened and assessed', 'Started analysis of'
    ];
    const stopVerbs = [
      'Completed work session for', 'Finished investigation of',
      'Concluded troubleshooting session for', 'Wrapped up review of',
      'Paused work on', 'Saved progress on'
    ];

    const verbs = action === 'start' ? startVerbs : stopVerbs;
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    const durationStr = elapsedTime
      ? `. Duration: ${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s`
      : '';

    // Detect activity from page context
    const activities: string[] = [];
    const pt = pageContext.pageType || '';
    if (pt === 'ticket_detail') activities.push('Reviewed ticket details');
    if (pageContext.formData && Object.keys(pageContext.formData).length > 0) {
      activities.push('Examined form fields and configuration');
    }
    if ((pageContext.badges || []).some((b: string) => b.includes('SLA'))) {
      activities.push('Checked SLA compliance status');
    }
    if (activities.length === 0) activities.push('Worked on incident');

    const activityTypes: Record<string, string> = {
      'ticket_detail': 'ticket_resolution',
      'settings': 'configuration',
      'reports': 'documentation',
      'knowledge_base': 'investigation'
    };

    return {
      summary: `${verb} incident ${ticketNumber}: ${ticketTitle || 'Service request'}${durationStr}`,
      activityType: activityTypes[pt] || 'ticket_resolution',
      confidence: 0.7,
      actionVerb: verb.split(' ')[0],
      detectedActivities: activities
    };
  }

  // ═══ Work Sessions CRUD ═══
  app.post("/api/work-sessions", async (req, res) => {
    try {
      const { user_id, user_name, ticket_id, ticket_number, start_time, stop_time, duration, start_context, stop_context, ai_notes_start, ai_notes_stop, status } = req.body;

      const result = await execute(
        `INSERT INTO work_sessions (user_id, user_name, ticket_id, ticket_number, start_time, stop_time, duration, start_context, stop_context, ai_notes_start, ai_notes_stop, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, user_name, ticket_id, ticket_number, start_time, stop_time || null, duration || 0, start_context || null, stop_context || null, ai_notes_start || null, ai_notes_stop || null, status || 'active']
      );

      const created = await query("SELECT * FROM work_sessions WHERE id = ?", [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error("Error creating work session:", error);
      res.status(500).json({ error: "Failed to create work session" });
    }
  });

  app.put("/api/work-sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fields = Object.keys(req.body).filter(k => k !== 'id');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => req.body[k]), id];

      await execute(`UPDATE work_sessions SET ${setClause} WHERE id = ?`, values);
      const updated = await query("SELECT * FROM work_sessions WHERE id = ?", [id]);
      res.json({ id: id.toString(), ...updated[0] });
    } catch (error: any) {
      console.error("Error updating work session:", error);
      res.status(500).json({ error: "Failed to update work session" });
    }
  });

  app.get("/api/work-sessions", async (req, res) => {
    try {
      const { user_id, ticket_id, status: wsStatus } = req.query;
      let sql = "SELECT * FROM work_sessions WHERE 1=1";
      const values: any[] = [];

      if (user_id) { sql += " AND user_id = ?"; values.push(user_id); }
      if (ticket_id) { sql += " AND ticket_id = ?"; values.push(ticket_id); }
      if (wsStatus) { sql += " AND status = ?"; values.push(wsStatus); }

      sql += " ORDER BY created_at DESC";
      const rows = await query(sql, values);
      res.json(rows.map(r => ({ id: r.id?.toString(), ...r })));
    } catch (error: any) {
      console.error("Error fetching work sessions:", error);
      res.status(500).json({ error: "Failed to fetch work sessions" });
    }
  });

  // ═══ WORK NOTES TABLE INIT ═══
  try {
    if (useSQLite) {
      const db = await getSQLiteDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS work_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          user_name TEXT,
          ticket_id TEXT,
          ticket_number TEXT,
          session_id TEXT,
          note_type TEXT NOT NULL,
          screenshot_url TEXT,
          screenshot_filename TEXT,
          screenshot_format TEXT,
          screenshot_size_kb INTEGER,
          ai_note TEXT,
          duration_seconds INTEGER,
          duration_display TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_wn_user ON work_notes(user_id);
        CREATE INDEX IF NOT EXISTS idx_wn_ticket ON work_notes(ticket_id);
        CREATE INDEX IF NOT EXISTS idx_wn_session ON work_notes(session_id);
      `);
    } else {
      await execute(`
        CREATE TABLE IF NOT EXISTS work_notes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          user_name VARCHAR(255),
          ticket_id VARCHAR(128),
          ticket_number VARCHAR(50),
          session_id VARCHAR(128),
          note_type ENUM('start','stop') NOT NULL,
          screenshot_url TEXT,
          screenshot_filename VARCHAR(255),
          screenshot_format VARCHAR(10),
          screenshot_size_kb INT,
          ai_note TEXT,
          duration_seconds INT,
          duration_display VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_wn_user (user_id),
          INDEX idx_wn_ticket (ticket_id),
          INDEX idx_wn_session (session_id)
        ) ENGINE=InnoDB
      `);
    }
    console.log('[DB] Work notes table initialized');
  } catch (e: any) {
    console.error('[DB] Work notes table init failed:', e.message);
  }

  // ═══ MESSAGE HISTORY TABLE INIT ═══
  try {
    if (useSQLite) {
      const db = await getSQLiteDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS message_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          user_name TEXT,
          message_type TEXT NOT NULL,
          recipient TEXT,
          message_content TEXT,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_mh_user ON message_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_mh_type ON message_history(message_type);
      `);
    } else {
      await execute(`
        CREATE TABLE IF NOT EXISTS message_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          user_name VARCHAR(255),
          message_type ENUM('email','whatsapp') NOT NULL,
          recipient VARCHAR(255),
          message_content TEXT,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_mh_user (user_id),
          INDEX idx_mh_type (message_type)
        ) ENGINE=InnoDB
      `);
    }
    console.log('[DB] Message history table initialized');
  } catch (e: any) {
    console.error('[DB] Message history table init failed:', e.message);
  }

  // ═══ ACTIVITY TRACKER TABLES INIT ═══
  try {
    if (useSQLite) {
      const db = await getSQLiteDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS activity_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          user_name TEXT,
          start_time DATETIME NOT NULL,
          stop_time DATETIME,
          duration INTEGER DEFAULT 0,
          summary TEXT,
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_as_user ON activity_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_as_session ON activity_sessions(session_id);

        CREATE TABLE IF NOT EXISTS activity_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          user_id TEXT NOT NULL,
          screenshot_url TEXT,
          screenshot_filename TEXT,
          screenshot_format TEXT,
          screenshot_size_kb INTEGER,
          activity_label TEXT,
          description TEXT,
          detected_app TEXT,
          detected_website TEXT,
          app_icon TEXT,
          confidence REAL DEFAULT 0,
          captured_at DATETIME,
          approval_status TEXT DEFAULT 'Pending',
          approved_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ae_session ON activity_entries(session_id);
        CREATE INDEX IF NOT EXISTS idx_ae_user ON activity_entries(user_id);
      `);
    } else {
      await execute(`
        CREATE TABLE IF NOT EXISTS activity_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id VARCHAR(128) NOT NULL UNIQUE,
          user_id VARCHAR(128) NOT NULL,
          user_name VARCHAR(255),
          start_time TIMESTAMP NOT NULL,
          stop_time TIMESTAMP NULL,
          duration INT DEFAULT 0,
          summary TEXT,
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_as_user (user_id),
          INDEX idx_as_session (session_id)
        ) ENGINE=InnoDB
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS activity_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          session_id VARCHAR(128),
          user_id VARCHAR(128) NOT NULL,
          screenshot_url TEXT,
          screenshot_filename VARCHAR(255),
          screenshot_format VARCHAR(10),
          screenshot_size_kb INT,
          activity_label VARCHAR(100),
          description TEXT,
          detected_app VARCHAR(100),
          detected_website VARCHAR(100),
          app_icon VARCHAR(50),
          confidence DECIMAL(4,3) DEFAULT 0,
          captured_at TIMESTAMP NULL,
          approval_status VARCHAR(20) DEFAULT 'Pending',
          approved_by VARCHAR(128),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_ae_session (session_id),
          INDEX idx_ae_user (user_id)
        ) ENGINE=InnoDB
      `);
    }
    
    // Ensure tables have latest columns
    try {
      if (useSQLite) {
        const db = await getSQLiteDb();
        await db.exec("ALTER TABLE activity_entries ADD COLUMN approval_status TEXT DEFAULT 'Pending'");
        await db.exec("ALTER TABLE activity_entries ADD COLUMN approved_by TEXT");
      } else {
        await execute("ALTER TABLE activity_entries ADD COLUMN approval_status VARCHAR(20) DEFAULT 'Pending'");
        await execute("ALTER TABLE activity_entries ADD COLUMN approved_by VARCHAR(128)");
      }
    } catch (e) {
      // Ignore if columns already exist
    }

    console.log('[DB] Activity tracker tables initialized');
  } catch (e: any) {
    console.error('[DB] Activity tracker tables init failed:', e.message);
  }

  // ═══ AI ANALYZE ACTIVITY (Vision-powered — Gemini sees the actual screenshot) ═══
  app.post('/api/ai/analyze-activity', async (req: any, res: any) => {
    try {
      const {
        timestamp, previous_activity, userId,
        appName, pageUrl, pageTitle, pageType, ticketNumber,
        headings, formData, recentClicks,
        recentKeys, idleSeconds, scrollDepth,
        badges, visibleText,
        screenshot_url,   // server-side path e.g. /uploads/screenshots/activity_xxx.jpeg
      } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'your_gemini_api_key_here') {
        return res.json(activityFallback(previous_activity, pageUrl, pageType, idleSeconds, appName, ticketNumber));
      }

      const app_ = appName || 'Connect IT';
      const prevStr = previous_activity ? `\nPrevious activity: ${previous_activity}` : '';
      const idleStr = idleSeconds > 60 ? `\nUser idle for ${idleSeconds}s.` : '';
      const tickStr = ticketNumber ? `\nActive ticket: ${ticketNumber}` : '';
      const clickStr = recentClicks?.length ? `\nRecent clicks: ${recentClicks.join(' → ')}` : '';
      const keyStr = recentKeys > 0 ? `\nKeystrokes: ${recentKeys}` : '';
      const headStr = headings?.length ? `\nPage headings: ${headings.join(' | ')}` : '';
      const formStr = formData && Object.keys(formData).length
        ? `\nForm fields: ${Object.entries(formData).map(([k, v]) => `${k}="${v}"`).join(', ')}` : '';
      const textStr = visibleText ? `\nVisible text: ${visibleText}` : '';

      const contextText = `You are an AI model that analyzes screenshots of a user's computer screen.
Your task is to identify the application, detect the website (if any), understand the activity, and generate a short professional description.

OBJECTIVE:
From the screenshot, return: application name, website name (if browser), activity type, short professional description, confidence score.

INSTRUCTIONS:
- Carefully analyze the screenshot visually
- Identify the main active application (ignore background apps)
- If it is a browser: detect the website name (e.g., ChatGPT, YouTube, Gmail, GitHub, etc.)
- Recognize activity type from: Coding, Development, Browsing, Documentation, Communication, Design, Ticket Work, Timesheet Entry, Dashboard Review, Reports Analysis, Idle, Unclear
- Generate a clear professional description (1-2 lines) using action-based wording: "Working on...", "Reviewing...", "Interacting with...", "Developing..."
- Avoid repetition. Do NOT hallucinate unknown tools.
- If unsure: set app = "Unknown", activity = "Unclear"

ADDITIONAL CONTEXT (from DOM/browser):
App detected from tab: ${app_}
Page: ${pageType || pageUrl}
Page title: ${pageTitle || 'unknown'}${tickStr}${prevStr}${idleStr}${clickStr}${keyStr}${headStr}${formStr}${textStr}

EXAMPLES:
Screenshot showing ChatGPT in Chrome → {"app":"Google Chrome","website":"ChatGPT","activity":"Browsing","description":"Interacting with ChatGPT to generate and review responses","confidence":0.95}
VS Code editor open → {"app":"Visual Studio Code","website":null,"activity":"Coding","description":"Developing and editing source code in the IDE","confidence":0.93}
Microsoft Word document → {"app":"Microsoft Word","website":null,"activity":"Documentation","description":"Writing and editing a document in Microsoft Word","confidence":0.90}
Unclear screen → {"app":"Unknown","website":null,"activity":"Unclear","description":"User activity could not be determined from the screen","confidence":0.40}

RULES:
- Do NOT guess random apps
- Do NOT generate long paragraphs
- Do NOT include extra text outside JSON
- Always return valid JSON
- Focus only on visible content
- Be accurate over creative, concise, consistent
- Prefer clarity over assumption

OUTPUT FORMAT (STRICT JSON — no markdown, no extra text):
{"app":"Application Name","website":"Website Name or null","activity":"Activity Type","description":"Short professional description","confidence":0.0}`;

      const ai = new GoogleGenAI({ apiKey });

      // ── Vision mode: send screenshot image to Gemini ──
      let contents: any;

      if (screenshot_url) {
        try {
          // Read the saved screenshot file and send as inline base64 image
          const screenshotPath = path.join(__dirname, 'public', screenshot_url);
          if (fs.existsSync(screenshotPath)) {
            const imageBuffer = fs.readFileSync(screenshotPath);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = screenshot_url.endsWith('.png') ? 'image/png' : 'image/jpeg';

            // Gemini Vision: text prompt + inline image
            contents = [
              { text: contextText },
              {
                inlineData: {
                  mimeType,
                  data: base64Image,
                },
              },
            ];
          }
        } catch (imgErr: any) {
          console.warn('[AI Activity] Could not load screenshot for vision:', imgErr.message);
        }
      }

      // Fallback to text-only if no image
      if (!contents) {
        contents = contextText;
      }

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
      });

      const raw = (result.text || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();

      let parsed: any;
      try { parsed = JSON.parse(raw); }
      catch { parsed = activityFallback(previous_activity, pageUrl, pageType, idleSeconds, appName, ticketNumber); }

      // Map new format fields → response
      const detectedApp = parsed.app || parsed.detected_app || appName || null;
      const detectedWebsite = parsed.website || parsed.detected_website || null;
      const activityLabel = parsed.activity || 'General Work';
      const description = parsed.description || `Working in ${app_} on ${pageType || 'the application'}.`;
      const confidence = parsed.confidence ?? 0.7;

      res.json({
        activity: activityLabel,
        description,
        confidence,
        detected_app: detectedApp,
        detected_website: detectedWebsite,
      });
    } catch (error: any) {
      console.error('[AI Analyze Activity] Error:', error.message);
      res.json(activityFallback(
        req.body.previous_activity, req.body.pageUrl, req.body.pageType,
        req.body.idleSeconds, req.body.appName, req.body.ticketNumber
      ));
    }
  });

  function activityFallback(
    previousActivity?: string, pageUrl?: string, pageType?: string,
    idleSeconds?: number, appName?: string, ticketNumber?: string
  ): object {
    const app_ = appName || 'Connect IT';
    const page = pageType || 'the application';

    if (idleSeconds && idleSeconds > 60) {
      return { activity: 'Idle', description: `User has been idle for ${idleSeconds} seconds in ${app_}.`, confidence: 0.95 };
    }

    const pt = pageType || pageUrl || '';
    const ticket = ticketNumber ? ` on ${ticketNumber}` : '';

    const map: Record<string, [string, string]> = {
      'Ticket Detail': ['Ticket Work', `Reviewing ticket details${ticket} in ${app_}'s Ticket Detail page.`],
      'Ticket List': ['Ticket Work', `Browsing the ticket list in ${app_}, reviewing open incidents.`],
      'Timesheet': ['Timesheet Entry', `Updating timesheet records in ${app_}'s Timesheet module.`],
      'Weekly Timesheet': ['Timesheet Entry', `Logging work hours in ${app_}'s Weekly Timesheet view.`],
      'Dashboard': ['Dashboard Review', `Reviewing the incident dashboard in ${app_}.`],
      'Reports': ['Reports Analysis', `Analyzing reports and metrics in ${app_}'s Reports section.`],
      'Knowledge Base': ['Knowledge Base', `Browsing knowledge base articles in ${app_}.`],
      'Calendar': ['Calendar Review', `Reviewing scheduled events in ${app_}'s Calendar.`],
      'Settings': ['Settings Configuration', `Configuring system settings in ${app_}.`],
      'CMDB': ['General Work', `Managing configuration items in ${app_}'s CMDB.`],
      'Problem Management': ['General Work', `Working on problem management tasks in ${app_}.`],
      'Change Management': ['General Work', `Reviewing change requests in ${app_}.`],
    };

    for (const [k, [act, desc]] of Object.entries(map)) {
      if (pt.includes(k)) return { activity: act, description: desc, confidence: 0.75 };
    }

    return { activity: 'General Work', description: `Working in ${app_} on the ${page} page.`, confidence: 0.6 };
  }

  // ═══ AI GENERATE SUMMARY ═══
  app.post('/api/ai/generate-summary', async (req: any, res: any) => {
    try {
      const { session_data, duration_seconds } = req.body;
      if (!session_data || !Array.isArray(session_data) || session_data.length === 0) {
        return res.json({ summary: 'Session completed. User was actively working.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'your_gemini_api_key_here') {
        const activities = [...new Set(session_data.map((e: any) => e.activity))].join(', ');
        return res.json({ summary: `User worked on: ${activities}. Session duration: ${Math.floor((duration_seconds || 0) / 60)} minutes.` });
      }

      const activityList = session_data.map((e: any) =>
        `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.activity}: ${e.description}`
      ).join('\n');

      const durationStr = duration_seconds
        ? `${Math.floor(duration_seconds / 3600)}h ${Math.floor((duration_seconds % 3600) / 60)}m`
        : 'unknown';

      const prompt = `You are an AI work session summarizer trained to generate professional timesheet summaries.

Session duration: ${durationStr}
Activity log:
${activityList}

INSTRUCTIONS:
- Write a 2-3 sentence professional summary for a timesheet/work report
- Mention the specific apps and websites the user worked with (e.g., "VS Code", "ChatGPT", "Gmail")
- Mention the types of tasks performed (coding, reviewing, communicating, etc.)
- Note any task transitions or variety in work
- Use past tense, professional tone
- Do NOT use bullet points
- Be specific — mention app names and activity types from the log above

EXAMPLE OUTPUT:
"The user spent the session developing code in VS Code and reviewing pull requests on GitHub. They also interacted with ChatGPT for AI assistance and reviewed incident tickets in Connect IT. The session showed a productive mix of development and support activities."

Respond ONLY with JSON: {"summary": "your summary here"}`;

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const raw = (result.text || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();

      let summary = 'Session completed successfully.';
      try { summary = JSON.parse(raw).summary || summary; } catch { summary = raw.length < 500 ? raw : summary; }

      res.json({ summary });
    } catch (error: any) {
      console.error('[AI Generate Summary] Error:', error.message);
      res.json({ summary: 'Session completed. User was actively working during this period.' });
    }
  });

  // ═══ ACTIVITY SESSIONS CRUD ═══
  app.post('/api/activity-sessions', async (req: any, res: any) => {
    try {
      const { session_id, user_id, user_name, start_time, status } = req.body;
      if (!user_id || !session_id) return res.status(400).json({ error: 'Missing user_id or session_id' });
      const result = await execute(
        `INSERT INTO activity_sessions (session_id, user_id, user_name, start_time, status) VALUES (?, ?, ?, ?, ?)`,
        [session_id, user_id, user_name || null, start_time || new Date().toISOString(), status || 'active']
      );
      const created = await query('SELECT * FROM activity_sessions WHERE id = ?', [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error('[Activity Sessions] Create failed:', error.message);
      res.status(500).json({ error: 'Failed to create activity session' });
    }
  });

  app.put('/api/activity-sessions/:id', async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const fields = Object.keys(req.body).filter(k => k !== 'id');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => req.body[k]), id];
      await execute(`UPDATE activity_sessions SET ${setClause} WHERE id = ?`, values);
      const updated = await query('SELECT * FROM activity_sessions WHERE id = ?', [id]);
      res.json({ id: id.toString(), ...updated[0] });
    } catch (error: any) {
      console.error('[Activity Sessions] Update failed:', error.message);
      res.status(500).json({ error: 'Failed to update activity session' });
    }
  });

  app.get('/api/activity-sessions', async (req: any, res: any) => {
    try {
      const { user_id, status: s, limit = '20' } = req.query;
      let sql = 'SELECT * FROM activity_sessions WHERE 1=1';
      const values: any[] = [];
      if (user_id) { sql += ' AND user_id = ?'; values.push(user_id); }
      if (s) { sql += ' AND status = ?'; values.push(s); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      values.push(parseInt(limit as string) || 20);
      const rows = await query(sql, values);
      res.json(rows.map((r: any) => ({ id: r.id?.toString(), ...r })));
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch activity sessions' });
    }
  });

  // ═══ ACTIVITY ENTRIES CRUD ═══
    app.post('/api/activity-entries', async (req: any, res: any) => {
    try {
      const { session_id, user_id, screenshot_url, screenshot_filename, screenshot_format,
        screenshot_size_kb, activity_label, description, confidence, captured_at, keystrokes, clicks } = req.body;
      if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
      const result = await execute(
        `INSERT INTO activity_entries (session_id, user_id, screenshot_url, screenshot_filename, screenshot_format, screenshot_size_kb, activity_label, description, confidence, captured_at, keystrokes, clicks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [session_id || null, user_id, screenshot_url || null, screenshot_filename || null,
        screenshot_format || null, screenshot_size_kb || null, activity_label || null,
        description || null, confidence || 0, captured_at || null, keystrokes || 0, clicks || 0]
      );
      const created = await query('SELECT * FROM activity_entries WHERE id = ?', [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error('[Activity Entries] Create failed:', error.message);
      res.status(500).json({ error: 'Failed to save activity entry' });
    }
  });

  app.get('/api/activity-entries', async (req: any, res: any) => {
    try {
      const { user_id, session_id, start_date, end_date, limit = '100' } = req.query;
      let sql = 'SELECT * FROM activity_entries WHERE 1=1';
      const values: any[] = [];
      if (user_id) { sql += ' AND user_id = ?'; values.push(user_id); }
      if (session_id) { sql += ' AND session_id = ?'; values.push(session_id); }
      if (start_date) { sql += ' AND captured_at >= ?'; values.push(start_date); }
      if (end_date) { sql += ' AND captured_at <= ?'; values.push(end_date); }
      sql += ' ORDER BY captured_at ASC LIMIT ?';
      values.push(parseInt(limit as string) || 100);
      const rows = await query(sql, values);
      res.json(rows.map((r: any) => ({ id: r.id?.toString(), ...r })));
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch activity entries' });
    }
  });

  app.put('/api/activity-entries/:id', async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const fields = Object.keys(req.body).filter(k => k !== 'id' && k !== 'created_at');
      if (fields.length === 0) return res.json({ message: "No fields to update" });
      
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => req.body[k]), id];
      
      await execute(`UPDATE activity_entries SET ${setClause} WHERE id = ?`, values);
      const updated = await query('SELECT * FROM activity_entries WHERE id = ?', [id]);
      res.json({ id: id.toString(), ...updated[0] });
    } catch (error: any) {
      console.error('[Activity Entries] Update failed:', error.message);
      res.status(500).json({ error: 'Failed to update activity entry' });
    }
  });

  // ═══ SCREENSHOT UPLOAD ═══
  // Ensure uploads directory exists
  const uploadsDir = path.join(__dirname, 'public', 'uploads', 'screenshots');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const screenshotStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      // Preserve the original filename (timesheet_start_<ts>.png / timesheet_stop_<ts>.jpeg)
      // Sanitise to prevent path traversal
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safe);
    },
  });

  const screenshotUpload = multer({
    storage: screenshotStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
    fileFilter: (_req, file, cb) => {
      // STRICT: only PNG and JPEG accepted
      const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type: ${file.mimetype}. Only PNG and JPEG are accepted.`));
      }
    },
  });

  app.post('/api/upload-screenshot', screenshotUpload.single('screenshot'), (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No screenshot file received' });
      }
      // Determine format from MIME
      const format = req.file.mimetype === 'image/png' ? 'PNG' : 'JPEG';
      const sizeKB = Math.round(req.file.size / 1024);
      const imageUrl = `/uploads/screenshots/${req.file.filename}`;

      console.log(`[Upload] Screenshot saved: ${req.file.filename} (${format}, ${sizeKB}KB)`);
      res.json({
        image_url: imageUrl,
        filename: req.file.filename,
        format,
        size_kb: sizeKB,
      });
    } catch (error: any) {
      console.error('[Upload] Screenshot upload failed:', error.message);
      res.status(500).json({ error: 'Screenshot upload failed' });
    }
  });

  // Serve uploaded screenshots statically
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
  app.use('/captures', express.static(path.join(__dirname, 'public', 'captures')));

  // ═══ GLOBAL INPUT TRACKING ═══
  let globalKeystrokes = 0;
  let globalClicks = 0;
  
  try {
    uIOhook.on('keydown', () => { globalKeystrokes++; });
    uIOhook.on('click', () => { globalClicks++; });
    uIOhook.start();
    console.log('[Activity Tracker] Global input hooking started');
  } catch (err) {
    console.error('[Activity Tracker] Failed to start global input hook:', err);
  }

  app.get('/api/input-stats', (req, res) => {
    res.json({
      keystrokes: globalKeystrokes,
      clicks: globalClicks
    });
  });

  // ═══ SCREEN CAPTURE API (OS-LEVEL) ═══
  app.get('/api/capture-screen', async (req, res) => {
    let scriptPath: string | null = null;
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const ts = Date.now();
      const filename = `screen_${ts}.jpg`;
      const publicDir = path.join(process.cwd(), 'public', 'captures');
      const tempDir = path.join(process.cwd(), '.temp');
      
      if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      // Cleanup old captures (older than 30 mins)
      try {
        const files = fs.readdirSync(publicDir);
        for (const file of files) {
          const filePath = path.join(publicDir, file);
          const stats = fs.statSync(filePath);
          if (Date.now() - stats.mtimeMs > 1800000) fs.unlinkSync(filePath);
        }
      } catch (e) { /* ignore */ }

      const filePath = path.join(publicDir, filename);
      scriptPath = path.join(tempDir, `capture_${ts}.ps1`);

      const psScript = `
        try {
          [void][Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
          [void][Reflection.Assembly]::LoadWithPartialName("System.Drawing")
          
          $screens = [System.Windows.Forms.Screen]::AllScreens
          if ($null -eq $screens -or $screens.Count -eq 0) {
            $primary = [System.Windows.Forms.Screen]::PrimaryScreen
            $width = $primary.Bounds.Width
            $height = $primary.Bounds.Height
            $left = $primary.Bounds.Left
            $top = $primary.Bounds.Top
          } else {
            $left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
            $top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
            $right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
            $bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
            $width = $right - $left
            $height = $bottom - $top
          }
          
          if ($width -le 0 -or $height -le 0) {
            throw "Invalid screen dimensions calculated: $width x $height. Ensure a monitor is connected and accessible."
          }
          
          # Cap dimensions to avoid GDI+ limits (optional, but good for safety)
          if ($width -gt 10000) { $width = 10000 }
          if ($height -gt 10000) { $height = 10000 }
          
          $bmp = New-Object System.Drawing.Bitmap ([int]$width), ([int]$height)
          $graphics = [System.Drawing.Graphics]::FromImage($bmp)
          $graphics.CopyFromScreen([int]$left, [int]$top, 0, 0, $bmp.Size)
          $graphics.Dispose()
          $bmp.Save("${filePath.replace(/\\/g, '/')}", [System.Drawing.Imaging.ImageFormat]::Jpeg)
          $bmp.Dispose()
          Write-Output "SUCCESS"
        } catch {
          $msg = $_.Exception.Message
          if ($_.Exception.InnerException) { $msg += " -> " + $_.Exception.InnerException.Message }
          Write-Output "[PS-ERROR] $msg"
          exit 1
        }
      `;

      fs.writeFileSync(scriptPath, psScript, 'utf8');

      console.log('[Screen Capture] Running PS script...');
      const { stdout, stderr } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
      console.log('[Screen Capture] PS Stdout:', stdout.trim());

      if (fs.existsSync(filePath)) {
        const bitmap = fs.readFileSync(filePath);
        const dataUrl = `data:image/jpeg;base64,${bitmap.toString('base64')}`;
        res.json({
          success: true,
          data_url: dataUrl,
          image_url: `/captures/${filename}`,
          filename,
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error("Screenshot file not found after PS execution. Stderr: " + stderr);
      }
    } catch (error: any) {
      console.error('[Screen Capture] Failed:', error.message);
      res.status(500).json({ error: "Failed to capture screen", detail: error.message });
    } finally {
      if (scriptPath && fs.existsSync(scriptPath)) {
        try { fs.unlinkSync(scriptPath); } catch {}
      }
    }
  });

  // ═══ COMPANY EMAIL CONFIGURATIONS (Ultra Super Admin) ═══
  app.get("/api/email-configs", async (req, res) => {
    try {
      const rows = await query("SELECT * FROM company_email_configs ORDER BY created_at DESC");
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/email-configs", async (req, res) => {
    try {
      const data = req.body;
      const fields = Object.keys(data);
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(k => data[k]);

      // If setting as default, unset others
      if (data.is_default) {
        await execute("UPDATE company_email_configs SET is_default = 0");
      }

      const result = await execute(
        `INSERT INTO company_email_configs (${fields.join(', ')}) VALUES (${placeholders})`,
        values
      );
      res.json({ id: result.insertId, ...data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/email-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const data = req.body;
      const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => data[k]), id];

      if (data.is_default) {
        await execute("UPDATE company_email_configs SET is_default = 0 WHERE id != ?", [id]);
      }

      await execute(`UPDATE company_email_configs SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
      res.json({ id, ...data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/email-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await execute("DELETE FROM company_email_configs WHERE id = ?", [id]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/email-configs/test", async (req, res) => {
    try {
      const config = req.body;
      // Test SMTP
      const transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port,
        secure: config.smtp_port === 465,
        auth: { user: config.smtp_user, pass: config.smtp_pass },
        tls: { rejectUnauthorized: false }
      });
      await transporter.verify();

      // Test IMAP
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
      const connection = await imaps.connect(imapConfig);
      connection.end();

      res.json({ success: true, message: "SMTP and IMAP connections successful!" });
    } catch (error: any) {

      console.error("[Email Test] Failed:", error.message);
      res.status(500).json({ error: "Connection failed", detail: error.message });
    }
  });

  // ═══ MASTER DATA APIS ═══


  const VALID_MASTER_TABLES = [
    'mst_groups', 'mst_statuses', 'mst_roles', 'mst_departments', 
    'mst_ticket_types', 'mst_projects', 'mst_priorities', 
    'mst_sources', 'mst_tags', 'mst_categories', 'mst_subcategories', 
    'mst_providences', 'mst_members'
  ];

  app.get("/api/master-data/:table", async (req, res) => {
    try {
      const { table } = req.params;
      const { status, search, sort = 'name', order = 'ASC', category_id, subcategory_id, group_id } = req.query;

      if (!VALID_MASTER_TABLES.includes(table)) {
        return res.status(400).json({ error: "Invalid master table" });
      }

      let sql = `SELECT * FROM ${table} WHERE 1=1`;
      const params: any[] = [];

      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }

      if (search) {
        sql += " AND (name LIKE ? OR description LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      // Hierarchy filters
      if (category_id && table === 'mst_subcategories') {
        sql += " AND category_id = ?";
        params.push(category_id);
      }
      if (subcategory_id && table === 'mst_providences') {
        sql += " AND subcategory_id = ?";
        params.push(subcategory_id);
      }
      if (group_id && table === 'mst_members') {
        sql += " AND group_id = ?";
        params.push(group_id);
      }

      // Safe sorting
      const allowedSortCols = ['name', 'created_at', 'id', 'level', 'status'];
      const finalSort = allowedSortCols.includes(sort as string) ? sort : 'name';
      const finalOrder = order === 'DESC' ? 'DESC' : 'ASC';
      
      sql += ` ORDER BY ${finalSort} ${finalOrder}`;

      const rows = await query(sql, params);
      res.json(rows.map(r => ({ ...r, id: r.id.toString() })));
    } catch (error: any) {
      console.error(`[Master Data] Fetch error (${req.params.table}):`, error.message);
      res.status(500).json({ error: "Failed to fetch master data" });
    }
  });

  app.post("/api/master-data/:table", async (req, res) => {
    try {
      const { table } = req.params;
      const data = req.body;

      if (!VALID_MASTER_TABLES.includes(table)) {
        return res.status(400).json({ error: "Invalid master table" });
      }

      const fields = Object.keys(data).filter(k => k !== 'id');
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(k => data[k]);

      const result = await execute(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`,
        values
      );

      const rows = await query(`SELECT * FROM ${table} WHERE id = ?`, [result.insertId]);
      res.json({ ...rows[0], id: result.insertId.toString() });
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: "An entry with this name already exists" });
      }
      console.error(`[Master Data] Create error (${req.params.table}):`, error.message);
      res.status(500).json({ error: "Failed to create master data" });
    }
  });

  app.put("/api/master-data/:table/:id", async (req, res) => {
    try {
      const { table, id } = req.params;
      const data = req.body;

      if (!VALID_MASTER_TABLES.includes(table)) {
        return res.status(400).json({ error: "Invalid master table" });
      }

      const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at');
      const setClause = fields.map(k => `${k} = ?`).join(', ');
      const values = [...fields.map(k => data[k]), id];

      await execute(`UPDATE ${table} SET ${setClause} WHERE id = ?`, values);

      const rows = await query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      res.json({ ...rows[0], id: id.toString() });
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: "An entry with this name already exists" });
      }
      console.error(`[Master Data] Update error (${req.params.table}):`, error.message);
      res.status(500).json({ error: "Failed to update master data" });
    }
  });

  app.delete("/api/master-data/:table/:id", async (req, res) => {
    try {
      const { table, id } = req.params;
      const { permanent } = req.query;

      if (!VALID_MASTER_TABLES.includes(table)) {
        return res.status(400).json({ error: "Invalid master table" });
      }

      if (permanent === 'true') {
        await execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
        res.json({ message: "Item deleted permanently" });
      } else {
        // Soft delete/deactivate
        const rows = await query(`SELECT status FROM ${table} WHERE id = ?`, [id]);
        const newStatus = rows[0]?.status === 'active' ? 'inactive' : 'active';
        await execute(`UPDATE ${table} SET status = ? WHERE id = ?`, [newStatus, id]);
        res.json({ message: `Item marked as ${newStatus}`, status: newStatus });
      }
    } catch (error: any) {
      console.error(`[Master Data] Delete error (${req.params.table}):`, error.message);
      res.status(500).json({ error: "Failed to delete master data" });
    }
  });

  // ═══ AI GENERATE NOTES (for Work Notes Chat) ═══
  app.post('/api/ai/generate-notes', async (req: any, res: any) => {
    try {
      const {
        context,        // 'start' | 'stop'
        ticketNumber,
        ticketTitle,
        userId,
        userName,
        durationSeconds,
        pageUrl,
        pageTitle,
      } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;

      // Smart fallback when no API key
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'your_gemini_api_key_here') {
        const note = generateWorkNoteFallback(context, ticketNumber, ticketTitle, durationSeconds);
        return res.json({ note });
      }

      const actionStr = context === 'start' ? 'starting' : 'stopping';
      const durationStr = durationSeconds
        ? `\nSession duration: ${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m ${durationSeconds % 60}s`
        : '';
      const ticketStr = ticketNumber ? `\nTicket: ${ticketNumber}${ticketTitle ? ` — ${ticketTitle}` : ''}` : '';

      const prompt = `You are an IT service management work notes assistant. Generate a concise, professional 1-2 sentence work note for a technician who is ${actionStr} a work session.

Technician: ${userName || 'Technician'}${ticketStr}${durationStr}
Current page: ${pageUrl || 'timesheet'}
Page title: ${pageTitle || 'Timesheet'}

Rules:
- Use action-based language: "Started working on...", "Continued development of...", "Reviewed...", "Completed..."
- Be specific and professional
- 1-2 sentences maximum
- Detect activity type from context (coding, support, documentation, etc.)
- For stop context, mention what was accomplished or the duration

Respond with ONLY a JSON object: {"note": "your note here"}`;

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const raw = (result.text || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();
      let note: string;
      try {
        const parsed = JSON.parse(raw);
        note = parsed.note || generateWorkNoteFallback(context, ticketNumber, ticketTitle, durationSeconds);
      } catch {
        // If AI returned plain text instead of JSON, use it directly
        note = raw.length > 10 && raw.length < 500
          ? raw
          : generateWorkNoteFallback(context, ticketNumber, ticketTitle, durationSeconds);
      }

      res.json({ note });
    } catch (error: any) {
      console.error('[AI Generate Notes] Error:', error.message);
      const note = generateWorkNoteFallback(
        req.body.context, req.body.ticketNumber,
        req.body.ticketTitle, req.body.durationSeconds
      );
      res.json({ note });
    }
  });

  function generateWorkNoteFallback(
    context: string,
    ticketNumber?: string,
    ticketTitle?: string,
    durationSeconds?: number
  ): string {
    const ticket = ticketNumber ? ` for ${ticketNumber}${ticketTitle ? `: ${ticketTitle}` : ''}` : '';
    const duration = durationSeconds
      ? ` Duration: ${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m.`
      : '';

    if (context === 'start') {
      const verbs = ['Started working on', 'Initiated work session', 'Began investigation of', 'Commenced work on'];
      const verb = verbs[Math.floor(Math.random() * verbs.length)];
      return `${verb} timesheet entry${ticket}. Session tracking initiated.`;
    } else {
      const verbs = ['Completed work session', 'Concluded work session', 'Finished work session', 'Wrapped up session'];
      const verb = verbs[Math.floor(Math.random() * verbs.length)];
      return `${verb}${ticket}.${duration} Progress saved.`;
    }
  }

  // ═══ WORK NOTES CRUD ═══
  app.post('/api/work-notes', async (req: any, res: any) => {
    try {
      const {
        user_id, user_name, ticket_id, ticket_number,
        session_id, note_type, screenshot_url,
        screenshot_filename, screenshot_format, screenshot_size_kb,
        ai_note, duration_seconds, duration_display,
      } = req.body;

      if (!user_id || !note_type) {
        return res.status(400).json({ error: 'Missing required fields: user_id, note_type' });
      }
      if (!['start', 'stop'].includes(note_type)) {
        return res.status(400).json({ error: 'note_type must be "start" or "stop"' });
      }

      const result = await execute(
        `INSERT INTO work_notes
          (user_id, user_name, ticket_id, ticket_number, session_id, note_type,
           screenshot_url, screenshot_filename, screenshot_format, screenshot_size_kb,
           ai_note, duration_seconds, duration_display)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          user_name || null,
          ticket_id || null,
          ticket_number || null,
          session_id || null,
          note_type,
          screenshot_url || null,
          screenshot_filename || null,
          screenshot_format || null,
          screenshot_size_kb || null,
          ai_note || null,
          duration_seconds || null,
          duration_display || null,
        ]
      );

      const created = await query('SELECT * FROM work_notes WHERE id = ?', [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error('[Work Notes] Create failed:', error.message);
      res.status(500).json({ error: 'Failed to save work note' });
    }
  });

  app.get('/api/work-notes', async (req: any, res: any) => {
    try {
      const { user_id, ticket_id, session_id, limit = '50' } = req.query;

      let sql = 'SELECT * FROM work_notes WHERE 1=1';
      const values: any[] = [];

      if (user_id) { sql += ' AND user_id = ?'; values.push(user_id); }
      if (ticket_id) { sql += ' AND ticket_id = ?'; values.push(ticket_id); }
      if (session_id) { sql += ' AND session_id = ?'; values.push(session_id); }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      values.push(parseInt(limit as string) || 50);

      const rows = await query(sql, values);
      // Return in chronological order for chat display
      res.json(rows.reverse().map((r: any) => ({ id: r.id?.toString(), ...r })));
    } catch (error: any) {
      console.error('[Work Notes] Fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch work notes' });
    }
  });

  // ═══ MESSAGE HISTORY CRUD ═══
  app.post('/api/message-history', async (req: any, res: any) => {
    try {
      const { user_id, user_name, message_type, recipient, message_content } = req.body;
      if (!user_id || !message_type) {
        return res.status(400).json({ error: 'Missing required fields: user_id, message_type' });
      }
      const result = await execute(
        `INSERT INTO message_history (user_id, user_name, message_type, recipient, message_content) VALUES (?, ?, ?, ?, ?)`,
        [user_id, user_name || null, message_type, recipient || null, message_content || null]
      );
      const created = await query('SELECT * FROM message_history WHERE id = ?', [result.insertId]);
      res.json({ id: result.insertId.toString(), ...created[0] });
    } catch (error: any) {
      console.error('[Message History] Save failed:', error.message);
      res.status(500).json({ error: 'Failed to save message history' });
    }
  });

  app.get('/api/message-history', async (req: any, res: any) => {
    try {
      const { user_id, message_type, limit = '100' } = req.query;
      let sql = 'SELECT * FROM message_history WHERE 1=1';
      const values: any[] = [];
      if (user_id) { sql += ' AND user_id = ?'; values.push(user_id); }
      if (message_type) { sql += ' AND message_type = ?'; values.push(message_type); }
      sql += ' ORDER BY sent_at DESC LIMIT ?';
      values.push(parseInt(limit as string) || 100);
      const rows = await query(sql, values);
      res.json(rows.map((r: any) => ({ id: r.id?.toString(), ...r })));
    } catch (error: any) {
      console.error('[Message History] Fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch message history' });
    }
  });

  // AI Classify Endpoint
  app.post("/api/ai/classify", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing text to classify" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.status(500).json({ error: "Gemini API key not configured" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analyze the following IT issue and classify it.\nIssue: "${text}"\n\nRespond ONLY with a valid JSON object with "category" and "priority" keys.\nCategory must be one of: "Network", "Software", "Hardware", "Database", "Inquiry / Help".\nPriority must be one of: "Low", "Medium", "High", "Critical".\nExample: {"category": "Network", "priority": "High"}`,
      });

      const raw = (result.text || "").replace(/```json\s*/g, "").replace(/```/g, "").trim();
      let classification: any = { category: "Inquiry / Help", priority: "Medium" };
      try { classification = JSON.parse(raw); } catch { }

      res.json(classification);
    } catch (error: any) {
      console.error("[AI Classify] Error:", error.message);
      res.status(500).json({ error: "AI classification failed", detail: error.message });
    }
  });

  // AI Suggest Endpoint
  app.post("/api/ai/suggest", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing text for suggestion" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.status(500).json({ error: "Gemini API key not configured" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "A user is experiencing an IT issue. Provide a short, direct suggested solution to help them fix it before creating a ticket. Keep it under 3 sentences and be friendly.\n\nIssue: \"" + text + "\"",
      });

      const suggestion = result.text || "Please create a ticket and our team will assist you shortly.";
      res.json({ suggestion });
    } catch (error: any) {
      console.error("[AI Suggest] Error:", error.message);
      res.status(500).json({ error: "AI suggestion failed", detail: error.message });
    }
  });

  // AI Chat Endpoint
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.status(500).json({
          error: "Gemini API key not configured.",
          detail: "API key missing or placeholder"
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: `You are Kiru, a friendly and intelligent IT service management assistant.
Personality: Warm, professional, and helpful.
Capabilities: 
1. Answer general questions.
2. Help with IT issues (Network, Software, Hardware, etc.).
3. Manage tickets using your available tools (create, get status, list).

When a user reports an issue, try to understand the impact and urgency. 
If they want to create a ticket, use the 'create_ticket' tool.
Always confirm the details before creating a ticket if possible.
Respond in a conversational, friendly tone.

User message: "${message}"

Please respond appropriately as a helpful IT assistant.`,
      });

      const responseText = result.text || "I processed your request but couldn't generate a text response.";
      res.json({ response: responseText });

    } catch (error: any) {
      console.error("[Kiru AI] Error:", error.message);
      res.status(500).json({
        error: "Failed to get AI response",
        detail: error.message
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.argv.includes("--test-only")) {
    console.log("[Test Mode] Skipping server listen.");
    return;
  }

  // ── HTTPS server with self-signed certificate ──────────────────────────────
  // Chrome's Web Speech API requires HTTPS. Without it, clicking the mic
  // produces "network error" because Chrome blocks speech on insecure origins.
  //
  // We generate a self-signed cert at runtime using Node's crypto module.
  // On first visit, Chrome will show a security warning — click
  // "Advanced → Proceed to localhost (unsafe)" to accept it once.
  //
  // In production, replace this with a real TLS certificate.
  // ──────────────────────────────────────────────────────────────────────────

  let serverInstance: http.Server | https.Server;

  try {
    // Try to use a real cert from environment variables first
    const tlsCert = process.env.TLS_CERT;
    const tlsKey  = process.env.TLS_KEY;

    if (tlsCert && tlsKey) {
      // Production: use real cert from env
      serverInstance = https.createServer({ cert: tlsCert, key: tlsKey }, app);
      console.log("[HTTPS] Using TLS certificate from environment variables");
    } else {
      // Development: use HTTP by default because self-signed HTTPS was causing ERR_SSL_VERSION_OR_CIPHER_MISMATCH
      serverInstance = http.createServer(app);
      console.warn("[HTTP] ⚠️  Running on HTTP — Chrome Web Speech API will NOT work unless accessed via localhost or a secure origin.");
    }
  } catch (err) {
    console.error("[Server] Failed to create HTTPS server, falling back to HTTP:", err);
    serverInstance = http.createServer(app);
  }

  const HTTPS_PORT = parseInt(process.env.PORT || String(PORT));

  serverInstance.listen(HTTPS_PORT, "0.0.0.0", () => {
    const protocol = serverInstance instanceof https.Server ? "https" : "http";
    console.log(`\n🚀 Server running on ${protocol}://localhost:${HTTPS_PORT}`);
    if (protocol === "https") {
      console.log(`🎤 Speech recognition enabled (HTTPS active)`);
    }
    console.log(`[MySQL] Database: ${dbConfig.database} at ${dbConfig.host}:${dbConfig.port}`);
    
    // OmniChannel polling
    console.log('[OmniChannel] Polling emails...');
    OmniChannelEngine.pollIncomingEmails();
    
    cron.schedule('*/30 * * * * *', () => {
      OmniChannelEngine.processNotificationQueue();
    });

    cron.schedule('*/1 * * * *', () => {
      console.log('[OmniChannel] Polling emails...');
      OmniChannelEngine.pollIncomingEmails();
    });
    
    cron.schedule('0 * * * *', () => {
      console.log('[SLAEngine] Monitoring SLA breaches...');
      SLAEngine.monitorBreaches();
    });
  });
}

startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
