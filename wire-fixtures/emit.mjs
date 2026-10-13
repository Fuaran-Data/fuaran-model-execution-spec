// SPDX-License-Identifier: Apache-2.0
//
// A deliberately minimal emitter for the model-execution conformance
// corpus — written against MODEL_EXECUTION_WIRE.md alone, with zero
// dependencies beyond Node's own crypto and fs.
//
// Its job is triangulation, not coverage. One emitter cannot tell its own
// accidents from the protocol: whatever it does becomes "the format"
// simply because it is the only thing producing bytes. So this script
// takes reference VALUES in unsorted, unstamped authoring order, applies
// the ordering, encoding and identity rules as the specification states
// them, and compares its output byte-for-byte against the committed
// fixtures. A divergence is a specification bug by definition — either
// the spec failed to state a rule, or it stated one that is not being
// followed.
//
//   node emit.mjs              # check against the committed corpus
//   node emit.mjs --write      # rewrite the round-trip and hash documents
//   node emit.mjs --self-test  # prove a mutated document makes this go red
//
// Reject and accept vectors are NOT emitted (§9.6): a reject vector is a
// document an implementation must refuse, so reproducing its bytes proves
// nothing, and an accept vector is deliberately not something a
// conformant emitter would produce.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ── canonical encoding (§3) ──────────────────────────────────────────

/** A RECORD: member order is the shape's declaration order (§3.1 r3). */
const rec = (pairs) => "{" + pairs.map(([k, v]) => JSON.stringify(k) + ":" + v).join(",") + "}";

/** A MAP: member order is ordinal ascending by key (§3.1 r4). */
const map = (entries, encode) =>
  "{" +
  Object.keys(entries)
    .sort(ordinal)
    .map((k) => JSON.stringify(k) + ":" + encode(entries[k]))
    .join(",") +
  "}";

const arr = (items) => "[" + items.join(",") + "]";
const str = (value) => JSON.stringify(value);
const bool = (value) => (value ? "true" : "false");

/** 32-bit integer: a JSON number (§3.1 r7). */
const i32 = (value) => {
  if (!Number.isInteger(value)) throw new Error(`not an int32: ${value}`);
  return String(value);
};

/** 64-bit integer: a sign-prefixed decimal STRING (§3.1 r8). */
const i64 = (value) => {
  const n = BigInt(value);
  return JSON.stringify((n < 0n ? "-" : "+") + (n < 0n ? -n : n).toString());
};

/** Real: a JSON number, shortest round-trip decimal (§3.1 r9). */
const real = (value) => {
  if (!Number.isFinite(value)) throw new Error(`non-finite value on the wire: ${value}`);
  return String(value);
};

/** Instant: ISO-8601 with an explicit offset (§3.1 r11). */
const instant = (value) => JSON.stringify(value);

/** Optional: absent is `null`, present is the value (§3.1 r5). */
const opt = (value, encode) => (value === null || value === undefined ? "null" : encode(value));

/** A late member (§3.1 rule 5): a member added after version 1 is OMITTED
 *  when it carries nothing — never `null`, never `{}` — so a document that
 *  states nothing in it keeps the bytes it had before the member existed. */
const late = (name, value, encode) => (value === null || value === undefined ? [] : [[name, encode(value)]]);

/** Ordinal (code-unit) comparison — never culture-sensitive (§3.1 r12). */
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const by = (key) => (a, b) => ordinal(key(a), key(b));

const sha256Hex = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

/** A content address: `{algorithm}:{lowercase hex}` (§4.1). */
const address = (bytes) => "sha256:" + sha256Hex(bytes);

// ── the minting canonicalisation (§4.5) ──────────────────────────────
//
// `canonical-json-sha256-v1`. Deliberately NOT §3's record rule: a
// specification's interior has no published field order, so EVERY object
// sorts — the §3.1 rule 4 map rule applied recursively — and there is no
// 64-bit-integer form inside a payload. Arrays keep their order, because
// an array's order is data.
//
// The canonical form is an intermediate: it is hashed and discarded. The
// payload on the wire is whatever the submitter rendered (§3.1 r13),
// which is why two payloads that differ only in member order mint one
// hash.

const SPEC_HASH_ALGORITHM = "canonical-json-sha256-v1";

const canonicalValue = (value) => {
  if (value === null) return "null";
  if (typeof value === "boolean") return bool(value);
  if (typeof value === "string") return str(value);
  if (typeof value === "number") {
    // Outside the rule's domain (§4.5): a value that does not survive a
    // round trip through binary64 would collide two specifications onto
    // one identity. Render it as a string instead.
    if (!Number.isFinite(value)) throw new Error(`non-finite number in a rendered specification: ${value}`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new Error(`${value} is not exactly representable as an IEEE-754 double — render it as a string (§4.5)`);
    return real(value);
  }
  if (Array.isArray(value)) return arr(value.map(canonicalValue));
  return map(value, canonicalValue);
};

/** §4.5 step 2 — the bytes that get hashed, never transmitted. */
const canonicalSpecPayload = (rendered) => canonicalValue(JSON.parse(rendered));

/** §4.5 step 3 — the value a submitter puts in `specHash`. */
const mintSpecHash = (rendered) => address(canonicalSpecPayload(rendered));

// ── shapes (§5) ──────────────────────────────────────────────────────

const contentRef = (c) =>
  rec([
    ["format", str(c.format)],
    ["hash", str(c.hash)],
    ["rowCount", opt(c.rowCount, i64)],
  ]);

const vintageRef = (v) =>
  rec([
    ["datasetId", str(v.datasetId)],
    ["version", i32(v.version)],
    ["contentRef", opt(v.contentRef, contentRef)],
  ]);

const resolvedVintage = (r) =>
  rec([
    ["ref", vintageRef(r.ref)],
    ["createdAt", instant(r.createdAt)],
    ["isLatest", bool(r.isLatest)],
  ]);

const gate = (g) =>
  rec([
    ["name", str(g.name)],
    ["threshold", real(g.threshold)],
    // The unit the threshold is stated in (§5.3), a late member.
    ...late("unit", g.unit, str),
    ["direction", str(g.direction)],
  ]);

const fitSubmission = (s) =>
  rec([
    ["vintage", vintageRef(s.vintage)],
    // Opaque: the bytes the submitter handed over, neither parsed nor
    // re-encoded (§3.1 r13).
    ["specPayload", str(s.specPayload)],
    ["specHash", str(s.specHash)],
    ["specHashAlgorithm", str(s.specHashAlgorithm)],
    ["providerKind", str(s.providerKind)],
    ["seed", i64(s.seed)],
    ["gates", arr([...s.gates].sort(by((g) => g.name)).map(gate))],
    ["submitterClass", str(s.submitterClass)],
  ]);

/** The one list that is NOT sorted: the receipt indexes into it (§5.3). */
const fitSubmissionBatch = (b) =>
  rec([
    ["batchId", str(b.batchId)],
    ["submissions", arr(b.submissions.map(fitSubmission))],
  ]);

const acceptedItem = (a) =>
  rec([
    ["index", i32(a.index)],
    ["jobId", str(a.jobId)],
  ]);

const rejectedItem = (r) =>
  rec([
    ["index", i32(r.index)],
    ["reason", refusal(r.reason)],
  ]);

const submissionReceipt = (r) =>
  rec([
    ["batchId", str(r.batchId)],
    ["itemCount", i32(r.itemCount)],
    ["accepted", arr([...r.accepted].sort((a, b) => a.index - b.index).map(acceptedItem))],
    ["rejected", arr([...r.rejected].sort((a, b) => a.index - b.index).map(rejectedItem))],
  ]);

const artifactRef = (a) =>
  rec([
    ["artifactId", str(a.artifactId)],
    ["contentHash", str(a.contentHash)],
    ["format", opt(a.format, str)],
  ]);

const gateVerdict = (v) =>
  rec([
    ["name", str(v.name)],
    ["threshold", real(v.threshold)],
    ...late("unit", v.unit, str),
    ["direction", str(v.direction)],
    ["observed", real(v.observed)],
    ["passed", bool(v.passed)],
  ]);

/** The join (§4.3). Its canonical bytes ARE the fit's identity. */
const compositeKey = (k) =>
  rec([
    ["specHash", str(k.specHash)],
    ["vintage", vintageRef(k.vintage)],
    ["seed", i64(k.seed)],
    ["providerId", str(k.providerId)],
    ["providerVersion", str(k.providerVersion)],
  ]);

const compositeKeyHash = (k) => address(compositeKey(k));

const timing = (t) =>
  rec([
    ["submittedAt", instant(t.submittedAt)],
    ["startedAt", opt(t.startedAt, instant)],
    ["completedAt", opt(t.completedAt, instant)],
    ["durationMs", opt(t.durationMs, i64)],
  ]);

const cost = (c) =>
  rec([
    ["unit", str(c.unit)],
    ["amount", real(c.amount)],
  ]);

const fitOutcome = (o) =>
  rec([
    // Never carried by the author: derived here, so a hand-authored
    // fixture cannot disagree with its own identity.
    ["compositeKeyHash", str(compositeKeyHash(o.compositeKey))],
    ["compositeKey", compositeKey(o.compositeKey)],
    ["artifactRef", opt(o.artifactRef, artifactRef)],
    // A non-finite diagnostic is omitted, never encoded (§5.4).
    ["diagnostics", map(finiteOnly(o.diagnostics), real)],
    // A late member: omitted when empty, and a unit goes with its
    // diagnostic when that diagnostic is omitted (§5.4).
    ...late("diagnosticUnits", unitsOf(o), (units) => map(units, str)),
    ["gateVerdicts", arr([...o.gateVerdicts].sort(by((v) => v.name)).map(gateVerdict))],
    ["status", str(o.status)],
    ["timing", timing(o.timing)],
    ["cost", opt(o.cost, cost)],
    ["annotations", map(o.annotations, str)],
    ["registeredAt", instant(o.registeredAt)],
  ]);

const finiteOnly = (entries) =>
  Object.fromEntries(Object.entries(entries).filter(([, v]) => Number.isFinite(v)));

/** The units of the diagnostics the outcome actually carries, or null when
 *  that leaves none. */
const unitsOf = (o) => {
  const kept = finiteOnly(o.diagnostics);
  const units = Object.entries(o.diagnosticUnits ?? {}).filter(([name]) => name in kept);
  return units.length === 0 ? null : Object.fromEntries(units);
};

const page = (p) =>
  rec([
    ["cursor", opt(p.cursor, str)],
    ["limit", i32(p.limit)],
  ]);

const registryQuery = (q) =>
  rec([
    ["specHashes", arr([...q.specHashes].sort(ordinal).map(str))],
    [
      "vintages",
      arr(
        [...q.vintages]
          .sort((a, b) => ordinal(a.datasetId, b.datasetId) || a.version - b.version)
          .map(vintageRef),
      ),
    ],
    ["statuses", arr([...q.statuses].sort(ordinal).map(str))],
    ["batchId", opt(q.batchId, str)],
    ["page", page(q.page)],
  ]);

const outcomePage = (p) =>
  rec([
    [
      "outcomes",
      arr([...p.outcomes].sort(by((o) => compositeKeyHash(o.compositeKey))).map(fitOutcome)),
    ],
    ["nextCursor", opt(p.nextCursor, str)],
  ]);

const scoreRequest = (s) =>
  rec([
    ["artifactKeyHash", str(s.artifactKeyHash)],
    ["input", vintageRef(s.input)],
    ["outputDatasetId", str(s.outputDatasetId)],
  ]);

// ── refusals (§5.7) ──────────────────────────────────────────────────
//
// A tagged record: `class` first, then that case's declared members in
// declaration order (§3.4). There is no nested single-member-object form.

const refusalMembers = {
  envelopeVersionMismatch: (r) => [
    ["received", i32(r.received)],
    ["accepted", arr([...r.accepted].sort((a, b) => a - b).map(i32))],
  ],
  unknownDocumentKind: (r) => [
    ["kind", str(r.kind)],
    ["known", arr([...r.known].sort(ordinal).map(str))],
  ],
  invalidSubmission: (r) => [["reason", str(r.reason)]],
  invalidQuery: (r) => [["reason", str(r.reason)]],
  unknownProvider: (r) => [
    ["kind", str(r.kind)],
    ["known", arr([...r.known].sort(ordinal).map(str))],
  ],
  budgetDenied: (r) => [
    ["quota", real(r.quota)],
    ["spent", real(r.spent)],
    ["unit", str(r.unit)],
  ],
  gateFailed: (r) => [["verdicts", arr([...r.verdicts].sort(by((v) => v.name)).map(gateVerdict))]],
  policyRefused: (r) => [["rule", str(r.rule)]],
  scopeUnavailable: () => [],
  forbidden: (r) => [["reason", str(r.reason)]],
  notFound: (r) => [
    ["what", str(r.what)],
    ["id", str(r.id)],
  ],
  substrateUnavailable: (r) => [["surface", str(r.surface)]],
  scoreRefused: (r) => [
    ["reason", str(r.reason)],
    ["detail", str(r.detail)],
  ],
  storageFailure: (r) => [["reason", str(r.reason)]],
  unspecified: (r) => [["message", str(r.message)]],
  // Registered after version 1, so its members are declared from its first
  // day: all present, `null` where a side states no unit (§5.7.1).
  gateUnitMismatch: (r) => [
    ["name", str(r.name)],
    ["unit", opt(r.unit, str)],
    ["reported", opt(r.reported, str)],
  ],
};

function refusal(r) {
  const members = refusalMembers[r.class];
  if (!members) throw new Error(`refusal class '${r.class}' is not in the closed vocabulary (§5.7.1)`);
  return rec([["class", str(r.class)], ...members(r)]);
}

// ── the envelope (§5.1) ──────────────────────────────────────────────

const bodies = {
  vintageRef,
  resolvedVintage,
  fitSubmission,
  fitSubmissionBatch,
  submissionReceipt,
  compositeKey,
  fitOutcome,
  registryQuery,
  outcomePage,
  scoreRequest,
  refusal,
};

const envelope = (kind, body) => {
  const encode = bodies[kind];
  if (!encode) throw new Error(`kind '${kind}' is not registered (§7.1)`);
  return rec([
    ["envelopeVersion", i32(1)],
    ["kind", str(kind)],
    ["body", encode(body)],
  ]);
};

// ── reference values ─────────────────────────────────────────────────
//
// Authored deliberately OUT of canonical order — unsorted gates, unsorted
// diagnostics, unsorted query filters — so the emitter, not the author,
// is responsible for the ordering the specification requires.

const panelRef = {
  datasetId: "quarterly-panel",
  version: 7,
  contentRef: {
    format: "parquet",
    hash: "sha256:9f2c8b1e4d6a0357c19e8b4f2a6d5c3018e7b9a4f1c6d2e830b5a7c94f1d6e28",
    rowCount: 148_920,
  },
};

/** The ordinary submitter shape: pinned by (datasetId, version) alone. */
const panelPin = { datasetId: "quarterly-panel", version: 7, contentRef: null };

const holdoutPin = { datasetId: "quarterly-holdout", version: 2, contentRef: null };

// The rendered specification crosses opaque (§3.1 r13). Its interior
// happens to be JSON here, which is what puts it inside §4.5's domain;
// nothing in the protocol knows or cares what the members mean. Note the
// members are NOT in sorted order: the rendering is whatever the
// submitter produced, and canonicalisation happens only for minting.
const specPayload =
  '{"family":"linear","response":"units","terms":["price","promotion","seasonality"],"prior":{"scale":2.5}}';

const altSpecPayload =
  '{"family":"linear","response":"units","terms":["price","promotion"],"prior":{"scale":1}}';

// Minted here rather than quoted (§4.5), so no fixture can carry a hash
// that disagrees with its own payload. Before the minting rule was
// specified these were constants, and a constant is exactly what a
// fixture family for a hashing rule cannot be built out of.
const specHash = mintSpecHash(specPayload);
const altSpecHash = mintSpecHash(altSpecPayload);

const specHashAlgorithm = SPEC_HASH_ALGORITHM;

const submission = {
  vintage: panelPin,
  specPayload,
  specHash,
  specHashAlgorithm,
  providerKind: "reference-linear",
  seed: 20260720,
  // Out of order on purpose.
  gates: [
    { name: "rmse", threshold: 0.25, direction: "atMost" },
    { name: "coverage", threshold: 0.9, direction: "atLeast" },
    { name: "r-squared", threshold: 0.72, direction: "atLeast" },
  ],
  submitterClass: "human",
};

const agentSubmission = {
  ...submission,
  vintage: holdoutPin,
  specPayload: altSpecPayload,
  specHash: altSpecHash,
  seed: -1,
  gates: [],
  submitterClass: "agent",
};

const scheduledSubmission = {
  ...submission,
  seed: 9007199254740993n, // beyond exact double range — the reason for §3.2 divergence 2
  submitterClass: "scheduled",
};

const batch = {
  batchId: "batch-2026-07-20-a",
  submissions: [submission, agentSubmission, scheduledSubmission],
};

const receipt = {
  batchId: batch.batchId,
  itemCount: 3,
  accepted: [
    { index: 2, jobId: "job-8c41" },
    { index: 0, jobId: "job-3a17" },
  ],
  rejected: [
    {
      index: 1,
      reason: { class: "unknownProvider", kind: "reference-linear", known: ["reference-null", "reference-mean"] },
    },
  ],
};

const primaryKey = {
  specHash,
  vintage: panelRef,
  seed: 20260720,
  providerId: "reference-linear",
  providerVersion: "1.4.0",
};

const secondaryKey = { ...primaryKey, specHash: altSpecHash, seed: -1 };

const outcome = {
  compositeKey: primaryKey,
  artifactRef: {
    artifactId: "artifact-4f19",
    contentHash: "sha256:2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3",
    format: "arrow-ipc",
  },
  // Out of order on purpose; the Infinity entry is dropped, not encoded.
  diagnostics: {
    rmse: 0.2137,
    "r-squared": 0.8413,
    coverage: 0.94,
    "log-likelihood": -1284.5,
    "condition-number": Number.POSITIVE_INFINITY,
  },
  gateVerdicts: [
    { name: "rmse", threshold: 0.25, direction: "atMost", observed: 0.2137, passed: true },
    { name: "coverage", threshold: 0.9, direction: "atLeast", observed: 0.94, passed: true },
    { name: "r-squared", threshold: 0.72, direction: "atLeast", observed: 0.8413, passed: true },
  ],
  status: "approved",
  timing: {
    submittedAt: "2026-07-20T09:30:00+00:00",
    startedAt: "2026-07-20T09:30:04+00:00",
    completedAt: "2026-07-20T09:47:11+00:00",
    durationMs: 1027000,
  },
  cost: { unit: "core-seconds", amount: 1027.5 },
  annotations: { reviewer: "unassigned", "run-note": "baseline refit on the new vintage" },
  registeredAt: "2026-07-20T09:47:12+00:00",
};

const gateFailedOutcome = {
  compositeKey: secondaryKey,
  artifactRef: null,
  diagnostics: { rmse: 0.4402, coverage: 0.61 },
  gateVerdicts: [
    { name: "coverage", threshold: 0.9, direction: "atLeast", observed: 0.61, passed: false },
    { name: "rmse", threshold: 0.25, direction: "atMost", observed: 0.4402, passed: false },
  ],
  status: "failed",
  timing: {
    submittedAt: "2026-07-20T09:30:00+00:00",
    startedAt: "2026-07-20T09:30:05+00:00",
    completedAt: "2026-07-20T09:38:40+00:00",
    durationMs: 515000,
  },
  cost: null,
  annotations: {},
  registeredAt: "2026-07-20T09:38:41+00:00",
};

// A backend that states what its diagnostics measure (§3.5, §5.4): an error
// in kilograms, a ratio that is dimensionless, a mean absolute error in
// pence, and one diagnostic it states no unit for. The Infinity entry is
// dropped, and its unit with it. Gates state the unit of their threshold,
// and the gate on the unit-less diagnostic states none.
const unitsKey = { ...primaryKey, seed: 20261013 };

const unitsOutcome = {
  compositeKey: unitsKey,
  artifactRef: {
    artifactId: "artifact-7c02",
    contentHash: "sha256:5e8a1f0c7d93b46e2a1c0f8b7d6e5a4938271605f4e3d2c1b0a9f8e7d6c5b4a3",
    format: "arrow-ipc",
  },
  diagnostics: {
    rmse: 1.25,
    "condition-number": Number.POSITIVE_INFINITY,
    mae: 37.5,
    elasticity: -0.42,
    "r-squared": 0.83,
  },
  diagnosticUnits: { "r-squared": "1", "condition-number": "1", rmse: "kg", mae: "c[GBP]" },
  gateVerdicts: [
    { name: "rmse", threshold: 2, unit: "kg", direction: "atMost", observed: 1.25, passed: true },
    { name: "elasticity", threshold: -1, direction: "atLeast", observed: -0.42, passed: true },
    { name: "r-squared", threshold: 0.7, unit: "1", direction: "atLeast", observed: 0.83, passed: true },
  ],
  status: "registered",
  timing: {
    submittedAt: "2026-10-13T08:00:00+00:00",
    startedAt: "2026-10-13T08:00:02+00:00",
    completedAt: "2026-10-13T08:06:40+00:00",
    durationMs: 398000,
  },
  cost: null,
  annotations: {},
  registeredAt: "2026-10-13T08:06:41+00:00",
};

const unitsSubmission = {
  ...submission,
  seed: 20261013,
  // Out of order on purpose; one gate states no unit.
  gates: [
    { name: "rmse", threshold: 2, unit: "kg", direction: "atMost" },
    { name: "elasticity", threshold: -1, direction: "atLeast" },
    { name: "r-squared", threshold: 0.7, unit: "1", direction: "atLeast" },
  ],
};

const query = {
  // Out of order on purpose.
  specHashes: [altSpecHash, specHash],
  vintages: [holdoutPin, panelPin],
  statuses: ["registered", "approved", "accepted"],
  batchId: batch.batchId,
  page: { cursor: null, limit: 50 },
};

const queryAny = {
  specHashes: [],
  vintages: [],
  statuses: [],
  batchId: null,
  page: { cursor: "b3V0Y29tZS1jdXJzb3ItMg", limit: 1000 },
};

const filledPage = { outcomes: [gateFailedOutcome, outcome], nextCursor: "b3V0Y29tZS1jdXJzb3ItMg" };
const lastPage = { outcomes: [outcome], nextCursor: null };
const unitsPage = { outcomes: [outcome, unitsOutcome], nextCursor: null };

const score = {
  artifactKeyHash: compositeKeyHash(primaryKey),
  input: holdoutPin,
  outputDatasetId: "quarterly-holdout-predictions",
};

// ── the spec-hash family (§4.5, §9.4) ────────────────────────────────
//
// Minting is only ever done inside a submission, so these are ordinary
// `fitSubmission` documents that differ from one another in exactly one
// member — the rendered payload. Everything else is held constant so a
// reader comparing two of them sees the rule and nothing else.
//
// `canonicalForm` and `permutedForm` are the SAME specification authored
// two ways. Their documents differ; their `specHash` does not. That pair
// is the family's reason for existing.

const mintingSubmission = (rendered) => ({
  vintage: panelPin,
  specPayload: rendered,
  specHash: mintSpecHash(rendered),
  specHashAlgorithm,
  providerKind: "reference-linear",
  seed: 20260720,
  gates: [],
  submitterClass: "human",
});

/** Already canonical: the rule is a normalisation, so this is its fixed point. */
const canonicalForm =
  '{"family":"linear","prior":{"scale":2.5},"response":"units","terms":["price","promotion","seasonality"]}';

/** The same value, members permuted at every level and indented. The term
 *  list is deliberately NOT permuted: an array's order is data, and
 *  permuting it would be a different specification, not a different
 *  rendering of this one. */
const permutedForm = `{
  "terms": [ "price", "promotion", "seasonality" ],
  "response": "units",
  "prior": { "scale": 2.5 },
  "family": "linear"
}`;

/** Number normalisation: negative zero, an exponent, a trailing zero, a
 *  value that keeps its exponent, and — the guidance §4.5 gives for a
 *  value outside binary64 — a large integer carried as a string. */
const numberForms =
  '{"zero":-0,"exponent":1e3,"trailing":1.50,"tiny":1e-7,' +
  '"identifier":"+9007199254740993","ratio":0.1,"negative":-2.5e-3,"integral":42.0}';

/** Escaping, literal non-ASCII, and the ordering edge case: keys sort by
 *  UTF-16 CODE UNIT (§3.1 r12), so the astral key sorts BEFORE U+FFFD.
 *  Sorting by code point would put it after — the one permutation that
 *  distinguishes the two rules. */
const unicodeForms =
  '{"quote":"a \\"quoted\\" term","backslash":"a\\\\b","control":"tab\\there",' +
  '"nonAscii":"naïve — αβγ","astral":"😀",' +
  '"�":"replacement-key","𐀀":"astral-key"}';

/** Nesting: an empty object, an empty array, a null, a boolean, and an
 *  array of objects whose ORDER is preserved while each element's
 *  members sort. */
const nestedForms =
  '{"model":{"terms":[{"name":"price","transform":{"shift":1,"kind":"log"}},' +
  '{"transform":null,"name":"promotion"}],"intercept":true},"notes":[],"meta":{},"version":"2"}';

const mintingForms = {
  "spec-hash/canonical-form": canonicalForm,
  "spec-hash/permuted-form": permutedForm,
  "spec-hash/numbers": numberForms,
  "spec-hash/unicode": unicodeForms,
  "spec-hash/nested": nestedForms,
};

const refusals = {
  "envelope-version-mismatch": { class: "envelopeVersionMismatch", received: 2, accepted: [1] },
  "unknown-document-kind": {
    class: "unknownDocumentKind",
    kind: "assemblyRequest",
    known: ["fitOutcome", "fitSubmission", "refusal"],
  },
  "invalid-submission": { class: "invalidSubmission", reason: "gate 'coverage' declared twice" },
  "invalid-query": { class: "invalidQuery", reason: "page.limit must be between 1 and 1000" },
  "unknown-provider": {
    class: "unknownProvider",
    kind: "hierarchical-bayes",
    known: ["reference-linear", "reference-mean", "reference-null"],
  },
  "budget-denied": { class: "budgetDenied", quota: 5000, spent: 5127.25, unit: "core-seconds" },
  "gate-failed": { class: "gateFailed", verdicts: gateFailedOutcome.gateVerdicts },
  "policy-refused": { class: "policyRefused", rule: "agent-submissions-require-approved-vintage" },
  "scope-unavailable": { class: "scopeUnavailable" },
  forbidden: { class: "forbidden", reason: "the caller's role does not permit submission" },
  "not-found": { class: "notFound", what: "outcome", id: compositeKeyHash(secondaryKey) },
  "substrate-unavailable": { class: "substrateUnavailable", surface: "scoring" },
  "score-refused": {
    class: "scoreRefused",
    reason: "input-schema-mismatch",
    detail: "column 'promotion' absent from the input vintage",
  },
  "storage-failure": { class: "storageFailure", reason: "object store returned 503 after 3 attempts" },
  unspecified: { class: "unspecified", message: "the executor reached a condition it has no class for" },
  // §5.3's gate rule: a threshold in grams against an error reported in
  // kilograms is refused by name, never converted.
  "gate-unit-mismatch": { class: "gateUnitMismatch", name: "rmse", unit: "g", reported: "kg" },
};

// ── the documents ────────────────────────────────────────────────────

const documents = () => {
  const out = {
    // The envelope family's own vector: the smallest complete document
    // there is, so the version-negotiation vectors beside it differ from
    // it in exactly one member.
    "envelope/v1.json": envelope("vintageRef", { datasetId: "minimal", version: 1, contentRef: null }),

    "vintage-ref/ref.json": envelope("vintageRef", panelRef),
    "vintage-ref/ref-unpinned.json": envelope("vintageRef", panelPin),
    "vintage-ref/resolved.json": envelope("resolvedVintage", {
      ref: panelRef,
      createdAt: "2026-07-19T22:04:00+00:00",
      isLatest: true,
    }),

    "fit-submission/submission.json": envelope("fitSubmission", submission),
    "fit-submission/batch.json": envelope("fitSubmissionBatch", batch),
    "fit-submission/receipt.json": envelope("submissionReceipt", receipt),
    "fit-submission/submission-gate-unit.json": envelope("fitSubmission", unitsSubmission),

    "fit-outcome/composite-key.json": envelope("compositeKey", primaryKey),
    "fit-outcome/outcome.json": envelope("fitOutcome", outcome),
    "fit-outcome/outcome-gate-failed.json": envelope("fitOutcome", gateFailedOutcome),
    "fit-outcome/outcome-units.json": envelope("fitOutcome", unitsOutcome),

    "registry-query/query.json": envelope("registryQuery", query),
    "registry-query/query-any.json": envelope("registryQuery", queryAny),
    "registry-query/page.json": envelope("outcomePage", filledPage),
    "registry-query/page-last.json": envelope("outcomePage", lastPage),
    "registry-query/page-units.json": envelope("outcomePage", unitsPage),

    "score-request/request.json": envelope("scoreRequest", score),
  };

  for (const [slug, value] of Object.entries(refusals)) {
    out[`refusal/${slug}.json`] = envelope("refusal", value);
  }

  for (const [id, rendered] of Object.entries(mintingForms)) {
    out[`${id}.json`] = envelope("fitSubmission", mintingSubmission(rendered));
  }

  return out;
};

/** The digest a `hash` vector's manifest entry records. Two recomputations
 *  live here, and §9.4 is the table that says which family asks for
 *  which: a composite-key content address (§4.3), or a minted `specHash`
 *  (§4.5). */
const hashVectorDigests = () => {
  const out = {
    "fit-outcome/composite-key": compositeKeyHash(primaryKey),
    "fit-outcome/outcome": compositeKeyHash(outcome.compositeKey),
    "fit-outcome/outcome-gate-failed": compositeKeyHash(gateFailedOutcome.compositeKey),
    "fit-outcome/outcome-units": compositeKeyHash(unitsOutcome.compositeKey),
  };
  for (const [id, rendered] of Object.entries(mintingForms)) out[id] = mintSpecHash(rendered);
  return out;
};

/** §4.5 step 2's intermediate, written into the manifest so a diverging
 *  implementation can see WHERE it diverged (§9.4). */
const canonicalPayloads = () =>
  Object.fromEntries(
    Object.entries(mintingForms).map(([id, rendered]) => [id, canonicalSpecPayload(rendered)]),
  );

// ── run ──────────────────────────────────────────────────────────────

const write = process.argv.includes("--write");
const selfTest = process.argv.includes("--self-test");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const emitted = documents();

let failures = 0;
let checked = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL ${message}`);
};

/** Refresh the index's DERIVED fields in place, preserving its hand
 *  formatting. `--write` exists for a deliberate specification change,
 *  and such a change moves every digest at once; an index left stating
 *  the old ones is a corpus whose own checker cannot start, and hand-
 *  transcribing them is the step that goes wrong. Nothing here is a
 *  judgement — every value rewritten is recomputed and re-checked
 *  independently on an ordinary run, by this script against its own
 *  output and by validate.mjs against the bytes on disk. */
function refreshManifest() {
  const path = join(here, "manifest.json");
  const digests = hashVectorDigests();
  const canonical = canonicalPayloads();
  let id = null;

  const rewritten = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => {
      const declared = /^\s*"id":\s*"([^"]+)"/.exec(line);
      if (declared) {
        id = declared[1];
        return line;
      }
      const entry = manifest.vectors.find((v) => v.id === id);
      if (!entry) return line;

      const restate = (key, value) =>
        `${/^\s*/.exec(line)[0]}${JSON.stringify(key)}: ${JSON.stringify(value)}${line.trimEnd().endsWith(",") ? "," : ""}`;

      if (/^\s*"sha256":/.test(line))
        return restate("sha256", createHash("sha256").update(readFileSync(join(here, entry.file))).digest("hex"));
      if (/^\s*"digest":/.test(line) && digests[id]) return restate("digest", digests[id]);
      if (/^\s*"canonicalPayload":/.test(line) && canonical[id]) return restate("canonicalPayload", canonical[id]);
      return line;
    })
    .join("\n");

  writeFileSync(path, rewritten, "utf8");
}

if (write) {
  for (const [file, document] of Object.entries(emitted)) writeFileSync(join(here, file), document, "utf8");
  refreshManifest();
  console.log(`wrote ${Object.keys(emitted).length} documents and refreshed the index's derived fields`);
  process.exit(0);
}

// 1. Every emitted document reproduces the committed bytes exactly.
for (const [file, document] of Object.entries(emitted)) {
  const committed = readFileSync(join(here, file), "utf8");
  checked += 1;

  if (committed !== document) {
    fail(`${file}\n  committed: ${committed}\n  emitted  : ${document}`);
  } else if (!selfTest) {
    console.log(`ok   ${file}`);
  }
}

// 2. The digests the manifest records are reproducible from these bytes —
//    otherwise the corpus and its own index disagree.
for (const [file, document] of Object.entries(emitted)) {
  const entry = manifest.vectors.find((v) => v.file === file);
  if (!entry) fail(`${file} is not enumerated by the manifest`);
  else if (sha256Hex(document) !== entry.sha256)
    fail(`${file} digest ${sha256Hex(document)} != manifest ${entry.sha256}`);
}

// 3. Every `hash` vector's identity digest, recomputed from the composite
//    key rather than read off the document (§4.3).
for (const [id, digest] of Object.entries(hashVectorDigests())) {
  const entry = manifest.vectors.find((v) => v.id === id);
  if (!entry) fail(`${id} is not enumerated by the manifest`);
  else if (entry.kind !== "hash") fail(`${id} should be a hash vector, manifest says '${entry.kind}'`);
  else if (entry.digest !== digest) fail(`${id} identity digest ${digest} != manifest ${entry.digest}`);
  else if (!selfTest) console.log(`ok   ${id} identity digest`);
}

// 3b. The canonical bytes a spec-hash vector records are the ones the
//     minting rule actually produces (§4.5 step 2, §9.4). Recording the
//     intermediate is what lets a diverging implementation see WHERE it
//     diverged rather than only that it did.
for (const [id, bytes] of Object.entries(canonicalPayloads())) {
  const entry = manifest.vectors.find((v) => v.id === id);
  if (!entry) fail(`${id} is not enumerated by the manifest`);
  else if (entry.canonicalPayload !== bytes)
    fail(`${id} canonical bytes\n  manifest: ${entry.canonicalPayload}\n  minted  : ${bytes}`);
  else if (!selfTest) console.log(`ok   ${id} canonical bytes`);
}

// 3c. The property the whole family exists for, asserted rather than
//     left to be inferred from two equal digests (§4.2 rule 3).
if (canonicalSpecPayload(canonicalForm) !== canonicalSpecPayload(permutedForm))
  fail("one specification, two authoring orders, two sets of canonical bytes — §4.5 is not being applied");
else if (!selfTest) console.log("ok   permuted authoring order mints one identity");

// 4. No emitter may claim to have emitted a reject or accept vector.
for (const vector of manifest.vectors) {
  if ((vector.kind === "reject" || vector.kind === "accept") && emitted[vector.file] !== undefined)
    fail(`${vector.id} is a ${vector.kind} vector and MUST NOT be emitted (§9.6)`);
}

// 5. Self-test: a conformance script is exactly the kind of code that
//    passes by doing nothing, so prove it goes red (§9.3).
if (selfTest) {
  const probes = [
    ["a mutated byte in a committed document", () => readFileSync(join(here, "fit-outcome/outcome.json"), "utf8").replace("approved", "retired") === emitted["fit-outcome/outcome.json"]],
    ["record members sorted instead of declaration-ordered", () => rec([["b", "1"], ["a", "2"]]) === rec([["a", "2"], ["b", "1"]])],
    ["map members left unsorted", () => map({ b: 1, a: 2 }, real) === '{"b":1,"a":2}'],
    ["a 64-bit integer emitted without its sign prefix", () => i64(7) === '"7"'],
    ["an unregistered refusal class silently encoded", () => { try { refusal({ class: "notAClass" }); return true; } catch { return false; } }],
    ["a non-finite real reaching the wire", () => { try { real(Number.NaN); return true; } catch { return false; } }],
    // §4.5. Each of these is a plausible way to get minting wrong, and
    // every one of them produces a corpus that still looks green if the
    // rule is only ever exercised through its own implementation.
    ["a payload hashed as rendered instead of canonicalised", () => mintSpecHash(permutedForm) === address(permutedForm)],
    ["objects left unsorted when minting", () => canonicalSpecPayload('{"b":1,"a":2}') === '{"b":1,"a":2}'],
    ["an array sorted when minting — an array's order is data", () => canonicalSpecPayload('{"t":["b","a"]}') === '{"t":["a","b"]}'],
    ["negative zero minted as -0 rather than 0", () => canonicalSpecPayload('{"z":-0}') === '{"z":-0}'],
    ["keys ordered by code point rather than code unit", () => canonicalSpecPayload('{"�":1,"\u{10000}":2}') !== '{"\u{10000}":2,"�":1}'],
    ["a number outside binary64 minted rather than refused", () => { try { mintSpecHash('{"n":9007199254740993}'); return true; } catch { return false; } }],
  ];

  for (const [name, tripped] of probes) {
    if (tripped()) fail(`self-test: the emitter did NOT reject "${name}"`);
    else console.log(`ok   self-test rejects ${name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} divergence(s) between an independent emitter and the corpus — that is a specification bug.`);
  process.exit(1);
} else if (checked === 0) {
  console.error("no documents were checked");
  process.exit(1);
} else {
  console.log(`\n${checked} documents reproduced byte-identically by an independent emitter.`);
}
