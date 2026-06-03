import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ShieldAlert, ShieldCheck, ShieldX, Ban, Loader2,
  RefreshCw, Trash2, AlertTriangle, CheckCircle2,
  MessageCircle, Smartphone, Mail,
} from 'lucide-react';

interface OtpLogEntry {
  id: number;
  timestamp: string;
  type: 'sms' | 'email' | 'reset';
  identifier: string;
  ip: string;
  result: 'sent' | 'phone_rate_limited' | 'ip_rate_limited' | 'ip_blocked' | 'captcha_failed' | 'error';
  method?: 'whatsapp' | 'sms';
  userAgent: string;
}

interface OtpLogsResponse {
  logs: OtpLogEntry[];
  blockedIPs: string[];
}

function ResultBadge({ result }: { result: OtpLogEntry['result'] }) {
  switch (result) {
    case 'sent':
      return <Badge className="bg-green-100 text-green-700 border-0 text-xs">✓ Sent</Badge>;
    case 'ip_blocked':
      return <Badge className="bg-red-100 text-red-700 border-0 text-xs">IP Blocked</Badge>;
    case 'ip_rate_limited':
      return <Badge className="bg-orange-100 text-orange-700 border-0 text-xs">IP Limit</Badge>;
    case 'phone_rate_limited':
      return <Badge className="bg-yellow-100 text-yellow-700 border-0 text-xs">Phone Limit</Badge>;
    case 'captcha_failed':
      return <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">CAPTCHA Fail</Badge>;
    case 'error':
      return <Badge className="bg-gray-100 text-gray-600 border-0 text-xs">Error</Badge>;
    default:
      return <Badge className="bg-gray-100 text-gray-600 border-0 text-xs">{result}</Badge>;
  }
}

function TypeIcon({ type, method }: { type: OtpLogEntry['type']; method?: string }) {
  if (type === 'email') return <Mail className="w-3.5 h-3.5 text-purple-500" />;
  if (method === 'whatsapp') return <MessageCircle className="w-3.5 h-3.5 text-green-500" />;
  return <Smartphone className="w-3.5 h-3.5 text-blue-500" />;
}

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}

export default function OtpLogsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [blockInput, setBlockInput] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || !(user as any).isAdmin)) navigate('/');
  }, [user, authLoading, navigate]);

  const { data, isLoading, refetch, isFetching } = useQuery<OtpLogsResponse>({
    queryKey: ['/api/admin/otp-logs'],
    enabled: !!(user as any)?.isAdmin,
    refetchInterval: 30_000,
  });

  const blockMutation = useMutation({
    mutationFn: async (ip: string) => {
      const res = await apiRequest('POST', '/api/admin/otp-block', { ip });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/otp-logs'] });
      toast({ title: 'IP blocked successfully' });
      setBlockInput('');
    },
    onError: (e: Error) =>
      toast({ title: 'Failed to block IP', description: e.message, variant: 'destructive' }),
  });

  const unblockMutation = useMutation({
    mutationFn: async (ip: string) => {
      const res = await apiRequest('DELETE', `/api/admin/otp-block/${encodeURIComponent(ip)}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/otp-logs'] });
      toast({ title: 'IP unblocked' });
    },
    onError: (e: Error) =>
      toast({ title: 'Failed to unblock IP', description: e.message, variant: 'destructive' }),
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#3bcac4]" />
      </div>
    );
  }
  if (!(user as any)?.isAdmin) return null;

  const logs = data?.logs || [];
  const blockedIPs = data?.blockedIPs || [];

  const stats = {
    total: logs.length,
    sent: logs.filter(l => l.result === 'sent').length,
    blocked: logs.filter(l => l.result === 'ip_blocked').length,
    rateLimited: logs.filter(l => l.result === 'ip_rate_limited' || l.result === 'phone_rate_limited').length,
    captchaFailed: logs.filter(l => l.result === 'captcha_failed').length,
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-[#3bcac4]/10 to-[#005476]/10">
              <ShieldAlert className="w-6 h-6 text-[#005476]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#005476]">OTP Security Logs</h1>
              <p className="text-xs text-muted-foreground">Logs reset on server restart · auto-refreshes every 30s</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-[#3bcac4]/10 to-[#005476]/5">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-[#005476]">{stats.total}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Requests</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-green-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Sent OK</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-red-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.blocked}</div>
              <div className="text-xs text-muted-foreground mt-0.5">IP Blocked</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-orange-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.rateLimited}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Rate Limited</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-purple-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.captchaFailed}</div>
              <div className="text-xs text-muted-foreground mt-0.5">CAPTCHA Fail</div>
            </CardContent>
          </Card>
        </div>

        {/* Blocked IPs */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-[#005476]">
              <Ban className="w-4 h-4" />
              Blocked IPs
              {blockedIPs.length > 0 && (
                <Badge className="bg-red-100 text-red-700 border-0 ml-1">{blockedIPs.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Manual block form */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter IP address to block (e.g. 1.2.3.4)"
                value={blockInput}
                onChange={e => setBlockInput(e.target.value)}
                className="text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter' && blockInput.trim()) blockMutation.mutate(blockInput.trim());
                }}
              />
              <Button
                size="sm"
                onClick={() => blockInput.trim() && blockMutation.mutate(blockInput.trim())}
                disabled={!blockInput.trim() || blockMutation.isPending}
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476] shrink-0"
              >
                {blockMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              </Button>
            </div>

            {/* IP list */}
            {blockedIPs.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                No blocked IPs — network looks clean.
              </div>
            ) : (
              <div className="space-y-1.5">
                {blockedIPs.map(ip => (
                  <div key={ip} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ShieldX className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      <span className="text-sm font-mono text-red-700">{ip}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-100"
                      onClick={() => unblockMutation.mutate(ip)}
                      disabled={unblockMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3 mr-1" /> Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* OTP Request Log Table */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-[#005476]">
              <AlertTriangle className="w-4 h-4" />
              Recent OTP Requests
              <span className="text-xs font-normal text-muted-foreground ml-1">
                (last {Math.min(logs.length, 500)}, newest first)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {logs.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                No OTP requests recorded since the server started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Channel</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Identifier</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">IP</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(entry => (
                      <tr
                        key={entry.id}
                        className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${
                          entry.result === 'ip_blocked' ? 'bg-red-50/50' :
                          entry.result === 'captcha_failed' ? 'bg-purple-50/50' :
                          entry.result.includes('rate_limited') ? 'bg-orange-50/50' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                          {formatTime(entry.timestamp)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <TypeIcon type={entry.type} method={entry.method} />
                            <span className="text-muted-foreground capitalize">
                              {entry.method || entry.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono">{entry.identifier}</td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            {entry.ip}
                            {blockedIPs.includes(entry.ip) && (
                              <ShieldX className="w-3 h-3 text-red-500 shrink-0" />
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <ResultBadge result={entry.result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
