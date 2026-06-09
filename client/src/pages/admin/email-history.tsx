import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Search, Eye, CheckCircle2, XCircle, MousePointerClick, AlertCircle, Loader2, ChevronLeft, ChevronRight, User } from "lucide-react";

interface EmailEvent {
  id: number; lead_id: number; event_type: string; subject: string; body_html: string;
  recipient_email: string; created_at: string; full_name: string; lead_email: string;
  phone: string; opened: boolean; clicked: boolean; bounced: boolean;
}

interface PageResult { rows: EmailEvent[]; total: number }

const PAGE_SIZE = 50;

export default function EmailHistoryPage() {
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [page, setPage]         = useState(1);
  const [viewEvent, setViewEvent] = useState<EmailEvent | null>(null);

  const { data, isLoading } = useQuery<PageResult>({
    queryKey: ["/api/admin/email-nurturing/history", search, status, dateFrom, dateTo, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search)   params.set("search",   search);
      if (status)   params.set("status",   status);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo)   params.set("dateTo",   dateTo);
      const r = await apiRequest("GET", `/api/admin/email-nurturing/history?${params}`);
      return r.json();
    },
  });

  const rows  = data?.rows  || [];
  const total = data?.total || 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  function applyFilters() { setPage(1); queryClient.invalidateQueries({ queryKey: ["/api/admin/email-nurturing/history"] }); }

  function statusBadge(ev: EmailEvent) {
    if (ev.bounced)  return <Badge className="text-xs bg-red-100 text-red-700 border border-red-200">Bounced</Badge>;
    if (ev.clicked)  return <Badge className="text-xs bg-purple-100 text-purple-700 border border-purple-200">Clicked</Badge>;
    if (ev.opened)   return <Badge className="text-xs bg-green-100 text-green-700 border border-green-200">Opened</Badge>;
    if (ev.event_type === "email_failed") return <Badge className="text-xs bg-red-100 text-red-600 border border-red-200">Failed</Badge>;
    if (ev.event_type === "email_skipped_disabled") return <Badge className="text-xs bg-amber-100 text-amber-700 border border-amber-200">Simulated</Badge>;
    return <Badge className="text-xs bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30">Sent</Badge>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="p-2.5 bg-white/20 rounded-xl"><Mail className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-bold">Email History</h1>
            <p className="text-white/75 text-sm mt-0.5">View all emails sent to CRM leads — {total.toLocaleString()} records</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* Filters */}
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="relative lg:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input className="pl-9" placeholder="Search by name, email, phone…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
              </div>
              <Select value={status} onValueChange={v => { setStatus(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="opened">Opened</SelectItem>
                  <SelectItem value="not_opened">Not Opened</SelectItem>
                  <SelectItem value="clicked">Link Clicked</SelectItem>
                  <SelectItem value="bounced">Bounced</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} placeholder="From date" />
              <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} placeholder="To date" />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No emails found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Lead</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Sent</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Engagement</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(ev => (
                    <tr key={ev.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#3bcac4]/10 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-[#3bcac4]" />
                          </div>
                          <div>
                            <p className="font-medium text-[#005476] text-xs">{ev.full_name || "—"}</p>
                            <p className="text-xs text-slate-400">{ev.recipient_email || ev.lead_email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <p className="truncate text-slate-700">{ev.subject || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-4 py-3">{statusBadge(ev)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {ev.opened  && <span title="Opened"  className="text-green-500"><CheckCircle2 className="h-4 w-4" /></span>}
                          {ev.clicked && <span title="Clicked" className="text-purple-500"><MousePointerClick className="h-4 w-4" /></span>}
                          {ev.bounced && <span title="Bounced" className="text-red-400"><AlertCircle className="h-4 w-4" /></span>}
                          {!ev.opened && !ev.clicked && !ev.bounced && <span className="text-slate-200">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-[#3bcac4]" title="View email content" onClick={() => setViewEvent(ev)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-slate-500">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</p>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="flex items-center px-3 text-xs text-slate-500">{page} / {pages}</span>
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Email content viewer */}
      <Dialog open={!!viewEvent} onOpenChange={open => { if (!open) setViewEvent(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#005476]">
              Email Preview — {viewEvent?.full_name || viewEvent?.recipient_email}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {/* Metadata panel */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
              <div className="flex gap-2 px-3 py-2">
                <span className="font-semibold text-slate-500 w-16 shrink-0">To</span>
                <span className="text-slate-700">{viewEvent?.recipient_email || "—"}</span>
              </div>
              <div className="flex gap-2 px-3 py-2">
                <span className="font-semibold text-slate-500 w-16 shrink-0">Subject</span>
                <span className="text-slate-700 font-medium">{viewEvent?.subject || "—"}</span>
              </div>
              <div className="flex gap-2 px-3 py-2">
                <span className="font-semibold text-slate-500 w-16 shrink-0">Sent</span>
                <span className="text-slate-700">
                  {viewEvent?.created_at ? new Date(viewEvent.created_at).toLocaleString("en-US", {
                    dateStyle: "medium", timeStyle: "short"
                  }) : "—"}
                </span>
              </div>
              {/* Extract CTA link from HTML */}
              {viewEvent?.body_html && (() => {
                const match = viewEvent.body_html.match(/href="(https?:\/\/[^"]+)"/);
                const ctaUrl = match?.[1] || null;
                return ctaUrl ? (
                  <div className="flex gap-2 px-3 py-2">
                    <span className="font-semibold text-slate-500 w-16 shrink-0">CTA</span>
                    <a
                      href={ctaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#3bcac4] underline underline-offset-2 truncate max-w-[360px]"
                    >
                      {ctaUrl}
                    </a>
                  </div>
                ) : null;
              })()}
              {/* Status badges */}
              <div className="flex gap-2 px-3 py-2 items-center">
                <span className="font-semibold text-slate-500 w-16 shrink-0">Status</span>
                <div className="flex gap-1.5 flex-wrap">
                  {viewEvent?.opened  && <Badge className="text-xs bg-green-100 text-green-700 border border-green-200">Opened</Badge>}
                  {viewEvent?.clicked && <Badge className="text-xs bg-purple-100 text-purple-700 border border-purple-200">Link Clicked</Badge>}
                  {viewEvent?.bounced && <Badge className="text-xs bg-red-100 text-red-700 border border-red-200">Bounced</Badge>}
                  {!viewEvent?.opened && !viewEvent?.clicked && !viewEvent?.bounced && (
                    <span className="text-slate-400 italic">No engagement yet</span>
                  )}
                </div>
              </div>
            </div>

            {/* Full email body */}
            {viewEvent?.body_html ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500 font-medium">
                  Email Body Preview
                </div>
                <iframe
                  srcDoc={viewEvent.body_html}
                  className="w-full h-[500px]"
                  sandbox="allow-same-origin"
                  title="Email content"
                />
              </div>
            ) : (
              <p className="text-slate-400 text-sm text-center py-8">No HTML content available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
