import React, { useState } from "react";
import { doc, setDoc, serverTimestamp, getDocs, collection, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Link, useNavigate } from "react-router-dom";
import { ROLE_LABELS, type Role } from "../lib/roles";
import { Crown, Shield, UserCog, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

// Local Button component
const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' }>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: "bg-sn-green text-sn-dark hover:bg-sn-green/90 shadow-md",
      outline: "border-2 border-border bg-transparent hover:bg-muted/50 text-foreground",
      ghost: "bg-transparent hover:bg-muted/50 text-muted-foreground"
    };
    return (
      <button
        ref={ref}
        className={cn(
          "px-4 py-2 rounded-lg font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// Same hash function as Register
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + str.length;
}

export function Login() {
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [error, setError]           = useState("");
  const [isLoading, setIsLoading]   = useState(false);
  const navigate = useNavigate();

  /* ── Demo login removed for production ─────────────────── */

  /* ── Email/password login (Firestore-based) ────────────── */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) { setError("Please enter email and password."); return; }
    setError("");
    setIsLoading(true);
    try {
      // Primary: Try backend API (which checks SQLite and has fallback logic)
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ email, password })
      });

      if (response.ok) {
        const userData = await response.json();
        
        // Save to localStorage
        localStorage.setItem("demo_user", JSON.stringify({
          uid: userData.uid,
          name: userData.name,
          email: userData.email,
          role: userData.role || "user",
          phone: userData.phone || ""
        }));

        window.location.href = "/";
        return;
      }

      // Secondary: Try Firestore direct (Original logic as backup)
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email.toLowerCase().trim()));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        if (userData.passwordHash === simpleHash(password)) {
          localStorage.setItem("demo_user", JSON.stringify({
            uid: userData.uid || userDoc.id,
            name: userData.name,
            email: userData.email,
            role: userData.role || "user",
            phone: userData.phone || ""
          }));
          window.location.href = "/";
          return;
        }
      }

      const errorData = await response.json().catch(() => ({}));
      setError(errorData.error || "Invalid email or password.");
      
    } catch (err: any) {
      console.error("Login error:", err);
      setError("Login failed: Check your connection and try again.");
    } finally { setIsLoading(false); }
  };


  return (
    <div className="min-h-screen flex items-center justify-center bg-sn-dark p-4">
      <div className="w-full max-w-4xl flex gap-6 items-start">

        {/* ── Login Form ── */}
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden mx-auto">
          <div className="bg-sn-sidebar p-8 text-white text-center">
            <div className="w-16 h-16 bg-sn-green rounded-xl flex items-center justify-center font-bold text-3xl text-sn-dark mx-auto mb-4 shadow-lg">C</div>
            <h1 className="text-2xl font-bold">Connect IT</h1>
            <p className="text-white/60 text-sm mt-2">Employee Portal Sign In</p>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100">{error}</div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full p-3 border border-border rounded-lg focus:ring-2 focus:ring-sn-green outline-none"
                placeholder="name@company.com" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full p-3 border border-border rounded-lg focus:ring-2 focus:ring-sn-green outline-none"
                placeholder="••••••••" />
            </div>

            <Button type="submit" disabled={isLoading}
              className="w-full py-6 bg-sn-green text-sn-dark font-bold text-base hover:bg-sn-green/90 disabled:opacity-50">
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>

            <div className="pt-6 border-t border-border mt-6">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 text-center">Quick Access Roles</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { role: "ultra_super_admin", label: "Ulter Super Admin", icon: Crown, color: "text-yellow-600 bg-yellow-50 border-yellow-100", email: "arun@technosprint.net" },
                  { role: "super_admin", label: "Super Admin", icon: Shield, color: "text-red-600 bg-red-50 border-red-100", email: "ulter@technosprint.net" },
                  { role: "admin", label: "Administrator", icon: UserCog, color: "text-orange-600 bg-orange-50 border-orange-100", email: "admin@technosprint.net" },
                  { role: "agent", label: "Support Agent", icon: Eye, color: "text-blue-600 bg-blue-50 border-blue-100", email: "agent@technosprint.net" },
                ].map((demo) => (
                  <button
                    key={demo.role}
                    type="button"
                    onClick={() => {
                      setEmail(demo.email);
                      setPassword("Password123!");
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center p-3 rounded-xl border transition-all hover:scale-105 active:scale-95",
                      demo.color
                    )}
                  >
                    <demo.icon className="w-5 h-5 mb-1" />
                    <span className="text-[10px] font-bold">{demo.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-4">
              No account? <Link to="/register" className="text-sn-green font-bold hover:underline">Register</Link>
            </p>
          </form>

        </div>
      </div>
    </div>
  );
}
