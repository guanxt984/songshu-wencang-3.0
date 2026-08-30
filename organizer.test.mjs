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
