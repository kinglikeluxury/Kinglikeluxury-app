import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Search, Shield, ShieldOff, Trash2, Loader2,
  Phone, Mail, Facebook, MessageCircle, CheckCircle, XCircle, Crown
} from "lucide-react";
import type { User } from "@shared/schema";

const AUTH_ICON: Record<string, JSX.Element> = {
  email:     <Mail className="w-3.5 h-3.5" />,
  phone:     <Phone className="w-3.5 h-3.5" />,
  whatsapp:  <MessageCircle className="w-3.5 h-3.5 text-green-500" />,
  facebook:  <Facebook className="w-3.5 h-3.5 text-blue-500" />,
};

export default function AdminUsers() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users").then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    retry: false,
  });

  const toggleAdminMutation = useMutation({
    mutationFn: ({ id, isAdmin }: { id: number; isAdmin: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${id}`, { isAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phoneNumber || "").includes(q)
    );
  });

  const adminCount = users.filter(u => u.isAdmin).length;
  const verifiedCount = users.filter(u => u.isVerified).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
            <Users className="w-6 h-6" /> User Management
          </h1>
          <div className="flex flex-wrap gap-4 mt-3">
            <div className="bg-white/15 rounded-xl px-4 py-2 text-center">
              <p className="text-2xl font-bold">{users.length}</p>
              <p className="text-xs text-white/70">Total Users</p>
            </div>
            <div className="bg-white/15 rounded-xl px-4 py-2 text-center">
              <p className="text-2xl font-bold">{adminCount}</p>
              <p className="text-xs text-white/70">Admins</p>
            </div>
            <div className="bg-white/15 rounded-xl px-4 py-2 text-center">
              <p className="text-2xl font-bold">{verifiedCount}</p>
              <p className="text-xs text-white/70">Verified</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by username, email, or phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* User list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400">No users found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(user => (
              <div key={user.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{ background: user.isAdmin ? "linear-gradient(135deg,#f59e0b,#ef4444)" : "linear-gradient(135deg,#3bcac4,#005476)" }}
                  >
                    {user.isAdmin ? <Crown className="w-5 h-5" /> : user.username.substring(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-gray-900">{user.username}</span>
                      {user.isAdmin && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-700 font-bold">ADMIN</Badge>
                      )}
                      {user.isVerified ? (
                        <Badge className="text-[10px] bg-green-100 text-green-700 flex items-center gap-1">
                          <CheckCircle className="w-2.5 h-2.5" /> Verified
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-gray-100 text-gray-500 flex items-center gap-1">
                          <XCircle className="w-2.5 h-2.5" /> Unverified
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      {user.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {user.email}
                        </span>
                      )}
                      {user.phoneNumber && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {user.phoneNumber}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        {AUTH_ICON[user.authMethod] || <Mail className="w-3 h-3" />}
                        {user.authMethod}
                      </span>
                      <span className="text-gray-400">ID #{user.id}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleAdminMutation.mutate({ id: user.id, isAdmin: !user.isAdmin })}
                      disabled={toggleAdminMutation.isPending}
                      title={user.isAdmin ? "Remove admin" : "Make admin"}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        user.isAdmin
                          ? "bg-amber-100 text-amber-600 hover:bg-amber-200"
                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                    >
                      {user.isAdmin ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete user "${user.username}"? This cannot be undone.`)) {
                          deleteUserMutation.mutate(user.id);
                        }
                      }}
                      disabled={deleteUserMutation.isPending}
                      title="Delete user"
                      className="w-9 h-9 rounded-full flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
