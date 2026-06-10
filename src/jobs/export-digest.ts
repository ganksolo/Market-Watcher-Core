import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getArg, resolveHandle } from '../utils/cli';
import { logger } from '../utils/logger';
import { getWatchAccount } from '../services/account-service';
import { getPostsByHandleAndDate } from '../services/post-service';

dotenv.config();

type Post = ReturnType<typeof getPostsByHandleAndDate>[number];

type ThemeDefinition = {
  key: string;
  title: string;
  keywords: string[];
  summary: string;
  newInformation: string;
  eventTemplate: string;
  disagreementTemplate?: string;
  credibility: string;
  followUp: string;
  verifyQuestion: string;
};

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    key: 'cpo_timeline',
    title: 'CPO / 光网络时间线',
    keywords: ['cpo', 'optical', 'scale up', 'scale-out', 'scale out', 'timeline', 'delay', 'shipping', 'mass production', 'ramp', '800v'],
    summary: '博主持续强调 CPO / 光网络相关时间线没有延迟，部分环节可能比市场预期更早推进。',
    newInformation: '围绕 CPO、光交换机与 800V DC，博主引用产业链口径强调出货、量产或 ramp 节奏并未延后。',
    eventTemplate: '围绕 CPO / 光产品节奏，推文持续提及出货、量产、ramp 或 800V DC 相关催化。',
    disagreementTemplate: '博主主要反驳“CPO / 光网络时间线延后”的市场或卖方判断，更倾向相信公司与产业链一手口径。',
    credibility: '若引用公司管理层、会议发言或产业链原话，可信度偏高；博主主观延伸部分可信度中等。',
    followUp: '继续跟踪 NVDA、LITE、Foxconn 等后续公开口径，确认 H2 / 2027 / 2028 的节奏是否一致。',
    verifyQuestion: '后续是否还能拿到管理层发言逐字稿、会议纪要或正式新闻稿来再次确认时间线？',
  },
  {
    key: 'institutional_flow',
    title: '机构资金流向',
    keywords: ['blackrock', 'fidelity', 'jp morgan', 'jpmorgan', 'passive', 'positions', 'owners', 'ownership', 'listing', 'institution'],
    summary: '博主认为相关标的正在从本地或零售资金，逐步过渡到更高层级的美国机构资金参与。',
    newInformation: '当天内容提到 Blackrock、Fidelity、JP Morgan 等机构或被动资金进入相关标的，强化了资金结构升级的叙事。',
    eventTemplate: '推文提到机构持仓、被动资金纳入、研究机构建仓等资金面催化。',
    credibility: '若能对应到持仓披露、指数纳入或机构公开文件，可信度中高；仅口头推断部分需二次核验。',
    followUp: '继续跟踪后续 13F、股东结构变化和指数纳入后的增量被动资金流入。',
    verifyQuestion: 'Blackrock、Fidelity、JP Morgan 的持仓变化是否能在公开披露或公司股东名册中验证？',
  },
  {
    key: 'analyst_rebuttal',
    title: '卖方观点反驳',
    keywords: ['analyst', 'erroneous article', 'refuting', 'trust', 'slander', 'messed up', 'wrong', 'delay report'],
    summary: '博主明确反驳外部分析师或错误报道，更偏向相信公司与产业链一手口径。',
    newInformation: '当天多条内容在直接回应分析师报告或错误报道，核心论点是市场对延迟或节奏判断过度悲观。',
    eventTemplate: '推文存在对分析师报告、媒体文章或市场误读的直接反驳。',
    disagreementTemplate: '主要分歧对象是外部分析师、错误报道或二手解读；博主认为它们与公司和产业链口径不一致。',
    credibility: '反驳方向本身能反映博主立场，但需要回到一手资料验证反驳是否成立。',
    followUp: '对照原始卖方报告、媒体文章与公司正式口径，区分情绪性反驳和事实性纠错。',
    verifyQuestion: '被反驳的卖方报告或文章原文到底说了什么，是否真的与公司口径冲突？',
  },
  {
    key: 'architecture_transition',
    title: '架构切换',
    keywords: ['pluggable', 'architecture', 'parallel', 'cannablized', 'cannibalized', '800v', 'dc'],
    summary: '博主认为旧架构与新架构短期并行，但长期可能出现新架构对旧收入结构的替代。',
    newInformation: '围绕可插拔方案与新架构并行、以及后续收入被替代的风险，博主给出了更明确的时间和结构判断。',
    eventTemplate: '推文讨论旧架构和新架构并行、以及未来收入结构被蚕食的可能性。',
    credibility: '这类内容更偏行业判断，可信度取决于是否有公司指引或产业数据支持。',
    followUp: '继续跟踪 AAOI、NVDA 等公司未来指引，验证并行期与替代期何时出现拐点。',
    verifyQuestion: '公司未来几季是否有更明确的收入拆分或产品路线，支持“并行后替代”的判断？',
  },
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function parseDateArg(): string {
  const date = getArg('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error({ date }, 'Invalid or missing --date argument (expected YYYY-MM-DD)');
    process.exit(1);
  }
  return date;
}

function getPostType(post: Post): 'tweet' | 'replied_to' | 'quoted' | 'retweeted' {
  return (post.referencedType as 'replied_to' | 'quoted' | 'retweeted' | null) ?? 'tweet';
}

function extractTickers(text: string): string[] {
  const matches = text.match(/\$[A-Z]{1,6}\b/g) ?? [];
  return Array.from(new Set(matches));
}

function detectThemes(posts: Post[]) {
  return THEME_DEFINITIONS.map(def => {
    const supportingPosts = posts.filter(post => {
      const text = post.text.toLowerCase();
      return def.keywords.some(keyword => text.includes(keyword.toLowerCase()));
    });

    const tickers = Array.from(new Set(supportingPosts.flatMap(post => extractTickers(post.text))));

    return {
      ...def,
      supportingPosts,
      tickers,
      score: supportingPosts.length,
    };
  })
    .filter(theme => theme.supportingPosts.length > 0)
    .sort((a, b) => b.score - a.score);
}

function inferOverallStance(posts: Post[]): string {
  const corpus = posts.map(post => post.text.toLowerCase()).join(' ');
  const bullishTerms = ['bullish', 'no delay', 'accelerat', 'upward', 'ramp', 'enter', 'good time', 'catalyst'];
  const bearishTerms = ['delay', 'sell everything', 'risk'];

  let bullishScore = 0;
  let bearishScore = 0;

  for (const term of bullishTerms) {
    if (corpus.includes(term)) bullishScore += 1;
  }
  for (const term of bearishTerms) {
    if (corpus.includes(term)) bearishScore += 1;
  }

  if (bullishScore >= bearishScore + 2) {
    return '整体偏多，倾向相信产业链与公司口径，对相关主题的时间线和资金面持乐观态度。';
  }
  if (bearishScore >= bullishScore + 2) {
    return '整体偏谨慎，虽然有主题表达，但更多是在提醒节奏、风险或市场误判。';
  }
  return '整体偏主观解读，存在方向性，但仍需要结合一手资料判断信号强弱。';
}

function buildNewInformation(themes: ReturnType<typeof detectThemes>): string[] {
  if (themes.length === 0) {
    return ['- 当天没有形成很强的单一主题，更多是围绕已有观点的补充说明和互动。'];
  }

  return themes.slice(0, 3).map(theme => {
    const tickerText = theme.tickers.length > 0 ? `（涉及 ${theme.tickers.join('、')}）` : '';
    return `- **${theme.title}**：${theme.newInformation}${tickerText}`;
  });
}

function buildCoreViews(themes: ReturnType<typeof detectThemes>): string[] {
  if (themes.length === 0) {
    return ['- 当天缺少可稳定聚类的强主题，建议直接结合原始 daily markdown 浏览。'];
  }

  return themes.slice(0, 4).map(theme => {
    return `- **${theme.title}**：${theme.summary}（相关推文 ${theme.supportingPosts.length} 条）`;
  });
}

function buildThemeToTicker(themes: ReturnType<typeof detectThemes>, allTickers: string[]): string[] {
  if (themes.length === 0) {
    return [`- 当天提及的主要标的：${allTickers.length > 0 ? allTickers.join('、') : '无明显 ticker'}`];
  }

  return themes.slice(0, 4).map(theme => {
    const tickerText = theme.tickers.length > 0 ? theme.tickers.join('、') : '无明确 ticker';
    return `- **${theme.title}** → ${tickerText}；${theme.summary}`;
  });
}

function buildEvents(themes: ReturnType<typeof detectThemes>): string[] {
  if (themes.length === 0) {
    return ['- 未抽取到显著的事件型催化，更多是观点表达。'];
  }

  return themes.slice(0, 4).map(theme => `- **${theme.title}**：${theme.eventTemplate}`);
}

function buildCredibility(posts: Post[], themes: ReturnType<typeof detectThemes>): string[] {
  const lines: string[] = [];

  if (themes.some(theme => theme.key === 'cpo_timeline')) {
    lines.push('- 高：涉及管理层发言、行业会议、公司高管表态或正式演讲内容，应优先回看原文或逐字稿。');
  }
  if (themes.some(theme => theme.key === 'institutional_flow')) {
    lines.push('- 中高：涉及 Blackrock、Fidelity、JP Morgan 持仓或被动纳入的内容，适合用公开披露二次验证。');
  }
  if (posts.some(post => getPostType(post) === 'replied_to')) {
    lines.push('- 中：回复型推文较多，能表达博主态度，但很多是对已有论点的解释而不是新增事实。');
  }
  if (lines.length === 0) {
    lines.push('- 中：当天内容以观点表达为主，需要结合原始推文和外部资料做人工筛选。');
  }

  return lines;
}

function buildFollowUps(themes: ReturnType<typeof detectThemes>): string[] {
  if (themes.length === 0) {
    return ['- 继续观察是否有新的原发推文把当天零散观点串成更完整的主线。'];
  }

  return themes.slice(0, 4).map(theme => `- ${theme.followUp}`);
}

function buildVerifyQuestions(themes: ReturnType<typeof detectThemes>): string[] {
  if (themes.length === 0) {
    return ['- 今天是否存在需要回溯的一手材料、截图、公告或会议逐字稿？'];
  }

  return themes.slice(0, 4).map(theme => `- ${theme.verifyQuestion}`);
}

function buildDisagreements(posts: Post[], themes: ReturnType<typeof detectThemes>): string[] {
  const lines: string[] = [];

  const disagreementThemes = themes.filter(theme => theme.disagreementTemplate);
  for (const theme of disagreementThemes.slice(0, 3)) {
    lines.push(`- **${theme.title}**：${theme.disagreementTemplate}`);
  }

  if (lines.length === 0) {
    const hasDisagreement = posts.some(post => {
      const text = post.text.toLowerCase();
      return text.includes('analyst') || text.includes('erroneous') || text.includes('wrong') || text.includes('trust');
    });

    if (hasDisagreement) {
      lines.push('- 当天存在对外部分析、二手报道或市场误读的反驳，但没有形成单一分歧主线。');
    } else {
      lines.push('- 当天没有特别突出的公开分歧点，更多是延续既有观点。');
    }
  }

  return lines;
}

function buildReadingConclusion(posts: Post[], themes: ReturnType<typeof detectThemes>): string {
  const originalPosts = posts.filter(post => getPostType(post) === 'tweet').length;
  const replyCount = posts.filter(post => getPostType(post) === 'replied_to').length;
  const quoteCount = posts.filter(post => getPostType(post) === 'quoted').length;
  const topTheme = themes[0];

  if (!topTheme) {
    return `今天共 ${posts.length} 条推文，整体以零散观点和互动回复为主，暂未形成需要单独拉出的强主线。原创 ${originalPosts} 条、回复 ${replyCount} 条、引用 ${quoteCount} 条。`;
  }

  return `今天的阅读重点是“${topTheme.title}”。当天共 ${posts.length} 条推文，其中原创 ${originalPosts} 条、回复 ${replyCount} 条、引用 ${quoteCount} 条；新增信息主要围绕 ${topTheme.summary}`;
}

function buildOneLineMain(themes: ReturnType<typeof detectThemes>): string {
  return themes[0]?.summary ?? '当天内容以零散观点和互动为主，未形成单一高强度主线。';
}

function buildDigest(handle: string, date: string, posts: Post[]): string {
  const themes = detectThemes(posts);
  const allTickers = Array.from(new Set(posts.flatMap(post => extractTickers(post.text))));
  const overallStance = inferOverallStance(posts);

  const lines: string[] = [
    `# Market Watcher 每日阅读简报 — ${date}`,
    '',
    `> 账号：@${handle}`,
    `> 当日推文数：${posts.length}`,
    `> 原始浏览稿：\`exports/daily/${handle}/${date}.md\``,
    `> 机器数据：\`exports/raw/${handle}/${date}.ndjson\``,
    `> 说明：本简报为规则生成的人类阅读版，请在做研究或交易判断前回看原始推文与外部一手资料。`,
    '',
    '## 1. 今日阅读结论',
    buildReadingConclusion(posts, themes),
    '',
    '## 2. 今日一句话主线',
    buildOneLineMain(themes),
    '',
    '## 3. 今日新增信息',
    ...buildNewInformation(themes),
    '',
    '## 4. 今日核心观点',
    ...buildCoreViews(themes),
    '',
    '## 5. 观点 → 标的映射',
    ...buildThemeToTicker(themes, allTickers),
    '',
    '## 6. 事件 / 催化因素',
    ...buildEvents(themes),
    '',
    '## 7. 博主立场',
    `- ${overallStance}`,
    '',
    '## 8. 信息类型与可信度',
    ...buildCredibility(posts, themes),
    '',
    '## 9. 后续观察点',
    ...buildFollowUps(themes),
    '',
    '## 10. 需要后续验证的问题',
    ...buildVerifyQuestions(themes),
    '',
    '## 11. 分歧点与反驳对象',
    ...buildDisagreements(posts, themes),
    '',
  ];

  return lines.join('\n');
}

function main(): void {
  const handle = resolveHandle();
  const date = parseDateArg();

  const account = getWatchAccount(handle);
  if (!account) {
    logger.error({ handle }, 'Account not found — run pnpm x:resolve first');
    process.exit(1);
  }

  const posts = getPostsByHandleAndDate(handle, date);
  if (posts.length === 0) {
    logger.warn({ handle, date }, 'No posts for this date — digest export skipped');
    return;
  }

  try {
    const digestDir = path.resolve(`exports/digest/${handle}`);
    fs.mkdirSync(digestDir, { recursive: true });

    const digestPath = path.join(digestDir, `${date}.digest.md`);
    const content = buildDigest(handle, date, posts);
    fs.writeFileSync(digestPath, content, 'utf-8');

    logger.info({ handle, date, postCount: posts.length, digestPath }, 'Digest export complete');
  } catch (err) {
    logger.error({ err }, 'export-digest failed');
    process.exit(1);
  }
}

main();
