import React from "react";
import { MessageSquare, Lock, Globe, Clock, Paperclip, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActivityCardProps {
  activity: any;
  formatDate: (date: any) => string;
}

export function ActivityCard({ activity, formatDate }: ActivityCardProps) {
  const isInternal = activity.visibility_type === 'internal' || activity.activity_type === 'work_note';
  
  let metadata: any = {};
  try {
    metadata = typeof activity.metadata_json === 'string' ? JSON.parse(activity.metadata_json) : (activity.metadata_json || {});
  } catch (e) { }

  // Generate initials from name
  const getInitials = (name: string) => {
    if (!name) return 'SY';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div className="relative pl-6 pb-4 last:pb-0 border-l-2 ml-2 group transition-all"
         style={{ borderColor: isInternal ? '#f59e0b' : '#3b82f6' }}>
      {/* Timeline Node */}
      <div className={cn(
        "absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm",
        isInternal ? "bg-amber-400" : "bg-blue-500"
      )}>
        {isInternal ? (
          <Lock className="w-2 h-2 text-white" />
        ) : (
          <Globe className="w-2 h-2 text-white" />
        )}
      </div>
      
      {/* Card */}
      <div className={cn(
        "flex flex-col gap-2 p-3.5 rounded-lg border shadow-sm transition-all duration-200 hover:shadow-md",
        isInternal 
          ? "bg-gradient-to-br from-amber-50 to-yellow-50/50 border-amber-200 hover:border-amber-300" 
          : "bg-white border-slate-200 hover:border-blue-200"
      )}>
        {/* Header Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* User Avatar */}
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 shadow-sm",
              isInternal ? "bg-amber-500" : "bg-blue-600"
            )}>
              {getInitials(activity.created_by_name)}
            </div>
            {/* Name + Badge */}
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[12px] font-bold text-sn-dark truncate">{activity.created_by_name || 'System'}</span>
              <span className={cn(
                "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 flex-shrink-0",
                isInternal 
                  ? "bg-amber-100 text-amber-800 border border-amber-200" 
                  : "bg-blue-100 text-blue-800 border border-blue-200"
              )}>
                {isInternal ? (
                  <>
                    <Lock className="w-2.5 h-2.5" />
                    Work Note · Internal
                  </>
                ) : (
                  <>
                    <Globe className="w-2.5 h-2.5" />
                    Customer Visible
                  </>
                )}
              </span>
            </div>
          </div>
          {/* Timestamp */}
          <div className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
            <Clock className="w-3 h-3" />
            <span className="text-[10px] font-medium">{formatDate(activity.created_at)}</span>
          </div>
        </div>
        
        {/* Message Body */}
        <div className={cn(
          "p-3 rounded-md text-xs whitespace-pre-wrap leading-relaxed",
          isInternal 
            ? "bg-amber-50/70 text-sn-dark border border-amber-100" 
            : "bg-slate-50 text-sn-dark border border-slate-100"
        )}>
          {activity.message}
        </div>

        {/* Attachments */}
        {metadata.attachments && metadata.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {metadata.attachments.map((att: any, i: number) => (
              <a
                key={i}
                href={att.url || "#"}
                target={att.url ? "_blank" : undefined}
                rel={att.url ? "noreferrer" : undefined}
                className="flex items-center gap-1.5 text-[11px] bg-muted/30 border border-border rounded-md px-2.5 py-1.5 text-sn-dark hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={(e) => { if (!att.url) e.preventDefault(); }}
              >
                <Paperclip className="w-3 h-3 text-muted-foreground" />
                {att.name}
              </a>
            ))}
          </div>
        )}

        {/* Privacy Footer for Internal Notes */}
        {isInternal && (
          <div className="flex items-center gap-1.5 mt-1 pt-2 border-t border-amber-100">
            <Shield className="w-3 h-3 text-amber-500" />
            <span className="text-[9px] text-amber-600 font-semibold uppercase tracking-wider">Private · Not visible to customer</span>
          </div>
        )}
      </div>
    </div>
  );
}
