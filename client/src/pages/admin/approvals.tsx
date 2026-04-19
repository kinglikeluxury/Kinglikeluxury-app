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
import { CheckCircle, XCircle, Eye, CreditCard, AlertTriangle } from "lucide-react";
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
                          <div className="flex justify-end space-x-2">
                            <Button size="sm" variant="outline" asChild>
                              <a href={`/property/${property.id}`} target="_blank" rel="noopener noreferrer">
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </a>
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
