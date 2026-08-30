const MAX_PINECONES = 500;
const MAX_PINECONE_CODE_POINTS = 4_000;
const MAX_TOTAL_CODE_POINTS = 20_000;
const MAX_REQUEST_BYTES = 1_048_576;

const jobTransitions = new Set([
  "queued:running",
  "queued:failed",
  "queued:expired",
  "running:succeeded",
  "running:failed",
  "running:expired",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ok = () => ({ ok: true });
const invalid = (code) => ({ ok: false, code });
const codePointLength = (value) => Array.from(value).length;

export function validateWarehouseSnapshot(snapshot) {
  if (!isObject(snapshot)) return invalid("VALIDATION_FAILED");
  const allowed = new Set(["schema_version", "name", "document", "shelves", "pinecones"]);
  if (Object.keys(snapshot).some((key) => !allowed.has(key))) return invalid("VALIDATION_FAILED");
  if (snapshot.schema_version !== 1 || typeof snapshot.name !== "string" || !snapshot.name.trim()) return invalid("VALIDATION_FAILED");
  if (!isObject(snapshot.document) || !Array.isArray(snapshot.shelves) || !Array.isArray(snapshot.pinecones)) return invalid("VALIDATION_FAILED");
  return ok();
}

export function validateOrganizeRequest(request) {
  if (!isObject(request)) return invalid("VALIDATION_FAILED");
  const { warehouseId, revision, idempotencyKey, mode, currentDocument, pinecones } = request;
  if (typeof warehouseId !== "string" || !warehouseId || !Number.isInteger(revision) || revision < 0 || typeof idempotencyKey !== "string" || !idempotencyKey || !["merge", "rebuild"].includes(mode)) {
    return invalid("VALIDATION_FAILED");
  }
  if (mode === "merge" && !isValidDocument(currentDocument, true)) return invalid("VALIDATION_FAILED");
  if (!Array.isArray(pinecones) || pinecones.length === 0) return invalid("AI_INPUT_EMPTY");
  if (pinecones.length > MAX_PINECONES) return invalid("AI_INPUT_TOO_MANY_ITEMS");
  let totalCodePoints = 0;
  const ids = new Set();
  for (const pinecone of pinecones) {
    if (!isObject(pinecone) || typeof pinecone.id !== "string" || !pinecone.id || typeof pinecone.content !== "string" || ids.has(pinecone.id)) {
      return invalid("VALIDATION_FAILED");
    }
    ids.add(pinecone.id);
    const length = codePointLength(pinecone.content);
    if (length > MAX_PINECONE_CODE_POINTS) return invalid("AI_INPUT_ITEM_TOO_LARGE");
    totalCodePoints += length;
  }
  if (mode === "merge") {
    const currentIds = new Set(currentDocument.sections.flatMap((section) => section.pineconeIds));
    if ([...ids].some((id) => currentIds.has(id))) return invalid("VALIDATION_FAILED");
  }
  if (totalCodePoints > MAX_TOTAL_CODE_POINTS) return invalid("AI_INPUT_TOO_LARGE");
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES) return invalid("REQUEST_TOO_LARGE");
  return ok();
}

export function validateOrganizeResult(result, inputPineconeIds, { mode = "rebuild", currentDocument = null } = {}) {
  if (!isObject(result) || !isObject(result.document) || typeof result.document.title !== "string" || !result.document.title.trim() || !Array.isArray(result.document.sections) || result.document.sections.length === 0) {
    return invalid("AI_OUTPUT_SCHEMA_INVALID");
  }
  if (!Array.isArray(inputPineconeIds) || new Set(inputPineconeIds).size !== inputPineconeIds.length) return invalid("VALIDATION_FAILED");
  const sectionIds = new Set();
  const assignedIds = [];
  for (const section of result.document.sections) {
    if (!isObject(section) || typeof section.id !== "string" || !section.id || sectionIds.has(section.id) || typeof section.title !== "string" || !section.title.trim() || typeof section.summary !== "string" || !Array.isArray(section.points) || !Array.isArray(section.pineconeIds) || section.pineconeIds.length === 0) {
      return invalid("AI_OUTPUT_SCHEMA_INVALID");
    }
    sectionIds.add(section.id);
    assignedIds.push(...section.pineconeIds);
  }
  const inputIds = new Set(inputPineconeIds);
  if (mode === "merge") {
    if (!isValidDocument(currentDocument, true)) return invalid("VALIDATION_FAILED");
    if (!preservesCurrentDocument(currentDocument, result.document)) return invalid("AI_OUTPUT_PRESERVATION_INVALID");
    const oldIds = currentDocument.sections.flatMap((section) => section.pineconeIds);
    const temporaryAssignments = assignedIds.filter((id) => inputIds.has(id));
    const preservedAssignments = assignedIds.filter((id) => !inputIds.has(id));
    if (
      temporaryAssignments.length !== inputPineconeIds.length
      || new Set(temporaryAssignments).size !== temporaryAssignments.length
      || temporaryAssignments.some((id) => !inputIds.has(id))
      || !sameMultiset(preservedAssignments, oldIds)
    ) {
      return invalid("AI_OUTPUT_PINECONE_ASSIGNMENT_INVALID");
    }
    return ok();
  }
  if (mode !== "rebuild") return invalid("VALIDATION_FAILED");
  if (assignedIds.length !== inputPineconeIds.length || new Set(assignedIds).size !== assignedIds.length || assignedIds.some((id) => !inputIds.has(id))) {
    return invalid("AI_OUTPUT_PINECONE_ASSIGNMENT_INVALID");
  }
  return ok();
}

function isValidDocument(document, allowEmptySections) {
  if (!isObject(document) || typeof document.title !== "string" || !document.title.trim() || !Array.isArray(document.sections)) return false;
  if (!allowEmptySections && document.sections.length === 0) return false;
  const sectionIds = new Set();
  return document.sections.every((section) => {
    if (!isObject(section) || typeof section.id !== "string" || !section.id || sectionIds.has(section.id)) return false;
    sectionIds.add(section.id);
    return (
    isObject(section)
    && typeof section.title === "string"
    && typeof section.summary === "string"
    && Array.isArray(section.points)
    && section.points.every((point) => typeof point === "string")
    && Array.isArray(section.pineconeIds)
    && section.pineconeIds.every((id) => typeof id === "string" && Boolean(id))
    );
  });
}

function preservesCurrentDocument(currentDocument, nextDocument) {
  if (currentDocument.title !== nextDocument.title || nextDocument.sections.length < currentDocument.sections.length) return false;
  return currentDocument.sections.every((currentSection, index) => {
    const nextSection = nextDocument.sections[index];
    return nextSection?.id === currentSection.id
      && nextSection.title === currentSection.title
      && nextSection.summary === currentSection.summary
      && startsWithValues(nextSection.points, currentSection.points)
      && startsWithValues(nextSection.pineconeIds, currentSection.pineconeIds);
  });
}

function startsWithValues(values, prefix) {
  return values.length >= prefix.length && prefix.every((value, index) => values[index] === value);
}

function sameMultiset(left, right) {
  if (left.length !== right.length) return false;
  const counts = new Map();
  for (const id of left) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of right) {
    const remaining = counts.get(id) || 0;
    if (!remaining) return false;
    counts.set(id, remaining - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

export function canTransitionJob(from, to) {
  return jobTransitions.has(`${from}:${to}`);
}

export function canWriteWarehouse(status) {
  return status === "ready";
}
