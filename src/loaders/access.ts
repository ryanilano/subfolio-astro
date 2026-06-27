import { parseSubfolioYaml } from "./yaml.ts";
import type { AccessRules } from "./schema.ts";

/**
 * Parse an `-access` file into structured rules, per
 * subfolio/plans/spec/SPEC-access.md. Phase 1 only *parses* and attaches these
 * to the folder entry as metadata — there is NO enforcement (that's the deferred
 * Phase-4 auth Worker). The static build serves everything publicly until then.
 *
 * The example `-access` is partly prose (a "Does not apply to sub-folders:"
 * header line); the lenient YAML parser tolerates it and we read only the known
 * keys.
 */

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => String(x));
}

export function parseAccess(src: string): AccessRules {
  const doc = parseSubfolioYaml(src);
  const rules: AccessRules = {};
  const allowUsers = asStringArray(doc.allow_users);
  const allowGroups = asStringArray(doc.allow_groups);
  const denyUsers = asStringArray(doc.deny_users);
  const denyGroups = asStringArray(doc.deny_groups);
  if (allowUsers) rules.allow_users = allowUsers;
  if (allowGroups) rules.allow_groups = allowGroups;
  if (denyUsers) rules.deny_users = denyUsers;
  if (denyGroups) rules.deny_groups = denyGroups;
  if (doc.current_folder && typeof doc.current_folder === "object") {
    rules.current_folder = doc.current_folder as Record<string, unknown>;
  }
  return rules;
}
