const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const expectations = [
  ["product title", "松鼠文仓"],
  ["product subtitle", "把零散信息整理成结构化文档"],
  ["warehouse list", "松果仓列表"],
  ["add pinecone action", "添加松果"],
  ["temporary shelf option", "暂存栏"],
  ["review document", "复盘文档"],
  ["pinecone shelf", "松果架"],
  ["shelf drawer search", "搜索松果"],
  ["shelf add action", "data-action=\"open-shelf-add\""],
  ["shelf management action", "data-action=\"toggle-shelf-management\""],
  ["toolbar edit action", "toggle-document-edit"],
  ["toolbar add action", "toggle-add"],
  ["toolbar reorganize action", "reorganize"],
  ["shelf search state", "shelfQuery"],
  ["local persistence key", "squirrel-warehouse-mvp"],
  ["mock organizer entry", "organizeWarehouse"],
  ["mock organizer", "organizeWarehouseWithMock"],
  ["add pinecone handler", "addPinecone"],
  ["create warehouse handler", "createWarehouse"],
  ["document editing handler", "toggleDocumentEdit"],
  ["document save handler", "saveDocumentEdits"],
  ["document corner tools", "document-corner-tools"],
  ["toolbar save document copy", "保存文档"],
  ["merge organization mode", "保持当前分区"],
  ["rebuild organization mode", "全部重新整理"],
  ["reorganize replacement warning", "当前文档中的人工修改将在整理成功后被替换"],
  ["reorganize targets captured warehouse and mode", "organizeWarehouse(warehouseId, mode)"],
  ["modal makes background inert", '${state.warehouseDialog ? "inert" : ""}'],
  ["approved warehouse icon", "pinecone-warehouse-icon.png"],
  ["warehouse name color", "getWarehouseColor"],
  ["official templates use natural wood color", 'warehouse.id.startsWith("example_") ? "wood"'],
  ["approved shelf icon", "pinecone-shelf-icon.png"],
  ["approved pinecone icon", "pinecone-icon.png"],
  ["document warehouse icon follows active warehouse", "renderWarehouseIcon(warehouse).replace(\"warehouse-icon\", \"book-icon\")"],
  ["document perched mascot png v2", 'class="document-mascot" src="assets/illustrations/squirrel-toolbar-perched-v2.png"'],
  ["toolbar icon box", "toolbar-icon-box"],
  ["shelf tab pinecone png", "icons.pinecone(\"shelf-tab-pinecone\")"],
  ["warehouse delete action", "data-action=\"delete-warehouse\""],
  ["warehouse empty state", "renderEmptyWarehouseState"],
  ["warehouse removal helper", "removeWarehouse"],
  ["warehouse card drag lock", 'draggable="${state.organizingWarehouseId ? "false" : "true"}"'],
  ["warehouse drag binder", "bindWarehouseDragEvents"],
  ["normalized warehouse state helper", "normalizeWarehouseState"],
  ["warehouse record hydration helper", "hydrateWarehouseRecord"],
  ["warehouse record persistence helper", "persistWarehouseRecord"],
  ["warehouse record reorder helper", "reorderWarehouseRecords"],
  ["warehouse pointer initiation state", "warehouseDragStartedFromButton"],
  ["warehouse touch drag state", "touchWarehouseDrag"],
  ["warehouse delete confirmation", "仓内松果和整理文档会一并删除"],
  ["warehouse dialog state", "warehouseDialog"],
  ["warehouse dialog renderer", "renderWarehouseDialog"],
  ["warehouse dialog name input", "data-input=\"warehouse-name\""],
  ["warehouse avatar picker", "warehouse-avatar-options"],
  ["warehouse avatar radio", "data-input=\"warehouse-avatar\""],
  ["custom warehouse avatar upload", "data-input=\"warehouse-avatar-upload\""],
  ["custom warehouse avatar preview", "warehouse-custom-upload-preview"],
  ["custom warehouse avatar reader", "readWarehouseAvatarFile"],
  ["product manager official avatar", "warehouse-icon-product-manager.png"],
  ["human nature official avatar", "warehouse-icon-human-nature.png"],
  ["warehouse dialog cancel action", "data-action=\"cancel-warehouse-dialog\""],
  ["warehouse dialog create action", "data-action=\"confirm-create-warehouse\""],
  ["warehouse dialog delete action", "data-action=\"confirm-delete-warehouse\""],
  ["shelf rows follow document sections", "warehouse.reviewDocument.sections.map"],
  ["temporary shelf appears in rack", "isTemporary: true"],
  ["shelf compact tool row", "shelf-tool-row"],
  ["flat shelf section row", '<section class="shelf-section'],
  ["small shelf count", "shelf-count"],
  ["pinecone management textarea", "data-input=\"pinecone-manage\""],
  ["pinecone top delete action", "pinecone-delete-button"],
  ["pinecone management draft", "pineconeDrafts"],
  ["management save before reorganization", "saveAllManagedPinecones"],
  ["toc jump action", "jumpToSection"],
  ["toc buttons carry section index", "data-action=\"jump-section\""],
];

const cssExpectations = [
  ["natural wood warehouse color", ".warehouse-color-wood"],
  ["two line warehouse names", "-webkit-line-clamp: 2"],
  ["warehouse avatar options", ".warehouse-avatar-options"],
  ["moss warehouse color", ".warehouse-color-moss"],
  ["clay warehouse color", ".warehouse-color-clay"],
  ["sky warehouse color", ".warehouse-color-sky"],
  ["plum warehouse color", ".warehouse-color-plum"],
  ["paper background", "--paper"],
  ["hand drawn card", ".document-card"],
  ["left panel", ".warehouse-panel"],
  ["document corner tools", ".document-corner-tools"],
  ["document perched mascot", ".document-mascot"],
  ["perched mascot nudged down five pixels", "top: -81px"],
  ["perched mascot nudged right ten pixels", "right: 126px"],
  ["pressable corner tool texture", ".corner-tool:active"],
  ["editable document fields", ".editable-field"],
  ["add panel", ".add-panel"],
  ["shelf drawer", ".shelf-drawer"],
  ["large expanded shelf content", "width: min(760px, calc(100vw - 430px))"],
  ["shelf bottom clears document bottom", "max-height: calc(100vh - 300px)"],
  ["shelf drawer moved up forty pixels", "top: 96px"],
  ["shelf drawer knows page edge gap", "--shelf-page-edge-offset: 43px"],
  ["collapsed shelf main area stays outside viewport", "right: calc(-760px - var(--shelf-page-edge-offset))"],
  ["mobile shelf page edge gap", "--shelf-page-edge-offset: 14px"],
  ["sticky shelf rack header", "position: sticky"],
  ["sticky shelf rack header top", "top: 0"],
  ["integrated shelf rack header", "shelf-integrated-header"],
  ["tighter shelf section spacing", ".shelf-rack-body {\n  gap: 8px;"],
  ["compact shelf rows", ".shelf-rack-body"],
  ["small shelf count type", ".shelf-count"],
  ["spacious shelf rack", "Spacious pinecone rack"],
  ["shelf tool row style", ".shelf-tool-row"],
  ["pinecone delete button style", ".pinecone-delete-button"],
  ["masonry pinecone layout", "column-count: 2"],
  ["natural pinecone height", "break-inside: avoid"],
  ["expanded shelf tab style is state scoped", ".shelf-drawer.open .shelf-tab"],
  ["expanded shelf tab icon style is state scoped", ".shelf-drawer.open .drawer-shelf-icon"],
  ["collapsed shelf keeps only tag visible", "transform: translateX(0)"],
  ["expanded shelf slides left to reveal main area", "transform: translateX(-760px)"],
  ["shelf drawer slides as one piece", "transition: transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)"],
  ["shelf drawer keeps tab on the left", "flex-direction: row"],
  ["expanded shelf tab keeps left edge radius", "border-radius: 28px 0 0 28px"],
  ["expanded shelf tab keeps left-side border", "border-left: 2px solid rgba(171, 101, 27, 0.7)"],
  ["shelf tab pinecone decoration hidden", ".shelf-tab-pinecone {\n  display: none;"],
  ["expanded shelf tag remains visible", "display: grid; /* expanded shelf handle */"],
  ["shelf scroll track is visually hidden", "scrollbar-width: none"],
  ["webkit shelf scroll track is visually hidden", ".shelf-content::-webkit-scrollbar"],
  ["document scroll enabled", "overflow-y: auto"],
  ["document title underline removed", ".doc-title .custom-warehouse-icon"],
  ["soft guide lines hidden", ".soft-lines"],
  ["warehouse delete button", ".warehouse-delete-button"],
  ["warehouse empty state", ".warehouse-empty-state"],
  ["warehouse dragging state", ".warehouse-card.dragging"],
  ["warehouse before drop target", ".warehouse-card.drop-before"],
  ["warehouse after drop target", ".warehouse-card.drop-after"],
];

const htmlExpectations = [
  ["module app script", '<script type="module" src="app.js"></script>'],
];

const forbidden = [
  ["old product title", "枝枝笔记"],
  ["old product subtitle", "把零散松果整理成可复盘的文档"],
  ["top right icon actions", "top-actions"],
  ["old product logo asset", "squirrel-wencang-logo.png"],
  ["toolbar upload knowledge action", "上传知识条"],
  ["toolbar organize temporary action", "整理暂存"],
  ["old organize existing action", "organize-existing"],
  ["old organize into shelf copy", "放进现有果架"],
  ["manual add destination", "已有素材栏"],
  ["manual new shelf destination", "新建素材栏"],
  ["manual pinecone move", "data-action=\"move-pinecone\""],
  ["manual shelf edit", "toggle-shelf-actions"],
  ["custom icon upload", "warehouse-icon-file"],
  ["custom icon picker", "openIconPicker"],
  ["legacy custom icon picker", "openLegacyIconPicker"],
  ["custom icon crop state", "iconCrop"],
  ["custom icon crop modal", "icon-crop-modal"],
  ["custom icon data", "iconDataUrl"],
  ["old reorganize warehouse copy", "重新整理仓库"],
  ["visible reference pinecone entry", "引用松果"],
  ["automatic tag generator", "makeTags("],
  ["workspace decoration renderer", "renderPageDecorations"],
  ["workspace decoration layer", "page-decorations"],
  ["shelf toolbar icon", "toolbar-shelf-icon"],
  ["old warehouse split pinecones", "icons.pinecone(\"warehouse-pine"],
  ["old shelf split pinecones", "icons.pinecone(\"shelf-mini"],
  ["css drawn toolbar mascot", ".toolbar-mascot::before"],
  ["css drawn toolbar mascot face", ".toolbar-mascot::after"],
  ["css drawn collapsed toolbar mascot", ".toolbar-orb-mascot::before"],
  ["css drawn collapsed toolbar mascot face", ".toolbar-orb-mascot::after"],
  ["css drawn shelf tab pinecone", ".shelf-tab-pinecone {\n  position: relative;\n  width:"],
  ["old single collapsed toolbar icon", "toolbar-orb-icon"],
  ["floating toolbar drag handle", "toolbar-drag-handle"],
  ["floating toolbar drag target", "data-drag-toolbar"],
  ["native warehouse name prompt", "prompt("],
  ["native warehouse delete confirmation", "confirm("],
  ["warehouse panel grass decoration", "panel-grass"],
  ["warehouse panel first grass illustration", "grass-a"],
  ["warehouse panel second grass illustration", "grass-b"],
  ["warehouse panel star illustration", "grass-star"],
  ["toolbar collapse action", "toggle-toolbar"],
  ["toolbar collapsed state", "toolbarCollapsed"],
  ["toolbar collapse control", ".toolbar-collapse"],
  ["collapsed toolbar style", ".bottom-toolbar.collapsed"],
  ["collapsed toolbar orb", ".toolbar-orb"],
  ["old toolbar perched mascot", "asset(\"squirrel-toolbar-perched.png\", \"toolbar-mascot\")"],
  ["obsolete bottom toolbar", "bottom-toolbar"],
  ["obsolete toolbar tab", "document-toolbar-tab"],
  ["obsolete document search", "doc-search"],
  ["obsolete featured action", "aria-label=\"精选\""],
  ["featured handler", "toggle-featured"],
  ["featured counter", "颗精选松果"],
  ["shelf title row", "shelf-title-row"],
  ["pinecone bottom action panel", "pinecone-action-panel"],
  ["temporary quantity limit", "tempLimit"],
  ["obsolete more action", "aria-label=\"更多\""],
];

const requiredAssets = [
  "assets/illustrations/pinecone-warehouse-icon.png",
  "assets/illustrations/pinecone-shelf-icon.png",
  "assets/illustrations/pinecone-icon.png",
  "assets/illustrations/squirrel-wencang-logo-ip.png",
  "assets/illustrations/squirrel-toolbar-perched.png",
  "assets/illustrations/squirrel-toolbar-perched-v2.png",
];

const missing = expectations.filter(([, needle]) => !appSource.includes(needle));
const missingCss = cssExpectations.filter(([, needle]) => !cssSource.includes(needle));
const missingHtml = htmlExpectations.filter(([, needle]) => !indexSource.includes(needle));
const presentForbidden = forbidden.filter(([, needle]) => appSource.includes(needle) || cssSource.includes(needle));
const missingAssets = requiredAssets.filter((filePath) => !fs.existsSync(path.join(__dirname, filePath)));

const emptyWarehouseSource = appSource.slice(
  appSource.indexOf("function renderEmptyWarehouseState()"),
  appSource.indexOf("function renderWarehouseCard("),
);
const emptyWarehouseFailures = [];
if (emptyWarehouseSource.includes('class="toast')) {
  emptyWarehouseFailures.push("Empty warehouse state renders a duplicate toast");
}

const warehouseDialogSource = appSource.slice(
  appSource.indexOf("function renderWarehouseDialog()"),
  appSource.indexOf("function renderReviewDocument("),
);
const warehouseDialogFailures = [];
[
  ["Warehouse dialog is modal", 'aria-modal="true"'],
  ["Warehouse dialog has a dialog role", 'role="dialog"'],
  ["Warehouse dialog has an accessible label", "aria-labelledby"],
  ["Warehouse create field has a label", 'for="warehouse-name-input"'],
].forEach(([failure, needle]) => {
  if (!warehouseDialogSource.includes(needle)) {
    warehouseDialogFailures.push(failure);
  }
});
if (!appSource.includes("warehouseDialog: _warehouseDialog")) {
  warehouseDialogFailures.push("Warehouse dialog state is persisted");
}

const toolbarSource = appSource.slice(
  appSource.indexOf("function renderToolbar()"),
  appSource.indexOf("function renderWarehouseDialog()"),
);
const toolbarFailures = [];
["toggle-document-edit", "toggle-add", "reorganize"].forEach((action) => {
  if (!toolbarSource.includes(`data-action="${action}"`)) {
    toolbarFailures.push(`Missing toolbar action: ${action}`);
  }
});
if ((toolbarSource.match(/<button\b/g) || []).length !== 3) {
  toolbarFailures.push("Toolbar does not render exactly three action buttons");
}
const reorganizeButtonSource = toolbarSource.slice(
  toolbarSource.indexOf('data-action="reorganize"') - 80,
  toolbarSource.indexOf('data-action="reorganize"') + 420,
);
if (!reorganizeButtonSource.includes('aria-disabled="${canOrganize ? "false" : "true"}"')) {
  toolbarFailures.push("Unavailable reorganization does not expose aria-disabled state");
}
if (reorganizeButtonSource.includes('? "" : "disabled"')) {
  toolbarFailures.push("Unavailable reorganization still swallows explanatory clicks with native disabled");
}
["organize-existing", "toggle-shelf"].forEach((action) => {
  if (toolbarSource.includes(`data-action="${action}"`)) {
    toolbarFailures.push(`Forbidden toolbar action: ${action}`);
  }
});
[
  ["Toolbar is not rendered as corner tools", toolbarSource, 'class="document-corner-tools"'],
  ["Toolbar buttons do not expose compact labels", toolbarSource, 'class="corner-tool-label"'],
  ["Perched mascot is not independent from the tools", toolbarSource, 'class="document-mascot"'],
  ["Corner tools are not anchored to the document top right", cssSource, ".document-corner-tools {"],
  ["Corner tool focus treatment is missing", cssSource, ".corner-tool:focus-visible"],
  ["Document card still reserves excessive bottom toolbar space", cssSource, "padding: 34px 40px 34px"],
  ["Document content does not use the full available height", cssSource, "height: calc(100% - 96px)"],
  ["Document prose does not clear the bottom edge", cssSource, "padding: 0 74px 32px 34px"],
].forEach(([failure, source, needle]) => {
  if (!source.includes(needle)) {
    toolbarFailures.push(failure);
  }
});
if (/\.toolbar-img[^}]*transform\s*:(?!\s*none\b)/s.test(cssSource)) {
  toolbarFailures.push("Toolbar icons still use geometric transforms");
}
const toggleShelfSource = appSource.slice(
  appSource.indexOf('if (action === "toggle-shelf")'),
  appSource.indexOf('if (action === "open-shelf-add")'),
);
if (!toggleShelfSource.includes("event.stopPropagation()")) {
  toolbarFailures.push("Shelf toggle can still bubble and cancel itself");
}
if (!toggleShelfSource.includes("toggleShelfDrawer()")) {
  toolbarFailures.push("Shelf toggle does not use the animated drawer switcher");
}
if (toggleShelfSource.includes("render()")) {
  toolbarFailures.push("Shelf toggle still re-renders and skips the CSS transition");
}
const toggleShelfDrawerSource = appSource.slice(
  appSource.indexOf("function toggleShelfDrawer()"),
  appSource.indexOf("function jumpToSection("),
);
[
  ["Animated shelf switcher does not toggle state", "state.shelfOpen = !state.shelfOpen"],
  ["Animated shelf switcher does not toggle the existing DOM node", "drawer?.classList.toggle(\"open\", state.shelfOpen)"],
  ["Animated shelf switcher does not persist state", "saveState()"],
].forEach(([failure, needle]) => {
  if (!toggleShelfDrawerSource.includes(needle)) {
    toolbarFailures.push(failure);
  }
});
const warehouseDragSource = appSource.slice(
  appSource.indexOf("function bindWarehouseDragEvents()"),
  appSource.indexOf("function toggleDocumentEdit("),
);
const warehouseDragFailures = [];
[
  ["Pointer down records button initiation", 'card.addEventListener("pointerdown"'],
  ["Native drag checks recorded initiation", "if (warehouseDragStartedFromButton)"],
  ["Touch dragging has a pointer move path", 'card.addEventListener("pointermove"'],
  ["Touch dragging commits on pointer up", 'card.addEventListener("pointerup"'],
  ["Touch dragging cancels on pointer cancel", 'card.addEventListener("pointercancel"'],
  ["Touch dragging hit-tests the card under the pointer", "document.elementFromPoint"],
  ["Touch dragging is limited to touch pointers", 'event.pointerType !== "touch"'],
  ["Touch dragging waits for long-press activation", "activateTouchWarehouseDrag"],
  ["Touch dragging cancels an armed moving pointer", "TOUCH_DRAG_MOVE_THRESHOLD"],
  ["Touch dragging rejects a second pointer", "if (touchWarehouseDrag)"],
  ["Touch edge scrolling uses animation frames", "requestAnimationFrame"],
  ["Touch edge scrolling targets the warehouse list", 'document.querySelector(".warehouse-list")'],
  ["Touch edge scrolling includes the viewport edge", "window.innerHeight"],
  ["Touch edge scrolling refreshes drop placement", "updateTouchWarehouseDropTarget"],
  ["Touch edge scrolling is cancelled during cleanup", "cancelAnimationFrame"],
  ["Active touch dragging suppresses browser panning", "preventActiveWarehouseTouchScroll"],
  ["Touch edge scrolling uses horizontal list offsets", "warehouseList.scrollLeft"],
  ["Touch edge scrolling uses horizontal bounds", "rect.left"],
  ["Touch edge scrolling includes horizontal viewport fallback", "window.scrollX"],
  ["Touch dragging cleans up lost pointer capture", 'card.addEventListener("lostpointercapture"'],
].forEach(([failure, needle]) => {
  if (!warehouseDragSource.includes(needle)) {
    warehouseDragFailures.push(failure);
  }
});
if (warehouseDragSource.includes('if (event.target.closest("button"))')) {
  warehouseDragFailures.push("Native drag still checks the retargeted dragstart target");
}
if (!appSource.includes('document.addEventListener("touchmove", preventActiveWarehouseTouchScroll, { passive: false });')) {
  warehouseDragFailures.push("Active touch drag does not install a non-passive scroll prevention hook");
}
const pointerDownSource = warehouseDragSource.slice(
  warehouseDragSource.indexOf('card.addEventListener("pointerdown"'),
  warehouseDragSource.indexOf('card.addEventListener("dragstart"'),
);
if (!pointerDownSource.includes("event.preventDefault();") || !pointerDownSource.includes("event.stopPropagation();") || !pointerDownSource.includes("{ capture: true }")) {
  warehouseDragFailures.push("Second touch is not suppressed before nested button activation");
}
const touchActivationSource = warehouseDragSource.slice(
  warehouseDragSource.indexOf("function activateTouchWarehouseDrag("),
  warehouseDragSource.indexOf("function preventActiveWarehouseTouchScroll("),
);
if (!touchActivationSource.includes("if (!card.isConnected)") || !touchActivationSource.includes("clearWarehouseDragState();")) {
  warehouseDragFailures.push("Disconnected touch activation does not fully clear gesture state");
}
const warehouseCardCss = cssSource.slice(
  cssSource.indexOf('.warehouse-card[draggable="true"]'),
  cssSource.indexOf(".warehouse-icon-button,"),
);
if (!warehouseCardCss.includes("touch-action: auto") && !warehouseCardCss.includes("touch-action: pan-x pan-y")) {
  warehouseDragFailures.push("Warehouse cards do not preserve horizontal and vertical touch scrolling");
}
if (warehouseCardCss.includes("touch-action: none")) {
  warehouseDragFailures.push("Warehouse cards still block all native touch scrolling");
}
const holdDelay = Number(appSource.match(/const TOUCH_DRAG_HOLD_MS = (\d+);/)?.[1]);
if (!Number.isFinite(holdDelay) || holdDelay < 250 || holdDelay > 350) {
  warehouseDragFailures.push("Touch drag long-press delay is outside 250-350ms");
}
const moveThreshold = Number(appSource.match(/const TOUCH_DRAG_MOVE_THRESHOLD = (\d+);/)?.[1]);
if (!Number.isFinite(moveThreshold) || moveThreshold < 4 || moveThreshold > 12) {
  warehouseDragFailures.push("Touch drag movement threshold is not small and bounded");
}
const warehouseListCss = cssSource.slice(
  cssSource.indexOf(".warehouse-list {"),
  cssSource.indexOf(".warehouse-card {"),
);
if (!warehouseListCss.includes("grid-auto-rows: 132px")) {
  warehouseDragFailures.push("Warehouse list does not keep every card row at a fixed height");
}
if (!warehouseListCss.includes("align-content: start")) {
  warehouseDragFailures.push("Warehouse list still allows rows to stretch into leftover space");
}
const warehouseCardBaseCss = cssSource.slice(
  cssSource.indexOf(".warehouse-card {"),
  cssSource.indexOf('.warehouse-card[draggable="true"]'),
);
if (!warehouseCardBaseCss.includes("height: 132px")) {
  warehouseDragFailures.push("Warehouse cards do not declare the shared fixed height");
}
const responsiveWarehouseListCss = cssSource.slice(
  cssSource.indexOf("@media (max-width: 1220px)"),
  cssSource.indexOf("@media (max-width: 720px)"),
);
if (!responsiveWarehouseListCss.includes("grid-template-columns: repeat(3, 260px)")) {
  warehouseDragFailures.push("Responsive warehouse list does not keep fixed-width card columns");
}

if (missing.length > 0 || missingCss.length > 0 || missingHtml.length > 0 || presentForbidden.length > 0 || missingAssets.length > 0 || toolbarFailures.length > 0 || emptyWarehouseFailures.length > 0 || warehouseDialogFailures.length > 0 || warehouseDragFailures.length > 0) {
  if (missing.length > 0) {
    console.error("Missing app content:");
    for (const [label, needle] of missing) {
      console.error(`- ${label}: ${needle}`);
    }
  }

  if (missingCss.length > 0) {
    console.error("Missing CSS content:");
    for (const [label, needle] of missingCss) {
      console.error(`- ${label}: ${needle}`);
    }
  }

  if (missingHtml.length > 0) {
    console.error("Missing HTML content:");
    for (const [label, needle] of missingHtml) {
      console.error(`- ${label}: ${needle}`);
    }
  }

  if (presentForbidden.length > 0) {
    console.error("Forbidden content still present:");
    for (const [label, needle] of presentForbidden) {
      console.error(`- ${label}: ${needle}`);
    }
  }

  if (missingAssets.length > 0) {
    console.error("Missing icon assets:");
    for (const filePath of missingAssets) {
      console.error(`- ${filePath}`);
    }
  }

  if (toolbarFailures.length > 0) {
    console.error("Toolbar contract failures:");
    for (const failure of toolbarFailures) {
      console.error(`- ${failure}`);
    }
  }

  if (emptyWarehouseFailures.length > 0) {
    console.error("Empty warehouse contract failures:");
    for (const failure of emptyWarehouseFailures) {
      console.error(`- ${failure}`);
    }
  }

  if (warehouseDialogFailures.length > 0) {
    console.error("Warehouse dialog contract failures:");
    for (const failure of warehouseDialogFailures) {
      console.error(`- ${failure}`);
    }
  }

  if (warehouseDragFailures.length > 0) {
    console.error("Warehouse drag contract failures:");
    for (const failure of warehouseDragFailures) {
      console.error(`- ${failure}`);
    }
  }

  process.exit(1);
}

console.log("Product UI content expectations found.");
