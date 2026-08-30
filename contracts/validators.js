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
  const { warehouseId, revision, idempotencyKey, pinecones } = request;
  if (typeof warehouseId !== "string" || !warehouseId || !Number.isInteger(revision) || revision < 0 || typeof idempotencyKey !== "string" || !idempotencyKey) {
    return invalid("VALIDATION_FAILED");
  }
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
  if (totalCodePoints > MAX_TOTAL_CODE_POINTS) return invalid("AI_INPUT_TOO_LARGE");
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES) return invalid("REQUEST_TOO_LARGE");
  return ok();
}

export function validateOrganizeResult(result, inputPineconeIds) {
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
  if (assignedIds.length !== inputPineconeIds.length || new Set(assignedIds).size !== assignedIds.length || assignedIds.some((id) => !inputIds.has(id))) {
    return invalid("AI_OUTPUT_PINECONE_ASSIGNMENT_INVALID");
  }
  return ok();
}

export function canTransitionJob(from, to) {
  return jobTransitions.has(`${from}:${to}`);
}

export function canWriteWarehouse(status) {
  return status === "ready";
}
