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
  eventTemplate: string;
  credibility: string;
  followUp: string;
  verifyQuestion: string;
};

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    key: 'cpo_timeline',
    title: 'CPO / 光网络时间线',
    keywords: ['cpo', 'optical', 'scale up', 'scale-out', 'scale out', 'timeline', 'delay', 'shipping', 'mass production', 'ramp', '800v'],
    summary: '博主强调 CPO / 光网络相关时间线没有延迟，部分环节可能比市场预期更早推进。',
    eventTemplate: '围绕 CPO / 光产品节奏，推文持续提及出货、量产、ramp 或 800V DC 相关催化。',
    credibility: '若引用公司管理层、conference speech 或产业链原话，可信度偏高；博主主观延伸部分可信度中等。',
    followUp: '继续跟踪 NVDA、LITE、Foxconn 等后续公开口径，确认 H2 / 2027 / 2028 的节奏是否一致。',
    verifyQuestion: '后续是否还能拿到管理层、conference transcript 或正式新闻稿来再次确认时间线？',
  },
  {
    key: 'institutional_flow',
    title: '机构资金流向',
    keywords: ['blackrock', 'fidelity', 'jp morgan', 'jpmorgan', 'passive', 'positions', 'owners', 'ownership', 'listing', 'institution'],
    summary: '博主认为相关标的正在从本地或零售资金，逐步过渡到更高层级的美国机构资金参与。',
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
    eventTemplate: '推文存在对分析师报告、媒体文章或市场误读的直接反驳。',
    credibility: '反驳方向本身能反映博主立场，但需要回到一手资料验证反驳是否成立。',
    followUp: '对照原始 analyst note、媒体文章与公司正式口径，区分情绪性反驳和事实性纠错。',
    verifyQuestion: '被反驳的 analyst / article 原文到底说了什么，是否真的与公司口径冲突？',
  },
  {
    key: 'architecture_transition',
    title: '架构切换',
    keywords: ['pluggable', 'architecture', 'parallel', 'cannablized', 'cannibalized', '800v', 'dc'],
    summary: '博主认为旧架构与新架构短期并行，但长期可能出现新架构对旧收入结构的替代。',
    eventTemplate: '推文讨论旧架构和新架构并行、以及未来收入结构被蚕食的可能性。',
    credibility: '这类内容更偏行业判断，可信度取决于是否有公司指引或产业数据支持。',
    followUp: '继续跟踪 AAOI、NVDA 等公司未来指引，验证并行期与替代期何时出现拐点。',
    verifyQuestion: '公司未来几季是否有更明确的收入拆分或产品路线，支持“并行后替代”的判断？',
  },
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|');
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

function containsKeyword(text: string, keyword: string): boolean {
  return text.includes(keyword.toLowerCase());
}

function scorePost(post: Post): number {
  const text = post.text.toLowerCase();
  const tickers = extractTickers(post.text).length;
  const type = getPostType(post);
  let score = 0;

  if (type === 'tweet') score += 4;
  if (type === 'quoted') score += 3;
  if (type === 'replied_to') score += 1;

  score += Math.min(3, tickers);
  if (text.includes('conference') || text.includes('management') || text.includes('executive')) score += 3;
  if (text.includes('blackrock') || text.includes('fidelity') || text.includes('jp morgan') || text.includes('jpmorgan')) score += 2;
  if (text.includes('delay') || text.includes('timeline') || text.includes('shipping')) score += 2;
  if (post.text.length > 180) score += 1;

  return score;
}

function detectThemes(posts: Post[]) {
  return THEME_DEFINITIONS.map(def => {
    const supportingPosts = posts.filter(post => {
      const text = post.text.toLowerCase();
      return def.keywords.some(keyword => containsKeyword(text, keyword));
    });

    const tickers = Array.from(new Set(supportingPosts.flatMap(post => extractTickers(post.text))));
    const score = supportingPosts.length * 10 + supportingPosts.reduce((acc, post) => acc + scorePost(post), 0);

    return {
      ...def,
      score,
      tickers,
      supportingPosts,
    };
  })
    .filter(theme => theme.supportingPosts.length > 0)
    .sort((a, b) => b.score - a.score);
}

function inferOverallStance(posts: Post[]): string {
  const corpus = posts.map(post => post.text.toLowerCase()).join(' ');
  const bullishTerms = ['bullish', 'no delay', 'accelerat', 'upward', 'ramp', 'enter', 'good time', 'catalyst'];
  const bearishTerms = ['delay', 'sell everything', 'wrong', 'risk'];

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
    return '整体偏谨慎或偏空，但今天的数据样本里这种情况不常见。';
  }
  return '整体偏主观解读，存在方向性，但需要结合一手资料判断是否足够强。';
}

function inferInformationCredibility(posts: Post[], themes: ReturnType<typeof detectThemes>): string[] {
  const lines: string[] = [];

  if (themes.some(theme => theme.key === 'cpo_timeline')) {
    lines.push('- 高：涉及 management / conference / executive / company speech 的内容，应优先回看原文或 transcript。');
  }
  if (themes.some(theme => theme.key === 'institutional_flow')) {
    lines.push('- 中高：涉及 Blackrock / Fidelity / JP Morgan 持仓或被动纳入的内容，适合用公开披露二次验证。');
  }
  if (posts.some(post => getPostType(post) === 'replied_to')) {
    lines.push('- 中：回复型推文较多，能表达博主态度，但很多是对已有论点的解释而不是新增事实。');
  }
  if (lines.length === 0) {
    lines.push('- 中：当天内容以观点表达为主，需要结合原始推文和外部资料做人工筛选。');
  }

  return lines;
}

function buildMustRead(posts: Post[]) {
  return [...posts]
    .sort((a, b) => scorePost(b) - scorePost(a))
    .slice(0, 5)
    .map(post => {
      const type = getPostType(post);
      const reasonParts: string[] = [];
      if (type === 'tweet') reasonParts.push('原发推文');
      if (type === 'quoted') reasonParts.push('引用外部信息');
      if (extractTickers(post.text).length > 0) reasonParts.push(`涉及 ${extractTickers(post.text).join(', ')}`);
      if (post.text.toLowerCase().includes('conference') || post.text.toLowerCase().includes('management')) {
        reasonParts.push('含一手/半一手口径');
      }
      if (reasonParts.length === 0) reasonParts.push('信息密度较高');

      return {
        post,
        reason: reasonParts.join('；'),
      };
    });
}

function buildTimeline(posts: Post[]): string[] {
  return posts.map(post => {
    const type = getPostType(post);
    return `- ${post.createdAt} · [${type}] \`${post.tweetId}\` · ${truncate(normalizeText(post.text), 160)}`;
  });
}

function buildRawList(posts: Post[]): string[] {
  return posts.map(post => {
    const type = getPostType(post);
    const url = post.url ?? `https://x.com/${post.authorHandle}/status/${post.tweetId}`;
    return `- ${post.createdAt} \`${post.tweetId}\` [↗](${url}) [${type}] ${truncate(normalizeText(post.text), 280)}`;
  });
}

function buildDigest(handle: string, date: string, posts: Post[]): string {
  const themes = detectThemes(posts);
  const mustRead = buildMustRead(posts);
  const tickers = Array.from(new Set(posts.flatMap(post => extractTickers(post.text))));
  const overallStance = inferOverallStance(posts);
  const originalPosts = posts.filter(post => getPostType(post) === 'tweet');
  const replyCount = posts.filter(post => getPostType(post) === 'replied_to').length;
  const quoteCount = posts.filter(post => getPostType(post) === 'quoted').length;
  const topTheme = themes[0];

  const readingConclusion = topTheme
    ? `今天的阅读重点是“${topTheme.title}”。当天 ${posts.length} 条推文里，原创 ${originalPosts.length} 条、回复 ${replyCount} 条、引用 ${quoteCount} 条，新增信息主要集中在 ${topTheme.summary}`
    : `今天共 ${posts.length} 条推文，整体以零散观点和互动回复为主，没有形成非常强的单一主题。`;

  const oneLineMain = topTheme
    ? topTheme.summary
    : '当天内容以零散观点和互动为主，未形成单一高强度主线。';

  const newInformation = mustRead.slice(0, 3).map(item => `- \`${item.post.tweetId}\` ${truncate(normalizeText(item.post.text), 180)}`);
  const coreViews = themes.length > 0
    ? themes.slice(0, 4).map(theme => `- **${theme.title}**：${theme.summary}（相关推文 ${theme.supportingPosts.length} 条）`)
    : ['- 当天缺少可稳定聚类的强主题，建议直接回看 Top Must Read Tweets。'];

  const themeToTicker = themes.length > 0
    ? themes.slice(0, 4).map(theme => `- **${theme.title}** → ${theme.tickers.length > 0 ? theme.tickers.join(', ') : '无明确 ticker'}；${theme.summary}`)
    : [`- 当天提及的主要标的：${tickers.length > 0 ? tickers.join(', ') : '无'}`];

  const events = themes.length > 0
    ? themes.slice(0, 4).map(theme => `- **${theme.title}**：${theme.eventTemplate}`)
    : ['- 未抽取到显著的事件型催化，更多是观点表达。'];

  const disagreements = posts
    .filter(post => {
      const text = post.text.toLowerCase();
      return text.includes('analyst') || text.includes('erroneous') || text.includes('wrong') || text.includes('trust');
    })
    .slice(0, 5)
    .map(post => `- \`${post.tweetId}\` ${truncate(normalizeText(post.text), 180)}`);

  const followUps = themes.length > 0
    ? themes.slice(0, 4).map(theme => `- ${theme.followUp}`)
    : ['- 继续观察是否有新的原发推文把当天零散观点串成更完整的主线。'];

  const verifyQuestions = themes.length > 0
    ? themes.slice(0, 4).map(theme => `- ${theme.verifyQuestion}`)
    : ['- 今天是否存在需要回溯的一手材料、截图、公告或 conference transcript？'];

  const credibility = inferInformationCredibility(posts, themes);

  const lines: string[] = [
    `# Market Watcher Daily Reading — ${date}`,
    '',
    `> Handle: @${handle}`,
    `> Posts today: ${posts.length}`,
    `> Raw daily file: \`exports/daily/${handle}/${date}.md\``,
    `> Raw ndjson file: \`exports/raw/${handle}/${date}.ndjson\``,
    `> Note: This digest is rule-generated for human reading. Review the source tweets before making any trading or research conclusion.`,
    '',
    '## 1. 今日阅读结论',
    readingConclusion,
    '',
    '## 2. 今日一句话主线',
    oneLineMain,
    '',
    '## 3. 今日新增信息',
    ...newInformation,
    '',
    '## 4. 今日核心观点',
    ...coreViews,
    '',
    '## 5. 观点 → 标的映射',
    ...themeToTicker,
    '',
    '## 6. 事件 / 催化因素',
    ...events,
    '',
    '## 7. 时间线',
    ...buildTimeline(posts),
    '',
    '## 8. 分歧点与反驳对象',
    ...(disagreements.length > 0 ? disagreements : ['- 当天没有显著的公开分歧点，或分歧主要体现在回复互动中。']),
    '',
    '## 9. 博主立场',
    `- ${overallStance}`,
    '',
    '## 10. 信息类型与可信度',
    ...credibility,
    '',
    '## 11. 后续观察点',
    ...followUps,
    '',
    '## 12. 需要后续验证的问题',
    ...verifyQuestions,
    '',
    '## 13. Top Must Read Tweets',
    ...mustRead.map(item => {
      const url = item.post.url ?? `https://x.com/${item.post.authorHandle}/status/${item.post.tweetId}`;
      return `- \`${item.post.tweetId}\` [↗](${url}) [${getPostType(item.post)}] ${truncate(normalizeText(item.post.text), 220)}\n  - 必读原因：${escapeMarkdown(item.reason)}`;
    }),
    '',
    '## 14. 原始推文列表',
    ...buildRawList(posts),
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
