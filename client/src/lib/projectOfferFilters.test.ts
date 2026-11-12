import assert from "node:assert/strict";
import test from "node:test";
import {
  filterProjectOfferProjects,
  isUnderConstructionStatus,
  parseProjectLocation,
} from "./projectOfferFilters";

test("recognizes Baku whether the database stores city only or city and country", () => {
  for (const location of ["Baku", "Baku, Azerbaijan", "Azerbaijan, Baku", "Bakı, Azərbaycan"]) {
    assert.deepEqual(parseProjectLocation(location), { country: "Azerbaijan", city: "Baku" });
  }
});

test("Baku selection includes only database projects marked under construction", () => {
  const projects = [
    { title: "Baku Building", location: "Baku", projectStatus: "Under Construction" },
    { title: "Baku Listing", location: "Baku, Azerbaijan", projectStatus: "Now Selling" },
    { title: "Tbilisi Project", location: "Tbilisi, Georgia", projectStatus: "Under Construction" },
  ];

  assert.deepEqual(
    filterProjectOfferProjects(projects, "Azerbaijan", "Baku").map((project) => project.title),
    ["Baku Building"],
  );
});

test("supports construction status formatting variants and preserves existing country filters", () => {
  assert.equal(isUnderConstructionStatus("under_construction"), true);
  assert.equal(isUnderConstructionStatus("UNDER-CONSTRUCTION"), true);

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
