import type { JsonSchemaProp, ToolInfo } from "./types";

/**
 * JSON Schema → form state → call arguments, as pure functions.
 *
 * The MCP server describes each tool with a JSON Schema produced by
 * zod-to-json-schema (draft-07). This module turns that schema into the form
 * the "Outils MCP" tab shows, and turns the form back into the `arguments`
 * object sent to the bridge. Pure on purpose: everything here is testable
 * without React, and the render smoke test drives it with the schemas captured
 * from the real server (fixtures/tools.json).
 */

export type FieldValue = string | number | boolean;
export type FormValues = Record<string, FieldValue>;

/**
 * Unwrap the shapes zod-to-json-schema can produce for optional fields
 * (`anyOf: [X, {type: "null"}]` or `type: ["string", "null"]`). The current
 * server emits clean schemas where optionality lives in `required` only, but
 * tolerating the other form costs nothing and survives an SDK upgrade.
 */
export function effective(prop: JsonSchemaProp): JsonSchemaProp {
  if (prop.anyOf && prop.anyOf.length > 0) {
    const real = prop.anyOf.find((p) => p.type && p.type !== "null");
    if (real) return { ...real, description: prop.description ?? real.description };
  }
  if (Array.isArray(prop.type)) {
    const real = prop.type.find((t) => t !== "null");
    if (real) return { ...prop, type: real };
  }
  return prop;
}

/** The input kind the form should show: enum | array | number | boolean | string. */
export function kindOf(prop: JsonSchemaProp): string {
  const p = effective(prop);
  if (p.enum) return "enum";
  if (p.type === "array") return "array";
  if (p.type === "number" || p.type === "integer") return "number";
  if (p.type === "boolean") return "boolean";
  return "string";
}

/** Initial form state: one blank entry per property, so the form shows them all. */
export function emptyValues(schema: ToolInfo["inputSchema"]): FormValues {
  const out: FormValues = {};
  for (const [name, prop] of Object.entries(schema?.properties ?? {})) {
    const p = effective(prop);
    if (kindOf(prop) === "boolean") {
      out[name] = false;
    } else if (p.default !== undefined && (typeof p.default === "string" || typeof p.default === "number")) {
      out[name] = p.default;
    } else {
      out[name] = "";
    }
  }
  return out;
}

/**
 * Form state → the `arguments` actually sent. Blank fields are **omitted**, so
 * the server applies its own defaults rather than receiving explicit nulls.
 */
export function toArguments(values: FormValues, schema: ToolInfo["inputSchema"]): Record<string, unknown> {
  const props: Record<string, JsonSchemaProp> = schema?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const prop = props[name];
    if (!prop) continue;
    const kind = kindOf(prop);

    if (kind === "boolean") {
      out[name] = Boolean(value);
      continue;
    }
    if (value === "" || value === null || value === undefined) continue;

    if (kind === "array") {
      const itemType = effective(effective(prop).items ?? {})?.type;
      const parts = String(value)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (parts.length === 0) continue;
      out[name] = parts.map((s) => (itemType === "number" || itemType === "integer" ? Number(s) : s));
      continue;
    }
    if (kind === "number") {
      const n = Number(value);
      if (Number.isFinite(n)) out[name] = n;
      continue;
    }
    out[name] = value;
  }
  return out;
}

/** Required properties the form has left blank ("" or missing). */
export function missingRequired(
  values: FormValues,
  schema: ToolInfo["inputSchema"],
): string[] {
  const props = schema?.properties ?? {};
  return (schema?.required ?? []).filter((name) => {
    const value = values[name];
    if (typeof value === "boolean") return false;
    return value === undefined || value === null || value === "";
  }).filter((name) => props[name] !== undefined);
}
