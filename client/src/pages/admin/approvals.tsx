import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Property, PROPERTY_STATUS } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Eye, CreditCard, AlertTriangle, Star, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const COMMISSION_RATE = 0.03;

const generateCommissionPDF = async (property: Property) => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  const teal = [59, 202, 196] as [number, number, number];
  const navy = [0, 84, 118] as [number, number, number];

  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, 35, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("KINGLIKE LUXURY REAL ESTATE", pageW / 2, 14, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("COMMISSION AGREEMENT — OFFICIAL DOCUMENT", pageW / 2, 24, { align: "center" });

  doc.setFillColor(...teal);
  doc.rect(0, 35, pageW, 3, "F");

  let y = 50;
  doc.setTextColor(0, 0, 0);

  const section = (title: string) => {
    doc.setFillColor(240, 248, 255);
    doc.rect(10, y - 5, pageW - 20, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(title, 14, y + 1);
    doc.setTextColor(0, 0, 0);
    y += 12;
  };

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label + ":", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 70, y);
    y += 8;
  };

  section("PROPERTY DETAILS");
  row("Property ID", String(property.id));
  row("Title", property.title);
  row("Type", property.propertyType.charAt(0).toUpperCase() + property.propertyType.slice(1));
  row("Location", property.location);
  row("Status", property.status);
  y += 4;

  const listedPrice = (property as any).userListedPrice || property.price;
  const commission = Math.round(listedPrice * COMMISSION_RATE);
  const netAmount = listedPrice - commission;
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

  section("COMMISSION BREAKDOWN");
  row("Listed Price (Owner's Price)", fmt(listedPrice));
  row("Platform Commission (3%)", fmt(commission));
  row("Net Amount to Owner", fmt(netAmount));
  y += 4;

  section("AGREEMENT DETAILS");
  const sig = (property as any).commissionSignature || "N/A";
  const acceptedAt = (property as any).commissionAcceptedAt
    ? new Date((property as any).commissionAcceptedAt).toLocaleString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit"
      })
    : "N/A";
  row("Owner Electronic Signature", sig);
  row("Agreement Accepted At", acceptedAt);
  row("Commission Rate", "3% of sale price");
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  const legalLines = [
    "The owner has agreed to pay Kinglike Luxury Real Estate a commission of 3% of the final",
    "transaction price upon successful sale, lease, or transfer of the listed property.",
    "This agreement was electronically signed and is legally binding.",
  ];
  legalLines.forEach(line => { doc.text(line, 14, y); y += 6; });

  y += 10;
  doc.setFillColor(...teal);
  doc.rect(10, y, (pageW - 20) / 2 - 5, 0.5, "F");
  doc.rect(pageW / 2 + 5, y, (pageW - 20) / 2 - 5, 0.5, "F");
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text("Platform Authorized Signature:", 14, y);
  doc.text("Owner Electronic Signature:", pageW / 2 + 5, y);
  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(12);
  doc.setTextColor(...teal);
  doc.text("Kinglike Luxury Real Estate", 14, y);
  doc.text(sig, pageW / 2 + 5, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("Pre-signed electronically — Management Team", 14, y);
  doc.text(acceptedAt, pageW / 2 + 5, y);

  doc.setFillColor(...navy);
  doc.rect(0, doc.internal.pageSize.getHeight() - 12, pageW, 12, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(
    "Kinglike Luxury Real Estate | Confidential Commission Agreement",
    pageW / 2,
    doc.internal.pageSize.getHeight() - 4,
    { align: "center" }
  );

  doc.save(`commission-agreement-property-${property.id}.pdf`);
};

const Approvals = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openPropertyId, setOpenPropertyId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [refundPayment, setRefundPayment] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [currentTab, setCurrentTab] = useState("pending");

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  const { data: properties, isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ['/api/properties?status=all'],
    enabled: !!user?.isAdmin,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await apiRequest("PATCH", `/api/properties/${id}/status`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties?status=all'] });
      setOpenPropertyId(null);
      setRejectionReason("");
      setRefundPayment(false);
    },
  });

  const topRatedMutation = useMutation({
    mutationFn: async ({ id, topRated }: { id: number; topRated: boolean }) => {
      const response = await apiRequest("PATCH", `/api/properties/${id}/top-rated`, { topRated });
      return response.json();
    },
    onSuccess: (_, { topRated }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties?status=all'] });
      toast({
        title: topRated ? "Top Rated ★ Enabled" : "Top Rated Removed",
        description: topRated ? "Property marked as Top Rated." : "Top Rated badge removed.",
      });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Failed", description: "Could not update Top Rated status." });
    },
  });

  const handleApprove = (id: number) => {
    updateStatusMutation.mutate(
      { id, status: PROPERTY_STATUS.APPROVED },
      {
        onSuccess: () => {
          toast({
            title: "Property Approved",
            description: "The property has been approved and is now visible to users.",
          });
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Approval Failed",
            description: `Failed to approve property: ${error}`,
          });
        },
      }
    );
  };

  const handleReject = async (id: number) => {
    if (refundPayment) {
      setIsRefunding(true);
      try {
        const refundRes = await apiRequest("POST", `/api/bog/refund/${id}`, {});
        const refundData = await refundRes.json();
        if (!refundRes.ok) {
          toast({
            variant: "destructive",
            title: "Refund Warning",
            description: refundData.message || "Could not process refund, but property will be rejected.",
          });
        } else {
          toast({
            title: "Refund Initiated",
            description: `$${refundData.refundedAmount} refund sent to the user's bank account.`,
          });
        }
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Refund Error",
          description: "Refund request failed. Property will still be rejected.",
        });
      } finally {
        setIsRefunding(false);
      }
    }

    updateStatusMutation.mutate(
      { id, status: PROPERTY_STATUS.REJECTED },
      {
        onSuccess: () => {
          toast({
            title: "Property Rejected",
            description: "The property has been rejected.",
          });
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Rejection Failed",
            description: `Failed to reject property: ${error}`,
          });
        },
      }
    );
  };

  const openRejectDialog = (id: number) => {
    setOpenPropertyId(id);
    setRejectionReason("");
    setRefundPayment(false);
  };

  if (authLoading || propertiesLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-12 w-full mb-6" />
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return null;
  }

  const filteredProperties = properties?.filter(p => {
    if (currentTab === "pending") return p.status === PROPERTY_STATUS.PENDING;
    if (currentTab === "approved") return p.status === PROPERTY_STATUS.APPROVED;
    if (currentTab === "rejected") return p.status === PROPERTY_STATUS.REJECTED;
    return true;
  }) || [];

  const getPropertyById = (id: number) => properties?.find(p => p.id === id);

  const isPaidProperty = (property: Property) =>
    property.listingType === "vip" || property.listingType === "super_vip";

  const openProperty = openPropertyId ? getPropertyById(openPropertyId) : null;

  return (
    <div className="p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Property Approvals</h1>
          <p className="text-gray-600 mt-1">
            Manage property submissions — approve or reject user-submitted properties
          </p>
        </div>

        <Tabs value={currentTab} onValueChange={setCurrentTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="pending">
              Pending
              <Badge variant="outline" className="ml-2 bg-yellow-100 text-yellow-800 border-yellow-300">
                {properties?.filter(p => p.status === PROPERTY_STATUS.PENDING).length || 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <Card>
            <CardHeader>
              <CardTitle>
                {currentTab === "pending" && "Pending Approvals"}
                {currentTab === "approved" && "Approved Properties"}
                {currentTab === "rejected" && "Rejected Properties"}
              </CardTitle>
              <CardDescription>
                {currentTab === "pending" && "Properties submitted by users awaiting your approval"}
                {currentTab === "approved" && "Properties that have been approved and are visible to users"}
                {currentTab === "rejected" && "Properties that have been rejected"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredProperties.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProperties.map((property) => (
                      <TableRow key={property.id}>
                        <TableCell>{property.id}</TableCell>
                        <TableCell className="font-medium">{property.title}</TableCell>
                        <TableCell className="capitalize">{property.propertyType}</TableCell>
                        <TableCell>{property.location}</TableCell>
                        <TableCell>${property.price.toLocaleString()}</TableCell>
                        <TableCell>
                          {isPaidProperty(property) ? (
                            <Badge className="bg-green-100 text-green-700 border-green-300 gap-1">
                              <CreditCard className="w-3 h-3" />
                              PAID
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-400">Free</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2 flex-wrap gap-1">
                            <Button size="sm" variant="outline" asChild>
                              <a href={`/property/${property.id}`} target="_blank" rel="noopener noreferrer">
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </a>
                            </Button>

                            {(property as any).commissionAccepted && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-[#005476]/10 text-[#005476] border-[#005476]/30 hover:bg-[#005476]/20"
                                onClick={() => generateCommissionPDF(property)}
                                title="Download Commission Agreement PDF"
                              >
                                <FileText className="h-4 w-4 mr-1" />
                                PDF
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              title={property.topRated ? "Remove Top Rated" : "Mark as Top Rated"}
                              className={property.topRated
                                ? "bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4] hover:bg-[#3bcac4]/20"
                                : "text-gray-400 hover:text-[#005476] hover:border-[#3bcac4]"}
                              onClick={() => topRatedMutation.mutate({ id: property.id, topRated: !property.topRated })}
                              disabled={topRatedMutation.isPending}
                            >
                              <Star className={`h-4 w-4 ${property.topRated ? "fill-[#3bcac4]" : ""}`} />
                            </Button>

                            {currentTab === "pending" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200"
                                  onClick={() => handleApprove(property.id)}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Approve
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-red-200"
                                  onClick={() => openRejectDialog(property.id)}
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  Reject
                                </Button>
                              </>
                            )}

                            {currentTab === "rejected" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 border-green-200"
                                onClick={() => handleApprove(property.id)}
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approve
                              </Button>
                            )}

                            {currentTab === "approved" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-red-200"
                                onClick={() => openRejectDialog(property.id)}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Reject
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">
                    {currentTab === "pending" && "No properties pending approval at the moment."}
                    {currentTab === "approved" && "No approved properties found."}
                    {currentTab === "rejected" && "No rejected properties found."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </Tabs>

        {/* Rejection Dialog */}
        <Dialog open={openPropertyId !== null} onOpenChange={(open) => !open && setOpenPropertyId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Property</DialogTitle>
              <DialogDescription>
                Are you sure you want to reject this property?
                {openPropertyId && (
                  <span className="font-medium mt-1 block">
                    "{getPropertyById(openPropertyId)?.title}"
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Reason for rejection (optional):</label>
                <Textarea
                  placeholder="Enter reason for rejection"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>

              {openProperty && isPaidProperty(openProperty) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">هذا العقار مدفوع (VIP)</p>
                      <p className="text-xs text-amber-700 mt-1">
                        تم دفع رسوم ترقية لهذا العقار عبر بنك جورجيا. هل تريد استرداد المبلغ تلقائياً؟
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="refund-check"
                      checked={refundPayment}
                      onCheckedChange={(v) => setRefundPayment(!!v)}
                    />
                    <label htmlFor="refund-check" className="text-sm font-medium text-amber-900 cursor-pointer">
                      نعم، استرداد المبلغ للعميل عبر بنك جورجيا
                    </label>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpenPropertyId(null)}
                disabled={isRefunding || updateStatusMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => openPropertyId && handleReject(openPropertyId)}
                disabled={isRefunding || updateStatusMutation.isPending}
              >
                {isRefunding ? "Refunding..." : updateStatusMutation.isPending ? "Rejecting..." : "Reject Property"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Approvals;
