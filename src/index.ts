#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  geocodeAddress,
  propertySales,
  pricePerM2,
  estimateProperty,
  backtestEstimator,
  rentEstimate,
  propertyTaxEstimate,
  propertyReport,
  cadastralParcel,
  urbanismZoning,
  irisLookup,
  rentControl,
  dpeLookup,
  naturalRisks,
  communeInfo,
  whatIsHere,
} from "./handlers.js";
import { VERSION } from "./version.js";

const server = new McpServer({
  name: "mcp-immo-olv",
  version: VERSION,
});

type Handler<A> = (args: A) => Promise<unknown>;

function wrap<A>(handler: Handler<A>) {
  return async (args: A) => {
    try {
      const result = await handler(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

// Shared schema fragments: one definition per reused input, so every tool
// describes the same parameter the same way.
const yearsSchema = z
  .array(z.number().int())
  .optional()
  .describe("DVF years to include (2021-2025). Defaults to all.");
const typeLocalSchema = () =>
  z.enum(["Appartement", "Maison"]).optional().describe("Filter by dwelling type");
const radiusSchema = (def: number, min = 20) =>
  z
    .number()
    .min(min)
    .max(5000)
    .optional()
    .describe(`Search radius in meters around the address (default ${def}; ignored for city-wide queries)`);
const pointInputSchema = () => ({
  address: z.string().optional().describe("Address in France (alternative to lat/lon)"),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

server.registerTool(
  "geocode_address",
  {
    title: "Geocode a French address",
    description:
      "Resolve a French address, street, or city to normalized candidates with coordinates, INSEE city code and BAN id (Base Adresse Nationale). Use this first if an address is ambiguous.",
    inputSchema: {
      query: z.string().describe("Free-form address, e.g. '10 rue de la Paix Paris'"),
      limit: z.number().int().min(1).max(20).optional().describe("Max candidates (default 5)"),
    },
  },
  wrap(geocodeAddress),
);

server.registerTool(
  "property_sales",
  {
    title: "Real property sales around an address (DVF)",
    description:
      "List actual notarized property sales (price, date, surface, rooms) recorded by the French tax administration (DVF) around an address, or for a whole commune if only a city is given. Data 2021-2025, no API key.",
    inputSchema: {
      address: z.string().describe("Address, street or city in France"),
      radius_m: radiusSchema(300),
      years: yearsSchema,
      type_local: typeLocalSchema(),
      min_surface_m2: z.number().optional(),
      max_surface_m2: z.number().optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Max sales returned (default 30)"),
    },
  },
  wrap(propertySales),
);

server.registerTool(
  "price_per_m2",
  {
    title: "Price per m² statistics (DVF)",
    description:
      "Compute price-per-m² statistics (median, mean, quartiles, per-year evolution) from actual notarized sales around a French address or across a commune. Data 2021-2025.",
    inputSchema: {
      address: z.string().describe("Address, street or city in France"),
      type_local: typeLocalSchema(),
      years: yearsSchema,
      radius_m: radiusSchema(500, 50),
    },
  },
  wrap(pricePerM2),
);

server.registerTool(
  "estimate_property",
  {
    title: "Estimate a property's value (comparables)",
    description:
      "Transparent comparables-based valuation of a flat or house at a precise French address: weighted median of nearby single-dwelling notarized sales, adjusted to current market level, with every comp and weight returned for audit. Also returns the official rent indicator and gross rental yield.",
    inputSchema: {
      address: z.string().describe("Precise address (street + number preferred)"),
      type_local: z.enum(["Appartement", "Maison"]),
      surface_m2: z.number().min(8).max(1000).describe("Living surface in m²"),
      rooms: z.number().int().min(1).max(20).optional().describe("Main rooms (pièces principales) — refines the rent indicator"),
    },
  },
  wrap(estimateProperty),
);

server.registerTool(
  "rent_estimate",
  {
    title: "Rent indicators (Carte des loyers)",
    description:
      "Official modelled asking rents (€/m²/month, charges included) for any French commune: apartments overall, 1-2 rooms, 3+ rooms, and houses. Source: Carte des loyers, Ministère du Logement / ANIL.",
    inputSchema: {
      location: z.string().describe("Address, commune name or INSEE code"),
      surface_m2: z.number().optional().describe("If given, also returns the estimated monthly rent"),
    },
  },
  wrap(rentEstimate),
);

server.registerTool(
  "property_tax_estimate",
  {
    title: "Average property tax by commune (REI)",
    description:
      "Returns the annual average charge per taxable REI article for taxe foncière on built properties, including published communal, intercommunal, syndicate, GEMAPI and TEOM components. It is an aggregate proxy, not an individual property's tax bill. Source: DGFiP REI via OFGL.",
    inputSchema: {
      location: z.string().describe("Address, commune name or INSEE code"),
      year: z.number().int().min(2024).max(2100).optional().describe("REI tax year; defaults to the latest available year"),
    },
  },
  wrap(propertyTaxEstimate),
);

server.registerTool(
  "property_report",
  {
    title: "Full property due-diligence report",
    description:
      "One call, full dossier for a French address: price-per-m² market stats, recent notarized sales, energy diagnostics (DPE), natural & technological risks, commune profile, official rent indicators and an aggregate taxe foncière proxy — plus a comparables-based valuation, gross yield and yield after average property tax when type_local and surface_m2 are provided. Ideal first call when a user asks about a specific property.",
    inputSchema: {
      address: z.string().describe("Address in France"),
      type_local: typeLocalSchema(),
      surface_m2: z.number().min(8).max(1000).optional(),
      rooms: z.number().int().min(1).max(20).optional(),
    },
  },
  wrap(propertyReport),
);

server.registerTool(
  "dpe_lookup",
  {
    title: "Energy performance diagnostics (DPE)",
    description:
      "Find official energy performance certificates (DPE: energy label A-G, GES label, surface, construction year) filed for a French address. Source: ADEME open data.",
    inputSchema: {
      address: z.string().describe("Address in France"),
      limit: z.number().int().min(1).max(50).optional().describe("Max diagnostics returned (default 10)"),
      dataset: z
        .enum(["all", "existant", "neuf"])
        .optional()
        .describe("DPE register: existing dwellings (dpe03existant), new dwellings (dpe02neuf), or both (default all)"),
    },
  },
  wrap(dpeLookup),
);

server.registerTool(
  "natural_risks",
  {
    title: "Natural & technological risks (Géorisques)",
    description:
      "Official risk report for a French address or point: flood, clay shrink-swell, radon, earthquake, industrial sites... Source: Géorisques (Ministère de la Transition écologique).",
    inputSchema: {
      ...pointInputSchema(),
    },
  },
  wrap(naturalRisks),
);

server.registerTool(
  "commune_info",
  {
    title: "Commune information",
    description:
      "Population, postcodes, département, région, surface and center coordinates of a French commune, by name or INSEE code.",
    inputSchema: {
      query: z.string().describe("Commune name or 5-char INSEE code (e.g. 'Lyon' or '69123')"),
    },
  },
  wrap(communeInfo),
);

server.registerTool(
  "reverse_geocode",
  {
    title: "Reverse geocode",
    description: "Find the nearest French address for GPS coordinates.",
    inputSchema: {
      lat: z.number(),
      lon: z.number(),
    },
  },
  wrap(whatIsHere),
);

server.registerTool(
  "backtest_estimator",
  {
    title: "Walk-forward backtest of the valuation model",
    description:
      "Replay the comparable-sales estimator on the commune's own notarized sales: every historical sale is valued using only the sales recorded before it (no look-ahead, own deed excluded), then compared with the price actually paid. Returns MAPE, median and 90th-percentile absolute error, signed bias, P25–P75 range coverage and the same metrics by surface band and by year. Use it to say how reliable estimate_property is in this specific market.",
    inputSchema: {
      address: z.string().describe("Precise address (street or house number) in France"),
      type_local: z.enum(["Appartement", "Maison"]).describe("Property type to backtest"),
      from_year: z
        .number()
        .int()
        .min(2021)
        .optional()
        .describe("First sale year to evaluate (default: every year available)"),
      to_year: z.number().int().optional().describe("Last sale year to evaluate"),
      max_points: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max sales evaluated, most recent first (default 250)"),
    },
  },
  wrap(backtestEstimator),
);

server.registerTool(
  "cadastral_parcel",
  {
    title: "Cadastral parcel at an address",
    description:
      "Official cadastral parcel(s) containing an address: unique cadastral id (idu) quoted on deeds, section, number and the official contenance in m². The contenance is the taxed area of the whole parcel, land included — not the dwelling's habitable surface — and the cadastre never records ownership. Source: IGN / DGFiP via API Carto.",
    inputSchema: {
      ...pointInputSchema(),
    },
  },
  wrap(cadastralParcel),
);

server.registerTool(
  "urbanism_zoning",
  {
    title: "Urbanism rules at an address (PLU)",
    description:
      "Urbanism zoning and prescriptions applicable to an address, from the Géoportail de l'urbanisme: zoning area label and type (U urban, AU to be urbanised, A agricultural, N natural), the regulation document reference, and the surface / linear / point prescriptions (emplacements réservés, protected areas, alignments…). It states which rules apply, never whether a project is permitted. Source: GPU, DGALN / IGN.",
    inputSchema: {
      ...pointInputSchema(),
    },
  },
  wrap(urbanismZoning),
);

server.registerTool(
  "iris_lookup",
  {
    title: "IRIS neighbourhood of an address",
    description:
      "Identify the IRIS — INSEE's infra-communal statistical unit, about 2 000 inhabitants — containing an address: 9-character IRIS code, name, type and commune. Join that code to INSEE's IRIS tables for population and Filosofi income. Boundaries from IGN ADMINEXPRESS; this layer carries identity only, no socio-demographic figures.",
    inputSchema: {
      address: z.string().describe("Address in France"),
    },
  },
  wrap(irisLookup),
);

server.registerTool(
  "rent_control",
  {
    title: "Rent-control reference rents",
    description:
      "Loyer de référence, loyer de référence majoré (the legal ceiling) and minoré, in €/m²/month, for a rent-controlled area — by number of rooms, construction period and furnished status. Covers only the areas whose authority publishes an open grid (Paris, Métropole de Lyon); the response states explicitly when an address is not covered instead of guessing. Sources: Ville de Paris, Métropole de Lyon.",
    inputSchema: {
      address: z.string().describe("Address in France"),
      rooms: z.number().int().min(1).max(10).optional().describe("Number of rooms (pièces)"),
      furnished: z.boolean().optional().describe("Furnished (true) or unfurnished (false)"),
      period: z.string().optional().describe("Construction period label, e.g. '1946-1970'"),
    },
  },
  wrap(rentControl),
);

const transport = new StdioServerTransport();
await server.connect(transport);
