import { createHash } from "node:crypto";
import { validateWarehouseSnapshot } from "../contracts/validators.js";

export function createWarehouseService({ repository, idGenerator, clock = () => new Date() }) {
  if (!repository || !idGenerator) throw new Error("WAREHOUSE_SERVICE_CONFIG_INVALID");

  const detail = (record) => ({
    id: record.id,
    revision: record.revision,
    status: record.status,
    position: record.position,
    snapshot: structuredClone(record.snapshot),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
  const summary = (record) => ({
    id: record.id,
    name: record.snapshot.name,
    revision: record.revision,
    status: record.status,
    position: record.position,
    updatedAt: record.updatedAt,
  });

  return {
    async listWarehouses(userId) {
      requireUser(userId);
      const result = await repository.listWithOrderRevision(userId);
      return { revision: result.revision, warehouses: result.warehouses.map(summary) };
    },
    async getWarehouse(userId, id) {
      requireUser(userId);
      const record = await repository.get(userId, id);
      if (!record) throw domainError("WAREHOUSE_NOT_FOUND");
      return detail(record);
    },
    async createWarehouse(userId, snapshot) {
      requireUser(userId);
      requireSnapshot(snapshot);
      const now = clock();
      return detail(await repository.create(userId, {
        id: idGenerator("warehouse"), revision: 0, status: "ready", snapshot: structuredClone(snapshot), createdAt: now, updatedAt: now,
      }));
    },
    async saveWarehouse(userId, id, { revision, snapshot } = {}) {
      requireUser(userId);
      requireRevision(revision);
      requireSnapshot(snapshot);
      const result = await repository.updateIfRevision(userId, id, revision, { snapshot: structuredClone(snapshot), updatedAt: clock() });
      handleMutationOutcome(result.outcome);
      return detail(result.warehouse);
    },
    async deleteWarehouse(userId, id, { revision } = {}) {
      requireUser(userId);
      requireRevision(revision);
      handleMutationOutcome(await repository.deleteReadyIfRevision(userId, id, revision));
    },
    async reorderWarehouses(userId, { revision, warehouseIds } = {}) {
      requireUser(userId);
      requireRevision(revision);
      if (!Array.isArray(warehouseIds) || new Set(warehouseIds).size !== warehouseIds.length || warehouseIds.some((id) => typeof id !== "string" || !id)) throw domainError("VALIDATION_FAILED");
      const current = await repository.list(userId);
      if (current.length !== warehouseIds.length || current.some((item) => !warehouseIds.includes(item.id))) throw domainError("VALIDATION_FAILED");
      const result = await repository.reorderIfRevision(userId, revision, warehouseIds);
      handleMutationOutcome(result.outcome);
      return { revision: result.revision, warehouses: result.warehouses.map(summary) };
    },
    async importWarehouses(userId, { idempotencyKey, warehouses } = {}) {
      requireUser(userId);
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 128 || !Array.isArray(warehouses) || warehouses.length === 0) throw domainError("VALIDATION_FAILED");
      if (warehouses.length > 10) throw domainError("WAREHOUSE_LIMIT_REACHED");
      warehouses.forEach(requireSnapshot);
      const fingerprint = createHash("sha256").update(canonicalJson(warehouses)).digest("hex");
      const previous = await repository.getImportBatch(userId, idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw domainError("VALIDATION_FAILED");
        return previous.result;
      }
      const now = clock();
      const records = warehouses.map((source) => ({
        id: idGenerator("warehouse"), revision: 0, status: "ready", snapshot: remapSnapshot(source, idGenerator), createdAt: now, updatedAt: now,
      }));
      const result = (storedRecords) => ({ warehouses: storedRecords.map(summary) });
      const batch = await repository.importEmptyBatch(userId, idempotencyKey, fingerprint, records, result);
      if (batch.fingerprint !== fingerprint) throw domainError("VALIDATION_FAILED");
      return batch.result;
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function remapSnapshot(source, idGenerator) {
  const snapshot = structuredClone(source);
  const pineconeIds = new Map(snapshot.pinecones.map((item) => [item.id, idGenerator("pinecone")]));
  const shelfIds = new Map(snapshot.shelves.map((item) => [item.id, idGenerator("shelf")]));
  snapshot.pinecones = snapshot.pinecones.map((item) => remapReferences({ ...item, id: pineconeIds.get(item.id) }, pineconeIds, shelfIds));
  snapshot.shelves = snapshot.shelves.map((item) => remapReferences({ ...item, id: shelfIds.get(item.id) }, pineconeIds, shelfIds));
  snapshot.document = remapReferences(snapshot.document, pineconeIds, shelfIds);
  if (Array.isArray(snapshot.document.sections)) snapshot.document.sections = snapshot.document.sections.map((section) => ({ ...section, id: idGenerator("section") }));
  return snapshot;
}

function remapReferences(value, pineconeIds, shelfIds) {
  if (Array.isArray(value)) return value.map((item) => remapReferences(item, pineconeIds, shelfIds));
  if (!value || typeof value !== "object") return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapReferences(item, pineconeIds, shelfIds)]));
  if (Array.isArray(value.pineconeIds)) mapped.pineconeIds = value.pineconeIds.map((id) => pineconeIds.get(id));
  if (typeof value.shelfId === "string" && value.shelfId) mapped.shelfId = shelfIds.get(value.shelfId);
  return mapped;
}

function requireUser(userId) {
  if (typeof userId !== "string" || !userId) throw domainError("AUTH_REQUIRED");
}

function requireSnapshot(snapshot) {
  const validation = validateWarehouseSnapshot(snapshot);
  if (!validation.ok || snapshot.name.length > 120) throw domainError(validation.code || "VALIDATION_FAILED");
}

function requireRevision(revision) {
  if (!Number.isInteger(revision) || revision < 0) throw domainError("VALIDATION_FAILED");
}

function handleMutationOutcome(outcome) {
  if (outcome === "not_found") throw domainError("WAREHOUSE_NOT_FOUND");
  if (outcome === "organizing") throw domainError("WAREHOUSE_ORGANIZING");
  if (outcome === "conflict") throw domainError("REVISION_CONFLICT");
}

function domainError(code) {
  return Object.assign(new Error(code), { code });
}
