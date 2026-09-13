const copy = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item; });
export function warehouseSnapshot(record) {
  return { schema_version: 1, name: record.name, document: copy(record.reviewDocument || { title: record.name, sections: [] }), shelves: copy(record.shelves || []), pinecones: copy(record.pinecones || []), ...(record.avatar ? { avatar: record.avatar } : {}) };
}
export function removePineconeReferences(value, id) {
  if (Array.isArray(value)) return value.map((item) => removePineconeReferences(item, id));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'pineconeIds' && Array.isArray(item) ? item.filter((itemId) => itemId !== id) : removePineconeReferences(item, id)]));
}
export function formatWarehouseUpdatedAt(value, { now = new Date(), timeZone } = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });
  return `${dateFormat.format(date) === dateFormat.format(now) ? '今天' : dateFormat.format(date)} ${timeFormat.format(date)} 更新`;
}
const recordOf = (detail) => copy({ id: detail.id, name: detail.snapshot.name, avatar: detail.snapshot.avatar, reviewDocument: detail.snapshot.document, shelves: detail.snapshot.shelves, pinecones: detail.snapshot.pinecones, updatedAt: formatWarehouseUpdatedAt(detail.updatedAt) });

// One durable mutation at a time. A failed revision is never refreshed and retried blindly.
export function createCloudWarehouseStore({ userId, csrfToken, fetchImpl = fetch, storage = localStorage, onStatus = () => {}, locks = globalThis.navigator?.locks }) {
  const legacyKey = `squirrel-cloud-pending:${userId}`;
  const taskPrefix = `squirrel-cloud-task:${encodeURIComponent(userId)}:`;
  const recoveryKey = `squirrel-cloud-recovery:${userId}`;
  const recoveryPrefix = `squirrel-cloud-backup:${encodeURIComponent(userId)}:`;
  let current = [], orderRevision = 0, pending = null, busy = false, stopped = false;
  const notify = (status, error = '') => { if (!stopped) onStatus({ status, error }); };
  const entries = (prefix) => {
    const result = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) result.push(JSON.parse(storage.getItem(key)));
    }
    return result;
  };
  const persist = () => { if (pending) storage.setItem(taskPrefix + pending.taskId, JSON.stringify(pending)); };
  const clearCurrent = () => { if (pending) storage.removeItem(taskPrefix + pending.taskId); pending = null; };
  const readPending = () => {
    const legacy = storage.getItem(legacyKey);
    if (legacy && storage.getItem(legacyKey + ':migrated') !== legacy) {
      const task = { ...JSON.parse(legacy), taskId: crypto.randomUUID(), savedAt: new Date().toISOString() };
      storage.setItem(taskPrefix + task.taskId, JSON.stringify(task));
      // Keep the original legacy bytes. The marker prevents reimporting a completed old task.
      storage.setItem(legacyKey + ':migrated', legacy);
    }
    return entries(taskPrefix).sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''));
  };
  const call = async (path, method = 'GET', body) => {
    if (stopped) throw new Error('账号已退出');
    const response = await fetchImpl(path, { credentials: 'same-origin', method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.message || '云端保存失败，请重试'), { code: data.error?.code });
    if (stopped) throw new Error('账号已退出');
    return data;
  };
  async function list() {
    const result = await call('/api/warehouses');
    return { ...result, details: await Promise.all(result.warehouses.map((item) => call(`/api/warehouses/${item.id}`))) };
  }
  return {
    get blocked() { return busy || Boolean(pending); },
    getPendingBackups() { return copy(readPending()); },
    getRecovery() {
      const raw = storage.getItem(recoveryKey);
      const backups = [...(raw ? JSON.parse(raw).entries || [] : []), ...entries(recoveryPrefix)];
      return backups.length ? { userId, entries: backups } : null;
    },
    stop() { stopped = true; },
    async load() {
      busy = true; notify('loading');
      try {
        pending = readPending()[0] || null;
        const result = await list(); current = result.details; orderRevision = result.revision;
        notify(pending ? 'error' : 'saved', pending ? '有未完成的保存，请重试；遇到版本冲突请先导出本地副本。' : '');
        return pending?.records || current.map(recordOf);
      } catch (error) { notify('error', error.message); if (pending) return copy(pending.records); throw error; }
      finally { busy = false; }
    },
    async save(records) {
      if (busy || pending) throw new Error('请先完成当前云端保存');
      const snapshots = records.map((item) => ({ id: item.id, snapshot: warehouseSnapshot(item) }));
      if (canonical(snapshots) === canonical(current.map((item) => ({ id: item.id, snapshot: item.snapshot })))) { notify('saved'); return records; }
      pending = { taskId: crypto.randomUUID(), savedAt: new Date().toISOString(), records: copy(records), base: copy(current), orderRevision, deletedIds: [], createIds: {}, importKey: null };
      persist();
      return this.retry();
    },
    async importRecords(records) {
      if (current.length || busy || pending) throw new Error('仅空账户可导入本机资料');
      pending = { taskId: crypto.randomUUID(), savedAt: new Date().toISOString(), records: copy(records), base: [], createIds: {}, importKey: crypto.randomUUID() }; persist();
      return this.retry();
    },
    async retry() {
      if (busy) throw new Error('正在保存');
      if (!pending) return this.load();
      const taskId = pending.taskId;
      const resume = async () => {
        const raw = storage.getItem(taskPrefix + taskId);
        if (!raw) { pending = null; return this.load(); }
        pending = JSON.parse(raw);
        return this.runPending();
      };
      if (locks?.request) return locks.request(taskPrefix + taskId, resume);
      if (!pending.importKey && pending.records.some((record) => !pending.base.some((base) => base.id === record.id) && !pending.createIds[record.id])) {
        const error = new Error('当前浏览器无法安全协调新增保存，请使用新版 Chrome 或 Edge 后重试。');
        notify('error', error.message); throw error;
      }
      return resume();
    },
    async runPending() {
      if (busy) throw new Error('正在保存');
      busy = true; notify('saving');
      try {
        if (pending.importKey) {
          await call('/api/import', 'POST', { idempotencyKey: pending.importKey, warehouses: pending.records.map(warehouseSnapshot) });
        } else {
          for (const record of pending.records) {
            const snapshot = warehouseSnapshot(record);
            const base = pending.base.find((item) => item.id === record.id);
            if (base && canonical(base.snapshot) !== canonical(snapshot)) {
              // A lost response is recognized only if the complete desired snapshot already exists.
              const latest = await call(`/api/warehouses/${base.id}`);
              if (canonical(latest.snapshot) !== canonical(snapshot)) await call(`/api/warehouses/${base.id}`, 'PUT', { revision: base.revision, snapshot });
            } else if (!base && !pending.createIds[record.id]) {
              if (pending.uncertainCreate === record.id) throw new Error('新增请求结果不确定。请导出本地副本并重新载入云端，避免重复创建。');
              pending.uncertainCreate = record.id; persist();
              try {
                const result = await call('/api/warehouses', 'POST', { snapshot });
                pending.createIds[record.id] = result.id; delete pending.uncertainCreate; persist();
              } catch (error) {
                if (error.code) { delete pending.uncertainCreate; persist(); }
                throw error;
              }
            }
          }
          for (const base of pending.base.filter((item) => !pending.records.some((record) => record.id === item.id))) {
            if (pending.deletedIds.includes(base.id)) continue;
            try { await call(`/api/warehouses/${base.id}`, 'DELETE', { revision: base.revision }); }
            catch (error) { if (error.code !== 'WAREHOUSE_NOT_FOUND') throw error; }
            pending.deletedIds.push(base.id); persist();
          }
          const order = pending.records.map((item) => pending.createIds[item.id] || item.id);
          const fresh = await call('/api/warehouses');
          if (fresh.warehouses.some((item) => !order.includes(item.id))) throw new Error('云端仓库列表已变化，请导出本地副本并重新载入');
          if (JSON.stringify(fresh.warehouses.map((item) => item.id)) !== JSON.stringify(order)) {
            const expectedRevision = pending.orderRevision + Object.keys(pending.createIds).length + pending.deletedIds.length;
            if (fresh.revision !== expectedRevision || fresh.warehouses.length !== order.length) throw new Error('云端排序已变化，请导出本地副本并重新载入');
            await call('/api/warehouses/order', 'PUT', { revision: expectedRevision, warehouseIds: order });
          }
        }
        const result = await list(); current = result.details; orderRevision = result.revision;
        clearCurrent(); notify('saved');
        return current.map(recordOf);
      } catch (error) { notify('error', error.code === 'REVISION_CONFLICT' ? '另一页面已修改此仓库。请导出本地副本，再重新载入云端。' : error.message); throw error; }
      finally { busy = false; }
    },
    async discardAndReload() {
      if (busy) throw new Error('正在保存');
      if (pending) {
        // Persist a recoverable account-scoped copy before removing the only pending copy.
        storage.setItem(recoveryPrefix + pending.taskId, JSON.stringify({ savedAt: new Date().toISOString(), records: copy(pending.records), pending: copy(pending) }));
        clearCurrent();
      }
      return this.load();
    },
  };
}
