import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Property, PROPERTY_STATUS, PROPERTY_TYPES } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Building, Home, CircleDot, Construction, User, Clock, Bell } from "lucide-react";

const AdminDashboard = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  // Fetch all properties
  const { data: properties, isLoading: propertiesLoading } = useQuery<Property[]>({
    queryKey: ['/api/properties?status=all'],
    enabled: !!user?.isAdmin,
  });

  if (authLoading || propertiesLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-8 w-64 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return null; // Will redirect due to useEffect
  }

  // Prepare dashboard data
  const allProperties = properties || [];
  
  // Count by property type
  const propertyTypeCounts = {
    apartment: allProperties.filter(p => p.propertyType === PROPERTY_TYPES.APARTMENT).length,
    villa: allProperties.filter(p => p.propertyType === PROPERTY_TYPES.VILLA).length,
    land: allProperties.filter(p => p.propertyType === PROPERTY_TYPES.LAND).length,
    project: allProperties.filter(p => p.propertyType === PROPERTY_TYPES.PROJECT).length,
  };
  
  // Count by status
  const propertyStatusCounts = {
    approved: allProperties.filter(p => p.status === PROPERTY_STATUS.APPROVED).length,
    pending: allProperties.filter(p => p.status === PROPERTY_STATUS.PENDING).length,
    rejected: allProperties.filter(p => p.status === PROPERTY_STATUS.REJECTED).length,
  };
  
  // Data for pie chart
  const propertyTypeData = [
    { name: 'Apartments', value: propertyTypeCounts.apartment, color: '#3b82f6' },
    { name: 'Villas', value: propertyTypeCounts.villa, color: '#10b981' },
    { name: 'Lands', value: propertyTypeCounts.land, color: '#f59e0b' },
    { name: 'Projects', value: propertyTypeCounts.project, color: '#8b5cf6' },
  ];
  
  // Data for bar chart
  const statusData = [
    { name: 'Approved', value: propertyStatusCounts.approved, color: '#10b981' },
    { name: 'Pending', value: propertyStatusCounts.pending, color: '#f59e0b' },
    { name: 'Rejected', value: propertyStatusCounts.rejected, color: '#ef4444' },
  ];

  return (
    <div className="p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <div className="flex space-x-3">
            <Button asChild variant="outline">
              <Link href="/admin/approvals">
                <Clock className="mr-2 h-4 w-4" />
                Pending Approvals
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/notifications">
                <Bell className="mr-2 h-4 w-4" />
                الإشعارات
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/add-project">
                <Construction className="mr-2 h-4 w-4" />
                Add Project
              </Link>
            </Button>
          </div>
        </div>
        
        {/* Stats overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <div className="p-3 rounded-full bg-primary-100 mb-4">
                <Building className="h-6 w-6 text-primary-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">Total Properties</p>
                <h3 className="text-3xl font-bold">{allProperties.length}</h3>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <div className="p-3 rounded-full bg-yellow-100 mb-4">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">Pending Approvals</p>
                <h3 className="text-3xl font-bold">{propertyStatusCounts.pending}</h3>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <div className="p-3 rounded-full bg-green-100 mb-4">
                <Home className="h-6 w-6 text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">Active Listings</p>
                <h3 className="text-3xl font-bold">{propertyStatusCounts.approved}</h3>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <div className="p-3 rounded-full bg-purple-100 mb-4">
                <Construction className="h-6 w-6 text-purple-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">Construction Projects</p>
                <h3 className="text-3xl font-bold">{propertyTypeCounts.project}</h3>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Charts */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Property Types Distribution</CardTitle>
                  <CardDescription>Breakdown of properties by type</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={propertyTypeData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {propertyTypeData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Property Status</CardTitle>
                  <CardDescription>Breakdown of properties by approval status</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={statusData}
                        margin={{
                          top: 20,
                          right: 30,
                          left: 20,
                          bottom: 5,
                        }}
                      >
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="value" name="Count">
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="properties">
            <Card>
              <CardHeader>
                <CardTitle>Property Listings Overview</CardTitle>
                <CardDescription>A summary of all properties in the system</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Property Type</th>
                        <th className="text-center p-2">Total</th>
                        <th className="text-center p-2">Pending</th>
                        <th className="text-center p-2">Approved</th>
                        <th className="text-center p-2">Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="p-2 flex items-center">
                          <Building className="mr-2 h-4 w-4 text-primary-500" />
                          Apartments
                        </td>
                        <td className="text-center p-2">{propertyTypeCounts.apartment}</td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.APARTMENT && p.status === PROPERTY_STATUS.PENDING).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.APARTMENT && p.status === PROPERTY_STATUS.APPROVED).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.APARTMENT && p.status === PROPERTY_STATUS.REJECTED).length}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-2 flex items-center">
                          <Home className="mr-2 h-4 w-4 text-secondary-500" />
                          Villas
                        </td>
                        <td className="text-center p-2">{propertyTypeCounts.villa}</td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.VILLA && p.status === PROPERTY_STATUS.PENDING).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.VILLA && p.status === PROPERTY_STATUS.APPROVED).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.VILLA && p.status === PROPERTY_STATUS.REJECTED).length}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="p-2 flex items-center">
                          <CircleDot className="mr-2 h-4 w-4 text-amber-500" />
                          Lands
                        </td>
                        <td className="text-center p-2">{propertyTypeCounts.land}</td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.LAND && p.status === PROPERTY_STATUS.PENDING).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.LAND && p.status === PROPERTY_STATUS.APPROVED).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.LAND && p.status === PROPERTY_STATUS.REJECTED).length}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 flex items-center">
                          <Construction className="mr-2 h-4 w-4 text-purple-500" />
                          Projects
                        </td>
                        <td className="text-center p-2">{propertyTypeCounts.project}</td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.PROJECT && p.status === PROPERTY_STATUS.PENDING).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.PROJECT && p.status === PROPERTY_STATUS.APPROVED).length}
                        </td>
                        <td className="text-center p-2">
                          {allProperties.filter(p => p.propertyType === PROPERTY_TYPES.PROJECT && p.status === PROPERTY_STATUS.REJECTED).length}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Recent property submissions awaiting your approval</CardDescription>
              </CardHeader>
              <CardContent>
                {allProperties.filter(p => p.status === PROPERTY_STATUS.PENDING).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Property</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-left p-2">Location</th>
                          <th className="text-left p-2">Price</th>
                          <th className="text-center p-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allProperties
                          .filter(p => p.status === PROPERTY_STATUS.PENDING)
                          .slice(0, 5)
                          .map(property => (
                            <tr key={property.id} className="border-b">
                              <td className="p-2">{property.title}</td>
                              <td className="p-2 capitalize">{property.propertyType}</td>
                              <td className="p-2">{property.location}</td>
                              <td className="p-2">${property.price.toLocaleString()}</td>
                              <td className="p-2 text-center">
                                <Button variant="outline" size="sm" asChild>
                                  <Link href={`/property/${property.id}`}>View</Link>
                                </Button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No pending approvals at the moment!</p>
                  </div>
                )}
                
                {allProperties.filter(p => p.status === PROPERTY_STATUS.PENDING).length > 0 && (
                  <div className="mt-4 flex justify-center">
                    <Button asChild>
                      <Link href="/admin/approvals">View All Pending Approvals</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboard;
