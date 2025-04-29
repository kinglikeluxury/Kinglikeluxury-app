import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, MapPin, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Project, Property } from "@shared/schema";

type ProjectWithProperty = Project & { property: Property };

const LatestProjects = () => {
  const { data: projects, isLoading } = useQuery<ProjectWithProperty[]>({
    queryKey: ['/api/projects'],
    staleTime: 60000, // 1 minute
  });

  // Display only the latest 2 projects
  const latestProjects = projects ? projects.slice(0, 2) : [];

  return (
    <div className="bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">Latest Construction Projects</h2>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-gray-500">
            Exclusive projects currently under development
          </p>
        </div>

        {isLoading ? (
          <div className="mt-12 grid gap-8 grid-cols-1 lg:grid-cols-2">
            {Array(2).fill(0).map((_, index) => (
              <Card key={index} className="overflow-hidden flex flex-col">
                <Skeleton className="h-64 w-full" />
                <CardContent className="p-6 flex-1 flex flex-col justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <Skeleton className="h-6 w-24 mr-2" />
                      <Skeleton className="h-6 w-32" />
                    </div>
                    <Skeleton className="h-7 w-3/4 mt-2" />
                    <Skeleton className="h-5 w-full mt-1" />
                    <div className="mt-4">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-5 w-1/2 mt-2" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-48 mt-6" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="mt-12 grid gap-8 grid-cols-1 lg:grid-cols-2">
            {latestProjects.length === 0 ? (
              <p className="text-gray-500 col-span-2 text-center py-12">No projects found</p>
            ) : (
              latestProjects.map((project) => (
                <Card key={project.id} className="overflow-hidden flex flex-col">
                  <div className="flex-shrink-0">
                    <img 
                      className="h-64 w-full object-cover" 
                      src={project.property.images[0] || "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"} 
                      alt={project.property.title}
                    />
                  </div>
                  <CardContent className="p-6 flex-1 flex flex-col justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 mr-2">
                          {project.projectStatus}
                        </Badge>
                        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                          Completion: {project.completionDate}
                        </Badge>
                      </div>
                      <Link href={`/property/${project.propertyId}`}>
                        <a className="block mt-2">
                          <p className="text-xl font-semibold text-gray-900">{project.property.title}</p>
                          <p className="mt-1 text-base text-gray-500">{project.property.description.slice(0, 100)}...</p>
                        </a>
                      </Link>
                      <div className="mt-4">
                        <div className="flex items-center text-sm text-gray-500">
                          <MapPin className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" />
                          {project.property.location}
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500">
                          <User className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" />
                          Developer: {project.developer}
                        </div>
                      </div>
                    </div>
                    <div className="mt-6">
                      <Button asChild>
                        <Link href={`/property/${project.propertyId}`}>
                          <span className="flex items-center">
                            View Project Details
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </span>
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        <div className="mt-10 text-center">
          <Button variant="outline" size="lg" asChild>
            <Link href="/properties?type=project">
              <span className="flex items-center">
                View All Projects
                <ArrowRight className="ml-2 h-5 w-5" />
              </span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LatestProjects;
