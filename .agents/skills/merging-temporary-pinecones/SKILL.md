---
name: merging-temporary-pinecones
description: Use when organizing a Squirrel Warehouse in merge mode, keeping the current sections while adding temporary pinecones without rewriting existing document content, manual edits, annotations, or old pinecone references.
---

# Merging Temporary Pinecones

## Overview

Merge only newly collected temporary pinecones into the current structured document. Treat existing scalar values and existing array entries as immutable prefixes; only append new points and temporary IDs. Add material to an existing section only when the semantic fit is defensible; otherwise create a new section.

This is preservation work, not a chance to improve the old document.

## Required Inputs

Before organizing, require:

- mode is `merge`;
- the complete contract-visible current document, including title, section IDs, titles, summaries, points, and old `pineconeIds`;
- only pinecones whose current status is temporary;
- a stable ID for every temporary pinecone.

If the current document context is absent or malformed, stop. Never guess what must be preserved.

Before generation, also verify that the preserved prefix can satisfy the result schema after considering only the additions this merge is allowed to make. The current contracts are asymmetric: a merge request may contain zero sections, up to 200 points per section, or a section with no pinecone IDs, while a result requires at least one section, permits at most 20 points per section, and requires at least one pinecone ID per section. An existing section with more than 20 points is irreparable and must fail preflight. An empty document is valid when the temporary pinecones can create a legal first section. A section with no old pinecone IDs is valid only when at least one temporary pinecone can be defensibly appended to that section without violating other limits. Stop only when the preserved prefix still cannot become a valid result through legal appends or new sections. Never delete or rewrite old content merely to make it fit the result schema.

## Workflow

1. Freeze a verbatim snapshot of all existing scalar values and every existing array entry, including order and old pinecone ownership.
2. Run the preservation-versus-result-schema preflight. Stop if the existing prefix cannot be represented in a valid result.
3. Inventory all temporary pinecone IDs. This is the required output-ID set.
4. Split each temporary pinecone into knowledge units while retaining its ID, source, qualifications, and uncertainty. Because the result maps IDs at section level, all units from one pinecone must share one destination section.
5. Classify each unit as fact, opinion, method, example, term, question, or conclusion.
6. Compare the unit with existing section titles, summaries, and points.
7. Append it to an existing section only when that section clearly covers the same topic and the append will remain within result limits.
8. Create a new section when no existing section is a defensible fit or the matching section cannot accept more points. Never force unrelated material into the nearest section.
9. Merge duplicate new statements at the prose level, but attach every contributing temporary ID exactly once to the destination section.
10. Preserve conflicting or uncertain material and label it as disputed, source-unknown, or needing verification. Do not silently discard it.
11. Return the full document and run the checklist in `references/merge-checklist.md`.

Follow the content-quality principles in `../../../docs/fragmented-information-processing-principles.md`. For product semantics, use `../../../docs/superpowers/specs/2026-08-30-pinecone-management-dual-organize-design.md`. For payload shapes and limits, use `../../../contracts/ai-organize-request.schema.json` and `../../../contracts/ai-organize-result.schema.json`.

## Preservation Boundary

The following existing values must remain byte-for-byte unchanged:

- document title;
- existing section IDs, titles, and summaries;
- user-edited scalar text represented in the contract.

Existing section order remains unchanged. Existing points and old `pineconeIds` are immutable prefixes: their values and order must remain unchanged, while new points and temporary IDs may be appended at the end of the matching section. New sections may be appended when necessary. Do not rename, polish, normalize, shorten, relocate, deduplicate, or correct old content.

Annotations are not part of the current AI request/result schemas. If the application stores contract-external annotations, the caller—not the model—must retain and reattach them unchanged after validating the result.

## ID and Source Rules

- The output must contain every temporary pinecone ID exactly once.
- No temporary ID may be dropped because its content is irrelevant, repetitive, conflicting, low confidence, or hard to classify.
- No old ID may be removed, duplicated, or moved.
- The contract maps pinecone IDs only at section level; it does not provide point-level ID mapping.
- When duplicate temporary pinecones support one point, keep all contributing IDs in that section's `pineconeIds`.
- If one pinecone spans several themes, choose one destination using its dominant topic. Keep its subsidiary knowledge in that same section; when no single existing section can represent it without distortion, create a new broader or “other material” section. Never duplicate its ID across sections.
- Preserve source URLs, author names, dates, and meaningful quotations when present.
- Do not invent IDs or cite a pinecone for a claim it does not support.

## Failure Semantics

If any preservation or ID check fails, reject the entire proposed result. The model returns only a proposed document; the caller owns validation and atomic application. On rejection, the caller must leave the current document and temporary shelf unchanged so the user can retry.

## Common Rationalizations

| Temptation | Required response |
|---|---|
| “Minor cleanup improves readability.” | Existing wording is immutable in merge mode. |
| “This old point belongs in another section.” | Moving old content is a rebuild operation. |
| “The unrelated pinecone can be omitted.” | Create a justified new section and retain its ID. |
| “The uncertain claim is probably wrong.” | Preserve it with an uncertainty label. |
| “Duplicates only need one ID.” | Prose may merge; every contributing ID remains mapped once. |

## Output Gate

Do not return a proposed result until all preservation, completeness, uniqueness, traceability, and non-fabrication checks pass. Application remains the caller's responsibility.
