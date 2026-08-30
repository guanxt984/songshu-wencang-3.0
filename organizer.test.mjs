import test from "node:test";
import assert from "node:assert/strict";
import { organizeWarehouseLocally } from "./organizer.js";

test("reorganize creates topic-specific shelves instead of interview defaults", () => {
  const warehouse = {
    id: "pm",
    name: "《如何成为产品经理》",
    updatedAt: "今天",
    tempLimit: 5,
    shelves: [
      { id: "resume", name: "简历准备", description: "旧的面试硬编码分类" },
    ],
    pinecones: [
      { id: "p1", content: "产品经理要先理解用户真实场景，不要只看表面需求。", status: "temp", isFeatured: true },
      { id: "p2", content: "写 PRD 前先把目标、边界、流程和验收标准讲清楚。", status: "temp", isFeatured: false },
      { id: "p3", content: "AI 产品经理要理解模型能力边界，知道 prompt、数据和评测会影响效果。", status: "shelved", shelfId: "resume", isFeatured: true },
      { id: "p4", content: "作品集比空泛经历更重要，要能说明自己如何发现问题、推进方案并复盘结果。", status: "temp", isFeatured: false },
    ],
    reviewDocument: { title: "《如何成为产品经理》", sections: [] },
  };

  const result = organizeWarehouseLocally(warehouse);

  assert.ok(result.shelves.length >= 3);
  assert.ok(!result.shelves.some((shelf) => shelf.name === "简历准备"));
  assert.ok(result.shelves.some((shelf) => shelf.name.includes("用户") || shelf.name.includes("需求")));
  assert.ok(result.shelves.some((shelf) => shelf.name.includes("AI")));
  assert.equal(result.pinecones.every((pinecone) => pinecone.status === "shelved"), true);
  assert.equal(result.reviewDocument.title, "《如何成为产品经理》");
  assert.equal(result.reviewDocument.sections.length, result.shelves.length);
  assert.ok(result.reviewDocument.sections.every((section) => section.bullets.length > 0));
});

test("reorganize preserves source mapping from document bullets to pinecones", () => {
  const warehouse = {
    id: "human",
    name: "《人性的弱点摘抄》",
    updatedAt: "今天",
    tempLimit: 5,
    shelves: [],
    pinecones: [
      { id: "h1", content: "不要直接批评别人，批评容易让对方防御，关系会变僵。", status: "temp", isFeatured: true },
      { id: "h2", content: "真诚地欣赏别人，比泛泛夸奖更容易让人感到被看见。", status: "temp", isFeatured: false },
      { id: "h3", content: "谈话时先倾听对方关心的事，再表达自己的观点。", status: "temp", isFeatured: false },
    ],
    reviewDocument: { title: "《人性的弱点摘抄》", sections: [] },
  };

  const result = organizeWarehouseLocally(warehouse);
  const mappedIds = new Set(result.reviewDocument.sections.flatMap((section) =>
    section.bullets.flatMap((bullet) => bullet.pineconeIds),
  ));

  assert.deepEqual([...mappedIds].sort(), ["h1", "h2", "h3"]);
  assert.ok(result.shelves.some((shelf) => shelf.name.includes("尊重") || shelf.name.includes("倾听")));
});

test("merge organization preserves existing document fields and appends only temporary pinecones", () => {
  const warehouse = {
    id: "merge",
    name: "产品笔记",
    shelves: [{ id: "existing", name: "用户研究", description: "人工改过的架子说明" }],
    pinecones: [
      { id: "old", content: "旧材料", status: "shelved", shelfId: "existing" },
      { id: "new", content: "用户访谈应该先确认真实使用场景。", status: "temp" },
    ],
    reviewDocument: {
      title: "我的人工标题",
      sections: [{
        shelfId: "existing",
        heading: "人工章节标题",
        summary: "人工摘要与批注",
        bullets: [{ text: "人工修改后的要点", pineconeIds: ["old"] }],
      }],
    },
  };

  const result = organizeWarehouseLocally(warehouse, { mode: "merge" });

  assert.equal(result.reviewDocument.title, "我的人工标题");
  assert.equal(result.reviewDocument.sections[0].heading, "人工章节标题");
  assert.equal(result.reviewDocument.sections[0].summary, "人工摘要与批注");
  assert.equal(result.reviewDocument.sections[0].bullets[0].text, "人工修改后的要点");
  assert.deepEqual(result.reviewDocument.sections[0].bullets[1], {
    text: "用户访谈应该先确认真实使用场景。",
    pineconeIds: ["new"],
  });
  assert.equal(result.pinecones.find(({ id }) => id === "old").shelfId, "existing");
  assert.equal(result.pinecones.find(({ id }) => id === "new").status, "shelved");
  assert.equal(warehouse.pinecones.find(({ id }) => id === "new").status, "temp");
});

test("merge organization creates a new section when no current section matches", () => {
  const warehouse = {
    id: "merge-new",
    name: "产品笔记",
    shelves: [{ id: "existing", name: "项目复盘", description: "复盘" }],
    pinecones: [{ id: "new", content: "AI 模型评测需要覆盖数据和提示词边界。", status: "temp" }],
    reviewDocument: {
      title: "产品笔记",
      sections: [{ shelfId: "existing", heading: "项目复盘", summary: "复盘", bullets: [] }],
    },
  };

  const result = organizeWarehouseLocally(warehouse, { mode: "merge" });

  assert.equal(result.reviewDocument.sections[0].heading, "项目复盘");
  assert.ok(result.reviewDocument.sections.length > 1);
  assert.deepEqual(
    result.reviewDocument.sections.flatMap((section) => section.bullets).flatMap((bullet) => bullet.pineconeIds),
    ["new"],
  );
});

test("rebuild organization replaces user-edited sections and assigns all pinecones", () => {
  const warehouse = {
    id: "rebuild",
    name: "产品笔记",
    shelves: [{ id: "manual", name: "人工架子", description: "人工说明" }],
    pinecones: [
      { id: "old", content: "产品需求来自真实用户场景。", status: "shelved", shelfId: "manual" },
      { id: "new", content: "PRD 应该写清流程和验收标准。", status: "temp" },
    ],
    reviewDocument: {
      title: "人工标题",
      sections: [{ shelfId: "manual", heading: "人工章节", summary: "人工摘要", bullets: [] }],
    },
  };

  const result = organizeWarehouseLocally(warehouse, { mode: "rebuild" });

  assert.equal(result.reviewDocument.title, "产品笔记");
  assert.equal(result.reviewDocument.sections.some(({ heading }) => heading === "人工章节"), false);
  assert.equal(result.pinecones.every(({ status }) => status === "shelved"), true);
});

test("organization rejects an unknown mode instead of falling back to rebuild", () => {
  const warehouse = {
    id: "invalid-mode",
    name: "文档",
    shelves: [{ id: "manual", name: "人工架子", description: "人工说明" }],
    pinecones: [{ id: "p1", content: "材料", status: "temp" }],
    reviewDocument: { title: "人工标题", sections: [] },
  };

  assert.throws(() => organizeWarehouseLocally(warehouse, { mode: "typo" }), /INVALID_ORGANIZE_MODE/);
  assert.equal(warehouse.reviewDocument.title, "人工标题");
});
