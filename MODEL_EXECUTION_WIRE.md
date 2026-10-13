# Model-execution wire specification

**Version 1 · Apache-2.0**

A model execution is the act of fitting a model to a pinned body of data under a stated
configuration, and of holding on to what came out. This document specifies the wire documents that
let a party which *decides what to fit* and a party which *runs the fit* exchange that work
**language-neutrally**, without either side seeing inside the other: an implementation in any
language participates by *conforming* — emitting and consuming these documents byte-correctly — not
by adopting any particular stack, statistical framework, or execution model.

The load-bearing asymmetry is deliberate. The **submitter** owns the model specification and never
hands it over as structure; it crosses as an opaque payload with a hash the submitter minted. The
**executor** owns the execution record — datasets, jobs, artifacts, gate verdicts — and never
interprets the payload it stores. Neither can reconstruct the other's model of the world from what
crosses, and the composite key of §4.3 is what nonetheless lets two records that never shared a type
name the same fit.

Everything normative is in §1–§9. The conformance corpus in [`wire-fixtures/`](wire-fixtures/) is the
executable half: an implementation certifies by round-tripping, re-hashing, refusing and accepting
the fixtures its profile requires. Where this prose and the corpus disagree, that is a defect in
this document, and the corpus is the tie-breaker — it is emitted from running code, and prose is not.

**Shared conventions.** This specification is written under the conventions stated in
`SPEC_CONVENTIONS.md`, published with the tree wire specification — canonical bytes, the corpus as
oracle, the manifest as the authoritative enumeration, declared conformance scope, forward coupling,
and how a specification in this family extends. They are normative here; where this document
diverges from one, it says so.

**Key words.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are used in the RFC 2119 sense.

---

## 1. Scope

Six shape families are specified, plus the envelope every document rides in.

| Family | Answers | Emitted by |
|---|---|---|
| **envelope** | what version and shape is this document? | everyone |
| **vintage ref** | which exact body of data is this about? | submitter (as a pin), executor (as a resolution) |
| **fit submission** | fit this configuration, on this data, under these gates | submitter |
| **fit outcome** | what came out, and what names it forever? | executor |
| **score request** | apply a registered artifact to this data | submitter |
| **registry query** | which outcomes match, and give them to me a page at a time | submitter asks, executor answers |
| **refusal** | why not, in a form a program can branch on | executor |

**In scope:** the documents, their canonical encoding, the identity rule that joins two independent
records of the same fit, the minting canonicalisation the identity rule rests on, the
version-negotiation rule, the closed refusal vocabulary and its extension rule, and the registries of
open string constants.

**Out of scope, deliberately:**

- **Transport and endpoints.** This specification defines documents, not routes. The same documents
  ride in-process, over HTTP, through a queue, or in a file on disk, unchanged.
- **The model specification itself.** The payload crosses opaque (§5.3). What is inside it, how it
  was authored, and what framework consumes it are the submitter's and the provider's business
  respectively, and are invisible here by construction.
- **Numerical method, correctness and quality.** Nothing in this specification asserts that a fit is
  good. Gates report thresholds an executor evaluated; judging a model remains a human act on
  whichever side owns it.
- **Authentication, tenancy and authorisation.** A participant executes every request under a scope
  it resolves for itself. **Scope is never wire-supplied** (§6.2), which is why no document here
  carries one.
- **Dataset authoring.** How a body of data came to exist — ingestion, joins, transforms — is not
  described. A vintage is referenced, never constructed (§5.2).
- **What a specification says.** §4.5 specifies how a rendered specification is reduced to bytes and
  hashed. It says nothing whatever about what those bytes *mean*: the vocabulary inside the payload
  is the submitter's, and remains invisible here (§6.1).

---

## 2. Conformance profiles

Conformance stratifies by what a participant *does*. Requiring every family of every party would
make a read-only consumer of results implement submission validation it will never perform. So an
implementation certifies against a **named profile**, and a claim of conformance MUST name it.

| Profile | Required families | What participation it grants |
|---|---|---|
| **observer** | envelope, vintage ref, fit outcome, refusal | Read an execution record: decode outcomes, recompute the identity that names them, and understand a refusal. Emits nothing. |
| **submitter** | observer + fit submission, score request, registry query | The above, plus authoring work: submit fits singly or in batches, request scoring, and page through the registry. |
| **executor** | every family | The above from the answering side: consume every request shape, emit every answer shape, and — the obligation unique to this profile — **refuse every `reject` vector with the class the manifest names**. |

Profiles are cumulative and the corpus is partitioned accordingly: `manifest.json` maps each profile
to its required families, and every vector declares the lowest profile that must run it.

**Refusal is the executor's obligation, with one exception.** An observer or submitter that
encounters a malformed document SHOULD refuse it, but a corpus reject vector normally describes an
executor's obligation on its request path, where a document accepted in error becomes a job that
runs. Such vectors carry `"profile": "executor"`.

The exception is the minting rule of §4.5, which the executor is *forbidden* to check (§4.2 rule 2)
and which therefore cannot be an executor's obligation at all. Its reject vector carries
`"profile": "submitter"` and describes a **pre-emit** obligation: a document a conformant submitter
never emits, rather than one a receiver refuses. A reject vector's `profile` is the party that must
catch it, and reading it as always meaning "executor" is the mistake this paragraph exists to
prevent.

**Certifying the minting rule is not re-deriving on the wire.** The `spec-hash` family is in the
submitter's profile, and therefore — profiles being cumulative — in the executor's. Running the
family in a harness is a self-check against a fixture; §4.2 rule 2 is unchanged and unconditional.
Whatever an executor's harness can compute, its request path stores the value it was handed.

**The thin-adapter path is intended.** An executor need not be a platform. A conformant adapter in
front of an existing job runner — one that resolves a vintage, hands the opaque payload to whatever
already fits models, and reports what came back in these shapes — is a first-class executor,
indistinguishable on the wire from anything larger. §5 is written so that implementing it is a small
amount of pure code.

---

## 3. Canonical encoding

Every document in this specification is a **canonical JSON** document. Canonical means: given the
same values, every conformant emitter produces the same bytes, so a hash over those bytes is a
stable identity. Identity is the whole point of §4, so the rules are stated exhaustively rather than
left to a library.

### 3.1 Rules

1. **No insignificant whitespace.** No spaces, no newlines, no indentation, anywhere.
2. **UTF-8**, no byte-order mark.
3. **A record's member order is its declaration order**, as given by the field tables in §5. It is
   *not* lexicographic.
4. **A map's member order is ordinal ascending by key.** A map (§3.3) is the one object whose keys
   are data rather than schema, so it is the one object that sorts.
5. **Every declared member is present.** An absent optional value is encoded as `null`; it is never
   omitted. A map with no entries is `{}`; a list with no items is `[]`. **The one exception is a
   late member**: a member added to a record after version 1, under §8, and marked *late* where §5
   declares it. A late member is **omitted** when it carries nothing — absent, or a map with no
   entries — and is never encoded as `null` or `{}`. That is what makes adding one additive: a
   document that states nothing in it keeps exactly the bytes it had before the member existed, so no
   document emitted earlier becomes non-canonical. A reader treats an omitted late member, or one that
   arrives as `null`, as carrying nothing.
6. **Strings** escape `"`, `\`, and characters below U+0020 (using `\u00XX` where no short escape
   exists). Characters at or above U+0020 — including all non-ASCII — are emitted literally.
7. **32-bit integers** are JSON numbers.
8. **64-bit integers are decimal strings with an explicit sign** (`"+8388608"`, `"-1"`, `"+0"`).
   See §3.2.
9. **Real numbers are JSON numbers** serialised by the ECMAScript `Number::toString` algorithm — the
   shortest decimal that round-trips to the same IEEE-754 double (this is RFC 8785 §3.2.2.3, adopted
   verbatim). **Non-finite values MUST NOT appear on the wire**; §5 states per field what an emitter
   does instead.
10. **Booleans** are `true` / `false`.
11. **Instants** are strings: ISO-8601 with an explicit UTC offset, e.g.
    `"2026-07-20T09:30:00+00:00"`. Whole seconds unless §5 says otherwise.
12. **Arrays** preserve the order the emitter produced; where a field's ordering is load-bearing, §5
    states the sort key, and **a sort is ordinal (code-unit) and MUST NOT be culture-sensitive** — a
    locale-dependent sort makes a document's hash depend on the machine that produced it. Where §5
    marks a list *submitter-ordered*, the order is data and MUST be preserved exactly.
13. **Opaque payloads ride as strings.** Where §5 marks a field *opaque*, its value is a JSON
    **string** and the receiver MUST NOT parse, normalise, re-indent or re-encode it. Its bytes are
    the value. This is what lets a payload cross a party that does not understand it and arrive with
    the hash it was minted under still correct.

### 3.2 Divergences from RFC 8785 (JCS), field by field

This encoding is close to JCS but is **not** JCS. Every divergence is deliberate and enumerated
here; there are no others.

| # | JCS | Here | Why |
|---|---|---|---|
| 1 | Object members sorted lexicographically by UTF-16 code unit. | **Records** in declaration order (§3.1 rule 3); **maps** sorted (rule 4). | The shapes are versioned records with a published field order; that order is part of the contract, and re-sorting it would make a document's structure depend on the accident of its field names. An implementation that sorts record members produces a **different, non-conformant document** — this is the divergence most likely to bite, so check it first. |
| 2 | All numbers serialised as ECMAScript doubles. | 32-bit integers as JSON numbers; **64-bit integers as sign-prefixed decimal strings**; real numbers per JCS. | A seed and a row count are 64-bit integers, and a 64-bit integer is not exactly representable as a double. Silently rounding the seed that reproduces a fit is worse than encoding it as text. The sign prefix is always present, including for zero. |
| 3 | Says nothing about absent members. | Optional members are always present, `null` when absent — except a late member, which is omitted when it carries nothing (§3.1 rule 5). | A reader that distinguishes "absent" from "null" cannot be written against a document where emitters disagree about which to produce. Fixing it to `null` removes the question. A member added later cannot be fixed the same way without re-encoding every document written before it. |
| 4 | Says nothing about instants. | ISO-8601 strings with an explicit offset. | An instant with no offset is ambiguous, and an epoch number would re-open divergence 2. |
| 5 | Says nothing about opacity. | §3.1 rule 13. | A canonicalising relay that "tidies" a payload invalidates a hash it cannot recompute, and the failure surfaces as a mismatched artifact identity a long way from its cause. |

An implementation MAY use a JCS library for string escaping and real-number formatting (rules 6 and
9 are JCS-compatible) but MUST NOT delegate member ordering or integer formatting to one.

### 3.3 Records, maps and lists

Three composite shapes, distinguished because they encode differently:

- A **record** has a fixed set of members named by §5. Members encode in declaration order; unknown
  members are ignored on read (§8) and never emitted.
- A **map** has string keys chosen by the emitter at runtime (a diagnostic name, an annotation key).
  Members encode in ordinal-ascending key order. §5 states the permitted value type.
- A **list** is a JSON array. §5 states its sort key, or marks it *submitter-ordered*.

### 3.4 Tagged shapes

Two shapes in this specification are one-of-several: the **refusal** (§5.7) and the envelope's
**body** (§5.1). Both are encoded as an ordinary record whose **first** member is a discriminator
string (`class` and `kind` respectively), followed by that case's declared members in declaration
order. There is no nested single-member-object form.

The discriminator is a string rather than a number so that an unrecognised case is legible to a
human reading a log, and both discriminated shapes carry an explicit rule for what a reader does
with a case it does not know (§5.7.2, §5.1.1).

### 3.5 Unit text

A number says nothing about what it measures. Where this specification lets a value state its unit,
the unit crosses as **unit text**: one string, which MUST be the **canonical text** of an **admitted
unit**. A text that does not parse, that names something not admitted, or that parses but is not the
canonical text of the unit it names, is not unit text, and a document carrying it is refused (§7.9).

**Two unit texts name the same unit exactly when they are byte-identical.** `km/h` and `m/s` are
different units here although they measure one dimension. This specification compares units by text
and converts nothing: how one admitted unit relates to another is outside it.

**Grammar.** The case-sensitive syntax of the Unified Code for Units of Measure (UCUM), read over the
vocabulary below and nothing else:

- A unit is a sequence of components joined by `.` (multiply) and `/` (divide), both left-associative
  with equal precedence, so `a/b.c` is a·b⁻¹·c. A text may begin with `/` (`/min`).
- A component is a parenthesised unit; or the factor `1`; or a **token** — an atom, optionally under
  one prefix — followed directly by an optional integer exponent with an optional sign (`m2`, `s-1`,
  `m+3`). An exponent lies within ±2147483647; an exponent of zero removes its atom.
- Nothing else is read: no whitespace anywhere, no annotation (`{...}`), no numeric factor other than
  `1` (`10*3`, `1000`).

**Vocabulary.** The admitted atoms, and whether each takes a prefix:

| Takes a prefix | Atoms |
|---|---|
| yes | `m` `g` `s` `A` `K` `mol` `cd` `rad` `sr` `Hz` `N` `Pa` `J` `W` `C` `V` `F` `Ohm` `S` `Wb` `T` `H` `lm` `lx` `Bq` `Gy` `Sv` `kat` `L` `t` `bar` |
| no | `min` `h` `d` `wk` `a` `%` `[ppm]` `[ppb]` `[in_i]` `[ft_i]` `[yd_i]` `[mi_i]` `[lb_av]` `[oz_av]` |

- `l` is read as `L`.
- A **currency** is an ISO 4217 alphabetic code in brackets — three capital letters, `[GBP]` — and
  takes a prefix (`c[GBP]` is a hundredth of a pound). The shape is checked, not membership of the
  current ISO list: a retired code still names what was recorded in it. UCUM's arbitrary units that
  share the shape — `[CFU]`, `[PFU]`, `[FFU]`, `[BAU]`, `[PNU]`, `[FEU]`, `[ELU]` — are not
  currencies and are not admitted.
- The prefixes are `Y` `Z` `E` `P` `T` `G` `M` `k` `h` `da` `d` `c` `m` `u` `n` `p` `f` `a` `z` `y`
  (`u` is UCUM's ASCII micro). A token is read as a whole atom first, and as prefix and atom only
  when it is not one: `Pa` is the pascal, `cd` the candela, `a` the year, `am` the attometre. `da`
  is tried before `d`. A prefix on an atom that takes none (`kmin`) is not admitted.
- Deliberately not admitted: units whose relation to their dimension is not a ratio — degrees Celsius
  and Fahrenheit, the logarithmic units — UCUM's arbitrary units, and the angular degree. Admitting
  one later is additive (§8); withdrawing one would not be.

**Canonical text.** The one text of a unit is written from its factors:

1. Equal tokens — the same prefix on the same atom, after `l` is read as `L` — are merged by adding
   their exponents, and a factor whose exponent is zero is dropped.
2. Factors are ordered by atom, then by prefix, ordinally (§3.1 rule 12).
3. The factors with a positive exponent come first, joined by `.`; then each factor with a negative
   exponent, as `/` and the factor, in the same order.
4. An exponent is written as its magnitude in ASCII digits directly after the token, and omitted
   where it is 1 — never a sign.
5. A unit with no factors is `1`, the dimensionless unit. A unit whose every exponent is negative
   begins with `/`.

So `kg.m/s2`, `/min`, `c[GBP]`, `mg/dL` and `1` are canonical; `s-1` (written `/s`), `m.kg`
(`kg.m`), `m.m` (`m2`), `ml` (`mL`) and `kg/(m.s2)` (`kg/m/s2`) parse, and are not.

---

## 4. Identity

Three distinct digests appear in this specification. Conflating them is the most consequential
implementation error available, because two of the three are what let independent records be joined.

### 4.1 Content addresses

A content address is the string `"{algorithm}:{lowercase hex}"`, e.g.
`"sha256:4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade6af1dd5"`. The algorithm is named
**inside** the value so that a future digest change is a visible discontinuity rather than a silent
one. `sha256` is the only algorithm registered at version 1 (§7.4).

A bare hex string with no algorithm prefix is **not** a content address and MUST NOT be emitted
where §5 declares one.

### 4.2 `specHash` — minted by the submitter, opaque to the executor

`specHash` is a content address over the submitter's model specification. It is **minted by the
submitter and is opaque to every other party**:

1. An executor **MUST** store and key by exactly the value it was handed.
2. An executor **MUST NOT** re-derive, re-normalise, recompute or validate `specHash` against
   `specPayload` — **not even where the submission names a minting algorithm the executor
   implements** (§4.5). The payload is opaque to it (§3.1 rule 13, §6.1), and a party that verifies a
   hash it was handed has no conformant action available in the failing case: it cannot correct the
   value, because that re-keys someone else's fit, and refusing on it would make the executor the
   arbiter of a rule it is not party to. The minting rule is certified by the party that mints,
   against the corpus, and never at the seam.
3. A submitter **MUST** mint the same `specHash` for the same specification every time, and two
   submitters that agree on a specification MUST mint the same hash for it. This is the property the
   composite key rests on, and — by rule 2 — it is not verifiable at the seam. It is verifiable only
   against a shared fixture family, which is what the `spec-hash` family (§9) is.
4. The submission carries `specHashAlgorithm` alongside the hash, so the minting rule can rotate
   without retroactively invalidating identities minted under the previous one (§7.4).
5. A submitter **MUST NOT** emit a submission whose `specHash` is not the minting of its own
   `specPayload` under the algorithm it names. This is a **pre-emit** obligation: by rule 2 nothing
   downstream is permitted to catch it, so a submission that violates it is one no party can ever
   detect and every party will key by.

**The minting canonicalisation is specified in §4.5**, and its identifier is registered in §7.4. A
submitter whose rendering is outside that rule's domain registers its own identifier and interoperates
only with submitters that share it; `specHashAlgorithm` is what distinguishes the two cases, and is
why an unregistered identifier is a legible statement rather than a defect.

### 4.3 The composite key — the join

A fit is named, forever and across parties, by five values and nothing else:

| Member | Type | Notes |
|---|---|---|
| `specHash` | content address | What was fitted (§4.2). |
| `vintage` | `vintageRef` | What it was fitted to (§5.2). |
| `seed` | int64 | The reproducibility seed the submitter chose. |
| `providerId` | string | Which provider ran it (§7.3 lexical rule). |
| `providerVersion` | string | Which version of that provider. |

`compositeKeyHash` is the **content address over the canonical bytes of the `compositeKey`
record** (§3). It is the addressable identifier for a registered outcome, and it is what lets a
submitter's own record of a decision and an executor's record of an execution refer to the same
thing while sharing no type, no database and no vocabulary.

Three consequences are normative:

1. **Re-fitting with the same five values is the same fit.** An executor MAY return the existing
   outcome rather than run again; a submitter MUST NOT assume it ran again.
2. **Changing any of the five is a different fit** and MUST produce a different
   `compositeKeyHash`. In particular, a new dataset version is a new fit, not an update of an old
   one.
3. **An outcome whose `compositeKeyHash` does not equal a recomputation over its own `compositeKey`
   is corrupt** and MUST be refused (`outcome-composite-key-mismatch`), never stored. It is a
   different condition from an unknown key, and MUST be reported differently.

### 4.4 Content hashes of data and artifacts

`contentRef.hash` and `artifactRef.contentHash` are content addresses over the **bytes of the thing
addressed** — the dataset blob, the fitted artifact — not over any JSON document. They are computed
by whichever party owns the bytes and are quoted, never recomputed, by anyone else.

### 4.5 The minting canonicalisation — `canonical-json-sha256-v1`

§4.2 requires that two submitters which agree on a specification mint the same `specHash` for it,
and forbids anyone downstream from checking that they did. This section is the rule that makes the
requirement mean something. It is placed here, after §4.4, rather than beside §4.2 where it belongs
by subject, so that adding it **enumerates rather than renumbers**: `compositeKeyHash` is cited by
section number in schemas, corpus descriptions and implementations that already exist.

**Domain.** This algorithm applies where the rendered specification is a JSON document (RFC 8259). A
submitter whose rendering is not JSON registers a different identifier (§7.4) — that is an ordinary
use of an open registry, not a failure to conform.

**The rule.** Given the rendering:

1. **Parse** it into values: object, array, string, number, boolean, null.
2. **Serialise** those values with §3.1 rules 1 (no insignificant whitespace), 2 (UTF-8, no BOM), 6
   (string escaping), 9 (real numbers), 10 (booleans) and `null` for null, plus two rules specific to
   this algorithm:
   - **Every object's members are ordered ordinally ascending by key** — §3.1 rule 4, applied
     recursively to every object rather than only to a map. A specification's interior is not a
     versioned record with a published field order (§3.1 rule 3 exists to protect one); there is
     nothing to preserve, and sorting is precisely what makes two authoring orders mint one hash.
   - **Every number is a JSON number**, serialised by §3.1 rule 9. There is no 64-bit-integer form
     inside a payload — §3.1 rule 8 does not apply here — and negative zero serialises as `0`.
   - **Arrays keep their order.** An array's order is data; two renderings that differ in it are two
     specifications, and MUST mint different hashes.
3. **Digest** the resulting bytes with SHA-256 and form the content address `sha256:{lowercase hex}`
   (§4.1). That value is `specHash`; `specHashAlgorithm` is `canonical-json-sha256-v1`.

**Outside the domain.** A rendering is not mintable under this algorithm, and a submitter MUST NOT
mint over it, if it contains:

- **duplicate member names** within one object — RFC 8259 permits them and no ordering makes them
  deterministic, so the only safe rule is to refuse;
- **a number that is not exactly representable as an IEEE-754 binary64** — rounding it silently
  collides two different specifications onto one identity. A value needing more precision (a large
  integer identifier, a fixed-point quantity) is rendered as a **string**, exactly as §3.2 divergence
  2 does on the wire and for the same reason;
- **ill-formed Unicode** — an unpaired surrogate has no UTF-8 encoding, so it has no bytes to hash.

**The wire payload is not required to be these bytes.** `specPayload` rides as rendered (§3.1 rule
13); the canonical form is an intermediate that exists only to be hashed, and no party ever
transmits it. Two submissions whose payloads differ only in member order or insignificant whitespace
therefore **differ on the wire and carry the same `specHash`** — which is §4.2 rule 3 made
observable, and is what the `spec-hash` corpus family pins.

**Why the submitter may parse what the executor may not.** Opacity is directional. The submitter
authored the specification and is rendering its own value model; it is not interpreting a payload
handed to it by another party. The executor is, which is why §6.1 forbids it — and why §4.2 rule 2
holds unchanged now that a canonicalisation exists which the executor could otherwise apply.

**Rotation.** A later rule registers a new identifier (§7.4); identities minted under an earlier one
remain valid and remain distinguishable, because the identifier travels with the hash. Two
submissions carrying the same specification under different algorithms are two different composite
keys, and that is correct: a key is a join only between parties that agree how it was minted.

---

## 5. Shape families

Field tables give each member in **declaration order** — which is also its encoding order (§3.1
rule 3). "Opt" marks a member encoded as `null` when absent.

### 5.1 Envelope

Every document specified here rides in an envelope. There is no bare-body form on the wire: a
document with no version is a document whose meaning cannot be established later, and the corpus
therefore contains no bare bodies.

**`envelope`**

| Member | Type | Notes |
|---|---|---|
| `envelopeVersion` | int32 | This specification's version. Currently `1`. |
| `kind` | string | The body's shape, from the registry in §7.1. |
| `body` | record | The document, whose shape `kind` names. |

**Version negotiation.** A participant declares the envelope versions it accepts — out of band, in a
capability document, or by publishing a supported range; how it declares them is not specified. On
receipt:

1. A participant **MUST** refuse an envelope whose `envelopeVersion` it does not accept, with the
   refusal `envelopeVersionMismatch` naming both what arrived and what it accepts
   (`envelope-version-unsupported`). It MUST NOT read such an envelope partially: a member it has no
   field for would otherwise satisfy a requirement by omission.
2. A participant **SHOULD** accept an envelope at a lower version it still understands.
3. `envelopeVersion` is **not** a per-family version. Every family moves together, because the
   families are joined by the identity rule and a partial version skew across them is exactly the
   state in which two records disagree about what a key means.

#### 5.1.1 An unknown `kind`

A reader that does not recognise `kind` **MUST** refuse with `unknownDocumentKind`
(`envelope-kind-unknown`), naming the kind it received and the kinds it knows. It MUST NOT guess
from the body's shape. Registering a new kind is additive (§8) and does not bump `envelopeVersion`,
so an unknown kind is an ordinary "I am older than you" condition and its refusal is the mechanism
by which that is discovered rather than mis-handled.

### 5.2 Vintage ref (profile: observer)

A **vintage** is one immutable version of a named dataset. It is *referenced* here, never
constructed: nothing in this specification creates, transforms or assembles data.

**`contentRef`** — where the bytes are and what they are.

| Member | Type | Notes |
|---|---|---|
| `format` | string | A registered format identifier (§7.2). Lexical rule enforced. |
| `hash` | content address | Over the dataset bytes (§4.4). |
| `rowCount` | int64, opt | Rows, where the format has rows and the holder knows. `null` otherwise. |

**`vintageRef`** — the pin. This is the shape that appears inside a composite key, so its encoding
is load-bearing for identity.

| Member | Type | Notes |
|---|---|---|
| `datasetId` | string | The dataset's identifier within the executor's scope. |
| `version` | int32 | The version ordinal. Monotonic per dataset; `1` is the first. |
| `contentRef` | `contentRef`, opt | `null` when the submitter pinned by `(datasetId, version)` alone. |

**A `vintageRef` with a `null` `contentRef` is fully conformant** and is the ordinary shape a
submitter emits: it pins *which* vintage, and lets the executor resolve where the bytes are. A
submitter that has resolved the content ref MAY carry it, and an executor MUST then require it to
match its own resolution (`vintage-content-ref-mismatch`) rather than silently prefer either — a
submitter that believes it pinned particular bytes and got different ones has had its evidence base
corrupted invisibly.

**`resolvedVintage`** — the executor's answer to "what is this, exactly?".

| Member | Type | Notes |
|---|---|---|
| `ref` | `vintageRef` | With `contentRef` present — a resolution that resolves nothing is not an answer. |
| `createdAt` | instant | When the vintage came into existence. |
| `isLatest` | bool | Whether this was the highest version of the dataset **at the moment of resolution**. Advisory, never an identity input. |

Corpus: `vintage-ref/ref.json`, `vintage-ref/ref-unpinned.json`, `vintage-ref/resolved.json`.

### 5.3 Fit submission (profile: submitter)

**`gate`** — a diagnostic threshold the executor evaluates after the fit.

| Member | Type | Notes |
|---|---|---|
| `name` | string | The diagnostic this gate reads, matching a key of the outcome's `diagnostics`. |
| `threshold` | real | Finite (§3.1 rule 9). |
| `unit` | unit text, **late** | The unit `threshold` is stated in (§3.5). Omitted where the gate states none (§3.1 rule 5). |
| `direction` | string | `"atLeast"` or `"atMost"` (§7.5). Any other value is refused. |

**The gate rule: a comparison is never made across units.** An executor evaluates a gate only where
the gate's `unit` and the unit the provider reports for the diagnostic it reads are the same unit
text (§3.5), or are both absent — the path every gate took before units could be stated. Otherwise it
MUST NOT evaluate the gate and MUST NOT convert either value: it refuses with `gateUnitMismatch`
(§5.7.1), naming the gate, the unit it stated and the unit reported. A gate that states no unit
against a diagnostic that has one is refused as well, for the reason §7.5 refuses a guessed
direction: a threshold read in a unit nobody stated is a gate that can silently pass. A threshold of
`2` in grams against an error reported in kilograms is wrong by a factor of a thousand while looking
like a pass, and the submitter, not the executor, knows which of the two was meant — so the
executor names the disagreement rather than resolving it.

A provider's units are a property of the provider, so an executor ordinarily knows them before it
schedules anything and refuses the item on the receipt. Whenever it learns them, it MUST NOT register
an outcome carrying a verdict over the mismatch (§5.4, `outcome-gate-unit-mismatch`).

**`fitSubmission`**

| Member | Type | Notes |
|---|---|---|
| `vintage` | `vintageRef` | What to fit to. |
| `specPayload` | string, **opaque** | The rendered specification. Never parsed by the executor (§3.1 rule 13). |
| `specHash` | content address | Minted by the submitter over the specification (§4.2, §4.5). MUST be non-empty. |
| `specHashAlgorithm` | string | The minting rule's identifier (§7.4). Naming a registered rule asserts the hash was minted under it (§4.2 rule 5). |
| `providerKind` | string | Which class of provider is being asked (§7.3 lexical rule). |
| `seed` | int64 | The reproducibility seed. Part of the composite key, so it is the submitter's choice, never the executor's default. |
| `gates` | `gate[]` | Sorted ordinally by `name`. Duplicate names are refused (`submission-gate-duplicate`). Empty is conformant — a submission with no gates asks for no verdicts. |
| `submitterClass` | string | `"human"`, `"scheduled"` or `"agent"` (§7.6). |

**`submitterClass` is on the wire from version 1** and MUST be emitted. An executor is not required
to act on it, but a policy that gates unattended exploration harder than interactive use cannot be
added later without a breaking change to every submitter, and the class of the party asking is not
recoverable from anything else in the document.

**`fitSubmissionBatch`** — the primary shape. A single fit is the degenerate batch and is also
available as its own kind for the common case.

| Member | Type | Notes |
|---|---|---|
| `batchId` | string | The submitter's correlation id. MUST be non-empty. |
| `submissions` | `fitSubmission[]` | **Submitter-ordered** (§3.1 rule 12). MUST be non-empty. |

The submission list is the one list in this specification that is **not** sorted, because the
receipt refers to its members by **index**. An emitter that sorts it renumbers the submitter's own
work.

**`submissionReceipt`** — what came back from the submission, before any fit has finished.

| Member | Type | Notes |
|---|---|---|
| `batchId` | string | Echoed. |
| `itemCount` | int32 | The number of submissions received. |
| `accepted` | `acceptedItem[]` | Sorted ascending by `index`. |
| `rejected` | `rejectedItem[]` | Sorted ascending by `index`. |

**`acceptedItem`**: `index` (int32), `jobId` (string — the executor's poll handle).
**`rejectedItem`**: `index` (int32), `reason` (`refusal`, §5.7).

**Partial acceptance is data, not an error.** An executor that accepts some items of a batch and
refuses others MUST return a receipt describing both, and MUST NOT refuse the whole batch because
one item was bad. `accepted` and `rejected` MUST partition the submitted indices exactly:
`|accepted| + |rejected| = itemCount`, with no index in both and none missing.

**Submission is not completion.** A receipt says the work was taken, never that it finished. A
submitter learns outcomes by querying (§5.5), not by holding a connection open. This is normative
because the alternative — a fit whose result is only ever delivered on the connection that requested
it — makes long-running work unrecoverable across a restart on either side.

Corpus: `fit-submission/submission.json`, `batch.json`, `receipt.json`, and four reject vectors.

### 5.4 Fit outcome (profile: observer)

**`artifactRef`**

| Member | Type | Notes |
|---|---|---|
| `artifactId` | string | The executor's identifier for the stored artifact. |
| `contentHash` | content address | Over the artifact bytes (§4.4). |
| `format` | string, opt | A registered format identifier (§7.2), where the executor declares one. |

**`gateVerdict`** — a gate plus what was observed.

| Member | Type | Notes |
|---|---|---|
| `name` | string | |
| `threshold` | real | As submitted. |
| `unit` | unit text, **late** | As submitted: the unit both `threshold` and `observed` are in. Equal to the unit `diagnosticUnits` states for `name`, or absent where it states none (§5.3's gate rule). |
| `direction` | string | As submitted. |
| `observed` | real | The diagnostic's value. Finite. |
| `passed` | bool | The executor's evaluation of `observed` against `threshold` and `direction`. |

`passed` is carried explicitly rather than left to the reader to recompute, because a reader that
recomputes it is asserting a floating-point comparison rule this specification does not fix. The
executor's evaluation is the record.

**`compositeKey`** — §4.3. Its members, in declaration order, are `specHash`, `vintage`, `seed`,
`providerId`, `providerVersion`. It is a document in its own right (`kind: "compositeKey"`) so that
the identity rule is directly certifiable.

**`fitOutcome`**

| Member | Type | Notes |
|---|---|---|
| `compositeKeyHash` | content address | Over `compositeKey`'s canonical bytes (§4.3). |
| `compositeKey` | `compositeKey` | Carried in full: an outcome that names only its hash cannot be re-derived by a party that lost the submission. |
| `artifactRef` | `artifactRef`, opt | `null` when the fit produced no retained artifact (a refused or failed run recorded for the evidence base). |
| `diagnostics` | map of real | Ordinal-sorted keys (§3.1 rule 4). A non-finite value is **omitted**, never encoded as `null` or `0`. |
| `diagnosticUnits` | map of unit text, **late** | Ordinal-sorted keys. Each key names a member of `diagnostics`; its value is the unit that diagnostic is stated in (§3.5). A diagnostic with no entry states no unit. The unit of a diagnostic omitted as non-finite is omitted with it. Omitted when it has no entries (§3.1 rule 5). |
| `gateVerdicts` | `gateVerdict[]` | Sorted ordinally by `name`. |
| `status` | string | A registered lifecycle status (§7.7). |
| `timing` | `timing` | |
| `cost` | `cost`, opt | `null` where the executor does not account for cost. |
| `annotations` | map of string | Ordinal-sorted keys. Free-form; nothing here interprets them. |
| `registeredAt` | instant | When the executor recorded this outcome. |

**`timing`**: `submittedAt` (instant), `startedAt` (instant, opt), `completedAt` (instant, opt),
`durationMs` (int64, opt). Every member may be `null` on an outcome that never ran.

**`cost`**: `unit` (string — the accounting unit, uninterpreted here), `amount` (real, finite).

**Diagnostics are uninterpreted.** Nothing in this specification assigns meaning to a diagnostic
name, ranks one model above another, or defines a good value. A gate is the only place a threshold
appears, and the threshold came from the submitter.

**A diagnostic's value has a unit, and the outcome may say what it is.** An error is in the unit of
what was predicted, a ratio is dimensionless, a coefficient is in one unit per another; a reader
comparing two outcomes, or a gate thresholding one, needs to know which, and the number alone cannot
say. `diagnosticUnits` states it beside the value rather than inside it, so `diagnostics` keeps its
type and an outcome that states no units is the document it always was. Stating a unit interprets
nothing: it says what a number measures, never what a good value is, and the vocabulary of diagnostic
names stays the provider's.

Corpus: `fit-outcome/outcome.json`, `outcome-gate-failed.json`, `outcome-units.json`,
`composite-key.json`, a reject vector for the identity mismatch of §4.3, and reject vectors for a unit
that is not unit text, a unit for a diagnostic the outcome does not carry, and a verdict stated in
another unit than its diagnostic.

### 5.5 Registry query (profile: submitter)

Batch-first: a query names sets, and a page comes back. A single-outcome read is the degenerate
query, not a separate shape.

**`registryQuery`** — the filters are **conjunctive**; an empty list matches anything.

| Member | Type | Notes |
|---|---|---|
| `specHashes` | content address[] | Sorted ordinally. Empty = any. |
| `vintages` | `vintageRef[]` | Sorted ordinally by `(datasetId, version)`. Empty = any. Matching compares `datasetId` and `version` only — a query MUST NOT be narrowed by a `contentRef` the caller happened to carry. |
| `statuses` | string[] | Registered statuses (§7.7), sorted ordinally. Empty = any. Unknown status: `query-status-unknown`. |
| `batchId` | string, opt | `null` = any. |
| `page` | `page` | |

**`page`**: `cursor` (string, opt — `null` for the first page), `limit` (int32, `1 ≤ limit ≤ 1000`;
out of range is `query-limit-out-of-range`).

**`outcomePage`**

| Member | Type | Notes |
|---|---|---|
| `outcomes` | `fitOutcome[]` | Sorted ordinally ascending by `compositeKeyHash`. |
| `nextCursor` | string, opt | `null` on the last page. |

**Pagination is deterministic and total.** The ordering is by `compositeKeyHash` — a value that
exists before the outcome is stored and never changes — precisely so that paging is stable while
new outcomes are being registered concurrently. A cursor is **opaque to the caller**: it MUST be
echoed unmodified and MUST NOT be parsed, compared or constructed. An exhausted or unrecognised
cursor is refused (`query-cursor-invalid`), never silently restarted from the beginning: a silent
restart turns a paging loop into an infinite one.

Corpus: `registry-query/query.json`, `query-any.json`, `page.json`, `page-last.json`,
`page-units.json`, and a reject vector.

### 5.6 Score request (profile: submitter)

**`scoreRequest`**

| Member | Type | Notes |
|---|---|---|
| `artifactKeyHash` | content address | The `compositeKeyHash` of a registered outcome (§4.3). |
| `input` | `vintageRef` | The data to score. |
| `outputDatasetId` | string | Where predictions land. |

**Predictions land as a vintage.** The answer to a score request is a `resolvedVintage` (§5.2) — a
new version of `outputDatasetId` — never an inline array of numbers. A prediction set is data, and
data in this specification has identity, a content hash and a version, so that a model fitted to
scored output is as reproducible as one fitted to source.

**`outputDatasetId` MUST NOT equal `input.datasetId`** (`score-output-collides-with-input`). Writing
predictions as a new version of the very dataset they were derived from makes the input
irreproducible and creates a dataset whose later versions silently depend on a model.

Corpus: `score-request/request.json` and a reject vector.

### 5.7 Refusal (profile: observer)

Every denial is **typed, enumerable data**. No document in this specification carries a bare error
string, an exception, or a numeric code whose meaning lives elsewhere. A consumer branches on
`class`; the human-readable text an implementation may add is diagnostic and is **not** part of the
contract.

#### 5.7.1 The closed vocabulary

Encoded per §3.4: `class` first, then the case's members in the order given.

| `class` | Members | Condition |
|---|---|---|
| `envelopeVersionMismatch` | `received` (int32), `accepted` (int32[], sorted ascending) | The envelope's version is not one this participant accepts (§5.1). |
| `unknownDocumentKind` | `kind` (string), `known` (string[], sorted ordinally) | The envelope names a body shape this participant does not implement (§5.1.1). |
| `invalidSubmission` | `reason` (string) | A submission failed validation before any work was scheduled. |
| `invalidQuery` | `reason` (string) | A query is malformed — an out-of-range limit, an unknown status, an unusable cursor. |
| `unknownProvider` | `kind` (string), `known` (string[], sorted ordinally) | No provider of the requested kind is available here. `known` lets a submitter re-aim without a second round trip. |
| `budgetDenied` | `quota` (real), `spent` (real), `unit` (string) | The work was refused on cost or quota grounds before it ran. |
| `gateFailed` | `verdicts` (`gateVerdict[]`, sorted ordinally by `name`) | Work completed but did not clear its gates, and the executor's policy is to refuse rather than register. Carries the verdicts so the submitter need not re-query to learn which. |
| `policyRefused` | `rule` (string) | A named policy refused the request. The rule's identifier is stable; its wording is not. |
| `scopeUnavailable` | — | The caller has no resolved scope, and every operation here requires one (§6.2). |
| `forbidden` | `reason` (string) | The caller's scope is resolved but does not permit the operation. |
| `notFound` | `what` (string — `"outcome"`, `"artifact"`, `"dataset"`, `"vintage"`, `"job"`), `id` (string) | No such thing in the caller's scope. Deliberately indistinguishable from "exists, but not yours". |
| `substrateUnavailable` | `surface` (string) | A named capability is not composed in this deployment. Distinct from `notFound`: the thing asked for is not merely absent, it is not offered. |
| `scoreRefused` | `reason` (string, §7.8), `detail` (string) | Scoring was refused with a typed sub-reason. |
| `storageFailure` | `reason` (string) | The underlying store failed. Diagnostic; the wording is not stable and MUST NOT be matched on. |
| `unspecified` | `message` (string) | The catch-all. See §5.7.2. |
| `gateUnitMismatch` | `name` (string), `unit` (unit text, opt), `reported` (unit text, opt) | A gate's unit is not the unit the provider reports its diagnostic in (§5.3's gate rule). `unit` is the gate's, `reported` the diagnostic's; either is `null` where that side states no unit. Registered after version 1, so its members are declared from its first day and are not late members. |

**`unspecified` exists so that nothing escapes as an exception.** An executor that hits a condition
it has no class for MUST emit `unspecified` with a diagnostic message; it MUST NOT return a bare
error, a stack trace, or a success document with an error inside. A refusal a program cannot branch
on is still infinitely better than one it cannot even detect.

#### 5.7.2 The extension rule

The vocabulary is **closed for interpretation and open for addition**:

1. Adding a class is **additive** and does not bump `envelopeVersion` (§8).
2. A reader that encounters an **unrecognised `class` MUST NOT fail**. It MUST treat the refusal as
   `unspecified`, preserving whatever human-readable text it can find, and MUST report the
   unrecognised class name so an operator can see that an upgrade is available.
3. A reader **MUST** ignore members it does not recognise within a class it does know (§8).
4. An implementation **MUST NOT** invent a class in a private namespace and expect it to be
   understood. An unregistered class is, by rule 2, exactly equivalent to `unspecified` — so
   inventing one buys a log line, not a behaviour.
5. **A refusal class MUST NOT be removed or have its meaning changed** within an
   `envelopeVersion`. Removing one is the change that turns a handled condition into an unhandled
   one at every reader that was branching on it.

Corpus: one vector per registered class in `refusal/`, and `refusal/unknown-class.json` (an
`accept` vector: an unregistered class a conformant reader MUST accept as `unspecified`).

---

## 6. What deliberately does not cross

This section is normative about *absence*: an implementation that adds these to the wire is not
extending the specification, it is leaving it.

**6.1 Structure of the specification.** Only the rendered, opaque payload crosses. An executor that
parses `specPayload` to make a decision has taken on a judgement the submitter did not delegate, and
has coupled itself to a vocabulary this specification deliberately never names.

**6.2 Scope, tenancy and identity.** Every operation executes under the scope the receiving party
resolves for the caller. **A document MUST NOT carry a scope, tenant, team or user identifier, and a
receiver MUST NOT read one if a caller adds it.** A wire-supplied scope is an impersonation
primitive: a submission that names a scope is a submission that can name someone else's.

**6.3 Judgement.** Which model is better, which should be promoted, which experiment to run next —
none of it crosses. `status` records lifecycle transitions a party made; it does not confer them,
and nothing here defines what makes an outcome worth approving.

**6.4 Live coupling.** A record of an outcome is a snapshot, complete on its own. A consumer holding
outcomes MUST be able to work entirely offline from them, and this specification provides no
mechanism that requires a live query in an analysis path. Everything needed to re-derive the record
against a registry later is in the composite key.

---

## 7. Registries

Open string constants. Each registry gives a lexical rule (what a valid identifier looks like) and a
seed set (what is registered at version 1). **Adding an entry is additive** (§8) and never bumps
`envelopeVersion`.

Every identifier registered here matches `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` unless a registry says
otherwise: lowercase, digits and interior hyphens. Identifiers are compared byte-for-byte; there is
no case folding, and an implementation MUST NOT normalise one.

### 7.1 Document kinds

The values `envelope.kind` may take, and the §5 shape each names.

| `kind` | Shape | §
|---|---|---|
| `vintageRef` | `vintageRef` | 5.2 |
| `resolvedVintage` | `resolvedVintage` | 5.2 |
| `fitSubmission` | `fitSubmission` | 5.3 |
| `fitSubmissionBatch` | `fitSubmissionBatch` | 5.3 |
| `submissionReceipt` | `submissionReceipt` | 5.3 |
| `compositeKey` | `compositeKey` | 5.4 |
| `fitOutcome` | `fitOutcome` | 5.4 |
| `registryQuery` | `registryQuery` | 5.5 |
| `outcomePage` | `outcomePage` | 5.5 |
| `scoreRequest` | `scoreRequest` | 5.6 |
| `refusal` | `refusal` | 5.7 |

Kind identifiers are lowerCamelCase — the one registry whose lexical rule is
`^[a-z][A-Za-z0-9]*$` — because they name the §5 shapes and reusing the shape names verbatim is what
makes an unknown kind diagnosable.

### 7.2 Dataset and artifact formats

A format identifier says what the addressed bytes are, so that a party fetching them knows what it
is holding without opening them.

Registered at version 1: `parquet`, `arrow-ipc`, `csv`, `ndjson`.

**Registering a vendor format.** An implementation with its own container registers an identifier of
the shape `{vendor}-{name}-v{n}` — for example `acme-frame-v1` — and publishes what it denotes. The
vendor segment prevents two implementations minting the same identifier for different bytes. No
vendor identifier is enumerated in this specification: enumerating one in a language-neutral
document would privilege an implementation the document is written not to name.

**An unregistered identifier is not an error.** A reader that does not know a format refuses to
*interpret* the bytes, not to read the document — `format` is a label on a reference, and a party
relaying a reference to a format it does not handle is doing exactly its job. What IS refused
(`vintage-format-invalid`) is an identifier that violates the lexical rule, because such an
identifier can never be registered and is therefore always a defect.

### 7.3 Provider kinds and ids

`providerKind` names a class of fitting provider; `providerId` names a concrete one; both follow the
common lexical rule. **Neither is registered here.** The set of providers is a deployment's own
composition, and a specification that enumerated them would have to be revised for every new one —
which is the failure mode a registry exists to avoid. What is normative is that `providerId` and
`providerVersion` are part of the composite key (§4.3), so an executor MUST NOT change either
without accepting that every fit run after the change is a different fit.

### 7.4 Digest and minting algorithms

Content-address algorithms (§4.1) registered at version 1: `sha256`.

`specHashAlgorithm` values registered at version 1: `canonical-json-sha256-v1` — the minting
canonicalisation of §4.5, over a rendering that is a JSON document, digested with SHA-256.

A submitter whose rendering is outside that algorithm's domain — a non-JSON format, or one carrying
values the rule refuses — emits its own identifier following the common lexical rule, and interop is
then bounded by agreement between submitters rather than by this document. That is a supported
posture, not a defect: the identifier is what makes it legible.

Registering a further minting rule is additive (§8). It does **not** invalidate identities minted
under an existing one, because a composite key is only ever joined between parties that agree on the
algorithm that produced its `specHash`.

### 7.5 Gate directions

`atLeast` — the observed value MUST be greater than or equal to the threshold.
`atMost` — the observed value MUST be less than or equal to the threshold.

The vocabulary is **closed**: an unrecognised direction is refused
(`submission-gate-direction-unknown`), not defaulted. A gate whose direction is guessed is a gate
that silently passes.

### 7.6 Submitter classes

`human` — a person acting interactively.
`scheduled` — an unattended, pre-authorised recurrence.
`agent` — an autonomous process choosing its own work.

**Closed** at version 1; an unrecognised class is refused
(`submission-submitter-class-unknown`). The distinction that matters is between work a person is
watching and work nothing is watching, and defaulting an unknown class to `human` would make the
stricter policy path unreachable by exactly the callers it exists for.

### 7.7 Outcome lifecycle statuses

`registered` — recorded, no judgement applied.
`accepted` — a party accepted it for use.
`approved` — a party approved it under whatever governance it operates.
`retired` — withdrawn from use; the record remains.
`failed` — the fit did not produce a usable artifact. The outcome is still registered, because a
failure is evidence.

Additional statuses may be registered (additive). Nothing here defines who may make a transition or
under what conditions — that is §6.3.

### 7.8 Score refusal reasons

The `reason` member of `scoreRefused` (§5.7.1): `provider-not-found`, `not-approved`,
`input-schema-mismatch`, `input-unavailable`, `provider-failed`, `storage-failure`. Additive;
an unrecognised reason is read as `provider-failed`'s weaker cousin — that is, as *unknown* — and
MUST NOT be treated as success.

### 7.9 Refusal classes for corpus reject vectors

Stable identifiers for the documents an implementation MUST refuse, used by the corpus's `reject`
vectors. The **class is normative**; the wording of a refusal is not, and an implementation in
another language will and should word it differently. Each but the last maps to a §5.7 refusal a
conformant executor emits; the last is a submitter's pre-emit obligation (§2), where the document is
never emitted and so no refusal ever crosses.

| Reject class | Family | Condition | Emitted refusal |
|---|---|---|---|
| `envelope-version-unsupported` | envelope | `envelopeVersion` not accepted. | `envelopeVersionMismatch` |
| `envelope-kind-unknown` | envelope | `kind` not implemented. | `unknownDocumentKind` |
| `envelope-malformed` | envelope | Not a well-formed envelope (a member missing or mistyped). | `invalidSubmission` |
| `vintage-format-invalid` | vintage ref | `contentRef.format` violates the lexical rule (§7.2). | `invalidSubmission` |
| `submission-batch-empty` | fit submission | `submissions` is empty, or `batchId` is empty. | `invalidSubmission` |
| `submission-gate-direction-unknown` | fit submission | A gate's `direction` is not in §7.5. | `invalidSubmission` |
| `submission-submitter-class-unknown` | fit submission | `submitterClass` is not in §7.6. | `invalidSubmission` |
| `submission-spec-hash-absent` | fit submission | `specHash` is empty or is not a content address (§4.1). | `invalidSubmission` |
| `outcome-composite-key-mismatch` | fit outcome | `compositeKeyHash` ≠ a recomputation over `compositeKey` (§4.3). | `invalidSubmission` |
| `outcome-diagnostic-unit-invalid` | fit outcome | A `diagnosticUnits` value, or a verdict's `unit`, is not unit text (§3.5). | `invalidSubmission` |
| `outcome-diagnostic-unit-orphan` | fit outcome | A `diagnosticUnits` key names no member of `diagnostics` (§5.4). | `invalidSubmission` |
| `outcome-gate-unit-mismatch` | fit outcome | A verdict's `unit` is not the unit `diagnosticUnits` states for its `name`, absent counting as a value (§5.3's gate rule). | `invalidSubmission` |
| `submission-gate-unit-invalid` | fit submission | A gate's `unit` is not unit text (§3.5). | `invalidSubmission` |
| `query-limit-out-of-range` | registry query | `page.limit` outside `1…1000`. | `invalidQuery` |
| `score-output-collides-with-input` | score request | `outputDatasetId` equals `input.datasetId` (§5.6). | `invalidSubmission` |
| `submission-spec-hash-non-canonical` | spec hash | `specHash` is not the minting of `specPayload` under the registered algorithm the document names (§4.5). | — (pre-emit; the executor is forbidden to check this — §4.2 rule 2) |

---

## 8. Versioning

**`envelopeVersion` is this specification's version**, carried by every document (§5.1). It is
distinct from a dataset's `version` (an ordinal within one dataset) and from a provider's
`providerVersion`; the three move independently and MUST NOT be conflated.

- **Additive changes do not bump it.** A new optional member (added as a late member, §3.1 rule 5), a
  new registry entry (a document kind, a format, a status, a refusal class, a score reason, an
  admitted unit), or a new fixture family is additive. A
  reader MUST ignore members it does not recognise, and MUST apply the fallback its §5 rule names
  for an unrecognised discriminator (`unknownDocumentKind` for a kind, `unspecified` for a refusal
  class).
- **A change to an existing member's meaning, type, presence or ordering, or to the canonical
  encoding itself, bumps it.** Every such change alters the bytes a hash was computed over, and a
  `compositeKeyHash` that changed for a reason a reader cannot see is worse than one that failed to
  compute: it silently splits an evidence base in two.
- **A reader MUST refuse a document whose `envelopeVersion` exceeds what it accepts**, naming both
  versions so an operator upgrades rather than guesses (§5.1). It MUST NOT read such a document
  partially.
- **A reader SHOULD accept a lower version it still understands.**

**Inclusion rule for identity-bearing shapes.** A member joins `compositeKey` (§4.3) only if two
fits that differ in it are genuinely different fits. Everything else — timing, cost, annotations,
lifecycle, who asked — is recorded *about* a fit, never *in* its identity. The test: would adding
this member mean that re-running the identical work produces a different key? If so it does not
belong, because a key that changes when nothing about the work changed makes the join useless in the
one situation it exists for.

---

## 9. Certifying against the corpus

The corpus lives in [`wire-fixtures/`](wire-fixtures/). `manifest.json` is the **authoritative
enumeration** — the families, the profile partition, and every vector with its kind and digest.
**Counts live in the manifest, never in prose**: a number written in a document drifts from the
directory beside it, and this sentence is the only place the corpus's size is discussed.

### 9.1 Vector kinds

| Kind | What certifying means |
|---|---|
| `round-trip` | Decode the document into your shapes and re-encode it. The bytes MUST be identical. |
| `hash` | Round-trip, **and** reproduce the digest the manifest records by recomputing it from the document's own content (§4). |
| `reject` | Feed the document to your reader. It MUST be refused, with the reject class the manifest names (§7.9). |
| `accept` | Feed the document to your reader. It MUST NOT be refused, and MUST be interpreted as the manifest's `interpretation` states. These are the forward-compatibility vectors: an implementation that refuses one is an implementation that will break on the next additive change. |

### 9.2 To certify

1. Choose a profile (§2) and take the families `manifest.json` lists for it.
2. Run every vector in those families. **Certifying a subset is not certifying.**
3. Report the profile. A conformance claim without a profile is unfalsifiable.

### 9.3 Two things the corpus asks of your harness, not of your emitter

A conformance suite is exactly the kind of code that passes by doing nothing. So:

- **Assert that the number of vectors you executed equals the number the manifest enumerates.** Not
  that they all passed — that the expected count ran.
- **Prove at least once that a mutated document makes your harness go red.** A green run that
  exercised nothing looks exactly like a green run that exercised everything.

Both scripts shipped with this corpus implement a `--self-test` mode that does precisely this to
themselves; an implementation's harness is expected to do the same.

### 9.4 The `spec-hash` family, and reservation

`manifest.json` carries a `reservedFamilies` list. A name reserved there is a family this
specification intends to add: it is not missing, and a certifying implementation is not failing to
run it. Adding a reserved family is additive (§8) and enumerates rather than renumbers. **No family
is reserved at present** — the list is retained because the mechanism is what makes the next
extension cheap, and an empty list is a statement rather than an omission.

`spec-hash` was the first name reserved and is now registered: the minting canonicalisation of §4.5
became specified, and the family landed under the rule this section describes. Its vectors are
`fitSubmission` documents, because minting only ever matters inside a submission and a family of
bare payloads would certify something no participant can send (§5.1). A `hash` vector there asks a
different recomputation from the one a `fit-outcome` vector asks:

| Family | What a `hash` vector's `digest` is | Recomputed from |
|---|---|---|
| `fit-outcome` | the composite-key content address (§4.3) | the document's own `compositeKey` |
| `spec-hash` | the minted `specHash` (§4.5) | the document's own `specPayload` |

A `spec-hash` vector also carries **`canonicalPayload`**: the intermediate bytes of §4.5 step 2,
written out so that an implementation which mints the wrong digest can see *where* it diverged
rather than only *that* it did. It is derived, never authoritative — the rule is, and the emitter
recomputes it.

Two of the vectors carry the same `digest` and the same `canonicalPayload` while differing in their
own `sha256`: the same specification, authored in a different member order, minting one identity.
That pair is the family's reason for existing, and an implementation that reproduces every other
vector but not those two has a canonicalisation that is ordering-dependent — the failure §4.2 rule 3
is written to make impossible.

### 9.5 Forward-coupling rule

A change to any field, ordering, encoding or digest specified here updates **this document, the
schemas, the emitter and the corpus in the same commit**. A corpus that lags its emitter certifies
nothing; a specification that lags either is worse than absent, because it is believed.

### 9.6 Two emitters

[`wire-fixtures/emit.mjs`](wire-fixtures/emit.mjs) derives every `round-trip` and `hash` document
from unsorted, unstamped input models by applying the ordering, encoding and identity rules as this
document states them, and compares its output byte-for-byte against the committed fixtures. It is
dependency-free and deliberately minimal. No digest in the corpus is a constant it was given: every
`specHash` is minted from its own payload by §4.5 and every `compositeKeyHash` is derived by §4.3, so
a fixture cannot disagree with its own identity.

Its purpose is **triangulation**. One emitter cannot distinguish the protocol from its own
accidents, because whatever it does becomes "the format" by default. A divergence between an
independent emitter and the committed corpus is a defect **in this specification** — either a rule
is missing here, or a rule stated here is not the rule being followed.

It deliberately does not emit `reject` or `accept` vectors: those are documents an implementation
must refuse or tolerate, so reproducing their bytes would prove nothing about either.

### 9.7 Schemas

[`schemas/v1/`](schemas/v1/) carries one JSON Schema (draft 2020-12) per document kind, plus the
envelope. They are a **structural** check and are subordinate to §5: where a schema and this
document disagree, this document is right and the schema is a defect.

A schema cannot express the rules that matter most here — member ordering, the absence of
whitespace, sign-prefixed integers as strings *meaning* integers, or that a hash equals a
recomputation. Passing schema validation is therefore necessary and nowhere near sufficient;
[`wire-fixtures/validate.mjs`](wire-fixtures/validate.mjs) runs it as one layer beneath the byte
comparison, not as a substitute for it.

---

## Appendix A — implementation checklist

Ordered by how often each one is the thing that is wrong.

- [ ] Record members in **declaration order**, not sorted; **map** keys sorted (§3.2 divergence 1).
- [ ] No whitespace anywhere.
- [ ] Optional members present as `null`, never omitted — except a late member, which is omitted when
      it carries nothing (§3.1 rule 5).
- [ ] A unit as its one canonical text (§3.5), and a gate never compared with a diagnostic stated in
      another unit (§5.3).
- [ ] 64-bit integers (`seed`, `rowCount`, `durationMs`) as **sign-prefixed strings**.
- [ ] Real numbers by the ECMAScript shortest-round-trip rule; no non-finite values on the wire.
- [ ] `specPayload` neither parsed nor re-encoded — the bytes you received are the bytes you store.
- [ ] `specHash` stored exactly as handed; **never recomputed** by the executor, even where the
      algorithm named is one you implement (§4.2 rule 2).
- [ ] Minting (submitter side): **every** object sorted, not just maps; arrays left alone; the
      canonical bytes hashed, never the payload as rendered (§4.5).
- [ ] `compositeKeyHash` recomputed over `compositeKey`'s canonical bytes, and a mismatch refused.
- [ ] `submissions` **not** sorted — the receipt indexes into the submitter's order.
- [ ] Every other list sorted by the key §5 names, **ordinally**.
- [ ] Partial batch acceptance returned as a receipt, not as a whole-batch refusal.
- [ ] Cursors echoed unmodified; an invalid cursor refused, never restarted from the beginning.
- [ ] Unknown members ignored; an unknown refusal `class` read as `unspecified`, not as a failure.
- [ ] Unknown envelope `kind` refused with `unknownDocumentKind`, never guessed from body shape.
- [ ] No scope, tenant or user identifier anywhere on the wire (§6.2).

---

## Appendix B — non-normative rationale and provenance

**Nothing in this appendix is normative**, and §1–§9 plus Appendix A reference nothing outside this
file, [`schemas/`](schemas/) and [`wire-fixtures/`](wire-fixtures/). The specification is therefore
self-contained and moves to a standalone home unchanged; this appendix is the only part that would
become a pointer.

**Spec-what-ships.** Every shape here was derived from a working execution substrate rather than
designed in the abstract, then restated generically: names, member sets and the opacity posture come
from surfaces that were already carrying real fits when this was written. Where a working
implementation had a shape this document does not (a transport, a route, a scope resolver), that is
§1's out-of-scope list doing its job rather than an omission.

**Why the payload is opaque.** Two parties, each of which would have to adopt the other's vocabulary
to interpret it, would collapse into one system with two deployments. Opacity is what keeps the
model author's design surface and the executor's execution record independently versionable — and
it is what makes the composite key necessary, since with no shared structure there is nothing else
that could name the same fit twice.

**Why batch and pagination are version 1 rather than a later addition.** The design load is a
submitter replaying many configurations across many vintages, not a person fitting one model. A
single-item interface retrofitted with batching produces a batch endpoint whose semantics are a
loop, and a loop has no partial-acceptance shape — so the receipt of §5.3, which is the whole point,
could not be added later without breaking every caller.

**Design provenance.** The layered cut this specification is Layer 1 of, its locked decisions, and
the two-party framing are recorded separately from this document, which deliberately cites no
private planning artefact. A party implementing against this file needs nothing from that record.
