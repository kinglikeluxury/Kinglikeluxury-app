import assert from "node:assert/strict";
import test from "node:test";
import {
  filterProjectOfferProjects,
  parseProjectLocation,
} from "./projectOfferFilters";

test("recognizes Baku whether the database stores city only or city and country", () => {
  for (const location of ["Baku", "Baku, Azerbaijan", "Azerbaijan, Baku", "Bakı, Azərbaycan"]) {
    assert.deepEqual(parseProjectLocation(location), { country: "Azerbaijan", city: "Baku" });
  }
});

test("Baku selection does not mistake the sales status for construction stage", () => {
  const projects = [
    { title: "Baku Building", location: "Baku", projectStatus: "Under Construction" },
    { title: "Baku Listing", location: "Baku, Azerbaijan", projectStatus: "Now Selling" },
    { title: "Tbilisi Project", location: "Tbilisi, Georgia", projectStatus: "Under Construction" },
  ];

  assert.deepEqual(
    filterProjectOfferProjects(projects, "Azerbaijan", "Baku").map((project) => project.title),
    ["Baku Building", "Baku Listing"],
  );
});

test("uses explicit Baku location evidence for district-only records", () => {
  const panorama = {
    title: "Panorama by Elie Saab",
    location: "Sabunchu Raion",
    description: "Location: Baku, Azerbaijan – First coastline.",
    projectStatus: "Now Selling",
  };
  assert.deepEqual(
    filterProjectOfferProjects([panorama], "Azerbaijan", "Baku").map((project) => project.title),
    ["Panorama by Elie Saab"],
  );
});

test("preserves existing country filters", () => {
  const projects = [
    { title: "Istanbul", location: "Istanbul, Turkey", projectStatus: "Now Selling" },
    { title: "Batumi", location: "Street 1, Batumi", projectStatus: "Now Selling" },
    { title: "Dubai", location: "Dubai, UAE", projectStatus: "Now Selling" },
    { title: "Iskele", location: "İskele, Northern Cyprus (TRNC)", projectStatus: "Now Selling" },
  ];

  assert.deepEqual(filterProjectOfferProjects(projects, "Turkey", "İstanbul").map((p) => p.title), ["Istanbul"]);
  assert.deepEqual(filterProjectOfferProjects(projects, "Georgia", "Batumi").map((p) => p.title), ["Batumi"]);
  assert.deepEqual(filterProjectOfferProjects(projects, "UAE", "Dubai").map((p) => p.title), ["Dubai"]);
  assert.deepEqual(
    filterProjectOfferProjects(projects, "Northern Cyprus (TRNC)", "İskele").map((p) => p.title),
    ["Iskele"],
  );
});
