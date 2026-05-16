import React, { useState, useEffect } from "react";
import { 
  Mail, 
  Plus, 
  Trash2, 
  Edit, 
  CheckCircle, 
  XCircle, 
  Settings, 
  Shield, 
  Send, 
  RefreshCw,
  MoreVertical,
  Check,
  Building2,
  Lock,
  Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";

interface EmailConfig {
  id: string;
  company_name: string;
  email_address: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_pass: string;
  encryption: string;
  is_active: number;
  is_default: number;
  created_at: string;
}

export function EmailIntegrations() {
  const { profile } = useAuth();
  const [configs, setConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean, message: string} | null>(null);
  
  const [form, setForm] = useState<Partial<EmailConfig>>({
    company_name: "",
    email_address: "",
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_user: "",
    imap_pass: "",
    encryption: "TLS",
    is_active: 1,
    is_default: 0
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-configs");
      const data = await res.json();
      setConfigs(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `/api/email-configs/${editingId}` : "/api/email-configs";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      
      if (res.ok) {
        setShowModal(false);
        fetchConfigs();
        setForm({
          company_name: "",
          email_address: "",
          smtp_host: "smtp.gmail.com",
          smtp_port: 587,
          smtp_user: "",
          smtp_pass: "",
          imap_host: "imap.gmail.com",
          imap_port: 993,
          imap_user: "",
          imap_pass: "",
          encryption: "TLS",
          is_active: 1,
          is_default: 0
        });
        setEditingId(null);
      }
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email-configs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message || data.error });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    }
    setTesting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this configuration?")) return;
    try {
      await fetch(`/api/email-configs/${id}`, { method: "DELETE" });
      fetchConfigs();
    } catch (e) { console.error(e); }
  };

  if (profile?.role !== 'ultra_super_admin') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-4">
          <Shield className="w-16 h-16 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">Only Ultra Super Admins can manage email integrations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Email Integration Management</h1>
          <p className="text-muted-foreground">Manage multi-company SMTP and IMAP configurations for automated support ticketing.</p>
        </div>
        <Button onClick={() => { setEditingId(null); setShowModal(true); }} className="bg-sn-green text-sn-dark font-bold gap-2">
          <Plus className="w-4 h-4" /> Add Integration
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {configs.map(config => (
          <div key={config.id} className="sn-card p-6 flex flex-col space-y-4 relative group">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sn-green/10 flex items-center justify-center text-sn-green">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-sn-dark">{config.company_name}</h3>
                  <p className="text-xs text-muted-foreground">{config.email_address}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {config.is_default === 1 && (
                  <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Default</span>
                )}
                {config.is_active === 1 ? (
                  <CheckCircle className="w-4 h-4 text-sn-green" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 py-4 border-y border-border">
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground">SMTP Status</p>
                <div className="flex items-center gap-1.5 text-xs text-sn-dark">
                  <Send className="w-3.5 h-3.5" /> {config.smtp_host}:{config.smtp_port}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground">IMAP Status</p>
                <div className="flex items-center gap-1.5 text-xs text-sn-dark">
                  <RefreshCw className="w-3.5 h-3.5" /> {config.imap_host}:{config.imap_port}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => {
                setEditingId(config.id);
                setForm(config);
                setShowModal(true);
              }}>
                <Edit className="w-4 h-4 mr-2" /> Edit
              </Button>
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(config.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        {configs.length === 0 && !loading && (
          <div className="col-span-full py-12 text-center sn-card bg-muted/20">
            <Mail className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-bold text-lg text-sn-dark">No Integrations Configured</h3>
            <p className="text-muted-foreground text-sm">Add your first company email configuration to start polling tickets.</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-sn-green" />
                <h2 className="text-xl font-bold">{editingId ? "Edit Integration" : "Add New Integration"}</h2>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-muted rounded-full transition-colors"><MoreVertical className="w-5 h-5 rotate-90" /></button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Basic Info */}
                <div className="space-y-6">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-sn-green flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> Basic Information
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block text-sn-dark">Company Name</label>
                      <input required value={form.company_name} onChange={e => setForm(f => ({...f, company_name: e.target.value}))}
                        className="w-full bg-muted/50 border-none rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-sn-green transition-all" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block text-sn-dark">Support Email Address</label>
                      <input required type="email" value={form.email_address} onChange={e => setForm(f => ({...f, email_address: e.target.value}))}
                        className="w-full bg-muted/50 border-none rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-sn-green transition-all" />
                    </div>
                    <div className="flex items-center gap-6 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={form.is_active === 1} onChange={e => setForm(f => ({...f, is_active: e.target.checked ? 1 : 0}))} className="hidden" />
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${form.is_active ? 'bg-sn-green border-sn-green' : 'border-muted-foreground'}`}>
                          {form.is_active === 1 && <Check className="w-3.5 h-3.5 text-sn-dark font-bold" />}
                        </div>
                        <span className="text-sm font-medium text-sn-dark">Active</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={form.is_default === 1} onChange={e => setForm(f => ({...f, is_default: e.target.checked ? 1 : 0}))} className="hidden" />
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${form.is_default ? 'bg-blue-500 border-blue-500' : 'border-muted-foreground'}`}>
                          {form.is_default === 1 && <Check className="w-3.5 h-3.5 text-white font-bold" />}
                        </div>
                        <span className="text-sm font-medium text-sn-dark">Set as Default</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Connection Settings */}
                <div className="space-y-6">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-sn-green flex items-center gap-2">
                    <Lock className="w-4 h-4" /> Security & Connection
                  </h3>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block text-sn-dark">Encryption Type</label>
                    <div className="grid grid-cols-3 gap-3">
                      {['TLS', 'SSL', 'None'].map(type => (
                        <button key={type} type="button" onClick={() => setForm(f => ({...f, encryption: type}))}
                          className={`py-2 rounded-lg text-sm font-bold border-2 transition-all ${form.encryption === type ? 'border-sn-green bg-sn-green/10 text-sn-green' : 'border-muted bg-muted/20 text-muted-foreground hover:bg-muted/40'}`}>
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* SMTP Config */}
                <div className="space-y-6 p-6 rounded-2xl bg-muted/20 border border-border/50">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-sn-dark flex items-center gap-2">
                    <Send className="w-4 h-4" /> SMTP Settings (Outbound)
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Host</label>
                      <input required value={form.smtp_host} onChange={e => setForm(f => ({...f, smtp_host: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Port</label>
                      <input required type="number" value={form.smtp_port} onChange={e => setForm(f => ({...f, smtp_port: parseInt(e.target.value)}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Username</label>
                      <input required value={form.smtp_user} onChange={e => setForm(f => ({...f, smtp_user: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Password / App Password</label>
                      <input required type="password" value={form.smtp_pass} onChange={e => setForm(f => ({...f, smtp_pass: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                  </div>
                </div>

                {/* IMAP Config */}
                <div className="space-y-6 p-6 rounded-2xl bg-muted/20 border border-border/50">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-sn-dark flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" /> IMAP Settings (Inbound)
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Host</label>
                      <input required value={form.imap_host} onChange={e => setForm(f => ({...f, imap_host: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Port</label>
                      <input required type="number" value={form.imap_port} onChange={e => setForm(f => ({...f, imap_port: parseInt(e.target.value)}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Username</label>
                      <input required value={form.imap_user} onChange={e => setForm(f => ({...f, imap_user: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Password / App Password</label>
                      <input required type="password" value={form.imap_pass} onChange={e => setForm(f => ({...f, imap_pass: e.target.value}))}
                        className="w-full bg-white border border-border/50 rounded-lg py-2 px-3 text-sm outline-none focus:ring-1 focus:ring-sn-green" />
                    </div>
                  </div>
                </div>
              </div>

              {testResult && (
                <div className={`p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-4 duration-300 ${testResult.success ? 'bg-sn-green/10 text-sn-green border border-sn-green/20' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                  {testResult.success ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <XCircle className="w-5 h-5 mt-0.5" />}
                  <div className="text-sm">
                    <p className="font-bold">{testResult.success ? "Success" : "Connection Failed"}</p>
                    <p className="opacity-80">{testResult.message}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-6 border-t border-border">
                <Button type="button" variant="ghost" onClick={handleTest} disabled={testing} className="text-blue-600 font-bold hover:bg-blue-50 gap-2">
                  <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} /> {testing ? "Testing..." : "Test Connection"}
                </Button>
                <div className="flex gap-4">
                  <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="rounded-xl px-8">Cancel</Button>
                  <Button type="submit" disabled={saving} className="bg-sn-green text-sn-dark font-bold rounded-xl px-12 hover:scale-105 transition-transform">
                    {saving ? "Saving..." : editingId ? "Update Integration" : "Save Integration"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
