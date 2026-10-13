export const presentationKinds = ["judge", "choice", "wordcloud"];
export const allKinds = ["discover", "design", ...presentationKinds];
export const activityNames = {
  discover: "一起发现",
  design: "一起设计",
  judge: "判断题",
  choice: "选择题",
  wordcloud: "词云",
};
export const defaultActivities = {
  judge: {
    revision: 1,
    question: "人工智能可以帮助我们解决生活中的问题。",
    options: [
      { id: "true", label: "正确" },
      { id: "false", label: "错误" },
    ],
  },
  choice: {
    revision: 1,
    question: "你最常接触到的人工智能应用是？",
    options: [
      { id: "A", label: "语音助手" },
      { id: "B", label: "智能导航" },
      { id: "C", label: "人脸识别" },
      { id: "D", label: "内容推荐" },
    ],
  },
  wordcloud: {
    revision: 1,
    question: "用 1–3 个词，描述你心中的人工智能。",
    options: [],
  },
};

export const maxActivities = 50;

// 0.6 stored one configuration per type. Its keys become stable activity IDs.
export function normalizeActivities(value) {
  if (Array.isArray(value)) return structuredClone(value);
  return Object.entries(value || defaultActivities).map(([kind, settings]) => ({
    id: kind,
    kind,
    ...structuredClone(settings),
  }));
}

export function classroomActivities(state) {
  return state.activities ?? normalizeActivities(state.activitySettings);
}

export function splitWords(text) {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .split(/[,，、;；\n]+/u)
        .map((word) => word.trim().replace(/\s+/gu, " ").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

// Round each share independently: equal vote counts must display equal percentages.
export function choiceResults(options, responses) {
  const counts = options.map((option) => ({ ...option, count: 0 }));
  for (const { content, n } of responses) {
    const row = counts.find((item) => item.id === JSON.parse(content).answer);
    if (row) row.count += n;
  }
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  return {
    total,
    options: counts.map((item) => ({
      ...item,
      percentage: total ? Math.round((item.count * 1000) / total) / 10 : 0,
    })),
  };
}

export function wordResults(responses) {
  const words = new Map();
  let total = 0;
  for (const { content, n } of responses) {
    total += n;
    for (const word of new Set(JSON.parse(content).words))
      words.set(word, (words.get(word) || 0) + n);
  }
  return {
    total,
    uniqueWords: words.size,
    words: [...words]
      .map(([text, count]) => ({ text, count }))
      .sort(
        (a, b) => b.count - a.count || a.text.localeCompare(b.text, "zh-CN"),
      )
      .slice(0, 60),
  };
}
