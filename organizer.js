const PRODUCT_MANAGER_PROFILE = {
  id: "product_manager",
  match: ["产品经理", "AI产品", "PRD", "原型", "需求", "用户", "面试", "作品集"],
  shelves: [
    {
      id: "user_needs",
      name: "用户、场景与需求判断",
      description: "先理解用户是谁、在什么场景里遇到什么问题，再判断需求是否值得做。",
      keywords: ["用户", "需求", "场景", "痛点", "反馈", "调研", "目标", "问题", "人群"],
    },
    {
      id: "product_design",
      name: "产品方案与体验设计",
      description: "把想法落成可理解、可评审、可执行的产品方案，兼顾流程、边界和体验。",
      keywords: ["PRD", "原型", "流程", "交互", "功能", "方案", "设计", "验收", "体验", "页面"],
    },
    {
      id: "ai_capability",
      name: "AI 能力与模型边界",
      description: "理解模型、数据、提示词和评测对产品效果的影响，避免把 AI 当黑盒许愿机。",
      keywords: ["AI", "模型", "大模型", "prompt", "提示词", "数据", "评测", "Agent", "智能", "API"],
    },
    {
      id: "portfolio_job",
      name: "项目作品与求职表达",
      description: "用项目、作品集和面试表达证明自己能发现问题、推进方案并拿到结果。",
      keywords: ["简历", "面试", "项目", "作品", "作品集", "JD", "岗位", "求职", "经历", "案例"],
    },
    {
      id: "delivery_collaboration",
      name: "协作推进与落地能力",
      description: "产品经理需要和研发、设计、运营等角色协作，把判断转化为稳定落地。",
      keywords: ["研发", "设计师", "运营", "排期", "沟通", "推进", "协作", "资源", "上线", "落地"],
    },
    {
      id: "iteration_growth",
      name: "复盘、取舍与长期成长",
      description: "通过复盘、优先级判断和持续输入，形成自己的产品感与判断力。",
      keywords: ["复盘", "迭代", "优先级", "取舍", "成长", "判断", "方法论", "失败", "长期"],
    },
  ],
};

const HUMAN_NATURE_PROFILE = {
  id: "human_nature",
  match: ["人性的弱点", "批评", "赞美", "倾听", "朋友", "冲突", "对方"],
  shelves: [
    {
      id: "empathy_needs",
      name: "理解他人的需要与处境",
      description: "先看见对方真正关心的目标、处境和情绪，再讨论自己的主张。",
      keywords: ["需要", "处境", "目标", "关心", "情绪", "立场", "对方", "理解"],
    },
    {
      id: "respect_recognition",
      name: "尊重、认可与保留尊严",
      description: "减少批评和羞耻感，让认可与改变建立在尊严之上。",
      keywords: ["尊重", "认可", "赞美", "欣赏", "批评", "指责", "尊严", "重要感"],
    },
    {
      id: "listening_interest",
      name: "倾听与建立真实连接",
      description: "通过名字、表情、持续关注和真诚倾听建立信任。",
      keywords: ["倾听", "谈话", "名字", "微笑", "兴趣", "关注", "连接", "信任"],
    },
    {
      id: "friendly_expression",
      name: "友善表达与影响他人",
      description: "用提问、共同目标和柔和表达推动合作，而不是强迫对方认输。",
      keywords: ["友善", "表达", "说服", "合作", "提问", "共识", "同意", "影响"],
    },
    {
      id: "conflict_handling",
      name: "处理错误、分歧与冲突",
      description: "面对错误和分歧时，优先保护关系，再寻找可继续合作的出口。",
      keywords: ["错误", "分歧", "冲突", "争论", "道歉", "防御", "反驳", "关系"],
    },
    {
      id: "practice_review",
      name: "把原则变成日常练习",
      description: "把沟通原则放进日常行动里，通过记录和复盘慢慢变成习惯。",
      keywords: ["练习", "习惯", "记录", "复盘", "每天", "行动", "实践", "改变"],
    },
  ],
};

const GENERAL_PROFILE = {
  id: "general",
  match: [],
  shelves: [
    {
      id: "core_ideas",
      name: "核心观点",
      description: "提炼材料里反复出现、最能代表主题的关键判断。",
      keywords: ["核心", "本质", "关键", "观点", "原则", "结论", "定义"],
    },
    {
      id: "methods",
      name: "方法与步骤",
      description: "整理可以照着执行的方法、流程、动作和检查点。",
      keywords: ["方法", "步骤", "流程", "行动", "执行", "实践", "操作", "怎么"],
    },
    {
      id: "examples",
      name: "案例与证据",
      description: "保留能说明观点的例子、现象、数据和具体场景。",
      keywords: ["例如", "比如", "案例", "数据", "现象", "场景", "故事"],
    },
    {
      id: "risks",
      name: "注意事项与反面提醒",
      description: "收纳容易误解、需要避开的坑和边界条件。",
      keywords: ["不要", "避免", "问题", "风险", "错误", "但是", "边界"],
    },
    {
      id: "open_questions",
      name: "待补充与延伸思考",
      description: "暂时无法完全归类，但值得保留、以后继续扩展的材料。",
      keywords: ["疑问", "之后", "补充", "延伸", "可能", "其他", "待"],
    },
  ],
};

const PROFILES = [PRODUCT_MANAGER_PROFILE, HUMAN_NATURE_PROFILE, GENERAL_PROFILE];

export function organizeWarehouseLocally(warehouse, { mode = "rebuild" } = {}) {
  if (mode === "merge") return mergeTemporaryPinecones(warehouse);
  if (mode !== "rebuild") throw new Error("INVALID_ORGANIZE_MODE");

  const working = structuredClone(warehouse);
  const targetPinecones = working.pinecones;

  if (!targetPinecones.length) return working;

  const profile = chooseProfile(working);
  const assigned = assignPineconesToShelves(targetPinecones, profile.shelves);
  const usedDefinitions = profile.shelves.filter((definition) => assigned.get(definition.id)?.length);

  working.shelves = usedDefinitions.map((definition) => ({
    id: makeShelfId(profile.id, definition.id),
    name: definition.name,
    description: definition.description,
  }));

  const idByDefinition = new Map(working.shelves.map((shelf, index) => [usedDefinitions[index].id, shelf.id]));
  for (const pinecone of targetPinecones) {
    const definitionId = assignedDefinitionId(assigned, pinecone.id);
    pinecone.shelfId = idByDefinition.get(definitionId) || working.shelves[0]?.id || "auto_general_core_ideas";
    pinecone.status = "shelved";
  }

  working.reviewDocument = buildReviewDocumentFromShelves(working);
  return working;
}

function mergeTemporaryPinecones(warehouse) {
  const working = structuredClone(warehouse);
  const temporaryPinecones = working.pinecones.filter(({ status }) => status === "temp");
  if (!temporaryPinecones.length) return working;

  const profile = chooseProfile({ ...working, pinecones: temporaryPinecones });
  const assigned = assignPineconesToShelves(temporaryPinecones, profile.shelves);
  const sections = working.reviewDocument?.sections || [];
  working.reviewDocument = working.reviewDocument || { title: working.name, sections };
  working.shelves = working.shelves || [];

  for (const definition of profile.shelves) {
    const pinecones = assigned.get(definition.id) || [];
    if (!pinecones.length) continue;

    let section = findMatchingExistingSection(sections, working.shelves, definition);
    if (!section) {
      const shelfId = uniqueShelfId(working, makeShelfId(profile.id, definition.id));
      const shelf = { id: shelfId, name: definition.name, description: definition.description };
      working.shelves.push(shelf);
      section = { shelfId, heading: shelf.name, summary: shelf.description, bullets: [] };
      sections.push(section);
    }

    section.bullets ||= [];
    for (const pinecone of pinecones) {
      section.bullets.push({ text: summarizePinecone(pinecone.content), pineconeIds: [pinecone.id] });
      pinecone.status = "shelved";
      pinecone.shelfId = section.shelfId;
    }
  }

  return working;
}

function findMatchingExistingSection(sections, shelves, definition) {
  const shelvesById = new Map((shelves || []).map((shelf) => [shelf.id, shelf]));
  const ranked = sections.map((section) => ({
    section,
    score: scoreKeywords([
      section.heading,
      section.summary,
      shelvesById.get(section.shelfId)?.name,
      shelvesById.get(section.shelfId)?.description,
    ].filter(Boolean).join(" "), definition.keywords),
  })).sort((left, right) => right.score - left.score);
  return ranked[0]?.score > 0 ? ranked[0].section : null;
}

function uniqueShelfId(warehouse, baseId) {
  const usedIds = new Set([
    ...(warehouse.shelves || []).map(({ id }) => id),
    ...(warehouse.reviewDocument?.sections || []).map(({ shelfId }) => shelfId),
  ]);
  if (!usedIds.has(baseId)) return baseId;
  let suffix = 2;
  while (usedIds.has(`${baseId}_${suffix}`)) suffix += 1;
  return `${baseId}_${suffix}`;
}

function chooseProfile(warehouse) {
  const corpus = `${warehouse.name} ${warehouse.pinecones.map((pinecone) => pinecone.content).join(" ")}`;
  const scored = PROFILES.map((profile) => ({
    profile,
    score: scoreKeywords(corpus, profile.match),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].profile : GENERAL_PROFILE;
}

function assignPineconesToShelves(pinecones, definitions) {
  const assigned = new Map(definitions.map((definition) => [definition.id, []]));

  pinecones.forEach((pinecone) => {
    const best = chooseBestDefinition(pinecone.content, definitions, assigned);
    assigned.get(best.id).push(pinecone);
  });

  return assigned;
}

function chooseBestDefinition(content, definitions, assigned) {
  const scored = definitions.map((definition) => ({
    definition,
    score: scoreKeywords(content, definition.keywords),
    load: assigned.get(definition.id).length,
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.load - b.load;
  });

  return scored[0].definition;
}

function assignedDefinitionId(assigned, pineconeId) {
  for (const [definitionId, pinecones] of assigned.entries()) {
    if (pinecones.some((pinecone) => pinecone.id === pineconeId)) return definitionId;
  }
  return "";
}

function buildReviewDocumentFromShelves(warehouse) {
  const sections = warehouse.shelves.map((shelf) => {
    const pinecones = warehouse.pinecones.filter((pinecone) => pinecone.status === "shelved" && pinecone.shelfId === shelf.id);
    return {
      shelfId: shelf.id,
      heading: shelf.name,
      summary: shelf.description,
      bullets: pinecones.map((pinecone) => ({
        text: summarizePinecone(pinecone.content),
        pineconeIds: [pinecone.id],
      })),
    };
  });

  return {
    title: warehouse.name,
    sections,
  };
}

function summarizePinecone(content) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= 54) return clean;

  const sentenceEnd = clean.search(/[。！？!?]/);
  if (sentenceEnd >= 24 && sentenceEnd <= 68) {
    return clean.slice(0, sentenceEnd + 1);
  }

  return `${clean.slice(0, 54)}…`;
}

function scoreKeywords(content, keywords) {
  return keywords.reduce((total, keyword) => {
    const matches = content.match(new RegExp(escapeRegExp(keyword), "gi"));
    return total + (matches?.length || 0);
  }, 0);
}

function makeShelfId(profileId, definitionId) {
  return `auto_${profileId}_${definitionId}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
