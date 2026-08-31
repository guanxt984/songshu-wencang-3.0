export const BUILT_IN_WAREHOUSE_AVATARS = [
  "squirrel-library-warehouse-logo.png",
  "squirrel-warehouse-logo-simple.png",
  "achang-doc.png",
  "achang-wave.png",
  "decor-pinecone-doc.png",
  "pinecone-warehouse-icon.png",
  "warehouse-icon-human-nature.png",
  "warehouse-icon-product-manager.png",
];

export function validateWarehouseAvatarFile(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "仅支持 PNG、JPEG 或 WebP 图片";
  }
  if (file.size > 2 * 1024 * 1024) return "图片不能超过 2MB";
  return "";
}

export function isWarehouseAvatarSource(source) {
  return BUILT_IN_WAREHOUSE_AVATARS.includes(source)
    || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(String(source || ""));
}

export function reorderWarehouses(warehouses, sourceId, targetId, placement) {
  const sourceIndex = warehouses.findIndex((item) => item.id === sourceId);
  const targetIndex = warehouses.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return warehouses;

  const next = [...warehouses];
  const [source] = next.splice(sourceIndex, 1);
  const adjustedTarget = next.findIndex((item) => item.id === targetId);
  const insertIndex = adjustedTarget + (placement === "after" ? 1 : 0);
  next.splice(insertIndex, 0, source);
  return idsEqual(next, warehouses) ? warehouses : next;
}

export function removeWarehouse(warehouses, activeWarehouseId, warehouseId) {
  const index = warehouses.findIndex((item) => item.id === warehouseId);
  if (index < 0) return { warehouses, activeWarehouseId, removed: false };
  const next = warehouses.filter((item) => item.id !== warehouseId);
  const nextActive = activeWarehouseId === warehouseId
    ? (next[index]?.id || next[index - 1]?.id || "")
    : activeWarehouseId;
  return { warehouses: next, activeWarehouseId: nextActive, removed: true };
}

function idsEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item.id === right[index].id);
}

export function normalizeWarehouseState(source, version) {
  if (source?.warehouses?.byId && Array.isArray(source?.warehouses?.order)) {
    const byId = Object.fromEntries(Object.entries(source.warehouses.byId).map(([id, warehouse]) => {
      const { iconDataUrl: _iconDataUrl, tempLimit: _tempLimit, ...metadata } = warehouse;
      return [id, metadata];
    }));
    return {
      ...source,
      version,
      warehouses: {
        byId,
        order: source.warehouses.order.filter((id) => byId[id]),
      },
      documents: { byWarehouseId: { ...(source.documents?.byWarehouseId || {}) } },
      shelves: { byWarehouseId: { ...(source.shelves?.byWarehouseId || {}) } },
      pinecones: { byWarehouseId: Object.fromEntries(Object.entries(source.pinecones?.byWarehouseId || {}).map(([id, pinecones]) => [id, stripObsoletePineconeFields(pinecones)])) },
    };
  }

  const legacyWarehouses = Array.isArray(source?.warehouses) ? source.warehouses : [];
  const byId = {};
  const order = [];
  const documentsByWarehouseId = {};
  const shelvesByWarehouseId = {};
  const pineconesByWarehouseId = {};

  legacyWarehouses.forEach((warehouse) => {
    if (!warehouse?.id || byId[warehouse.id]) return;
    const { reviewDocument, shelves, pinecones, ...meta } = warehouse;
    byId[warehouse.id] = {
      id: warehouse.id,
      name: warehouse.name || "未命名松鼠仓",
      updatedAt: warehouse.updatedAt || "",
    };
    order.push(warehouse.id);
    documentsByWarehouseId[warehouse.id] = structuredClone(reviewDocument || { title: warehouse.name || "未命名松鼠仓", sections: [] });
    shelvesByWarehouseId[warehouse.id] = structuredClone(Array.isArray(shelves) ? shelves : []);
    pineconesByWarehouseId[warehouse.id] = stripObsoletePineconeFields(pinecones);
  });

  const activeWarehouseId = byId[source?.activeWarehouseId]
    ? source.activeWarehouseId
    : (order[0] || "");

  return {
    ...(source || {}),
    version,
    activeWarehouseId,
    warehouses: { byId, order },
    documents: { byWarehouseId: documentsByWarehouseId },
    shelves: { byWarehouseId: shelvesByWarehouseId },
    pinecones: { byWarehouseId: pineconesByWarehouseId },
  };
}

export function getWarehouseColor(name) {
  const colors = ["moss", "clay", "sky", "plum"];
  const paletteIndex = [...String(name || "")]
    .reduce((total, character) => total + character.codePointAt(0), 0) % colors.length;
  return colors[paletteIndex];
}

export function applyDocumentEdit(warehouse, edit, value) {
  const next = structuredClone(warehouse);
  const section = next.reviewDocument?.sections?.[edit.sectionIndex];
  if (!section) return next;

  if (edit.field === "heading") section.heading = value || section.heading;
  if (edit.field === "summary") section.summary = value;
  if (edit.field === "bullet") {
    const bullet = section.bullets?.[edit.bulletIndex];
    if (bullet) bullet.text = value;
  }
  return next;
}

export function applyPineconeEdits(warehouse, edits) {
  const invalidIds = edits.filter(({ content }) => !content.trim()).map(({ id }) => id);
  if (invalidIds.length) return { warehouse, invalidIds };

  const contentById = new Map(edits.map(({ id, content }) => [id, content.trim()]));
  const next = structuredClone(warehouse);
  for (const pinecone of next.pinecones || []) {
    if (contentById.has(pinecone.id)) pinecone.content = contentById.get(pinecone.id);
  }
  return { warehouse: next, invalidIds: [] };
}

function stripObsoletePineconeFields(pinecones) {
  return (Array.isArray(pinecones) ? pinecones : []).map((pinecone) => {
    const { isFeatured: _isFeatured, ...current } = pinecone;
    return structuredClone(current);
  });
}

export function deriveShelfSections(warehouse) {
  const pineconesById = new Map((warehouse.pinecones || []).map((pinecone) => [pinecone.id, pinecone]));
  return (warehouse.reviewDocument?.sections || []).map((section) => {
    const ids = [...new Set((section.bullets || []).flatMap((bullet) => bullet.pineconeIds || []))];
    return {
      id: section.shelfId,
      name: section.heading,
      description: section.summary,
      pinecones: ids.map((id) => pineconesById.get(id)).filter(Boolean),
      isTemporary: false,
    };
  });
}

export function isWarehouseReadOnly(organizingWarehouseId, warehouseId) {
  return Boolean(organizingWarehouseId) && organizingWarehouseId === warehouseId;
}

export function canStartWarehouseOrganization(organizingWarehouseId, warehouse) {
  return !organizingWarehouseId && Boolean(warehouse?.pinecones?.some(({ status }) => status === "temp"));
}

export function getWarehouseRecords(state) {
  return (state.warehouses?.order || [])
    .map((id) => hydrateWarehouseRecord(state, id))
    .filter(Boolean);
}

export function hydrateWarehouseRecord(state, warehouseId) {
  const warehouse = state.warehouses?.byId?.[warehouseId];
  if (!warehouse) return null;
  return {
    ...structuredClone(warehouse),
    reviewDocument: structuredClone(state.documents?.byWarehouseId?.[warehouseId] || { title: warehouse.name, sections: [] }),
    shelves: structuredClone(state.shelves?.byWarehouseId?.[warehouseId] || []),
    pinecones: structuredClone(state.pinecones?.byWarehouseId?.[warehouseId] || []),
  };
}

export function persistWarehouseRecord(state, record) {
  if (!record?.id) return state;
  const { reviewDocument, shelves, pinecones, ...warehouse } = record;
  return {
    ...state,
    warehouses: {
      byId: { ...state.warehouses.byId, [record.id]: structuredClone(warehouse) },
      order: state.warehouses.order.includes(record.id) ? state.warehouses.order : [record.id, ...state.warehouses.order],
    },
    documents: { byWarehouseId: { ...state.documents.byWarehouseId, [record.id]: structuredClone(reviewDocument || { title: record.name, sections: [] }) } },
    shelves: { byWarehouseId: { ...state.shelves.byWarehouseId, [record.id]: structuredClone(shelves || []) } },
    pinecones: { byWarehouseId: { ...state.pinecones.byWarehouseId, [record.id]: structuredClone(pinecones || []) } },
  };
}

export function useOnlyExampleWarehouses(state, examples, collectionVersion) {
  if ((state.exampleCollectionVersion || 0) >= collectionVersion) return state;

  const emptyState = {
    ...state,
    activeWarehouseId: examples[0]?.id || "",
    warehouses: { byId: {}, order: [] },
    documents: { byWarehouseId: {} },
    shelves: { byWarehouseId: {} },
    pinecones: { byWarehouseId: {} },
  };
  const examplesOnly = examples.reduce(
    (nextState, example) => persistWarehouseRecord(nextState, example),
    emptyState,
  );

  return {
    ...examplesOnly,
    exampleCollectionVersion: collectionVersion,
    warehouses: { ...examplesOnly.warehouses, order: examples.map((example) => example.id) },
  };
}

export function createEmptyWarehouseRecord(id, name, updatedAt, avatar = "pinecone-warehouse-icon.png") {
  return {
    warehouse: { id, name, updatedAt, avatar },
    document: {
      title: name,
      sections: [{
        shelfId: "ideas",
        heading: "先存下零散松果",
        summary: "这个仓库还在积累材料，添加松果后可以让 AI 开始整理。",
        bullets: [],
      }],
    },
    shelves: [{ id: "ideas", name: "待整理线索", description: "新松果整理后会先放到这里。" }],
    pinecones: [],
  };
}

export function removeWarehouseRecord(state, warehouseId) {
  const records = getWarehouseRecords(state).map(({ reviewDocument, shelves, pinecones, ...warehouse }) => warehouse);
  const result = removeWarehouse(records, state.activeWarehouseId, warehouseId);
  if (!result.removed) return { state, removed: false };

  const { [warehouseId]: _removedWarehouse, ...byId } = state.warehouses.byId;
  const { [warehouseId]: _removedDocument, ...documentsByWarehouseId } = state.documents.byWarehouseId;
  const { [warehouseId]: _removedShelves, ...shelvesByWarehouseId } = state.shelves.byWarehouseId;
  const { [warehouseId]: _removedPinecones, ...pineconesByWarehouseId } = state.pinecones.byWarehouseId;

  return {
    removed: true,
    state: {
      ...state,
      activeWarehouseId: result.activeWarehouseId,
      warehouses: { byId, order: result.warehouses.map((warehouse) => warehouse.id) },
      documents: { byWarehouseId: documentsByWarehouseId },
      shelves: { byWarehouseId: shelvesByWarehouseId },
      pinecones: { byWarehouseId: pineconesByWarehouseId },
    },
  };
}

export function reorderWarehouseRecords(state, sourceId, targetId, placement) {
  const records = getWarehouseRecords(state).map(({ reviewDocument, shelves, pinecones, ...warehouse }) => warehouse);
  const next = reorderWarehouses(records, sourceId, targetId, placement);
  if (next === records) return state;
  return {
    ...state,
    warehouses: {
      ...state.warehouses,
      order: next.map((warehouse) => warehouse.id),
    },
  };
}
