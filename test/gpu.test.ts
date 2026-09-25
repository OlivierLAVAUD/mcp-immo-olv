import { describe, expect, it } from "vitest";
import { toPrescription, toZone } from "../src/apis/gpu.js";

describe("toZone", () => {
  it("maps the GPU zone-urba attributes", () => {
    const zone = toZone({
      properties: {
        libelle: "UCe1b",
        libelong: "Tissu urbain dense a caractere patrimonial",
        typezone: "U",
        partition: "DU_200046977",
        idurba: "200046977_PLUI_20260326",
        datvalid: "20260326",
        nomfic: "200046977_reglement_20260326.pdf",
        urlfic: "   ",
      },
    });
    expect(zone.label).toBe("UCe1b");
    expect(zone.type).toBe("U");
    expect(zone.partition).toBe("DU_200046977");
    expect(zone.document_id).toBe("200046977_PLUI_20260326");
    expect(zone.document_valid_from).toBe("20260326");
    expect(zone.regulation_file).toBe("200046977_reglement_20260326.pdf");
    expect(zone.document_url).toBeNull(); // a blank string is not a URL
  });

  it("tolerates missing properties", () => {
    const zone = toZone({});
    expect(zone.label).toBeNull();
    expect(zone.type).toBeNull();
    expect(zone.description).toBeNull();
  });
});

describe("toPrescription", () => {
  it("maps a prescription and keeps its geometry kind", () => {
    const prescription = toPrescription(
      {
        properties: {
          libelle: "Secteur de mixite sociale",
          typepsc: "17",
          stypepsc: "00",
          txt: "1",
          idurba: "200046977_PLUI_20260326",
          datvalid: "20260326",
        },
      },
      "surf",
    );
    expect(prescription.label).toBe("Secteur de mixite sociale");
    expect(prescription.type_code).toBe("17");
    expect(prescription.subtype_code).toBe("00");
    expect(prescription.geometry_kind).toBe("surf");
    expect(prescription.value).toBe("1");
  });

  it("falls back to 'nature' when no text value is published", () => {
    const prescription = toPrescription(
      { properties: { libelle: "Alignement", nature: "alignement" } },
      "lin",
    );
    expect(prescription.value).toBe("alignement");
    expect(prescription.type_code).toBeNull();
  });
});