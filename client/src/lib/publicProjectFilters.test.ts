import assert from "node:assert/strict";
import test from "node:test";
import { filterPublicProjects, type PublicProjectFilters, type PublicProjectRecord } from "./publicProjectFilters";
import { filterProjectOfferProjects } from "./projectOfferFilters";

const bakuProjects: PublicProjectRecord[] = [
  {
    id: 55,
    propertyId: 142,
    completionDate: "Q3 2029",
    projectStatus: "Now Selling",
    property: {
      id: 142,
      title: "Panorama by Elie Saab",
      location: "Sabunchu Raion",
      description: "🇦🇿 PANORAMA BY ELIE SAAB | BAKU\nLocation: Baku, Azerbaijan – First coastline.",
      status: "approved",
      price: 180000,
      bedrooms: 1,
    },
  },
  {
    id: 56,
    propertyId: 143,
    completionDate: "Q3 2030",
    projectStatus: "Now Selling",
    property: {
      id: 143,
      title: "Reportage Hights ",
      location: "Əsəd Əhmədov küç., Sabunchu Raion",
      description: "🇦🇿🌊 REPORTAGE HEIGHTS | BAKU\nAzerbaijan",
      status: "approved",
      price: 85840,
      bedrooms: 1,
    },
  },
];

function filters(overrides: Partial<PublicProjectFilters> = {}): PublicProjectFilters {
  return {
    searchTerm: "",
    selectedCountry: "azerbaijan",
    selectedCity: "baku",
    minPrice: null,
    maxPrice: null,
    bedroomCount: "",
    selectedDeliveryYear: "",
    isAdmin: false,
    ...overrides,
  };
}

test("public Azerbaijan/Baku filters return both approved Sabunchu projects", () => {
  assert.deepEqual(
    filterPublicProjects(bakuProjects, filters()).map((project) => project.propertyId),
    [142, 143],
  );
});

test("public location search recognizes Baku, Bakı, Azerbaijan, and aliases for verified projects", () => {
  for (const searchTerm of ["Baku", "Bakı", "باكو", "Azerbaijan", "Azərbaycan", "أذربيجان"]) {
    assert.deepEqual(
      filterPublicProjects(bakuProjects, filters({ searchTerm })).map((project) => project.propertyId),
      [142, 143],
      `expected ${searchTerm} to find both verified Baku projects`,
    );
  }
});

test("Baku searches do not infer a city from Sabunchu alone or unrelated-country evidence", () => {
  const unverifiedDistrict = {
    id: 200,
    title: "Sabunchu development",
    location: "Sabunchu Raion",
    description: "District residential development",
    status: "approved",
  };
  const foreignProject = {
    id: 201,
    title: "Istanbul project",
    location: "Istanbul, Turkey",
    description: "Baku market comparison",
    status: "approved",
  };

  assert.deepEqual(
    filterPublicProjects([unverifiedDistrict, foreignProject], filters()),
    [],
  );
  assert.deepEqual(
    filterPublicProjects([unverifiedDistrict, foreignProject], filters({ searchTerm: "Baku" })),
    [],
  );
});

test("public Baku filters and searches continue to enforce approval status", () => {
  const pending: PublicProjectRecord = {
    ...bakuProjects[0],
    property: { ...bakuProjects[0].property, status: "pending" },
  };

  assert.deepEqual(filterPublicProjects([pending], filters()), []);
  assert.deepEqual(
    filterPublicProjects([pending], filters({
      searchTerm: "Baku",
    })),
    [],
  );
});

test("public search still matches titles and preserves other country filters", () => {
  const istanbul = {
    id: 300,
    title: "Istanbul Residence",
    location: "Istanbul, Turkey",
    description: "Approved city project",
    status: "approved",
  };
  const batumi = {
    id: 301,
    title: "Batumi Residence",
    location: "Batumi, Georgia",
    description: "Approved city project",
    status: "approved",
  };

  assert.deepEqual(
    filterPublicProjects([istanbul, batumi], filters({
      searchTerm: "Istanbul",
      selectedCountry: "turkey",
      selectedCity: "istanbul",
    })).map((project) => project.id),
    [300],
  );
  assert.deepEqual(
    filterPublicProjects([istanbul, batumi], filters({
      searchTerm: "Batumi",
      selectedCountry: "georgia",
      selectedCity: "batumi",
    })).map((project) => project.id),
    [301],
  );
});

test("Project Offer continues to return both Baku projects from the same project evidence", () => {
  const offerProjects = bakuProjects.map(({ property }) => ({
    title: property?.title,
    location: property?.location || "",
    description: property?.description,
    projectStatus: "Now Selling",
  }));

  assert.deepEqual(
    filterProjectOfferProjects(offerProjects, "Azerbaijan", "Baku").map((project) => project.title?.trim()),
    ["Panorama by Elie Saab", "Reportage Hights"],
  );
});
