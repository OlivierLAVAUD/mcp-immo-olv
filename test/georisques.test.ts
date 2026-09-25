import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEORISQUES_PORTAL,
  riskReport,
  unavailableRiskReport,
} from "../src/apis/georisques.js";
import { HttpError } from "../src/http.js";

// The HTTP module caches by URL and the cache outlives a test, so each test
// asks about its own point.
let counter = 0;
const point = () => ({ lat: 45.1 + ++counter / 1000, lon: 4.8 + counter / 1000 });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("riskReport when the source is down", () => {
  it("reports an unknown status, never an absence of risk, on HTTP 503", async () => {
    const { lat, lon } = point();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const report = await riskReport(lat, lon);

    expect(report.available).toBe(false);
    expect(report.unavailable?.reason).toContain("503");
    // Empty lists are only safe because `available` says so out loud.
    expect(report.naturalRisks).toEqual([]);
    expect(report.technologicalRisks).toEqual([]);
  });

  it("points at the official portal so the user can still check by hand", async () => {
    const { lat, lon } = point();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const report = await riskReport(lat, lon);

    expect(report.officialReportUrl).toBe(GEORISQUES_PORTAL);
    expect(report.unavailable?.portal_url).toBe(GEORISQUES_PORTAL);
  });

  it("degrades the same way when the socket dies", async () => {
    const { lat, lon } = point();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const report = await riskReport(lat, lon);

    expect(report.available).toBe(false);
    expect(report.unavailable?.reason).toContain("unreachable");
  });

  it("stays loud on a client error, which means the request itself was wrong", async () => {
    const { lat, lon } = point();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "bad params" }, 400)));

    await expect(riskReport(lat, lon)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("riskReport when the source answers", () => {
  it("keeps only the risks present, with their status at the address", async () => {
    const { lat, lon } = point();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          adresse: { libelle: "12 Rue de la République 69002 Lyon" },
          commune: { libelle: "Lyon", codePostal: "69002" },
          url: "https://www.georisques.gouv.fr/rapport/abc",
          risquesNaturels: {
            inondation: {
              present: true,
              libelle: "Inondation",
              libelleStatutAdresse: "Risque Existant",
              libelleStatutCommune: "Risque Existant",
            },
            seisme: { present: false, libelle: "Séisme" },
          },
          risquesTechnologiques: {
            icpe: {
              present: true,
              libelle: "ICPE",
              libelleStatutAdresse: null,
              libelleStatutCommune: "Risque non Concerne",
            },
          },
        }),
      ),
    );

    const report = await riskReport(lat, lon);

    expect(report.available).toBe(true);
    expect(report.unavailable).toBeUndefined();
    expect(report.address).toBe("12 Rue de la République 69002 Lyon");
    expect(report.commune).toBe("Lyon 69002");
    expect(report.naturalRisks).toEqual([
      { risk: "Inondation", statusAtAddress: "Risque Existant", statusInCommune: "Risque Existant" },
    ]);
    expect(report.technologicalRisks).toEqual([
      { risk: "ICPE", statusAtAddress: null, statusInCommune: "Risque non Concerne" },
    ]);
  });
});

describe("unavailableRiskReport", () => {
  it("states the reason and where to verify it", () => {
    expect(unavailableRiskReport("Géorisques API returned HTTP 503")).toMatchObject({
      available: false,
      officialReportUrl: GEORISQUES_PORTAL,
      unavailable: {
        reason: "Géorisques API returned HTTP 503",
        portal_url: GEORISQUES_PORTAL,
      },
    });
  });
});
