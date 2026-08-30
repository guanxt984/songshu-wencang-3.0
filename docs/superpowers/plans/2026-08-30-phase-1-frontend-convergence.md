# 阶段 1：前端规则收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地版 UI 和规则模拟器收敛到公开测试版的“暂存、全部整理、只读松果架、内置图标”行为。

**Architecture:** `organizer.js` 是唯一的本地整理模拟器：每次接受完整松果集合并重建文档和松果架归属。`app.js` 只维护收集、编辑、删除、精选和触发模拟器的交互；松果架由文档章节派生展示，不能移动松果或创建分类。保留当前本地存储，阶段 4 再替换为云端保存。

**Tech Stack:** 原生 HTML/CSS、ES modules、Node test runner。

**Spec:** `docs/松鼠文仓-产品实现链路与公开测试版方案.md` 第 3.4、4、5.1、10、15.1、16.1、16.3 节。

## Global Constraints

- 新松果统一进入暂存栏；用户不得指定或新建松果架作为新增目标。
- 用户可编辑、删除、精选松果；章节归属只能由“全部重新整理”决定。
- 本地模拟器必须使用全部松果，且成功后每个松果恰好归属一个章节。
- 松果架仅展示章节及其来源材料；不可移动松果。
- 仓库不再接受自定义图标上传或裁剪；使用内置图标与由名称确定的配色。
- 不接入登录、云端 API、数据库或真实 AI。

---

### Task 1: 固定完整整理的领域结果

**Files:**
- Modify: `organizer.test.mjs`
- Modify: `organizer.js`

**Interfaces:**
- Produces: `organizeWarehouseLocally(warehouse, "reorganize")` 返回全部松果 `status: "shelved"`、非空 `shelfId`、与章节一一对应的 shelves。

- [x] **Step 1: 写失败测试，证明已有已归档松果也会在重整后重新分配**

```js
assert.deepEqual(result.pinecones.map(({ id, shelfId }) => [id, shelfId]), [["p1", "auto_general_core_ideas"], ["p2", "auto_general_methods"]]);
assert.deepEqual(result.reviewDocument.sections.flatMap((section) => section.bullets.flatMap((bullet) => bullet.pineconeIds)).sort(), ["p1", "p2"]);
```

- [x] **Step 2: 运行 `node --test organizer.test.mjs`，确认失败**

- [x] **Step 3: 用最小代码让本地整理按所有松果建立唯一映射**

```js
working.pinecones = working.pinecones.map((pinecone) => ({ ...pinecone, status: "shelved", shelfId: assignedDefinitionId(assigned, pinecone.id) }));
```

- [x] **Step 4: 运行 `node --test organizer.test.mjs`，确认通过**

### Task 2: 收敛新增松果与松果架操作

**Files:**
- Modify: `app.js`
- Modify: `test-ui-content.cjs`

**Interfaces:**
- Produces: `addPinecone()` 始终写入 `{ status: "temp", shelfId: null }`；渲染层不再输出新增目的地选择器或松果移动选择器。

- [x] **Step 1: 将 UI 检查改为要求暂存栏与编辑/删除、拒绝已有素材栏/新建素材栏/移动到**

```js
forbidden.push(["manual pinecone move", "data-action=\"move-pinecone\""]);
forbidden.push(["existing shelf add destination", "已有素材栏"]);
```

- [x] **Step 2: 运行 `node test-ui-content.cjs`，确认因旧 UI 存在而失败**

- [x] **Step 3: 删除新增目的地状态、渲染和事件；删除 `movePinecone` 及其选择器；新增松果始终暂存**

```js
warehouse.pinecones.unshift({ id: uid("pinecone"), content, status: "temp", shelfId: null, isFeatured: false, createdAt: nowText().replace(" 更新", "") });
```

- [x] **Step 4: 运行 `node test-ui-content.cjs`，确认通过**

### Task 3: 收敛整理入口与松果架展示

**Files:**
- Modify: `app.js`
- Modify: `test-ui-content.cjs`

**Interfaces:**
- Produces: 工具栏唯一整理动作 `reorganize`；确认文案说明全量替换人工文档；松果架从 `reviewDocument.sections` 和松果 ID 派生且不含修改按钮。

- [x] **Step 1: 写失败 UI 检查，要求全量整理确认文案并禁止架子级修改**

```js
expectations.push(["reorganize replacement warning", "当前文档中的人工修改将在整理成功后被替换"]);
forbidden.push(["shelf modification", "toggle-shelf-actions"]);
```

- [x] **Step 2: 运行 `node test-ui-content.cjs`，确认失败**

- [x] **Step 3: 仅保留 `reorganize`，将架子渲染为来源展示，并在本地模拟器前显示确认对话框**

- [x] **Step 4: 运行 `node test-ui-content.cjs` 和 `node --test organizer.test.mjs`，确认通过**

### Task 4: 替换自定义图标为内置图标与名称配色

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `warehouse-management.js`
- Modify: `warehouse-management.test.mjs`
- Modify: `test-ui-content.cjs`

**Interfaces:**
- Produces: `getWarehouseColor(name)` 返回固定调色板中的颜色；迁移时丢弃 `iconDataUrl`；无文件上传与裁剪 UI。

- [x] **Step 1: 为旧 `iconDataUrl` 在规范化后不再存在、同名仓库颜色稳定写失败测试**

```js
assert.equal(normalizeWarehouseState(legacy, 8).warehouses.byId.a.iconDataUrl, undefined);
assert.equal(getWarehouseColor("研究"), getWarehouseColor("研究"));
```

- [x] **Step 2: 运行 `node --test warehouse-management.test.mjs`，确认失败**

- [x] **Step 3: 新增确定性色彩函数，移除上传、裁剪和 `iconDataUrl` 持久化路径**

- [x] **Step 4: 运行领域与 UI 测试，确认通过**

### Task 5: 完整验收与提交

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-phase-1-frontend-convergence.md`

- [x] **Step 1: 运行 `npm run check`**

- [x] **Step 2: 在浏览器手动验证新增松果、全部重新整理、编辑/删除、松果架来源和内置图标**

- [x] **Step 3: 运行 `git diff --check` 并提交阶段 1 文件**

```bash
git add app.js organizer.js warehouse-management.js styles.css organizer.test.mjs warehouse-management.test.mjs test-ui-content.cjs docs/superpowers/plans/2026-08-30-phase-1-frontend-convergence.md
git commit -m "feat: converge frontend to public beta rules"
```
