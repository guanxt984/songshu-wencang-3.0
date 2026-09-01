# Dual Organization Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and verify two project-level Skills that reliably guide merge and rebuild organization modes.

**Architecture:** Store each Skill as an independent package under `.agents/skills`, with a concise `SKILL.md`, Codex metadata, and a mode-specific reference checklist. Test each Skill against a fresh-context pressure scenario before and after loading it, and finish one Skill before creating the next.

**Tech Stack:** Markdown Skill packages, YAML agent metadata, Python skill validation, existing Node.js project checks.

**Spec:** `docs/superpowers/specs/2026-09-01-dual-organization-skills-design.md`

## Global Constraints

- Skills are project-local under `.agents/skills/`.
- Merge accepts only temporary pinecones and preserves all existing document fields and old references verbatim.
- Rebuild consumes all pinecones and may replace the current document completely.
- Every in-scope pinecone ID appears exactly once in a successful result.
- Content organization follows `docs/fragmented-information-processing-principles.md`.
- Complete baseline test, creation, Skill-enabled test, and validation for the first Skill before creating the second.

---

### Task 1: Merge Skill

**Files:**
- Create: `.agents/skills/merging-temporary-pinecones/SKILL.md`
- Create: `.agents/skills/merging-temporary-pinecones/agents/openai.yaml`
- Create: `.agents/skills/merging-temporary-pinecones/references/merge-checklist.md`

**Interfaces:**
- Consumes: mode `merge`, current document, old references, and temporary pinecones.
- Produces: preservation-safe instructions and a result checklist for incremental organization.

- [x] **Step 1: Run a fresh-context baseline pressure test without the Skill**

Use a scenario containing manually edited titles and summaries, old pinecone references, duplicate new facts, one conflicting claim, and one unrelated temporary pinecone. Record whether the response rewrites old content, loses references, duplicates IDs, or forces an unrelated item into an existing section.

- [x] **Step 2: Create the minimal Skill package**

Initialize `merging-temporary-pinecones`, then replace generated placeholders with merge-specific trigger wording, ordered processing instructions, invariants, failure handling, and the mode checklist.

- [x] **Step 3: Validate the package structure**

Run:

```powershell
python C:\Users\GXT\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\merging-temporary-pinecones
```

Expected: validation succeeds with no metadata or naming errors.

- [x] **Step 4: Re-run the same pressure test with the Skill loaded**

Expected: all pre-existing fields and references remain byte-for-byte unchanged, only temporary pinecones are added, every temporary ID occurs once, and unrelated material creates a justified new section.

- [x] **Step 5: Refine until all merge checks pass**

Add explicit counters for any rationalization found during testing, especially “minor cleanup is harmless”, “moving an old point improves structure”, or “a vaguely related section is good enough”.

### Task 2: Rebuild Skill

**Files:**
- Create: `.agents/skills/rebuilding-warehouse-document/SKILL.md`
- Create: `.agents/skills/rebuilding-warehouse-document/agents/openai.yaml`
- Create: `.agents/skills/rebuilding-warehouse-document/references/rebuild-checklist.md`

**Interfaces:**
- Consumes: mode `rebuild`, warehouse name, and every raw pinecone.
- Produces: full-document reconstruction instructions and a complete one-to-one mapping checklist.

- [x] **Step 1: Run a fresh-context baseline pressure test without the Skill**

Use a scenario with mixed facts, opinions, methods, examples, duplicate material, uncertain claims, source links, and misleading input order. Record whether the response merely summarizes, follows paste order, invents content, drops sources, or loses/duplicates IDs.

- [x] **Step 2: Create the minimal Skill package**

Initialize `rebuilding-warehouse-document`, then replace generated placeholders with full-rebuild trigger wording, knowledge-unit extraction, semantic clustering, hierarchy construction, traceability rules, uncertainty handling, and the mode checklist.

- [x] **Step 3: Validate the package structure**

Run:

```powershell
python C:\Users\GXT\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\rebuilding-warehouse-document
```

Expected: validation succeeds with no metadata or naming errors.

- [x] **Step 4: Re-run the same pressure test with the Skill loaded**

Expected: the result is organized by reader-oriented themes, distinguishes information types, retains sources and uncertainty, introduces no unsupported knowledge, and maps every input ID exactly once.

- [x] **Step 5: Refine until all rebuild checks pass**

Add explicit counters for any rationalization found during testing, especially “a polished summary is sufficient”, “input order is a reasonable outline”, or “background knowledge improves completeness”.

### Task 3: Repository Verification

**Files:**
- Modify only if verification reveals a defect in the new Skill packages.

**Interfaces:**
- Consumes: both validated Skill packages.
- Produces: a clean repository diff and passing project checks.

- [x] **Step 1: Scan for placeholders and broken project references**

Run `rg -n "TBD|TODO|implement later|fill in details" .agents/skills` and verify every referenced project file exists.

- [x] **Step 2: Run project checks**

Run `npm run check` and expect all existing checks to pass.

- [x] **Step 3: Check patch integrity**

Run `git diff --check` and inspect `git diff -- .agents/skills docs/superpowers`.

- [x] **Step 4: Commit the completed Skills**

Stage only the two Skill packages and their approved design and implementation documents, then commit with `feat: add dual organization skills`.
