import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { insertPropertySchema, PROPERTY_TYPES } from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Extend the property schema with validation
const formSchema = insertPropertySchema.extend({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(20, "Description must be at least 20 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  area: z.number().min(1, "Area must be greater than 0"),
  location: z.string().min(3, "Location must be at least 3 characters"),
  images: z.array(z.string()).min(1, "At least one image URL is required"),
  features: z.array(z.string()),
  // Make bedrooms and bathrooms required for apartments and villas
  propertyType: z.enum([
    PROPERTY_TYPES.APARTMENT,
    PROPERTY_TYPES.VILLA,
    PROPERTY_TYPES.LAND,
    PROPERTY_TYPES.PROJECT,
  ]),
  bedrooms: z.number().optional().nullable(),
  bathrooms: z.number().optional().nullable(),
  // For projects only (optional fields)
  projectDetails: z.object({
    developer: z.string().optional(),
    completionDate: z.string().optional(),
    projectStatus: z.string().optional(),
  }).optional(),
});

const PropertyForm = ({ isAdmin = false }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showProjectFields, setShowProjectFields] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [feature, setFeature] = useState("");

  // Property type options based on user role
  const propertyTypeOptions = isAdmin
    ? [
        { value: PROPERTY_TYPES.APARTMENT, label: "Apartment" },
        { value: PROPERTY_TYPES.VILLA, label: "Villa" },
        { value: PROPERTY_TYPES.LAND, label: "Land" },
        { value: PROPERTY_TYPES.PROJECT, label: "Construction Project" },
      ]
    : [
        { value: PROPERTY_TYPES.APARTMENT, label: "Apartment" },
        { value: PROPERTY_TYPES.VILLA, label: "Villa" },
        { value: PROPERTY_TYPES.LAND, label: "Land" },
      ];

  // Initialize the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      price: 0,
      area: 0,
      location: "",
      propertyType: PROPERTY_TYPES.APARTMENT,
      images: [],
      features: [],
      bedrooms: null,
      bathrooms: null,
      ownerId: user?.id || 0,
    },
  });

  const propertyType = form.watch("propertyType");

  // Handle property type change to show/hide project fields
  const handlePropertyTypeChange = (value: string) => {
    form.setValue("propertyType", value as any);
    
    if (value === PROPERTY_TYPES.PROJECT) {
      setShowProjectFields(true);
      // Set default values for project fields
      form.setValue("projectDetails", {
        developer: "",
        completionDate: "",
        projectStatus: "Pre-Launch",
      });
    } else {
      setShowProjectFields(false);
      form.setValue("projectDetails", undefined);
    }
    
    // Reset bedroom/bathroom fields based on property type
    if (value === PROPERTY_TYPES.LAND) {
      form.setValue("bedrooms", null);
      form.setValue("bathrooms", null);
    }
  };

  // Handle image URL addition
  const handleAddImage = () => {
    if (imageUrl && !imageUrls.includes(imageUrl)) {
      const newImageUrls = [...imageUrls, imageUrl];
      setImageUrls(newImageUrls);
      form.setValue("images", newImageUrls);
      setImageUrl("");
    }
  };

  // Handle feature addition
  const handleAddFeature = () => {
    if (feature && !features.includes(feature)) {
      const newFeatures = [...features, feature];
      setFeatures(newFeatures);
      form.setValue("features", newFeatures);
      setFeature("");
    }
  };

  // Handle form submission
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Authentication required",
        description: "Please log in to submit a property.",
      });
      navigate("/login");
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Validate that apartments and villas have bedrooms and bathrooms
      if (
        (data.propertyType === PROPERTY_TYPES.APARTMENT ||
          data.propertyType === PROPERTY_TYPES.VILLA) &&
        (!data.bedrooms || !data.bathrooms)
      ) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: "Bedrooms and bathrooms are required for apartments and villas.",
        });
        return;
      }

      // Submit the property
      const response = await apiRequest("POST", "/api/properties", data);
      const result = await response.json();

      toast({
        title: "Property submitted successfully",
        description: data.propertyType === PROPERTY_TYPES.PROJECT 
          ? "Your project has been added" 
          : "Your property will be reviewed for approval",
      });

      // Redirect to the property page or my properties page
      if (data.propertyType === PROPERTY_TYPES.PROJECT) {
        navigate(`/property/${result.id}`);
      } else {
        navigate("/properties?myProperties=true");
      }
    } catch (error) {
      console.error("Error submitting property:", error);
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Please try again later",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get sample images based on property type
  const getSampleImages = () => {
    switch (propertyType) {
      case PROPERTY_TYPES.APARTMENT:
        return [
          "https://images.unsplash.com/photo-1493809842364-78817add7ffb?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"
        ];
      case PROPERTY_TYPES.VILLA:
        return [
          "https://images.unsplash.com/photo-1613490493576-7fde63acd811?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"
        ];
      case PROPERTY_TYPES.LAND:
        return [
          "https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1500076656116-558758c991c1?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1506744038136-46273834b3fb?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"
        ];
      case PROPERTY_TYPES.PROJECT:
        return [
          "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1553247407-23251f7e13d0?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
          "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"
        ];
      default:
        return [];
    }
  };

  // Function to use sample images
  const useExampleImages = () => {
    const sampleImages = getSampleImages();
    setImageUrls(sampleImages);
    form.setValue("images", sampleImages);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {showProjectFields ? "Add Construction Project" : "Submit Property"}
        </CardTitle>
        <CardDescription>
          {showProjectFields
            ? "Fill in the details about your new construction project."
            : "Fill in the details about your property. All submissions require approval."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter property title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="propertyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property Type</FormLabel>
                    <Select
                      onValueChange={handlePropertyTypeChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select property type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {propertyTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Enter price"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input placeholder="City, State" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="area"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Area (sqft)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Enter area in sqft"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {(propertyType === PROPERTY_TYPES.APARTMENT ||
                propertyType === PROPERTY_TYPES.VILLA) && (
                <>
                  <FormField
                    control={form.control}
                    name="bedrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bedrooms</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="Number of bedrooms"
                            value={field.value || ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bathrooms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bathrooms</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="Number of bathrooms"
                            value={field.value || ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter a detailed description of the property"
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <FormLabel>Images</FormLabel>
              <FormDescription>
                Add image URLs for your property. You can add multiple images.
              </FormDescription>

              <div className="flex mt-2">
                <Input
                  type="text"
                  placeholder="Enter image URL"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="mr-2"
                />
                <Button type="button" onClick={handleAddImage} variant="outline">
                  Add
                </Button>
              </div>

              <div className="mt-2">
                <Button
                  type="button"
                  onClick={useExampleImages}
                  variant="ghost"
                  size="sm"
                >
                  Use Example Images
                </Button>
              </div>

              {imageUrls.length > 0 && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {imageUrls.map((url, index) => (
                    <div key={index} className="relative">
                      <img
                        src={url}
                        alt={`Property ${index + 1}`}
                        className="h-40 w-full rounded-md object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute right-2 top-2"
                        onClick={() => {
                          const newUrls = imageUrls.filter((_, i) => i !== index);
                          setImageUrls(newUrls);
                          form.setValue("images", newUrls);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {form.formState.errors.images && (
                <p className="text-sm font-medium text-destructive mt-2">
                  {form.formState.errors.images.message}
                </p>
              )}
            </div>

            <div>
              <FormLabel>Features</FormLabel>
              <FormDescription>
                Add features of your property (e.g., Swimming Pool, Garage, etc.)
              </FormDescription>

              <div className="flex mt-2">
                <Input
                  type="text"
                  placeholder="Enter feature"
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  className="mr-2"
                />
                <Button type="button" onClick={handleAddFeature} variant="outline">
                  Add
                </Button>
              </div>

              {features.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {features.map((f, index) => (
                    <Badge key={index} variant="secondary" className="px-3 py-1">
                      {f}
                      <button
                        type="button"
                        className="ml-2 text-gray-500 hover:text-gray-700"
                        onClick={() => {
                          const newFeatures = features.filter((_, i) => i !== index);
                          setFeatures(newFeatures);
                          form.setValue("features", newFeatures);
                        }}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Project specific fields */}
            {showProjectFields && (
              <>
                <Separator className="my-4" />
                <h3 className="text-lg font-medium mb-4">Project Details</h3>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="projectDetails.developer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Developer Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter developer name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="projectDetails.completionDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Completion</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Q4 2024" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="projectDetails.projectStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Status</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Pre-Launch">Pre-Launch</SelectItem>
                            <SelectItem value="Now Selling">Now Selling</SelectItem>
                            <SelectItem value="Under Construction">
                              Under Construction
                            </SelectItem>
                            <SelectItem value="Almost Complete">
                              Almost Complete
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {!user && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Authentication required</AlertTitle>
                <AlertDescription>
                  You need to be logged in to submit a property.
                </AlertDescription>
              </Alert>
            )}

            <CardFooter className="flex justify-end px-0">
              <Button type="submit" disabled={isSubmitting || !user}>
                {isSubmitting ? "Submitting..." : "Submit Property"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default PropertyForm;
