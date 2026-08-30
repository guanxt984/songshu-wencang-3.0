# Pinecone Management and Dual Organize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify pinecone management and support repeatable merge/rebuild organization gated by temporary pinecones.

**Architecture:** Keep persistence backward compatible while removing featured behavior from active UI. Put organization semantics in the pure local organizer and pass an explicit mode through the UI, so merge preservation and rebuild replacement are independently testable.

**Tech Stack:** Native HTML/CSS/JavaScript ES modules, Node test runner, JSON Schema.

**Spec:** `docs/superpowers/specs/2026-08-30-pinecone-management-dual-organize-design.md`

## Global Constraints

- New pinecones always enter the temporary shelf.
- Temporary storage has no UI quantity limit.
- Organization is allowed only when temporary pinecones exist and no job is active.
- Merge preserves existing document fields verbatim; rebuild replaces them.
- Normal cards show text only; management mode exposes inline editing and top-right deletion.

---

### Task 1: Organization domain behavior

**Files:**
- Modify: `organizer.test.mjs`
- Modify: `organizer.js`
- Modify: `warehouse-management.test.mjs`
- Modify: `warehouse-management.js`

**Interfaces:**
- Produces: `organizeWarehouseLocally(warehouse, { mode: "merge" | "rebuild" })`
- Produces: `canStartWarehouseOrganization(activeWarehouseId, warehouse)`

- [x] **Step 1: Write failing tests** for merge preservation, rebuild replacement, empty-temp gating, and unlimited temporary storage metadata.
- [x] **Step 2: Run `node --test organizer.test.mjs warehouse-management.test.mjs`** and confirm failures describe the missing mode/gate behavior.
- [x] **Step 3: Implement minimal pure domain logic** so merge appends temporary materials without rewriting existing fields and rebuild retains current full-generation behavior.
- [x] **Step 4: Run the focused tests** and confirm they pass.

### Task 2: Contracts and documentation

**Files:**
- Modify: `contracts/ai-organize-request.schema.json`
- Modify: `contracts/contract.test.mjs`
- Modify: `PRODUCT.md`
- Modify: `docs/松鼠文仓-产品实现链路与公开测试版方案.md`

**Interfaces:**
- Consumes: organization modes from Task 1.
- Produces: request field `mode` with enum `merge | rebuild`.

- [x] **Step 1: Write a failing contract test** requiring the mode enum and current-document context for merge.
- [x] **Step 2: Run `node --test contracts/contract.test.mjs`** and confirm it fails against the old schema.
- [x] **Step 3: Update schemas and product documentation** to describe both modes, unlimited temporary storage, and removal of featured pinecones.
- [x] **Step 4: Run the contract test** and confirm it passes.

### Task 3: Shelf management UI

**Files:**
- Modify: `test-ui-content.cjs`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: domain gate and organizer modes from Task 1.
- Produces: `state.shelfManaging`, `data-action="toggle-shelf-management"`, and mode-aware reorganization confirmation.

- [x] **Step 1: Update UI assertions first** for the compact tool row, absence of featured controls, management controls, and two organize choices.
- [x] **Step 2: Run `node test-ui-content.cjs`** and confirm it fails on the old markup.
- [x] **Step 3: Implement UI and interaction changes** including inline editing, top-right delete, add-to-temp, disabled organize state, and selected organize mode.
- [x] **Step 4: Run UI checks and focused unit tests** and confirm they pass.

### Task 4: End-to-end verification

**Files:**
- Modify only if a defect is reproduced by a new failing test.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified public-beta behavior.

- [x] **Step 1: Run `npm run check` and `git diff --check`.**
- [x] **Step 2: Test in browser**: add multiple pinecones, manage/edit/delete, merge, add again and merge again, then inspect rebuild without overwriting current demo data.
- [x] **Step 3: Inspect responsive shelf layout and keyboard focus states.**
- [x] **Step 4: Request code review and address any material findings with failing tests first.**
