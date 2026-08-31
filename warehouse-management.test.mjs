import test from "node:test";
import assert from "node:assert/strict";
import { applyDocumentEdit, applyPineconeEdits, canStartWarehouseOrganization, createEmptyWarehouseRecord, deriveShelfSections, getWarehouseColor, getWarehouseRecords, isWarehouseReadOnly, normalizeWarehouseState, removeWarehouse, removeWarehouseRecord, reorderWarehouses, reorderWarehouseRecords, useOnlyExampleWarehouses } from "./warehouse-management.js";
import { EXAMPLE_COLLECTION_VERSION, exampleWarehouses } from "./example-warehouses.js";
import * as warehouseModule from "./warehouse-management.js";

const ids = (items) => items.map((item) => item.id);
const warehouses = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("reorderWarehouses moves a card before or after the target without mutation", () => {
  assert.deepEqual(ids(reorderWarehouses(warehouses, "c", "a", "before")), ["c", "a", "b"]);
  assert.deepEqual(ids(reorderWarehouses(warehouses, "a", "b", "after")), ["b", "a", "c"]);
  assert.deepEqual(ids(warehouses), ["a", "b", "c"]);
});

test("reorderWarehouses ignores invalid and no-op drops", () => {
  assert.equal(reorderWarehouses(warehouses, "missing", "a", "before"), warehouses);
  assert.equal(reorderWarehouses(warehouses, "a", "a", "before"), warehouses);
});

test("removeWarehouse preserves selection when deleting an inactive warehouse", () => {
  assert.deepEqual(removeWarehouse(warehouses, "a", "c"), {
    warehouses: [{ id: "a" }, { id: "b" }], activeWarehouseId: "a", removed: true,
  });
});

test("removeWarehouse selects next, then previous, and permits an empty list", () => {
  assert.equal(removeWarehouse(warehouses, "b", "b").activeWarehouseId, "c");
  assert.equal(removeWarehouse(warehouses, "c", "c").activeWarehouseId, "b");
  assert.deepEqual(removeWarehouse([{ id: "a" }], "a", "a"), {
    warehouses: [], activeWarehouseId: "", removed: true,
  });
});

test("normalizeWarehouseState separates each warehouse document shelves and pinecones by warehouse id", () => {
  const legacy = {
    version: 6,
    activeWarehouseId: "a",
    warehouses: [
      {
        id: "a",
        name: "A",
        updatedAt: "today",
        tempLimit: 5,
        iconDataUrl: "icon-a",
        pinecones: [{ id: "pa", shelfId: "sa", content: "A pinecone" }],
        shelves: [{ id: "sa", name: "Shelf A" }],
        reviewDocument: { title: "Doc A", sections: [{ shelfId: "sa", heading: "A" }] },
      },
      {
        id: "b",
        name: "B",
        updatedAt: "today",
        tempLimit: 5,
        pinecones: [{ id: "pb", shelfId: "sb", content: "B pinecone" }],
        shelves: [{ id: "sb", name: "Shelf B" }],
        reviewDocument: { title: "Doc B", sections: [{ shelfId: "sb", heading: "B" }] },
      },
    ],
  };

  const normalized = normalizeWarehouseState(legacy, 7);

  assert.deepEqual(normalized.warehouses.order, ["a", "b"]);
  assert.deepEqual(Object.keys(normalized.warehouses.byId), ["a", "b"]);
  assert.equal(normalized.documents.byWarehouseId.a.title, "Doc A");
  assert.equal(normalized.documents.byWarehouseId.b.title, "Doc B");
  assert.deepEqual(normalized.shelves.byWarehouseId.a.map((shelf) => shelf.id), ["sa"]);
  assert.deepEqual(normalized.shelves.byWarehouseId.b.map((shelf) => shelf.id), ["sb"]);
  assert.deepEqual(normalized.pinecones.byWarehouseId.a.map((pinecone) => pinecone.id), ["pa"]);
  assert.deepEqual(normalized.pinecones.byWarehouseId.b.map((pinecone) => pinecone.id), ["pb"]);
  assert.equal(normalized.warehouses.byId.a.reviewDocument, undefined);
  assert.equal(normalized.warehouses.byId.a.pinecones, undefined);
  assert.equal(normalized.warehouses.byId.a.iconDataUrl, undefined);
});

test("getWarehouseColor derives a stable built-in palette name", () => {
  assert.equal(getWarehouseColor("研究"), getWarehouseColor("研究"));
  assert.match(getWarehouseColor("研究"), /^(moss|clay|sky|plum)$/);
});

test("applyDocumentEdit preserves a document draft without mutating the stored warehouse", () => {
  const warehouse = {
    reviewDocument: {
      title: "文档",
      sections: [{ heading: "旧标题", summary: "旧摘要", bullets: [{ text: "旧要点", pineconeIds: ["p1"] }] }],
    },
  };
  const headingDraft = applyDocumentEdit(warehouse, { field: "heading", sectionIndex: 0 }, "新标题");
  const completedDraft = applyDocumentEdit(headingDraft, { field: "bullet", sectionIndex: 0, bulletIndex: 0 }, "新要点");

  assert.equal(warehouse.reviewDocument.sections[0].heading, "旧标题");
  assert.equal(completedDraft.reviewDocument.sections[0].heading, "新标题");
  assert.equal(completedDraft.reviewDocument.sections[0].bullets[0].text, "新要点");
});

test("applyPineconeEdits saves every managed card together and rejects blank content", () => {
  const warehouse = { pinecones: [{ id: "p1", content: "旧一" }, { id: "p2", content: "旧二" }] };
  const saved = applyPineconeEdits(warehouse, [{ id: "p1", content: "新一" }, { id: "p2", content: "新二" }]);
  const rejected = applyPineconeEdits(warehouse, [{ id: "p1", content: "   " }]);

  assert.deepEqual(saved.invalidIds, []);
  assert.deepEqual(saved.warehouse.pinecones.map(({ content }) => content), ["新一", "新二"]);
  assert.equal(warehouse.pinecones[0].content, "旧一");
  assert.deepEqual(rejected.invalidIds, ["p1"]);
  assert.equal(rejected.warehouse, warehouse);
});

test("normalizeWarehouseState removes obsolete featured and temporary limit fields", () => {
  const normalized = normalizeWarehouseState({
    version: 7,
    activeWarehouseId: "a",
    warehouses: { byId: { a: { id: "a", name: "A", tempLimit: 5 } }, order: ["a"] },
    documents: { byWarehouseId: { a: { title: "A", sections: [] } } },
    shelves: { byWarehouseId: { a: [] } },
    pinecones: { byWarehouseId: { a: [{ id: "p1", content: "材料", status: "temp", isFeatured: true }] } },
  }, 7);

  assert.equal(Object.hasOwn(normalized.warehouses.byId.a, "tempLimit"), false);
  assert.equal(Object.hasOwn(normalized.pinecones.byWarehouseId.a[0], "isFeatured"), false);
});

test("deriveShelfSections follows document pinecone ids instead of stale shelf ids", () => {
  const warehouse = {
    pinecones: [
      { id: "p1", shelfId: "stale", content: "第一条" },
      { id: "p2", shelfId: "section-a", content: "第二条" },
      { id: "p3", shelfId: "section-a", content: "未引用" },
    ],
    reviewDocument: {
      sections: [{ shelfId: "section-a", heading: "章节", summary: "摘要", bullets: [{ pineconeIds: ["p1", "p2", "p1"] }] }],
    },
  };

  const sections = deriveShelfSections(warehouse);
  assert.deepEqual(sections[0].pinecones.map(({ id }) => id), ["p1", "p2"]);
});

test("isWarehouseReadOnly locks only the warehouse with an active organization", () => {
  assert.equal(isWarehouseReadOnly("a", "a"), true);
  assert.equal(isWarehouseReadOnly("a", "b"), false);
  assert.equal(isWarehouseReadOnly(null, "a"), false);
});

test("canStartWarehouseOrganization enforces one active job across warehouses", () => {
  const withTemporary = { pinecones: [{ id: "temp", status: "temp" }] };
  const withoutTemporary = { pinecones: [{ id: "shelved", status: "shelved" }] };
  assert.equal(canStartWarehouseOrganization(null, withTemporary), true);
  assert.equal(canStartWarehouseOrganization(null, withoutTemporary), false);
  assert.equal(canStartWarehouseOrganization("a", withTemporary), false);
});

test("getWarehouseRecords hydrates isolated records without sharing nested data", () => {
  const normalized = normalizeWarehouseState({
    activeWarehouseId: "a",
    warehouses: [
      { id: "a", name: "A", pinecones: [{ id: "pa" }], shelves: [{ id: "sa" }], reviewDocument: { title: "A", sections: [] } },
      { id: "b", name: "B", pinecones: [{ id: "pb" }], shelves: [{ id: "sb" }], reviewDocument: { title: "B", sections: [] } },
    ],
  }, 7);

  const records = getWarehouseRecords(normalized);
  records[0].pinecones.push({ id: "leak" });

  assert.deepEqual(normalized.pinecones.byWarehouseId.a.map((pinecone) => pinecone.id), ["pa"]);
  assert.deepEqual(records.map((record) => record.id), ["a", "b"]);
});

test("removeWarehouseRecord deletes warehouse scoped document shelves and pinecones", () => {
  const normalized = normalizeWarehouseState({
    activeWarehouseId: "a",
    warehouses: [
      { id: "a", name: "A", pinecones: [{ id: "pa" }], shelves: [{ id: "sa" }], reviewDocument: { title: "A", sections: [] } },
      { id: "b", name: "B", pinecones: [{ id: "pb" }], shelves: [{ id: "sb" }], reviewDocument: { title: "B", sections: [] } },
    ],
  }, 7);

  const result = removeWarehouseRecord(normalized, "a");

  assert.equal(result.removed, true);
  assert.equal(result.state.activeWarehouseId, "b");
  assert.deepEqual(result.state.warehouses.order, ["b"]);
  assert.equal(result.state.warehouses.byId.a, undefined);
  assert.equal(result.state.documents.byWarehouseId.a, undefined);
  assert.equal(result.state.shelves.byWarehouseId.a, undefined);
  assert.equal(result.state.pinecones.byWarehouseId.a, undefined);
  assert.equal(result.state.documents.byWarehouseId.b.title, "B");
});

test("createEmptyWarehouseRecord initializes independent empty document shelf and pinecone stores", () => {
  const record = createEmptyWarehouseRecord("w1", "新仓", "今天 12:00 更新", "achang-wave.png");

  assert.equal(record.warehouse.id, "w1");
  assert.equal(record.warehouse.avatar, "achang-wave.png");
  assert.equal(record.document.title, "新仓");
  assert.deepEqual(record.shelves.map((shelf) => shelf.id), ["ideas"]);
  assert.deepEqual(record.pinecones, []);
  assert.equal(record.document.sections[0].shelfId, "ideas");
  assert.equal(Object.hasOwn(record.warehouse, "tempLimit"), false);
});

test("custom warehouse avatar validation accepts supported images and rejects unsafe uploads", () => {
  assert.equal(typeof warehouseModule.validateWarehouseAvatarFile, "function");
  assert.equal(warehouseModule.validateWarehouseAvatarFile({ type: "image/png", size: 2 * 1024 * 1024 }), "");
  assert.equal(warehouseModule.validateWarehouseAvatarFile({ type: "image/gif", size: 1024 }), "仅支持 PNG、JPEG 或 WebP 图片");
  assert.equal(warehouseModule.validateWarehouseAvatarFile({ type: "image/jpeg", size: 2 * 1024 * 1024 + 1 }), "图片不能超过 2MB");
});

test("warehouse avatar source permits built-ins and safe image data only", () => {
  assert.equal(typeof warehouseModule.isWarehouseAvatarSource, "function");
  assert.equal(warehouseModule.isWarehouseAvatarSource("achang-wave.png"), true);
  assert.equal(warehouseModule.isWarehouseAvatarSource("data:image/webp;base64,AAAA"), true);
  assert.equal(warehouseModule.isWarehouseAvatarSource("data:text/html;base64,AAAA"), false);
  assert.equal(warehouseModule.isWarehouseAvatarSource("https://example.com/avatar.png"), false);
});

test("reorderWarehouseRecords only changes order metadata", () => {
  const normalized = normalizeWarehouseState({
    activeWarehouseId: "a",
    warehouses: [
      { id: "a", name: "A", pinecones: [], shelves: [], reviewDocument: { title: "A", sections: [] } },
      { id: "b", name: "B", pinecones: [], shelves: [], reviewDocument: { title: "B", sections: [] } },
      { id: "c", name: "C", pinecones: [], shelves: [], reviewDocument: { title: "C", sections: [] } },
    ],
  }, 7);

  const next = reorderWarehouseRecords(normalized, "c", "a", "before");

  assert.deepEqual(next.warehouses.order, ["c", "a", "b"]);
  assert.equal(next.documents.byWarehouseId.a.title, "A");
  assert.equal(next.documents.byWarehouseId.c.title, "C");
});

test("example warehouses preserve messy source fragments and produce structured documents", () => {
  assert.deepEqual(exampleWarehouses.map((warehouse) => warehouse.name), ["如何成为产品经理", "人性的弱点摘抄"]);
  assert.deepEqual(exampleWarehouses.map((warehouse) => warehouse.avatar), ["warehouse-icon-product-manager.png", "warehouse-icon-human-nature.png"]);
  assert.equal(exampleWarehouses.some((warehouse) => "iconDataUrl" in warehouse), false);

  for (const warehouse of exampleWarehouses) {
    assert.equal(warehouse.pinecones.length, 40);
    assert.equal(warehouse.pinecones.filter((pinecone) => pinecone.status === "temp").length, 4);
    assert.equal(warehouse.shelves.length, 6);
    assert.equal(warehouse.reviewDocument.sections.length, 6);
    assert.equal(warehouse.reviewDocument.sections.length, warehouse.shelves.length);
    const shelfIds = new Set(warehouse.shelves.map((shelf) => shelf.id));
    assert.ok(warehouse.pinecones.filter((pinecone) => pinecone.status === "shelved").every((pinecone) => shelfIds.has(pinecone.shelfId)));
    assert.ok(warehouse.pinecones.every((pinecone) => !Object.hasOwn(pinecone, "title")));
    const lengths = warehouse.pinecones.map((pinecone) => pinecone.content.length);
    assert.ok(Math.min(...lengths) < 20);
    assert.ok(Math.max(...lengths) > 80);
    assert.ok(warehouse.reviewDocument.sections.every((section) => section.bullets.length > 0));
  }
});

test("useOnlyExampleWarehouses replaces old warehouses once and preserves later user additions", () => {
  const original = normalizeWarehouseState({
    activeWarehouseId: "mine",
    warehouses: [{ id: "mine", name: "我的仓", pinecones: [], shelves: [], reviewDocument: { title: "我的文档", sections: [] } }],
  }, 7);

  const examplesOnly = useOnlyExampleWarehouses(original, exampleWarehouses, EXAMPLE_COLLECTION_VERSION);
  assert.deepEqual(examplesOnly.warehouses.order, ["example_product_manager", "example_human_nature"]);
  assert.equal(examplesOnly.activeWarehouseId, "example_product_manager");
  assert.equal(examplesOnly.warehouses.byId.mine, undefined);
  assert.equal(examplesOnly.documents.byWarehouseId.mine, undefined);
  assert.equal(examplesOnly.exampleCollectionVersion, EXAMPLE_COLLECTION_VERSION);

  const withUserAddition = persistWarehouseRecordForTest(examplesOnly, {
    id: "later",
    name: "后来新建的仓",
    updatedAt: "今天",
    tempLimit: 5,
    reviewDocument: { title: "后来新建的仓", sections: [] },
    shelves: [],
    pinecones: [],
  });
  const unchanged = useOnlyExampleWarehouses(withUserAddition, exampleWarehouses, EXAMPLE_COLLECTION_VERSION);
  assert.ok(unchanged.warehouses.byId.later);
});

function persistWarehouseRecordForTest(state, record) {
  const { reviewDocument, shelves, pinecones, ...warehouse } = record;
  return {
    ...state,
    warehouses: { byId: { ...state.warehouses.byId, [record.id]: warehouse }, order: [...state.warehouses.order, record.id] },
    documents: { byWarehouseId: { ...state.documents.byWarehouseId, [record.id]: reviewDocument } },
    shelves: { byWarehouseId: { ...state.shelves.byWarehouseId, [record.id]: shelves } },
    pinecones: { byWarehouseId: { ...state.pinecones.byWarehouseId, [record.id]: pinecones } },
  };
}
