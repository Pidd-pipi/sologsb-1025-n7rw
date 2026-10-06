import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NbAlertModule,
  NbBadgeModule,
  NbButtonModule,
  NbCardModule,
  NbCheckboxModule,
  NbIconModule,
  NbInputModule,
  NbLayoutModule,
  NbOptionModule,
  NbSelectModule,
  NbTabsetModule,
  NbToastrModule,
  NbToastrService
} from '@nebular/theme';

type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions' | 'sync';
type ReviewStatus = 'pending' | 'approved' | 'changes';
type NoticeStatus = 'draft' | 'in-review' | 'locked';
type CheckLevel = 'error' | 'warning' | 'info';

interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
  /** 单调修订号：该语言正文/标题每被改动一次就 +1，用于三方合并判断。 */
  revision: number;
}

interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
}

interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  version: string;
  title: string;
  severity: string;
  scope: string;
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  channels: string[];
  languages: LanguageVersion[];
  note: string;
  emergency: boolean;
  /** 锁定快照生成时整稿的修订号。 */
  revision: number;
}

/** 每个语言版本的同步簿记：上次已确认对齐的修订号与内容指纹。 */
interface LanguageSyncState {
  revision: number;
  signature: string;
}

/** 同一语言两边都改过、且内容不同的待裁定冲突。裁定前不改当前正文。 */
interface MergeConflict {
  id: string;
  locale: string;
  packetId: string;
  receivedAt: string;
  local: LanguageVersion;
  remote: LanguageVersion;
  baseRevision: number;
  status: 'pending' | 'resolved-local' | 'resolved-remote';
}

interface NoticeDraft {
  id: string;
  title: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  requiredLocales: string[];
  languages: LanguageVersion[];
  discussions: Discussion[];
  reviews: RoleReview[];
  versions: VersionSnapshot[];
  status: NoticeStatus;
  version: string;
  lockedAt?: string;
  emergencyRevision: boolean;
  /** 整稿修订号，任何可持久化变更都会 +1；也是锁定快照的修订号。 */
  revision: number;
  updatedAt: string;
  /** locale -> 上次合并/裁定后对齐的修订号与指纹。 */
  sync: Record<string, LanguageSyncState>;
  /** 已应用过的回连整包 id（幂等：重复回连不会多出语言版本）。 */
  appliedPacketIds: string[];
  conflicts: MergeConflict[];
}

interface CheckResult {
  id: string;
  category: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

interface DiffRow {
  left: string;
  right: string;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

interface NoticeTemplate {
  id: string;
  name: string;
  description: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  title: Record<string, string>;
  body: Record<string, string>;
}

/** 随整包携带的三方合并基准（发包设备上一次与对端对齐时的状态）。 */
interface SyncPacket {
  id: string;
  draftId: string;
  deviceId: string;
  sentAt: string;
  draft: {
    title: string;
    eventType: string;
    severity: string;
    scope: string;
    eventAt: string;
    effectiveAt: string;
    expiresAt: string;
    channels: string[];
    requiredLocales: string[];
  };
  draftRevision: number;
  languages: LanguageVersion[];
  discussions: Discussion[];
  reviews: RoleReview[];
  lockedVersions: VersionSnapshot[];
  /** locale -> 发包端记录的对端基准修订号与指纹。 */
  baseLanguages: Record<string, LanguageSyncState>;
}

interface MergeReport {
  packetId: string;
  deviceId: string;
  mergedLocales: string[];
  conflictLocales: string[];
  addedVersions: number;
  duplicate: boolean;
  receivedAt: string;
}

const STORAGE_KEY = 'sologsb-1025-emergency-notice-v1';
const DEVICE_KEY = 'sologsb-1025-device-id';
const META_FIELDS = ['title', 'eventType', 'severity', 'scope', 'eventAt', 'effectiveAt', 'expiresAt'] as const;
type MetaField = (typeof META_FIELDS)[number];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function posInt(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 语言内容指纹：只看标题/正文/译者/复核位，修订号不参与。 */
function languageSignature(language: Pick<LanguageVersion, 'title' | 'body' | 'translator' | 'reviewed'>): string {
  return JSON.stringify([language.title, language.body, language.translator, language.reviewed]);
}

function syncStateOf(language: LanguageVersion): LanguageSyncState {
  return { revision: posInt(language.revision), signature: languageSignature(language) };
}

function ensureLanguage(language: Partial<LanguageVersion>, index: number): LanguageVersion {
  return {
    id: String(language.id ?? language.locale ?? `lang-${index}`),
    locale: String(language.locale ?? language.id ?? `lang-${index}`),
    name: String(language.name ?? language.locale ?? '未知语言'),
    title: String(language.title ?? ''),
    body: String(language.body ?? ''),
    translator: String(language.translator ?? ''),
    reviewed: Boolean(language.reviewed),
    revision: posInt(language.revision)
  };
}

function initialDraft(): NoticeDraft {
  const first: VersionSnapshot = {
    id: 'version-1-0-0',
    label: '首次发布稿',
    createdAt: '2026-09-23T08:10:00+08:00',
    version: '1.0.0',
    title: '台风“海燕”橙色预警通知',
    scope: '滨海新区沿海街道',
    severity: '橙色',
    eventAt: '2026-09-23T07:30:00+08:00',
    effectiveAt: '2026-09-23T09:00:00+08:00',
    expiresAt: '2026-09-24T08:00:00+08:00',
    channels: ['短信', '广播', '社区大屏'],
    note: '发布范围覆盖滨海新区。',
    emergency: false,
    revision: 1,
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警通知',
        body: '请滨海新区居民立即停止户外活动。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
        translator: '林晓', reviewed: true, revision: 1
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
        translator: '周晴', reviewed: true, revision: 1
      }
    ]
  };

  const second: VersionSnapshot = {
    ...clone(first),
    id: 'version-1-1-0',
    label: '扩大影响范围',
    createdAt: '2026-09-24T10:35:00+08:00',
    version: '1.1.0',
    title: '台风“海燕”橙色预警及人员转移通知',
    scope: '滨海新区全区，重点为沿海街道',
    note: '增加沿海街道转移要求。',
    revision: 2,
    languages: [
      {
        ...clone(first.languages[0]),
        id: 'zh-CN',
        title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至安置点。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。'
      } as LanguageVersion,
      {
        ...clone(first.languages[1]),
        id: 'en',
        title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.'
      } as LanguageVersion
    ]
  };
  second.languages.forEach((language) => { language.revision = 2; });

  const languages: LanguageVersion[] = [
    {
      id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警及人员转移通知',
      body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。不要停留在临时建筑附近，并持续关注后续通知。',
      translator: '林晓', reviewed: true, revision: 3
    },
    {
      id: 'en', locale: 'en', name: 'English', title: 'Orange alert and evacuation notice for Typhoon Haiyan',
      body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Keep away from temporary buildings and continue to monitor further notices.',
      translator: '周晴', reviewed: true, revision: 2
    },
    {
      id: 'ja', locale: 'ja', name: '日本語', title: '台風「ハイエン」オレンジ警報',
      body: '浜海新区の住民は直ちに屋外活動を中止してください。本日午後、強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。',
      translator: '佐藤 明', reviewed: false, revision: 1
    }
  ];

  return {
    id: 'notice-haiyan-2026',
    title: '台风“海燕”橙色预警及人员转移通知',
    eventType: '台风',
    severity: '橙色',
    scope: '滨海新区全区，重点为沿海街道',
    channels: ['短信', '广播', '社区大屏', '政务新媒体'],
    eventAt: '2026-09-25T07:30',
    effectiveAt: '2026-09-25T09:00',
    expiresAt: '2026-09-26T08:00',
    requiredLocales: ['zh-CN', 'en', 'ja'],
    languages,
    discussions: [
      {
        id: 'comment-1', languageId: 'zh-CN', sentenceIndex: 1, author: '陈冉', role: '法务审阅',
        text: '建议明确安置点地址由属地另行发送，避免通知被理解为完整点位清单。', createdAt: '2026-09-25T08:16:00+08:00', resolved: false
      }
    ],
    reviews: [
      { role: '编辑', owner: '林晓', status: 'approved', note: '事件要素完整。' },
      { role: '法务', owner: '陈冉', status: 'changes', note: '转移表述需补充依据。' },
      { role: '翻译', owner: '周晴', status: 'pending', note: '等待日文版复核。' },
      { role: '发布人', owner: '值班中心', status: 'pending', note: '' }
    ],
    versions: [first, second],
    status: 'in-review',
    version: '1.2.0-draft',
    emergencyRevision: false,
    revision: 3,
    updatedAt: new Date().toISOString(),
    sync: {
      'zh-CN': { revision: 3, signature: languageSignature(languages[0]) },
      en: { revision: 2, signature: languageSignature(languages[1]) },
      ja: { revision: 1, signature: languageSignature(languages[2]) }
    },
    appliedPacketIds: [],
    conflicts: []
  };
}

const TEMPLATES: NoticeTemplate[] = [
  {
    id: 'typhoon', name: '台风人员转移', description: '适用于沿海区域人员转移和停业停课提醒。',
    eventType: '台风', severity: '橙色', scope: '沿海街道', channels: ['短信', '广播', '社区大屏'],
    title: { 'zh-CN': '台风预警及人员转移通知', en: 'Typhoon alert and evacuation notice', ja: '台風警報・避難のお知らせ' },
    body: {
      'zh-CN': '请相关区域居民立即停止户外活动。危险区域人员请按属地安排转移至安全场所。预计将出现强风和暴雨，请远离临时建筑并关注后续通知。',
      en: 'Residents in the affected area should stop outdoor activities immediately. People in high-risk areas must follow local evacuation arrangements. Strong winds and heavy rain are expected. Stay away from temporary structures and monitor further notices.',
      ja: '対象地域の住民は直ちに屋外活動を中止してください。危険地域の方は自治体の避難指示に従ってください。強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。'
    }
  },
  {
    id: 'water', name: '供水异常', description: '适用于计划停水和恢复供水通知。',
    eventType: '公共设施', severity: '黄色', scope: '城市供水片区', channels: ['短信', '政务新媒体'],
    title: { 'zh-CN': '计划停水通知', en: 'Planned water service interruption', ja: '断水のお知らせ' },
    body: {
      'zh-CN': '因管网维护，相关区域将于指定时间暂停供水。请提前储水并关闭用水设备。恢复供水后可能出现短时浑浊，请排放后再使用。',
      en: 'Water service will be temporarily suspended for network maintenance. Please store water in advance and close water fixtures. Water may appear cloudy when service resumes; run the tap before use.',
      ja: '管路保守作業のため、対象地域では一時的に断水します。事前に水を確保し、水道設備を閉めてください。復旧後は濁りが生じる場合があるため、しばらく通水してから使用してください。'
    }
  },
  {
    id: 'public-safety', name: '公共安全提醒', description: '适用于大型活动周边临时管控。',
    eventType: '公共安全', severity: '黄色', scope: '活动周边道路', channels: ['广播', '社区大屏', '政务新媒体'],
    title: { 'zh-CN': '大型活动期间临时交通提醒', en: 'Temporary traffic notice during major event', ja: '大規模イベント期間中の交通規制' },
    body: {
      'zh-CN': '活动期间部分道路将采取临时管控措施。请服从现场指引，合理规划出行路线，非必要不前往管控区域。',
      en: 'Temporary traffic controls will be in place during the event. Follow on-site directions, plan your route, and avoid restricted areas unless necessary.',
      ja: 'イベント期間中、一部道路で交通規制を行います。現場の案内に従い、移動経路を事前に確認してください。不要な場合は規制区域への立入りを控えてください。'
    }
  }
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NbLayoutModule,
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbSelectModule,
    NbOptionModule,
    NbCheckboxModule,
    NbTabsetModule,
    NbIconModule,
    NbBadgeModule,
    NbAlertModule,
    NbToastrModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly templates = TEMPLATES;
  readonly eventTypes = ['台风', '暴雨', '地震', '公共卫生', '公共设施', '公共安全'];
  readonly severities = ['蓝色', '黄色', '橙色', '红色'];
  readonly channelOptions = ['短信', '广播', '社区大屏', '政务新媒体', '应急喇叭', '网站'];
  readonly locales = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'es', name: 'Español' }
  ];
  readonly bannedTerms = ['大概', '可能吧', '无需恐慌', '绝对不会', '保证安全'];
  readonly glossary = [
    { canonical: '立即', variants: ['马上', '赶紧'] },
    { canonical: '安置点', variants: ['避难所', '庇护所'] },
    { canonical: '持续关注', variants: ['随时留意', '保持观看'] }
  ];
  readonly roles: RoleReview['role'][] = ['编辑', '法务', '翻译', '发布人'];

  draft: NoticeDraft = initialDraft();
  activeView: WorkspaceView = 'compose';
  selectedLanguageId = 'zh-CN';
  selectedSentenceIndex = 0;
  selectedTemplateId = 'typhoon';
  discussionText = '';
  currentRole: RoleReview['role'] = '编辑';
  compareBaseId = '';
  compareTargetId = '';
  lastSavedAt = '';
  history: NoticeDraft[] = [];
  future: NoticeDraft[] = [];

  // —— 断网回连 / 续作合并 ——
  readonly deviceId = this.resolveDeviceId();
  incomingPacketText = '';
  retainedMerge: { draft: NoticeDraft; report: MergeReport } | null = null;
  lastMergeReport: MergeReport | null = null;
  simulateWriteFailure = false;
  /** 裁定/复核变化后内容版本号 +1，发布检查结果与版本差异立即失效重算。 */
  private contentVersion = 0;
  private checkStamp = Date.now();
  private checksCache: { version: number; value: CheckResult[] } = { version: -1, value: [] };
  private diffCache = new Map<string, { version: number; rows: DiffRow[] }>();

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.draft = this.migrate(JSON.parse(saved) as NoticeDraft);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        this.draft = initialDraft();
      }
    }
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.lastSavedAt = this.formatDateTime(this.draft.updatedAt);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveNow();
    }
  }

  get selectedLanguage(): LanguageVersion {
    return this.draft.languages.find((language) => language.id === this.selectedLanguageId) ?? this.draft.languages[0];
  }

  get selectedTemplateDescription(): string {
    return this.templates.find((template) => template.id === this.selectedTemplateId)?.description ?? '请选择一个模板';
  }

  get unresolvedDiscussionCount(): number {
    return this.draft.discussions.filter((discussion) => !discussion.resolved).length;
  }

  get currentSentences(): string[] {
    return this.splitSentences(this.selectedLanguage?.body ?? '');
  }

  get activeDiscussions(): Discussion[] {
    return this.draft.discussions.filter((discussion) => discussion.languageId === this.selectedLanguageId);
  }

  get pendingConflicts(): MergeConflict[] {
    return this.draft.conflicts.filter((conflict) => conflict.status === 'pending');
  }

  get resolvedConflicts(): MergeConflict[] {
    return this.draft.conflicts.filter((conflict) => conflict.status !== 'pending');
  }

  get hasPendingConflict(): boolean {
    return this.pendingConflicts.length > 0;
  }

  get appliedPackets(): string[] {
    return [...this.draft.appliedPacketIds].reverse();
  }

  get checkStampLabel(): string {
    return this.formatDateTime(new Date(this.checkStamp).toISOString());
  }

  get exportedPacketPreview(): string {
    return JSON.stringify(this.buildPacket({ id: uid('packet'), deviceId: this.deviceId, sentAt: new Date().toISOString() }), null, 2);
  }

  get checks(): CheckResult[] {
    if (this.checksCache.version === this.contentVersion) return this.checksCache.value;
    this.checksCache = { version: this.contentVersion, value: this.computeChecks() };
    this.checkStamp = Date.now();
    return this.checksCache.value;
  }

  get blockingChecks(): CheckResult[] {
    return this.checks.filter((check) => check.level === 'error');
  }

  get warningCount(): number {
    return this.checks.filter((check) => check.level === 'warning').length;
  }

  get isLocked(): boolean {
    return this.draft.status === 'locked';
  }

  get allReviewsApproved(): boolean {
    return this.draft.reviews.every((review) => review.status === 'approved');
  }

  get hasIncompleteReviews(): boolean {
    return this.draft.reviews.some((review) => review.status !== 'approved');
  }

  isSentenceDiscussed(index: number): boolean {
    return this.activeDiscussions.some((discussion) => discussion.sentenceIndex === index && !discussion.resolved);
  }

  languageName(locale: string): string {
    return this.locales.find((item) => item.id === locale)?.name
      ?? this.draft.languages.find((language) => language.id === locale)?.name
      ?? locale;
  }

  joinLocaleNames(locales: readonly string[]): string {
    return locales.map((locale) => this.languageName(locale)).join('、');
  }

  baselineRevision(locale: string): number {
    return this.draft.sync[locale]?.revision ?? 0;
  }

  conflictExists(locale: string): boolean {
    return this.draft.conflicts.some((conflict) => conflict.locale === locale && conflict.status === 'pending');
  }

  get nextVersion(): string {
    const numbers = this.draft.version.match(/\d+/g)?.map(Number) ?? [1, 2, 0];
    return `${numbers[0] || 1}.${(numbers[1] || 0) + 1}.0`;
  }

  get versionDiff(): DiffRow[] {
    const base = this.draft.versions.find((version) => version.id === this.compareBaseId);
    const target = this.draft.versions.find((version) => version.id === this.compareTargetId);
    const key = `${this.compareBaseId}|${this.compareTargetId}|${this.selectedLanguageId}`;
    const cached = this.diffCache.get(key);
    if (cached?.version === this.contentVersion && base && target) return cached.rows;
    if (!base || !target) return [];
    const baseLanguage = base.languages.find((language) => language.id === this.selectedLanguageId);
    const targetLanguage = target.languages.find((language) => language.id === this.selectedLanguageId);
    const rows = this.diffSentences(this.splitSentences(baseLanguage?.body ?? ''), this.splitSentences(targetLanguage?.body ?? ''));
    this.diffCache.set(key, { version: this.contentVersion, rows });
    return rows;
  }

  updateMeta(field: MetaField, value: string): void {
    this.commit((draft) => {
      draft[field] = value;
      draft.status = draft.status === 'locked' ? 'draft' : draft.status;
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language && language[field] !== value) {
        language[field] = value;
        language.revision += 1;
        this.touchSync(draft, language.id);
      }
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language && language.reviewed !== checked) {
        language.reviewed = checked;
        language.revision += 1;
        this.touchSync(draft, language.id);
      }
    });
  }

  selectSentence(index: number): void {
    this.selectedSentenceIndex = index;
  }

  addDiscussion(): void {
    const text = this.discussionText.trim();
    if (!text || this.isLocked) return;
    this.commit((draft) => {
      draft.discussions.push({
        id: uid('discussion'), languageId: this.selectedLanguageId, sentenceIndex: this.selectedSentenceIndex,
        author: this.currentRole === '法务' ? '陈冉' : this.currentRole === '翻译' ? '周晴' : '林晓',
        role: `${this.currentRole}审阅`, text, createdAt: new Date().toISOString(), resolved: false
      });
    });
    this.discussionText = '';
    this.toastr.success('讨论已绑定到当前句。', '已添加');
  }

  toggleDiscussion(discussionId: string): void {
    this.commit((draft) => {
      const item = draft.discussions.find((discussion) => discussion.id === discussionId);
      if (item) item.resolved = !item.resolved;
    });
  }

  setReviewStatus(role: RoleReview['role'], status: ReviewStatus): void {
    // 复核状态变化：发布检查结果立即失效重算。
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.status = status;
    });
  }

  setReviewNote(role: RoleReview['role'], note: string): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.note = note;
    });
  }

  applyTemplate(): void {
    const template = this.templates.find((item) => item.id === this.selectedTemplateId);
    if (!template || this.isLocked) return;
    this.commit((draft) => {
      draft.eventType = template.eventType;
      draft.severity = template.severity;
      draft.scope = template.scope;
      draft.channels = [...template.channels];
      draft.languages.forEach((language) => {
        const nextTitle = template.title[language.id];
        const nextBody = template.body[language.id];
        if ((nextTitle !== undefined && nextTitle !== language.title) || (nextBody !== undefined && nextBody !== language.body)) {
          if (nextTitle !== undefined) language.title = nextTitle;
          if (nextBody !== undefined) language.body = nextBody;
          language.reviewed = false;
          language.revision += 1;
          this.touchSync(draft, language.id);
        }
      });
    });
    this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  lockVersion(): void {
    if (this.hasPendingConflict) {
      this.toastr.warning(`还有 ${this.pendingConflicts.length} 个语言版本待裁定，裁定前不能生成锁定版本。`, '存在待裁定冲突');
      this.activeView = 'sync';
      return;
    }
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages), note: '发布前检查通过并锁定。', emergency: false,
      revision: this.draft.revision + 1
    };
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
    });
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.toastr.success(`版本 ${snapshot.version} 已锁定。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = `${major}.${minor + 1}.0-emergency`;
      draft.lockedAt = undefined;
    });
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id.startsWith('conflict:')) {
      this.activeView = 'sync';
      return;
    }
    if (check.id.startsWith('missing-') || check.id.startsWith('required-') || check.id.startsWith('banned-') || check.id.startsWith('term-')) {
      const locale = check.id.split('-').at(-1);
      if (locale && this.draft.languages.some((language) => language.id === locale)) this.selectedLanguageId = locale;
      this.activeView = 'compose';
    } else if (check.id === 'discussions') {
      this.activeView = 'review';
    }
  }

  // ================= 断网回连 · 续作合并 =================

  /** 模拟场景一：对端离线时新增韩语版本，网络恢复后整包到达（不同语言直接并入）。 */
  simulateRemoteNewLanguage(): void {
    const korean: LanguageVersion = {
      id: 'ko', locale: 'ko', name: '한국어',
      title: '태풍 「하이옌」 주황 경보 및 주민 대피 통지',
      body: '빈하이 신구 주민은 즉시 옥외 활동을 중지해 주십시오. 해안가 주민은 오늘 17시까지 가까운 대피소로 이동해 주십시오. 오늘 오후 강풍과 폭우가 예상됩니다. 가설 건축물에 접근하지 마시고 추후 통지를 확인해 주십시오.',
      translator: '김 민서', reviewed: false, revision: 1
    };
    const base = this.draft;
    const packet: SyncPacket = {
      id: uid('packet'),
      draftId: base.id,
      deviceId: 'device-B-demo',
      sentAt: new Date().toISOString(),
      draft: this.pickMeta(base),
      draftRevision: base.revision,
      languages: [...clone(base.languages), korean],
      discussions: clone(base.discussions),
      reviews: clone(base.reviews),
      lockedVersions: clone(base.versions),
      baseLanguages: this.packetBase(base)
    };
    this.incomingPacketText = JSON.stringify(packet, null, 2);
    this.activeView = 'sync';
    this.toastr.info('对端“设备B”回连整包已到达：含新增的韩语版本。', '网络恢复');
  }

  /**
   * 模拟场景二：两台设备都改中文（同一语言两边都改过）。
   * 本机先落一版（修订号 +1），对端整包携带另一版与旧基准，合并后并列待裁定。
   */
  simulateBothEditedZh(): void {
    if (this.hasPendingConflict) {
      this.toastr.warning('请先裁定现有冲突，再模拟新的同语言双改。', '存在待裁定冲突');
      this.activeView = 'sync';
      return;
    }
    const base = clone(this.draft);
    const local = this.draft;
    const localCurrent = local.languages.find((item) => item.id === 'zh-CN');
    if (!localCurrent) return;
    const localBody = `${localCurrent.body.replace(/。$/, '')}。【本机补充：安置点物资由属地街道保障，请按指引有序前往。】`;
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === 'zh-CN');
      if (language) {
        language.body = localBody;
        language.revision += 1;
        this.touchSync(draft, language.id);
      }
    });

    const remoteZh = ensureLanguage({
      ...clone(base.languages.find((item) => item.id === 'zh-CN')),
      body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。【对端修改：如遇强降雨可提前转移，途中注意避开积水路段。】不要停留在临时建筑附近，并持续关注后续通知。',
      translator: '林晓（设备B）',
      revision: (base.sync['zh-CN']?.revision ?? localCurrent.revision) + 1
    }, 0);
    const packet: SyncPacket = {
      id: uid('packet'),
      draftId: base.id,
      deviceId: 'device-B-demo',
      sentAt: new Date().toISOString(),
      draft: this.pickMeta(base),
      draftRevision: base.revision,
      languages: base.languages.map((item) => item.id === 'zh-CN' ? remoteZh : clone(item)),
      discussions: clone(base.discussions),
      reviews: clone(base.reviews),
      lockedVersions: clone(base.versions),
      baseLanguages: this.packetBase(base)
    };
    this.incomingPacketText = JSON.stringify(packet, null, 2);
    this.activeView = 'sync';
    this.toastr.warning('两台设备都修改了简体中文版本，合并将并列待裁定。', '同语言双改');
  }

  /** 重新发送当前整包文本，用来演示重复回连：应被幂等跳过，不多出语言版本。 */
  resendLastIncoming(): void {
    if (!this.incomingPacketText.trim()) {
      this.toastr.info('还没有回连整包，请先生成一个演示场景。', '重复回连');
      return;
    }
    this.mergeIncoming();
  }

  exportPacket(): void {
    this.incomingPacketText = this.exportedPacketPreview;
    this.toastr.success('已按当前草稿生成回连整包文本，可复制到另一台设备。', '导出整包');
  }

  mergeIncoming(): void {
    let packet: SyncPacket;
    try {
      packet = JSON.parse(this.incomingPacketText) as SyncPacket;
    } catch {
      this.toastr.danger('整包不是合法 JSON，已拒绝合并。', '整包解析失败');
      return;
    }
    const validation = this.validatePacket(packet);
    if (validation) {
      this.toastr.danger(validation, '整包校验失败');
      return;
    }
    const { draft: merged, report } = this.mergeDrafts(clone(this.draft), packet);
    if (report.duplicate) {
      this.lastMergeReport = report;
      this.toastr.info(`整包 ${report.packetId} 此前已应用，重复回连已跳过；语言版本数量不变。`, '重复回连');
      return;
    }
    // 先写存储；写入失败回滚到合并前草稿，但合并稿保留在内存中可重试。
    const error = this.writeStorage(merged);
    if (error) {
      this.retainedMerge = { draft: merged, report };
      this.toastr.danger('合并稿写入失败，已回滚当前展示，合并草稿已保留，可在上方重试。', '写入失败');
      return;
    }
    this.swapIn(merged, { pushFuture: false });
    this.retainedMerge = null;
    this.lastMergeReport = report;
    this.invalidateDerived();
    this.toastr.success(
      `直接并入 ${report.mergedLocales.length} 个语言、${report.addedVersions} 个锁定版本`
      + (report.conflictLocales.length ? `；${report.conflictLocales.length} 个语言待裁定` : '；无冲突'),
      '网络恢复 · 续作合并完成'
    );
  }

  retryRetainedMerge(): void {
    if (!this.retainedMerge) return;
    const { draft, report } = this.retainedMerge;
    const error = this.writeStorage(draft);
    if (error) {
      this.toastr.danger('仍然写入失败，合并草稿继续保留。', '写入失败');
      return;
    }
    this.swapIn(draft, { pushFuture: false });
    this.retainedMerge = null;
    this.lastMergeReport = report;
    this.invalidateDerived();
    this.toastr.success('保留的合并草稿已写入并生效。', '重试成功');
  }

  discardRetainedMerge(): void {
    if (!this.retainedMerge) return;
    this.retainedMerge = null;
    this.toastr.info('已放弃保留的合并草稿，当前草稿保持合并前状态。', '已丢弃');
  }

  /** 裁定：采用本机版本或对端版本。裁定前不动当前正文；裁定当下才替换。 */
  resolveConflict(conflictId: string, side: 'local' | 'remote'): void {
    this.commit((draft) => {
      const index = draft.conflicts.findIndex((conflict) => conflict.id === conflictId);
      if (index < 0) return;
      const conflict = draft.conflicts[index];
      const winner = side === 'local' ? clone(conflict.local) : clone(conflict.remote);
      winner.revision = Math.max(conflict.local.revision, conflict.remote.revision) + 1;
      const position = draft.languages.findIndex((language) => language.id === conflict.locale);
      if (position >= 0) draft.languages[position] = winner;
      else draft.languages.push(winner);
      conflict.status = side === 'local' ? 'resolved-local' : 'resolved-remote';
      draft.sync[conflict.locale] = syncStateOf(winner);
    });
    // 裁定变化已随 commit 使发布检查结果与版本差异立即失效重算。
    const conflict = this.draft.conflicts.find((item) => item.id === conflictId);
    this.toastr.success(
      `已采用${side === 'local' ? '本机' : '对端'}版本，当前正文已更新${this.pendingConflicts.length ? '' : '，所有冲突裁定完成'}。`,
      '冲突已裁定'
    );
    if (conflict && this.selectedLanguageId === conflict.locale) this.selectedSentenceIndex = 0;
  }

  jumpToConflict(locale: string): void {
    this.selectedLanguageId = locale;
    this.activeView = 'compose';
  }

  conflictDiffRows(conflict: MergeConflict): DiffRow[] {
    return this.diffSentences(this.splitSentences(conflict.local.body), this.splitSentences(conflict.remote.body));
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    this.future.push(clone(this.draft));
    const error = this.writeStorage(previous);
    if (error) {
      this.history.push(previous);
      this.toastr.danger('写入失败，撤销已回滚。', '写入失败');
      return;
    }
    this.swapIn(previous, { pushHistory: false, pushFuture: false });
    this.invalidateDerived();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    const error = this.writeStorage(next);
    if (error) {
      this.future.push(next);
      this.toastr.danger('写入失败，重做已回滚。', '写入失败');
      return;
    }
    this.swapIn(next, { pushHistory: false, pushFuture: false });
    this.invalidateDerived();
  }

  saveNow(): void {
    const error = this.writeStorage(this.draft);
    if (error) {
      this.toastr.danger('写入失败，草稿未保存，请检查浏览器存储后重试。', '保存失败');
      return;
    }
    this.lastSavedAt = this.formatDateTime(this.draft.updatedAt);
    this.toastr.success('草稿已保存在当前浏览器。', '保存成功');
  }

  formatDateTime(value: string): string {
    if (!value) return '未设置';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  // ================= 内部实现 =================

  private computeChecks(): CheckResult[] {
    const checks: CheckResult[] = [];
    const draft = this.draft;
    const requiredMeta: Array<[string, string]> = [
      ['标题', draft.title], ['事件类型', draft.eventType], ['严重程度', draft.severity],
      ['影响范围', draft.scope], ['事件时间', draft.eventAt], ['生效时间', draft.effectiveAt],
      ['失效时间', draft.expiresAt]
    ];
    requiredMeta.filter(([, value]) => !value).forEach(([label]) => checks.push({
      id: `meta-${label}`, category: '必填信息', level: 'error', title: `缺少${label}`,
      detail: `请补全通知的${label}后再提交发布。`
    }));
    if (!draft.channels.length) checks.push({
      id: 'channels', category: '发布渠道', level: 'error', title: '未选择目标渠道', detail: '至少选择一个目标发布渠道。'
    });

    draft.requiredLocales.forEach((locale) => {
      if (!draft.languages.some((language) => language.id === locale)) {
        const name = this.locales.find((item) => item.id === locale)?.name ?? locale;
        checks.push({
          id: `missing-${locale}`, category: '语言完整性', level: 'error', title: `${name}版本缺失`,
          detail: '该语言属于本次发布的必需语言，请添加并完成翻译。'
        });
      }
    });

    // 待裁定冲突：当前正文未定稿，既阻止锁定，也作为发布阻断项。
    this.pendingConflicts.forEach((conflict, index) => {
      checks.push({
        id: `conflict:${conflict.id}`,
        category: '合并裁定',
        level: 'error',
        title: `${this.languageName(conflict.locale)}存在两端并发修改`,
        detail: `第 ${index + 1} 个待裁定冲突：两端都改了同一语言且内容不同，请在“断网回连”页选择保留版本；裁定前不会改动当前正文，也不能锁定。`
      });
    });

    draft.languages.forEach((language) => {
      if (!language.title.trim() || !language.body.trim()) checks.push({
        id: `required-${language.id}`, category: '必填信息', level: 'error', title: `${language.name}内容不完整`,
        detail: '语言版本必须包含标题和正文。'
      });
      if (!language.reviewed) checks.push({
        id: `review-${language.id}`, category: '版本审阅', level: language.id === 'ja' ? 'warning' : 'info',
        title: `${language.name}尚未完成语言复核`, detail: '发布前应确认措辞、术语和本地化表达。'
      });
      const banned = this.bannedTerms.filter((term) => language.body.includes(term));
      if (banned.length) checks.push({
        id: `banned-${language.id}`, category: '禁用词', level: 'error', title: `${language.name}包含禁用词`,
        detail: `请替换：${banned.join('、')}。`
      });
      const inconsistent = this.glossary.filter((entry) => {
        const variantCount = entry.variants.filter((variant) => language.body.includes(variant)).length;
        return variantCount > 0 && (!language.body.includes(entry.canonical) || variantCount > 1);
      });
      if (inconsistent.length) checks.push({
        id: `term-${language.id}`, category: '术语一致性', level: 'warning', title: `${language.name}术语不统一`,
        detail: inconsistent.map((item) => `统一使用“${item.canonical}”，避免“${item.variants.join('、')}”`).join('；')
      });
    });

    const eventAt = this.toTime(draft.eventAt);
    const effectiveAt = this.toTime(draft.effectiveAt);
    const expiresAt = this.toTime(draft.expiresAt);
    if (eventAt && effectiveAt && effectiveAt < eventAt) checks.push({
      id: 'time-effective', category: '时间冲突', level: 'warning', title: '生效时间早于事件时间',
      detail: '请确认这是预防性通知；否则调整事件时间或生效时间。'
    });
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) checks.push({
      id: 'time-expires', category: '时间冲突', level: 'error', title: '失效时间早于生效时间',
      detail: '通知有效期必须晚于生效时间。'
    });
    const unresolved = draft.discussions.filter((discussion) => !discussion.resolved).length;
    if (unresolved) checks.push({
      id: 'discussions', category: '逐句讨论', level: 'warning', title: `${unresolved} 条讨论尚未解决`,
      detail: '发布前请处理或明确忽略未解决讨论。'
    });
    return checks;
  }

  /**
   * 纯函数：通知草稿、语言版本和锁定版本的续作三方合并。
   * - 不同语言（对端独有）直接并入；
   * - 同一语言只有一端改过：快进到改动端；
   * - 同一语言两端都改过且内容不同：并列待裁定，不修改当前语言版本；
   * - 锁定版本只并入本机缺失的快照，绝不重新生成；
   * - packetId 幂等：重复回连直接跳过，不会多出语言版本。
   */
  private mergeDrafts(local: NoticeDraft, packet: SyncPacket): { draft: NoticeDraft; report: MergeReport } {
    const report: MergeReport = {
      packetId: packet.id, deviceId: packet.deviceId, mergedLocales: [], conflictLocales: [],
      addedVersions: 0, duplicate: false, receivedAt: new Date().toISOString()
    };
    if (local.appliedPacketIds.includes(packet.id)) {
      report.duplicate = true;
      return { draft: local, report };
    }

    // 通知草稿标量元信息（标题/事件要素/时间）保留本机版本，晚到整包不覆盖另一端的草稿要素；
    // 渠道与必需语言是集合，取并集。
    local.channels = [...new Set([...local.channels, ...packet.draft.channels])];
    local.requiredLocales = [...new Set([...local.requiredLocales, ...packet.draft.requiredLocales])];

    // 讨论按 id 并集。
    (packet.discussions ?? []).forEach((discussion) => {
      if (!local.discussions.some((item) => item.id === discussion.id)) local.discussions.push(clone(discussion));
    });

    // 角色审阅：本机没有的角色并入；状态一致时同步备注，状态冲突时不互相覆盖（待人工复核）。
    (packet.reviews ?? []).forEach((incoming) => {
      const current = local.reviews.find((review) => review.role === incoming.role);
      if (!current) {
        local.reviews.push(clone(incoming));
      } else if (current.status === incoming.status) {
        current.note = incoming.note;
      }
    });

    // 锁定版本（续作合并）：按快照 id 去重，只并入本机缺失项，绝不重新生成。
    (packet.lockedVersions ?? []).forEach((incoming) => {
      if (local.versions.some((version) => version.id === incoming.id)) return;
      const snapshot = clone(incoming);
      snapshot.revision = posInt(snapshot.revision, local.revision);
      snapshot.languages = (snapshot.languages ?? []).map((language, index) => ensureLanguage(language, index));
      local.versions.push(snapshot);
      report.addedVersions += 1;
    });
    local.versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // 语言版本续作合并。
    packet.languages.forEach((incomingRaw, index) => {
      const incoming = ensureLanguage(incomingRaw, index);
      const position = local.languages.findIndex((language) => language.id === incoming.id);
      if (position < 0) {
        // 对端独有语言：直接并入，revision 从 1 补齐，绝不因重复回连而追加第二份。
        if (local.languages.some((language) => language.locale === incoming.locale)) return;
        const added = clone(incoming);
        added.revision = posInt(added.revision);
        local.languages.push(added);
        local.sync[incoming.id] = syncStateOf(added);
        report.mergedLocales.push(incoming.id);
        return;
      }

      const current = local.languages[position];
      const base = (packet.baseLanguages ?? {})[incoming.id] ?? local.sync[incoming.id] ?? null;
      const baseRevision = base?.revision ?? 0;
      const currentSignature = languageSignature(current);
      const incomingSignature = languageSignature(incoming);

      const localChanged = current.revision > baseRevision || (base !== null && currentSignature !== base.signature);
      const remoteChanged = incoming.revision > baseRevision || (base !== null && incomingSignature !== base.signature);
      const sameContent = currentSignature === incomingSignature;

      if (sameContent) {
        current.revision = Math.max(current.revision, incoming.revision);
        local.sync[incoming.id] = { revision: current.revision, signature: currentSignature };
        return;
      }

      if (localChanged && remoteChanged) {
        // 同一语言两边都改过：并列待裁定。裁定前不改当前正文。
        const existing = local.conflicts.find(
          (conflict) => conflict.locale === incoming.id && conflict.status === 'pending'
        );
        if (!existing) {
          local.conflicts.push({
            id: uid('conflict'),
            locale: incoming.id,
            packetId: packet.id,
            receivedAt: report.receivedAt,
            local: clone(current),
            remote: clone(incoming),
            baseRevision,
            status: 'pending'
          });
          report.conflictLocales.push(incoming.id);
        }
        return;
      }

      if (remoteChanged && !localChanged) {
        // 只对端改过：快进到对端版本（晚到整包在该语言上安全续作，而非覆盖本地改动）。
        const next = clone(incoming);
        next.revision = Math.max(current.revision, incoming.revision);
        local.languages[position] = next;
        local.sync[incoming.id] = syncStateOf(next);
        report.mergedLocales.push(incoming.id);
        return;
      }

      // 只本机改过（或基准不明但对端与基准一致）：保留本机，不被覆盖。
      local.sync[incoming.id] = {
        revision: Math.max(current.revision, incoming.revision, baseRevision),
        signature: currentSignature
      };
    });

    local.appliedPacketIds.push(packet.id);
    if (local.appliedPacketIds.length > 50) local.appliedPacketIds.splice(0, local.appliedPacketIds.length - 50);
    local.revision = Math.max(posInt(local.revision), posInt(packet.draftRevision)) + 1;
    local.updatedAt = report.receivedAt;
    return { draft: local, report };
  }

  private validatePacket(packet: SyncPacket): string | null {
    if (!packet || typeof packet !== 'object') return '整包内容为空。';
    if (!packet.id || typeof packet.id !== 'string') return '整包缺少 id。';
    if (packet.draftId !== this.draft.id) return '整包属于另一份通知草稿，不能合并到当前草稿。';
    if (!Array.isArray(packet.languages)) return '整包缺少语言版本列表。';
    if (!packet.draft || typeof packet.draft !== 'object') return '整包缺少草稿元信息。';
    return null;
  }

  private pickMeta(draft: NoticeDraft): SyncPacket['draft'] {
    return {
      title: draft.title,
      eventType: draft.eventType,
      severity: draft.severity,
      scope: draft.scope,
      eventAt: draft.eventAt,
      effectiveAt: draft.effectiveAt,
      expiresAt: draft.expiresAt,
      channels: [...draft.channels],
      requiredLocales: [...draft.requiredLocales]
    };
  }

  /** 发包端携带的「对端基准」：直接复用本机记录的同步簿记。 */
  private packetBase(draft: NoticeDraft): Record<string, LanguageSyncState> {
    return clone(draft.sync);
  }

  private buildPacket(init: { id: string; deviceId: string; sentAt: string }): SyncPacket {
    const draft = this.draft;
    return {
      id: init.id,
      draftId: draft.id,
      deviceId: init.deviceId,
      sentAt: init.sentAt,
      draft: this.pickMeta(draft),
      draftRevision: draft.revision,
      languages: clone(draft.languages),
      discussions: clone(draft.discussions),
      reviews: clone(draft.reviews),
      lockedVersions: clone(draft.versions),
      baseLanguages: this.packetBase(draft)
    };
  }

  private touchSync(draft: NoticeDraft, locale: string): void {
    const language = draft.languages.find((item) => item.id === locale);
    if (language) draft.sync[locale] = syncStateOf(language);
  }

  /** 裁定或复核变化后，发布检查结果和版本差异立即失效重算。 */
  private invalidateDerived(): void {
    this.contentVersion += 1;
    this.diffCache.clear();
    this.checksCache = { version: -1, value: [] };
  }

  private commit(mutator: (draft: NoticeDraft) => void): void {
    this.history.push(clone(this.draft));
    if (this.history.length > 50) this.history.shift();
    const next = clone(this.draft);
    mutator(next);
    next.revision = posInt(next.revision) + 1;
    next.updatedAt = new Date().toISOString();
    const error = this.writeStorage(next);
    if (error) {
      this.history.pop();
      this.toastr.danger('写入失败，本次修改已回滚，草稿保持原样。', '写入失败');
      return;
    }
    this.swapIn(next, { pushHistory: false, pushFuture: false });
    this.future = [];
    this.invalidateDerived();
  }

  /** 写 localStorage（演示中可被「模拟写入失败」开关强制失败）；失败时不改任何现有数据。 */
  private writeStorage(draft: NoticeDraft): Error | null {
    try {
      if (this.simulateWriteFailure) throw new Error('simulated storage failure');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private swapIn(
    draft: NoticeDraft,
    options: { pushHistory?: boolean; pushFuture?: boolean } = {}
  ): void {
    const { pushHistory = true, pushFuture = true } = options;
    if (pushHistory) this.history.push(clone(this.draft));
    if (pushFuture) this.future.push(clone(this.draft));
    this.draft = draft;
    this.lastSavedAt = this.formatDateTime(draft.updatedAt);
    if (!draft.languages.some((language) => language.id === this.selectedLanguageId)) {
      this.selectedLanguageId = draft.languages[0]?.id ?? '';
    }
  }

  private resolveDeviceId(): string {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `device-A-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  /** 旧数据迁移：补齐整稿/语言/锁定快照修订号与同步簿记。 */
  private migrate(value: NoticeDraft): NoticeDraft {
    if (!value || !value.id || !Array.isArray(value.languages) || !Array.isArray(value.versions)) return initialDraft();
    value.discussions ??= [];
    value.reviews ??= [];
    value.requiredLocales ??= ['zh-CN'];
    value.conflicts ??= [];
    value.appliedPacketIds = Array.isArray(value.appliedPacketIds)
      ? [...new Set(value.appliedPacketIds.filter((id): id is string => typeof id === 'string'))]
      : [];
    value.sync = value.sync && typeof value.sync === 'object' ? value.sync : {};

    // 整稿修订号补齐。
    value.revision = posInt(value.revision, 1);

    // 语言版本修订号补齐；旧数据迁移后以当前内容作为同步基准。
    value.languages = value.languages.map((language, index) => ensureLanguage(language, index));
    value.languages.forEach((language) => {
      const state = value.sync[language.id];
      if (!state || !posInt(state.revision, 0)) {
        value.sync[language.id] = syncStateOf(language);
      } else {
        value.sync[language.id] = { revision: posInt(state.revision, language.revision), signature: String(state.signature ?? '') };
      }
    });

    // 锁定快照及其内嵌语言版本修订号补齐。
    value.versions.forEach((version) => {
      version.revision = posInt(version.revision, value.revision);
      version.languages = Array.isArray(version.languages)
        ? version.languages.map((language, index) => ensureLanguage(language, index))
        : [];
    });

    // 待裁定冲突结构兜底，丢弃无法识别的残片。
    value.conflicts = value.conflicts.filter((conflict) =>
      conflict && conflict.locale && conflict.local && conflict.remote
    ).map((conflict) => ({
      ...conflict,
      id: String(conflict.id ?? uid('conflict')),
      packetId: String(conflict.packetId ?? 'unknown'),
      receivedAt: String(conflict.receivedAt ?? new Date().toISOString()),
      baseRevision: posInt(conflict.baseRevision, 0),
      status: conflict.status === 'pending' ? 'pending' : conflict.status
    }));
    return value;
  }

  private splitSentences(text: string): string[] {
    return (text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? []).map((item) => item.trim()).filter(Boolean);
  }

  private toTime(value: string): number {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private diffSentences(left: string[], right: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const lcs: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        rows.push({ left: left[i], right: right[j], kind: 'same' }); i++; j++;
      } else if (i < left.length && j < right.length && lcs[i + 1][j] === lcs[i][j] && lcs[i][j + 1] === lcs[i][j]) {
        rows.push({ left: left[i], right: right[j], kind: 'changed' }); i++; j++;
      } else if (j < right.length && (i === left.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
        rows.push({ left: '', right: right[j], kind: 'added' }); j++;
      } else if (i < left.length) {
        rows.push({ left: left[i], right: '', kind: 'removed' }); i++;
      }
    }
    return rows;
  }
}
