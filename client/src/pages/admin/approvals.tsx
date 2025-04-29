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
import { CheckCircle, XCircle, Eye } from "lucide-react";
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
  const [currentTab, setCurrentTab] = useState("pending");

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  // Fetch all properties for admin
  const { data: properties, isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ['/api/properties?status=all'],
    enabled: !!user?.isAdmin,
  });

  // Update property status mutation
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
    },
  });

  // Handle approve action
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

  // Handle reject action
  const handleReject = (id: number) => {
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

  // Open rejection dialog
  const openRejectDialog = (id: number) => {
    setOpenPropertyId(id);
    setRejectionReason("");
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
    return null; // Will redirect due to useEffect
  }

  // Filter properties based on current tab
  const filteredProperties = properties?.filter(p => {
    if (currentTab === "pending") return p.status === PROPERTY_STATUS.PENDING;
    if (currentTab === "approved") return p.status === PROPERTY_STATUS.APPROVED;
    if (currentTab === "rejected") return p.status === PROPERTY_STATUS.REJECTED;
    return true;
  }) || [];

  // Get property by ID
  const getPropertyById = (id: number) => {
    return properties?.find(p => p.id === id);
  };

  return (
    <div className="p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Property Approvals</h1>
          <p className="text-gray-600 mt-1">
            Manage property submissions - approve or reject user-submitted properties
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
            
            <div className="py-2">
              <label className="text-sm font-medium mb-1 block">Reason for rejection (optional):</label>
              <Textarea
                placeholder="Enter reason for rejection"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
            
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setOpenPropertyId(null)}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => openPropertyId && handleReject(openPropertyId)}
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? "Rejecting..." : "Reject Property"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Approvals;
