---
name: rebuilding-warehouse-document
description: Use when organizing a Squirrel Warehouse in rebuild mode, replacing the current document by deriving a new reader-oriented structure from every raw pinecone while preserving traceability, uncertainty, and one-to-one pinecone assignment.
---

# Rebuilding a Warehouse Document

## Overview

Rebuild the complete structured document from all raw pinecones in the warehouse. Identify themes before choosing sections, organize for the reader rather than for input order, and preserve every source ID exactly once.

This mode may replace old document structure and manual edits. The raw pinecones are the content authority.

## Required Inputs

Before organizing, require:

- mode is `rebuild`;
- the warehouse name or subject;
- every raw pinecone in the warehouse, including stable IDs and available source metadata.

Inventory the input IDs before writing. If the input set is incomplete or contains duplicate IDs, stop rather than producing a partial rebuild.

## Workflow

1. Read all pinecones before choosing a title or section structure.
2. Split each pinecone into knowledge units without losing its ID, source, qualifications, or uncertainty. Because the result maps IDs at section level, all units from one pinecone must share one destination section.
3. Classify units as fact, opinion, method, example, term, question, or conclusion.
4. Identify the main subject, recurring themes, supporting themes, and outliers.
5. Cluster by meaning, not by paste order, source, or superficial wording.
6. Choose a reader-oriented hierarchy appropriate to the material. Use definitions, evidence, methods, examples, risks, and open questions only when the input supports them.
7. Merge duplicate expressions into one knowledge point while retaining every contributing pinecone ID exactly once in that section's mapping.
8. Keep facts distinct from opinions and examples distinct from conclusions.
9. Preserve links, authors, dates, quotations, and other source traces without letting them dictate section boundaries.
10. Mark unsupported, conflicting, incomplete, or source-unknown claims as uncertain or needing verification.
11. Write concise summaries and points using only knowledge supported by the input.
12. Return the complete replacement document and run `references/rebuild-checklist.md`.

Follow `../../../docs/fragmented-information-processing-principles.md` for knowledge organization. Use `../../../docs/superpowers/specs/2026-08-30-pinecone-management-dual-organize-design.md` for rebuild semantics. Use `../../../contracts/ai-organize-request.schema.json` and `../../../contracts/ai-organize-result.schema.json` for payload shapes and limits.

## Structure Rules

- The document must be understandable without reading the raw paste sequence.
- Sections must form a coherent reading path and each section must cover one recognizable theme.
- Every section must have at least one supporting pinecone.
- Section IDs must be unique and stable within the returned result.
- Similar information should be consolidated without deleting meaningful differences or qualifications.
- Outliers may enter an “other material” or “open questions” section when no stronger structure is justified.
- Do not create empty template sections merely to fill a preferred outline.

## Content and Traceability Rules

- Every input pinecone ID must appear exactly once in the section-level output mapping.
- Do not omit low-quality, duplicate, irrelevant, uncertain, or conflicting pinecones; represent them honestly in the most suitable section.
- Do not invent facts, examples, definitions, sources, conclusions, or transitions that imply unsupported causality.
- External knowledge may not be blended into the document. If explicitly requested later, label it separately as supplemental and needing verification.
- Do not expose internal processing notes such as “p6 duplicates p3”, “these items were clustered”, or “the model merged two cards” as document content. Express the supported knowledge once and retain both IDs in the mapping.
- If one pinecone spans several themes, choose one destination using its dominant topic and keep its subsidiary knowledge in that section. If this would distort an established theme, create a broader or “other material” section. Never duplicate its ID across sections.

## Replacement and Failure Semantics

The model returns only a proposed replacement `document`. After schema and mapping validation, the caller derives shelves and pinecone placement from the accepted section mapping and applies the document, shelves, and placements atomically. A failed validation must leave the previous version untouched. The model must not claim to write application state directly.

## Common Rationalizations

| Temptation | Required response |
|---|---|
| “A polished summary is enough.” | Build an explicit, reusable knowledge hierarchy. |
| “Input order is a reasonable outline.” | Discover semantic themes first. |
| “Background knowledge makes it complete.” | Use only provided materials. |
| “A weak item can be dropped.” | Retain and label it honestly. |
| “Duplicate handling should be explained in the prose.” | Merge the knowledge, keep all IDs, omit process commentary. |
| “The old document should be preserved just in case.” | Rebuild semantics allow full replacement; raw pinecones govern. |

## Output Gate

Do not return a proposed replacement until structure quality, information typing, source traceability, uncertainty labels, ID completeness, ID uniqueness, and non-fabrication all pass. Validation, derivation, and atomic application remain caller responsibilities.
