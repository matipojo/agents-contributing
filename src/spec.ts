import { parse as parseYaml } from "yaml";

export const KNOWN_VERSIONS = new Set([1]);
export const KNOWN_TYPES = new Set([
  "triage", "reproduce", "pr", "tests", "review", "docs", "translate", "answer",
]);
export const OUTPUTS = new Set(["comment", "pr", "review", "failing-test-pr"]);
const CODE_OUTPUTS = new Set(["pr", "failing-test-pr"]);
const REQUIRE_VALUES = new Set(["tests", "disclosure", "changelog"]);
const HELP_FIELDS = new Set(["enabled", "scope", "output", "require", "forbidden_paths", "max_diff_lines", "limits"]);
const LIMIT_FIELDS = ["max_open_agent_contributions", "max_per_contributor_per_week", "cooldown_hours"] as const;
const TOP_FIELDS = new Set(["version", "limits", "contact", "providers"]);
export const HELP_PREFIX = "help_";
const SCOPE_RE = /^(label|path):\S+$/;

export type Output = "comment" | "pr" | "review" | "failing-test-pr";

export interface Limits {
  max_open_agent_contributions: number;
  max_per_contributor_per_week: number;
  cooldown_hours: number;
}

export interface HelpType {
  enabled?: boolean;
  scope?: string;
  output?: Output;
  require?: string[];
  forbidden_paths?: string[];
  max_diff_lines?: number;
  limits?: Partial<Limits>;
}

export interface AgentsContributing {
  version: number;
  [helpType: `help_${string}`]: HelpType;
  limits: Limits;
  contact?: string;
  providers?: { allow?: string[]; deny?: string[] };
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  data?: AgentsContributing;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

export function extractFrontMatter(text: string): { yaml?: string; error?: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) {
    return { error: "No YAML front matter found. The file must start with a block between '---' lines." };
  }
  return { yaml: m[1] ?? "" };
}

export function validateText(text: string): ValidationResult {
  const fm = extractFrontMatter(text);
  if (fm.error) return { errors: [fm.error], warnings: [] };
  let data: unknown;
  try {
    data = parseYaml(fm.yaml ?? "");
  } catch (e) {
    return { errors: [`Front matter is not valid YAML: ${(e as Error).message}`], warnings: [] };
  }
  return validateData(data);
}

export function validateData(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(data)) {
    return { errors: ["Front matter must be a YAML mapping."], warnings };
  }

  for (const key of Object.keys(data)) {
    if (!TOP_FIELDS.has(key) && !key.startsWith(HELP_PREFIX)) {
      warnings.push(`Unknown top-level field '${key}' (ignored by runners).`);
    }
  }
  if ("help" in data) {
    errors.push("'help' is not a field. Write each help type as its own top-level field, for example 'help_triage'.");
  }

  const version = data.version;
  if (version === undefined) {
    errors.push("Missing required field 'version'.");
  } else if (typeof version !== "number" || !KNOWN_VERSIONS.has(version)) {
    errors.push(`Unknown version '${String(version)}'. Runners will skip this repository.`);
  }

  const help = Object.entries(data).filter(([key]) => key.startsWith(HELP_PREFIX));
  if (help.length === 0) {
    errors.push("No help type defined. Add at least one 'help_<type>' field, for example 'help_reproduce'.");
  }

  let enabledCount = 0;
  for (const [where, cfg] of help) {
    const name = where.slice(HELP_PREFIX.length);
    if (!name) {
      errors.push(`'${where}': missing help type name after '${HELP_PREFIX}'.`);
      continue;
    }
    if (!KNOWN_TYPES.has(name)) {
      warnings.push(`${where}: custom help type. Runners that do not know it will skip it.`);
    }
    if (!isRecord(cfg)) {
      errors.push(`${where}: must be a mapping.`);
      continue;
    }
    for (const key of Object.keys(cfg)) {
      if (!HELP_FIELDS.has(key)) warnings.push(`${where}: unknown field '${key}'.`);
    }
    const enabled = cfg.enabled ?? false;
    if (typeof enabled !== "boolean") {
      errors.push(`${where}.enabled: must be true or false.`);
      continue;
    }
    if (!enabled) continue;
    enabledCount++;

    const scope = cfg.scope;
    if (!scope) {
      errors.push(`${where}: enabled but has no 'scope', so it applies to nothing.`);
    } else if (typeof scope !== "string" || !SCOPE_RE.test(scope)) {
      errors.push(`${where}.scope: must look like 'label:<name>' or 'path:<dir>'.`);
    }

    const output = cfg.output;
    if (typeof output !== "string" || !OUTPUTS.has(output)) {
      errors.push(`${where}.output: must be one of ${[...OUTPUTS].join(", ")}.`);
    }

    const req = cfg.require ?? [];
    if (!Array.isArray(req)) {
      errors.push(`${where}.require: must be a list.`);
    } else {
      for (const r of req) {
        if (!REQUIRE_VALUES.has(String(r))) warnings.push(`${where}.require: unknown requirement '${String(r)}'.`);
      }
    }

    const isCode = typeof output === "string" && CODE_OUTPUTS.has(output);
    const fp = cfg.forbidden_paths ?? [];
    if (!Array.isArray(fp)) {
      errors.push(`${where}.forbidden_paths: must be a list.`);
    } else if (isCode && !fp.includes(".github/")) {
      warnings.push(`${where}: produces code but does not forbid '.github/'. Workflow changes are the riskiest kind.`);
    }

    if (cfg.limits !== undefined) {
      if (!isRecord(cfg.limits)) {
        errors.push(`${where}.limits: must be a mapping.`);
      } else {
        checkLimits(cfg.limits, `${where}.limits`, false, errors, warnings);
      }
    }

    const mdl = cfg.max_diff_lines;
    if (mdl !== undefined && !(isNonNegInt(mdl) && mdl > 0)) {
      errors.push(`${where}.max_diff_lines: must be a positive integer.`);
    } else if (mdl === undefined && isCode) {
      warnings.push(`${where}: no 'max_diff_lines'. Large agent PRs are hard to review.`);
    }
  }

  if (help.length > 0 && enabledCount === 0) {
    warnings.push("No help type is enabled. Runners will not contribute.");
  }

  if (!isRecord(data.limits)) {
    errors.push("Missing 'limits' map.");
  } else {
    checkLimits(data.limits, "limits", true, errors, warnings);
  }

  const providers = data.providers;
  if (providers !== undefined) {
    const ok = isRecord(providers)
      && Object.keys(providers).every((k) => k === "allow" || k === "deny")
      && Object.values(providers).every(Array.isArray);
    if (!ok) errors.push("providers: must be a mapping with 'allow' and/or 'deny' lists.");
  }

  return errors.length === 0
    ? { errors, warnings, data: data as unknown as AgentsContributing }
    : { errors, warnings };
}

function checkLimits(
  limits: Record<string, unknown>, where: string, required: boolean, errors: string[], warnings: string[],
): void {
  for (const key of LIMIT_FIELDS) {
    const val = limits[key];
    if (val === undefined) {
      if (required) errors.push(`${where}.${key}: required.`);
    } else if (!isNonNegInt(val)) {
      errors.push(`${where}.${key}: must be a non-negative integer.`);
    }
  }
  for (const key of Object.keys(limits)) {
    if (!(LIMIT_FIELDS as readonly string[]).includes(key)) warnings.push(`${where}: unknown field '${key}'.`);
  }
}

/** The limits that apply to one help type: its own limits, with each missing field taken from the top-level limits. */
export function effectiveLimits(data: AgentsContributing, type: string): Limits {
  return { ...data.limits, ...data[`${HELP_PREFIX}${type}`]?.limits };
}

/** The marker line every contribution must end with. */
export function contributionMarker(m: {
  type: string; provider: string; model: string; runner: string; from: string;
}): string {
  return `agents-contributing: v1 type=${m.type} provider=${m.provider} model=${m.model} runner=${m.runner} from=${m.from}`;
}
