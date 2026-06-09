import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Mail, Settings, Plus, Edit3, Eye, Trash2, Loader2, Save,
  ChevronDown, ChevronUp, RotateCw, BarChart3, Send,
} from "lucide-react";

interface Sequence { id: number; name: string; description: string; is_active: boolean; created_at: string }
interface Template { id: number; sequence_id: number; day_offset: number; sort_order: number; is_recurring: boolean; is_active: boolean; subject: string; body_html: string; body_text: string }
interface Overview { active: number; paused: number; stopped: number; unsubscribed: number; completed: number; total: number; sent: number; opened: number; clicked: number; bounced: number }
interface Settings { sender_name?: string; sender_email?: string; reply_to?: string }

export default function EmailSequencesPage() {
  const { toast } = useToast();
  const [selectedSeq, setSelectedSeq] = useState<Sequence | null>(null);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [newTemplate, setNewTemplate] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ day_offset: 0, sort_order: 99, subject: "", body_html: "", body_text: "", is_recurring: false });
  const [settingsForm, setSettingsForm] = useState<Settings>({});

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/admin/email-nurturing/overview"] });
  const { data: sequences = [], isLoading: seqLoading } = useQuery<Sequence[]>({ queryKey: ["/api/admin/email-nurturing/sequences"] });
  const { data: templates = [], isLoading: tmplLoading } = useQuery<Template[]>({
    queryKey: ["/api/admin/email-nurturing/sequences", selectedSeq?.id, "templates"],
    queryFn: async () => {
      if (!selectedSeq) return [];
      const r = await apiRequest("GET", `/api/admin/email-nurturing/sequences/${selectedSeq.id}/templates`);
      return r.json();
    },
    enabled: !!selectedSeq,
  });
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/admin/email-nurturing/settings"],
    enabled: settingsOpen,
  });

  const updateSeqMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/admin/email-nurturing/sequences/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/email-nurturing/sequences"] }); toast({ title: "Saved" }); },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (data: any) => editTemplate
      ? apiRequest("PUT", `/api/admin/email-nurturing/templates/${editTemplate.id}`, data)
      : apiRequest("POST", `/api/admin/email-nurturing/sequences/${selectedSeq!.id}/templates`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-nurturing/sequences", selectedSeq?.id, "templates"] });
      setEditTemplate(null); setNewTemplate(false);
      toast({ title: "Template saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/email-nurturing/templates/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/email-nurturing/sequences", selectedSeq?.id, "templates"] }); toast({ title: "Deleted" }); },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/admin/email-nurturing/settings", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/email-nurturing/settings"] }); setSettingsOpen(false); toast({ title: "Settings saved" }); },
  });

  function openEditTemplate(t: Template) {
    setEditTemplate(t);
    setTemplateForm({ day_offset: t.day_offset, sort_order: t.sort_order, subject: t.subject, body_html: t.body_html, body_text: t.body_text || "", is_recurring: t.is_recurring });
    setNewTemplate(false);
  }

  function openNewTemplate() {
    setEditTemplate(null);
    setTemplateForm({ day_offset: 0, sort_order: (templates.length + 1) * 10, subject: "", body_html: "", body_text: "", is_recurring: false });
    setNewTemplate(true);
  }

  const sent     = Number(overview?.sent     || 0);
  const opened   = Number(overview?.opened   || 0);
  const clicked  = Number(overview?.clicked  || 0);
  const bounced  = Number(overview?.bounced  || 0);
  const openRate   = sent > 0 ? Math.round(opened  / sent * 100) : 0;
  const clickRate  = sent > 0 ? Math.round(clicked / sent * 100) : 0;
  const bounceRate = sent > 0 ? Math.round(bounced / sent * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/20 rounded-xl"><Mail className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold">Email Nurturing Sequences</h1>
              <p className="text-white/75 text-sm mt-0.5">Manage automated email sequences for CRM leads</p>
            </div>
          </div>
          <Button variant="outline" className="border-white/40 text-white hover:bg-white/15 bg-transparent gap-2" onClick={() => { setSettingsForm(settings || {}); setSettingsOpen(true); }}>
            <Settings className="h-4 w-4" /> Settings
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Active",       value: overview?.active      || 0, color: "text-[#3bcac4]" },
            { label: "Paused",       value: overview?.paused      || 0, color: "text-amber-500" },
            { label: "Stopped",      value: overview?.stopped     || 0, color: "text-slate-500" },
            { label: "Completed",    value: overview?.completed   || 0, color: "text-green-600" },
            { label: "Open Rate",    value: `${openRate}%`,        color: "text-[#005476]" },
            { label: "Click Rate",   value: `${clickRate}%`,       color: "text-[#005476]" },
            { label: "Bounce Rate",  value: `${bounceRate}%`,      color: bounceRate > 5 ? "text-red-500" : "text-slate-500" },
          ].map(s => (
            <Card key={s.label} className="shadow-sm">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Send status notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm text-amber-800">
          <Send className="h-4 w-4 flex-shrink-0" />
          <span>Email sending is currently <strong>DISABLED</strong> by default. Set <code className="bg-amber-100 px-1 rounded">EMAIL_NURTURING_ENABLED=true</code> in environment secrets to activate real sending.</span>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Sequences list */}
          <div>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#005476]">Sequences</CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {seqLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" /></div>
                ) : sequences.map(seq => (
                  <div
                    key={seq.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedSeq?.id === seq.id ? "border-[#3bcac4] bg-[#3bcac4]/5" : "border-slate-200 hover:border-[#3bcac4]/50"}`}
                    onClick={() => setSelectedSeq(seq)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-[#005476] truncate">{seq.name}</p>
                        {seq.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{seq.description}</p>}
                      </div>
                      <Switch
                        checked={seq.is_active}
                        onCheckedChange={v => updateSeqMutation.mutate({ id: seq.id, data: { is_active: v } })}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Badge variant={seq.is_active ? "default" : "secondary"} className={`text-xs ${seq.is_active ? "bg-[#3bcac4] text-white" : ""}`}>
                        {seq.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Templates */}
          <div className="lg:col-span-2">
            {!selectedSeq ? (
              <Card className="shadow-sm h-full flex items-center justify-center">
                <CardContent className="text-center py-16 text-slate-400">
                  <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Select a sequence to view templates</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm">
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-base text-[#005476]">{selectedSeq.name} — Templates</CardTitle>
                  <Button size="sm" className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-1" onClick={openNewTemplate}>
                    <Plus className="h-4 w-4" /> Add Template
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {tmplLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" /></div>
                  ) : templates.length === 0 ? (
                    <p className="text-center py-8 text-slate-400 text-sm">No templates yet</p>
                  ) : (
                    <div className="divide-y">
                      {templates.map((t, i) => (
                        <div key={t.id} className="p-4 hover:bg-slate-50 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm text-[#005476] truncate">{t.subject}</p>
                                <Badge variant="outline" className="text-xs border-[#3bcac4]/40 text-[#3bcac4]">Day {t.day_offset}</Badge>
                                {t.is_recurring && <Badge className="text-xs bg-purple-100 text-purple-700 border border-purple-200">Recurring</Badge>}
                                <Badge variant={t.is_active ? "default" : "secondary"} className={`text-xs ${t.is_active ? "bg-green-100 text-green-700 border border-green-200" : ""}`}>
                                  {t.is_active ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                              {t.body_text && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{t.body_text}</p>}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-[#3bcac4]" onClick={() => setPreviewHtml(t.body_html)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-[#005476]" onClick={() => openEditTemplate(t)}>
                                <Edit3 className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteTemplateMutation.mutate(t.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Template editor dialog */}
      <Dialog open={!!(editTemplate || newTemplate)} onOpenChange={open => { if (!open) { setEditTemplate(null); setNewTemplate(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#005476]">{editTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Day Offset</Label>
                <Input type="number" min={0} value={templateForm.day_offset} onChange={e => setTemplateForm(f => ({ ...f, day_offset: parseInt(e.target.value) || 0 }))} />
                <p className="text-xs text-slate-400 mt-1">Days after sequence start to send this email</p>
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input type="number" min={1} value={templateForm.sort_order} onChange={e => setTemplateForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={templateForm.subject} onChange={e => setTemplateForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject — use {{firstName}} for personalization" />
            </div>
            <div>
              <Label>Plain Text (optional)</Label>
              <Textarea rows={3} value={templateForm.body_text} onChange={e => setTemplateForm(f => ({ ...f, body_text: e.target.value }))} placeholder="Plain text fallback" />
            </div>
            <div>
              <Label>HTML Body</Label>
              <p className="text-xs text-slate-400 mb-1">Variables: <code>{"{{firstName}}"}</code>, <code>{"{{unsubscribeUrl}}"}</code></p>
              <Textarea rows={14} className="font-mono text-xs" value={templateForm.body_html} onChange={e => setTemplateForm(f => ({ ...f, body_html: e.target.value }))} placeholder="Full HTML email body" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={templateForm.is_recurring} onCheckedChange={v => setTemplateForm(f => ({ ...f, is_recurring: v }))} />
              <Label>Recurring (repeats every 30 days after the sequence ends)</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setEditTemplate(null); setNewTemplate(false); }}>Cancel</Button>
              <Button
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-2"
                disabled={!templateForm.subject || !templateForm.body_html || saveTemplateMutation.isPending}
                onClick={() => saveTemplateMutation.mutate(templateForm)}
              >
                {saveTemplateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Save className="h-4 w-4" /> Save Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewHtml} onOpenChange={open => { if (!open) setPreviewHtml(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader><DialogTitle className="text-[#005476]">Email Preview</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden mt-2">
            <iframe
              srcDoc={previewHtml || ""}
              className="w-full h-[520px]"
              sandbox="allow-same-origin"
              title="Email preview"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-[#005476]">Email Sender Settings</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Sender Name</Label>
              <Input value={settingsForm.sender_name ?? (settings?.sender_name || "")} onChange={e => setSettingsForm(f => ({ ...f, sender_name: e.target.value }))} placeholder="Kinglike Luxury" />
            </div>
            <div>
              <Label>Sender Email</Label>
              <Input value={settingsForm.sender_email ?? (settings?.sender_email || "")} onChange={e => setSettingsForm(f => ({ ...f, sender_email: e.target.value }))} placeholder="info@kinglikeluxury.app" />
            </div>
            <div>
              <Label>Reply-To</Label>
              <Input value={settingsForm.reply_to ?? (settings?.reply_to || "")} onChange={e => setSettingsForm(f => ({ ...f, reply_to: e.target.value }))} placeholder="info@kinglikeluxury.app" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-2"
                disabled={saveSettingsMutation.isPending}
                onClick={() => saveSettingsMutation.mutate(settingsForm)}
              >
                {saveSettingsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Save className="h-4 w-4" /> Save Settings
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
