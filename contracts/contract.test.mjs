import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canTransitionJob,
  validateOrganizeRequest,
  validateOrganizeResult,
  validateWarehouseSnapshot,
} from "./validators.js";

test("warehouse snapshot accepts only the version 1 client content shape", () => {
  assert.equal(validateWarehouseSnapshot({
    schema_version: 1,
    name: "研究",
    document: {},
    shelves: [],
    pinecones: [],
  }).ok, true);

  assert.equal(validateWarehouseSnapshot({
    schema_version: 2,
    name: "研究",
    document: {},
    shelves: [],
    pinecones: [],
  }).ok, false);
});

test("organize request enforces payload limits and result assigns each pinecone once", () => {
  assert.equal(validateOrganizeRequest({
    warehouseId: "w1",
    revision: 1,
    idempotencyKey: "request-1",
    mode: "rebuild",
    pinecones: [{ id: "p1", content: "x".repeat(4001) }],
  }).code, "AI_INPUT_ITEM_TOO_LARGE");

  assert.equal(validateOrganizeResult({
    document: {
      title: "研究",
      sections: [
        { id: "one", title: "一", summary: "", points: [], pineconeIds: ["p1"] },
        { id: "two", title: "二", summary: "", points: [], pineconeIds: ["p1"] },
      ],
    },
  }, ["p1"]).code, "AI_OUTPUT_PINECONE_ASSIGNMENT_INVALID");
});

test("organize request requires a declared mode and document context for merge", () => {
  const base = {
    warehouseId: "w1",
    revision: 1,
    idempotencyKey: "request-1",
    pinecones: [{ id: "p1", content: "新增材料" }],
  };

  assert.equal(validateOrganizeRequest(base).ok, false);
  assert.equal(validateOrganizeRequest({ ...base, mode: "merge" }).ok, false);
  assert.equal(validateOrganizeRequest({ ...base, mode: "merge", currentDocument: { title: "文档", sections: [] } }).ok, true);
  assert.equal(validateOrganizeRequest({ ...base, mode: "rebuild" }).ok, true);
  assert.equal(validateOrganizeRequest({ ...base, mode: "unknown" }).ok, false);
});

test("merge result permits preserved old references while assigning each temporary pinecone once", () => {
  const currentDocument = {
    title: "人工标题",
    sections: [{ id: "one", title: "人工章节", summary: "人工摘要", points: ["旧内容"], pineconeIds: ["old-id", "old-id"] }],
  };
  const result = {
    document: {
      title: "人工标题",
      sections: [{
        id: "one",
        title: "人工章节",
        summary: "人工摘要",
        points: ["旧内容", "新内容"],
        pineconeIds: ["old-id", "old-id", "temp-id"],
      }],
    },
  };

  assert.equal(validateOrganizeResult(result, ["temp-id"], { mode: "merge", currentDocument }).ok, true);
  assert.equal(validateOrganizeResult(result, ["temp-id"], { mode: "rebuild" }).ok, false);
});

test("merge validation rejects rewritten current content and malformed document context without throwing", () => {
  const base = {
    warehouseId: "w1",
    revision: 1,
    idempotencyKey: "request-1",
    mode: "merge",
    pinecones: [{ id: "temp-id", content: "新增材料" }],
  };
  const currentDocument = {
    title: "人工标题",
    sections: [{ id: "one", title: "人工章节", summary: "人工摘要", points: ["旧内容"], pineconeIds: ["old-id"] }],
  };
  const rewritten = {
    document: {
      title: "被重写",
      sections: [{ id: "one", title: "被重写", summary: "被重写", points: ["被重写", "新内容"], pineconeIds: ["old-id", "temp-id"] }],
    },
  };

  assert.equal(validateOrganizeRequest({ ...base, currentDocument: { sections: "bad" } }).ok, false);
  assert.doesNotThrow(() => validateOrganizeResult(rewritten, ["temp-id"], { mode: "merge", currentDocument: { sections: "bad" } }));
  assert.equal(validateOrganizeResult(rewritten, ["temp-id"], { mode: "merge", currentDocument: { sections: "bad" } }).code, "VALIDATION_FAILED");
  assert.equal(validateOrganizeResult(rewritten, ["temp-id"], { mode: "merge", currentDocument }).code, "AI_OUTPUT_PRESERVATION_INVALID");
});

test("accepted merge requests have unique sections and disjoint old and temporary references", () => {
  const base = {
    warehouseId: "w1",
    revision: 1,
    idempotencyKey: "request-1",
    mode: "merge",
    pinecones: [{ id: "same", content: "新增材料" }],
  };
  const section = { id: "one", title: "章节", summary: "摘要", points: ["旧内容"], pineconeIds: ["old"] };

  assert.equal(validateOrganizeRequest({ ...base, currentDocument: { title: " ", sections: [] } }).ok, false);
  assert.equal(validateOrganizeRequest({ ...base, currentDocument: { title: "文档", sections: [section, { ...section }] } }).ok, false);
  assert.equal(validateOrganizeRequest({ ...base, currentDocument: { title: "文档", sections: [{ ...section, pineconeIds: ["same"] }] } }).ok, false);
  assert.equal(validateOrganizeRequest({ ...base, currentDocument: { title: "文档", sections: [section] } }).ok, true);
});

test("AI jobs only use declared forward transitions", () => {
  assert.equal(canTransitionJob("queued", "running"), true);
  assert.equal(canTransitionJob("succeeded", "running"), false);
});

test("REST contract exposes public beta routes and stable conflict response", async () => {
  const openapi = JSON.parse(await readFile(new URL("./openapi.json", import.meta.url), "utf8"));
  const errors = JSON.parse(await readFile(new URL("./error-codes.json", import.meta.url), "utf8"));

  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/api/warehouses/{id}/organize"].post);
  assert.equal(openapi.paths["/api/warehouses/{id}"].put.responses["409"].$ref, "#/components/responses/RevisionConflict");
  assert.equal(errors.REVISION_CONFLICT.httpStatus, 409);
  assert.equal(errors.REVISION_CONFLICT.message, "内容已在其他设备更新");
  assert.deepEqual(openapi.components.schemas.WarehouseWrite.required, ["revision", "snapshot"]);
  assert.deepEqual(openapi.components.schemas.ImportRequest.required, ["idempotencyKey", "warehouses"]);
});

test("warehouse snapshot validation rejects excessive nesting and content", () => {
  const deeplyNested = { schema_version: 1, name: "深层", document: {}, shelves: [], pinecones: [] };
  let cursor = deeplyNested.document;
  for (let index = 0; index < 40; index += 1) cursor.next = cursor = {};
  assert.equal(validateWarehouseSnapshot(deeplyNested).code, "VALIDATION_FAILED");

  const tooLong = { schema_version: 1, name: "过长", document: {}, shelves: [], pinecones: [{ id: "p", content: "字".repeat(4001) }] };
  assert.equal(validateWarehouseSnapshot(tooLong).code, "VALIDATION_FAILED");
});

test("first database migration declares ownership and active job constraints", async () => {
  const migration = await readFile(new URL("../db/migrations/0001_public_beta_contracts.sql", import.meta.url), "utf8");

  assert.match(migration, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(migration, /CREATE UNIQUE INDEX ai_jobs_one_active_per_user ON ai_jobs \(user_id\) WHERE status IN \('queued', 'running'\)/);
  assert.match(migration, /CHECK \(status IN \('ready', 'organizing'\)\)/);
  assert.match(migration, /CREATE TABLE email_challenges/);
  assert.match(migration, /CREATE TABLE beta_access/);
  assert.match(migration, /CREATE TABLE account_deletion_jobs/);
  assert.match(migration, /CREATE TRIGGER warehouses_limit_per_user/);
});

test("environment template keeps every value empty and local check includes contract tests", async () => {
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(envExample, /^APP_ENV=$/m);
  assert.match(envExample, /^LOCAL_DEVELOPMENT_AUTH=$/m);
  assert.match(envExample, /^DATABASE_URL=$/m);
  assert.match(envExample, /^SESSION_COOKIE_SECURE=$/m);
  assert.match(envExample, /^TEST_DATABASE_URL=$/m);
  assert.match(packageJson.scripts.check, /contracts\/contract\.test\.mjs/);
});
