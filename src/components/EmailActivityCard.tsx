import React, { useState } from "react";
import { Mail, Clock, ChevronDown, ChevronUp, CheckCircle2, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmailActivityCardProps {
  activity: any;
  formatDate: (date: any) => string;
}

export function EmailActivityCard({ activity, formatDate }: EmailActivityCardProps) {
  const [expanded, setExpanded] = useState(false);

  let metadata: any = {};
  try {
    metadata = typeof activity.metadata_json === "string" ? JSON.parse(activity.metadata_json) : (activity.metadata_json || {});
  } catch (e) { }

  const isSent = activity.activity_type === "email_sent";
  const recipients = Array.isArray(metadata.to) ? metadata.to.join(", ") : (metadata.to || "System");

  return (
    <div className="relative pl-6 pb-6 last:pb-0 border-l border-border ml-2 group">
      <div className={cn(
        "absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center transition-transform group-hover:scale-110",
        isSent ? "bg-purple-500" : "bg-indigo-500"
      )}>
        <Mail className="w-2.5 h-2.5 text-white" />
      </div>
      <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-purple-100 bg-purple-50/30 shadow-sm transition-all hover:shadow-md hover:bg-purple-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-sn-dark">{isSent ? "Email Sent" : "Email Received"}</span>
            <span className={cn(
              "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider",
              isSent ? "bg-purple-100 text-purple-700" : "bg-indigo-100 text-indigo-700"
            )}>
              {isSent ? "Outbound" : "Inbound"}
            </span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="text-[10px]">{formatDate(activity.created_at)}</span>
          </div>
        </div>

        <div className="text-xs font-semibold text-sn-dark mt-1">
          Subject: {metadata.subject || activity.message}
        </div>

        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <span>From: <span className="font-medium text-sn-dark">{metadata.from || activity.created_by_name}</span></span>
          <span>&bull;</span>
          <span>To: <span className="font-medium text-sn-dark">{recipients}</span></span>
        </div>

        {metadata.attachments && metadata.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {metadata.attachments.map((att: any, i: number) => (
              <a
                key={i}
                href={att.url || "#"}
                target={att.url ? "_blank" : undefined}
                rel={att.url ? "noreferrer" : undefined}
                className="flex items-center gap-1.5 text-[11px] bg-white border border-purple-100 rounded-md px-2 py-1 text-sn-dark hover:bg-purple-50 transition-colors"
                onClick={(e) => { if (!att.url) e.preventDefault(); }}
              >
                <Paperclip className="w-3 h-3 text-muted-foreground" />
                {att.name}
              </a>
            ))}
          </div>
        )}

        {metadata.status === "delivered" && (
          <div className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
            <CheckCircle2 className="w-3 h-3" /> Delivered
          </div>
        )}

        <div className="mt-2 border-t border-purple-100 pt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-600 hover:text-purple-800 transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="w-3 h-3" /> Hide email details</>
            ) : (
              <><ChevronDown className="w-3 h-3" /> Show email details</>
            )}
          </button>

          {expanded && (
            <div className="mt-3 p-3 bg-white border border-purple-100 rounded text-xs text-sn-dark overflow-auto max-h-[300px] whitespace-pre-wrap font-sans leading-relaxed">
              {metadata.body || activity.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
