import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, MapPin, User } from "lucide-react";
import { slugifyProperty } from "@/lib/slugify";
import { Skeleton } from "@/components/ui/skeleton";
import { Project, Property } from "@shared/schema";
import { useAutoTranslate } from "@/hooks/useAutoTranslate";

type ProjectWithProperty = Project & { property: Property };

const ARABIC_RE = /[\u0600-\u06FF]/;

const getTranslatedStatus = (status: string, t: (key: string, fallback: string) => string): string => {
  const statusMap: Record<string, string> = {
    'Now Selling': t('projectStatus.nowSelling', 'Now Selling'),
    'Under Construction': t('projectStatus.underConstruction', 'Under Construction'),
    'Pre-Launch': t('projectStatus.preLaunch', 'Pre-Launch'),
    'Completed': t('projectStatus.completed', 'Completed'),
    'Coming Soon': t('projectStatus.comingSoon', 'Coming Soon'),
    'Sold Out': t('projectStatus.soldOut', 'Sold Out'),
  };
  return statusMap[status] || status;
};

function LatestProjectCard({ project }: { project: ProjectWithProperty }) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';

  const rawDescription = project.property.description || '';
  const descriptionEn = (project.property as any).descriptionEn as string | undefined;
  const rawTitle = project.property.title || '';
  const titleEn = (project.property as any).titleEn as string | undefined;

  const hasStoredEnglishDesc = currentLang === 'en' && !!descriptionEn;
  const hasStoredEnglishTitle = currentLang === 'en' && !!titleEn;

  const descriptionIsArabic = ARABIC_RE.test(rawDescription);
  const titleIsArabic = ARABIC_RE.test(rawTitle);

  const shouldAutoTranslateDesc = !hasStoredEnglishDesc && currentLang !== 'ar' && descriptionIsArabic;
  const shouldAutoTranslateTitle = !hasStoredEnglishTitle && currentLang !== 'ar' && titleIsArabic;

  const translated = useAutoTranslate({
    description: shouldAutoTranslateDesc ? rawDescription : '',
    title: shouldAutoTranslateTitle ? rawTitle : '',
  });

  const displayDescription = hasStoredEnglishDesc
    ? descriptionEn!
    : shouldAutoTranslateDesc && translated.description
      ? translated.description
      : rawDescription;

  const displayTitle = hasStoredEnglishTitle
    ? titleEn!
    : shouldAutoTranslateTitle && translated.title
      ? translated.title
      : rawTitle;

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="flex-shrink-0">
        <img
          className="h-64 w-full object-cover"
          src={project.property.images[0] || "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80"}
          alt={displayTitle}
        />
      </div>
      <CardContent className="p-6 flex-1 flex flex-col justify-between">
        <div className="flex-1">
          <div className="flex items-center">
            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 mr-2">
              {getTranslatedStatus(project.projectStatus, t)}
            </Badge>
            <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
              {t('home.projects.completion', 'Completion:')} {project.completionDate}
            </Badge>
          </div>
          <Link href={`/property/${slugifyProperty(project.property.title, project.property.location, project.propertyId)}`} className="block mt-2">
            <p className="text-xl font-semibold text-gray-900">
              {displayTitle}
            </p>
            <p className="mt-1 text-base text-gray-500">
              {displayDescription.slice(0, 100)}...
            </p>
          </Link>
          <div className="mt-4">
            <div className="flex items-center text-sm text-gray-500">
              <MapPin className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" />
              {project.property.location}
            </div>
            <div className="mt-2 flex items-center text-sm text-gray-500">
              <User className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" />
              {t('home.projects.developer', 'Developer:')} {project.developer}
            </div>
          </div>
        </div>
        <div className="mt-6">
          <Button asChild>
            <Link href={`/property/${slugifyProperty(project.property.title, project.property.location, project.propertyId)}`}>
              <span className="flex items-center">
                {t('property.viewProject', 'View Project Details')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const LatestProjects = () => {
  const { t } = useTranslation();
  const { data: projects, isLoading } = useQuery<ProjectWithProperty[]>({
    queryKey: ['/api/projects'],
    staleTime: 60000,
  });

  const latestProjects = projects ? projects.slice(0, 2) : [];

  return (
    <div className="bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">{t('home.projects.title', 'Latest Construction Projects')}</h2>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-gray-500">
            {t('home.projects.subtitle', 'Exclusive projects currently under development')}
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
              <p className="text-gray-500 col-span-2 text-center py-12">{t('home.projects.noResults', 'No projects found')}</p>
            ) : (
              latestProjects.map((project) => (
                <LatestProjectCard key={project.id} project={project} />
              ))
            )}
          </div>
        )}

        <div className="mt-10 text-center">
          <Button variant="outline" size="lg" asChild>
            <Link href="/properties?type=project">
              <span className="flex items-center">
                {t('property.viewAllProjects', 'View All Projects')}
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
