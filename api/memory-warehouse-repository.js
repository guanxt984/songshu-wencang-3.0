export function createMemoryWarehouseRepository() {
  const warehouses = [];
  const orderRevisions = new Map();
  const importBatches = new Map();

  const owned = (userId) => warehouses.filter((item) => item.userId === userId).sort((a, b) => a.position - b.position);
  const clone = (value) => structuredClone(value);

  return {
    listWithOrderRevision(userId) {
      return { revision: orderRevisions.get(userId) || 0, warehouses: clone(owned(userId)) };
    },
    list(userId) {
      return clone(owned(userId));
    },
    get(userId, id) {
      const item = warehouses.find((candidate) => candidate.userId === userId && candidate.id === id);
      return item ? clone(item) : null;
    },
    create(userId, record) {
      if (owned(userId).length >= 10) throw repositoryError("WAREHOUSE_LIMIT_REACHED");
      const stored = clone({ ...record, userId, position: owned(userId).length });
      warehouses.push(stored);
      orderRevisions.set(userId, (orderRevisions.get(userId) || 0) + 1);
      return clone(stored);
    },
    updateIfRevision(userId, id, revision, patch) {
      const item = warehouses.find((candidate) => candidate.userId === userId && candidate.id === id);
      if (!item) return { outcome: "not_found" };
      if (item.status !== "ready") return { outcome: "organizing" };
      if (item.revision !== revision) return { outcome: "conflict" };
      Object.assign(item, clone(patch), { revision: revision + 1 });
      return { outcome: "updated", warehouse: clone(item) };
    },
    deleteReadyIfRevision(userId, id, revision) {
      const index = warehouses.findIndex((candidate) => candidate.userId === userId && candidate.id === id);
      if (index < 0) return "not_found";
      if (warehouses[index].status !== "ready") return "organizing";
      if (warehouses[index].revision !== revision) return "conflict";
      warehouses.splice(index, 1);
      owned(userId).forEach((item, position) => { item.position = position; });
      orderRevisions.set(userId, (orderRevisions.get(userId) || 0) + 1);
      return "deleted";
    },
    getOrderRevision(userId) {
      return orderRevisions.get(userId) || 0;
    },
    reorderIfRevision(userId, revision, ids) {
      if ((orderRevisions.get(userId) || 0) !== revision) return { outcome: "conflict" };
      const items = owned(userId);
      if (items.some((item) => item.status !== "ready")) return { outcome: "organizing" };
      ids.forEach((id, position) => {
        const item = warehouses.find((candidate) => candidate.userId === userId && candidate.id === id);
        item.position = position;
      });
      orderRevisions.set(userId, revision + 1);
      return { outcome: "updated", revision: revision + 1, warehouses: clone(owned(userId)) };
    },
    getImportBatch(userId, idempotencyKey) {
      const batch = importBatches.get(`${userId}:${idempotencyKey}`);
      return batch ? clone(batch) : null;
    },
    importEmptyBatch(userId, idempotencyKey, fingerprint, records, result) {
      const key = `${userId}:${idempotencyKey}`;
      if (importBatches.has(key)) return clone(importBatches.get(key));
      if (owned(userId).length !== 0) throw repositoryError("WAREHOUSE_NOT_EMPTY");
      if (records.length > 10) throw repositoryError("WAREHOUSE_LIMIT_REACHED");
      const storedRecords = records.map((record, position) => clone({ ...record, userId, position }));
      warehouses.push(...storedRecords);
      orderRevisions.set(userId, (orderRevisions.get(userId) || 0) + 1);
      const batch = { fingerprint, result: clone(result(storedRecords)) };
      importBatches.set(key, batch);
      return clone(batch);
    },
    setStatusForTest(userId, id, status) {
      const item = warehouses.find((candidate) => candidate.userId === userId && candidate.id === id);
      if (item) item.status = status;
    },
  };
}

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}
