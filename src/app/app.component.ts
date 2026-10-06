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
import {
  CheckResult,
  DiffRow,
  LanguageVersion,
  NoticeDraft,
  NoticeTemplate,
  PendingLanguageConflict,
  RoleReview,
  VersionSnapshot,
  VersionVector,
  WorkspaceView
} from './notice.model';
import {
  createDeviceId,
  exportPackage,
  isSyncPackage,
  mergeDrafts,
  MergeReport,
  tickVector,
  uid
} from './notice-sync';
import { migrateDraft } from './notice-migrate';

type ReviewStatus = 'pending' | 'approved' | 'changes';
type CheckLevel = 'error' | 'warning' | 'info';

const STORAGE_KEY = 'sologsb-1025-emergency-notice-v1';
const DEVICE_KEY = 'sologsb-1025-device-id';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function snapshotLanguageOf(language: LanguageVersion) {
  return {
    id: language.id, locale: language.locale, name: language.name,
    title: language.title, body: language.body, translator: language.translator, reviewed: language.reviewed
  };
}

function initialDraft(deviceId = createDeviceId()): NoticeDraft {
  const lang = (
    id: string, locale: string, name: string, title: string, body: string, translator: string,
    reviewed: boolean, revision: number, updatedBy: string
  ): LanguageVersion => ({
    id, locale, name, title, body, translator, reviewed,
    revision, vector: { [deviceId]: revision }, updatedAt: '2026-09-25T08:40:00+08:00', updatedBy
  });

  const zhFirst: LanguageVersion = lang(
    'zh-CN', 'zh-CN', '简体中文', '台风“海燕”橙色预警通知',
    '请滨海新区居民立即停止户外活动。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
    '林晓', true, 1, '林晓'
  );
  const enFirst: LanguageVersion = lang(
    'en', 'en', 'English', 'Orange alert for Typhoon Haiyan',
    'Residents in Binhai New Area should stop outdoor activities immediately. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
    '周晴', true, 1, '周晴'
  );

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
    originDeviceId: deviceId,
    languages: [snapshotLanguageOf(zhFirst), snapshotLanguageOf(enFirst)]
  };

  const zhSecond: LanguageVersion = {
    ...lang(
      'zh-CN', 'zh-CN', '简体中文', '台风“海燕”橙色预警及人员转移通知',
      '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
      '林晓', true, 2, '林晓'
    ),
    vector: { [deviceId]: 2 }
  };
  const enSecond: LanguageVersion = {
    ...lang(
      'en', 'en', 'English', 'Orange alert and evacuation notice for Typhoon Haiyan',
      'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
      '周晴', true, 2, '周晴'
    ),
    vector: { [deviceId]: 2 }
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
    languages: [snapshotLanguageOf(zhSecond), snapshotLanguageOf(enSecond)]
  };

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
    languages: [
      {
        ...lang(
          'zh-CN', 'zh-CN', '简体中文', '台风“海燕”橙色预警及人员转移通知',
          '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。不要停留在临时建筑附近，并持续关注后续通知。',
          '林晓', true, 3, '林晓'
        ),
        vector: { [deviceId]: 3 }
      },
      {
        ...lang(
          'en', 'en', 'English', 'Orange alert and evacuation notice for Typhoon Haiyan',
          'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Keep away from temporary buildings and continue to monitor further notices.',
          '周晴', true, 3, '周晴'
        ),
        vector: { [deviceId]: 3 }
      },
      lang(
        'ja', 'ja', '日本語', '台風「ハイエン」オレンジ警報',
        '浜海新区の住民は直ちに屋外活動を中止してください。本日午後、強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。',
        '佐藤 明', false, 1, '佐藤 明'
      )
    ],
    discussions: [
      {
        id: 'comment-1', languageId: 'zh-CN', sentenceIndex: 1, author: '陈冉', role: '法务审阅',
        text: '建议明确安置点地址由属地另行发送，避免通知被理解为完整点位清单。', createdAt: '2026-09-25T08:16:00+08:00', resolved: false
      }
    ],
    reviews: [
      { role: '编辑', owner: '林晓', status: 'approved', note: '事件要素完整。', updatedAt: '2026-09-25T08:20:00+08:00' },
      { role: '法务', owner: '陈冉', status: 'changes', note: '转移表述需补充依据。', updatedAt: '2026-09-25T08:30:00+08:00' },
      { role: '翻译', owner: '周晴', status: 'pending', note: '等待日文版复核。', updatedAt: '2026-09-25T08:31:00+08:00' },
      { role: '发布人', owner: '值班中心', status: 'pending', note: '', updatedAt: '' }
    ],
    versions: [first, second],
    status: 'in-review',
    version: '1.2.0-draft',
    emergencyRevision: false,
    updatedAt: new Date().toISOString(),
    deviceId,
    revision: 3,
    metaVector: { [deviceId]: 3 },
    pendingLanguageConflicts: []
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

  draft!: NoticeDraft;
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

  // 断网续作合并相关状态
  deviceId = '';
  editorName = '本机编辑';
  importText = '';
  saveError = '';
  lastMergeReport: MergeReport | null = null;
  private fileInput: HTMLInputElement | null = null;

  // 发布检查与版本差异缓存：裁定、复核或任何修改后立即作废重算
  private cacheEpoch = 0;
  private cachedChecks: CheckResult[] | null = null;
  private cachedChecksEpoch = -1;
  private cachedDiff: DiffRow[] = [];
  private cachedDiffKey = '';

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    this.deviceId = this.resolveDeviceId();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as unknown;
        this.draft = migrateDraft(parsed, () => initialDraft(this.deviceId), this.deviceId);
        if (!this.draft.deviceId) this.draft.deviceId = this.deviceId;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        this.draft = initialDraft(this.deviceId);
      }
    } else {
      this.draft = initialDraft(this.deviceId);
      this.persist();
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
      if (!this.saveError) this.toastr.success('草稿已保存在当前浏览器。', '保存成功');
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

  get activeDiscussions() {
    return this.draft.discussions.filter((discussion) => discussion.languageId === this.selectedLanguageId);
  }

  // 发布检查结果带缓存：epoch 变化后下次访问立即重算
  get checks(): CheckResult[] {
    if (this.cachedChecks && this.cachedChecksEpoch === this.cacheEpoch) return this.cachedChecks;
    this.cachedChecks = this.computeChecks();
    this.cachedChecksEpoch = this.cacheEpoch;
    return this.cachedChecks;
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

  get pendingConflicts(): PendingLanguageConflict[] {
    return this.draft.pendingLanguageConflicts ?? [];
  }

  get hasPendingConflicts(): boolean {
    return this.pendingConflicts.length > 0;
  }

  get deviceIdShort(): string {
    return this.deviceId.slice(-8);
  }

  get draftRevision(): number {
    return this.draft.revision;
  }

  isSentenceDiscussed(index: number): boolean {
    return this.activeDiscussions.some((discussion) => discussion.sentenceIndex === index && !discussion.resolved);
  }

  conflictFor(languageId: string): PendingLanguageConflict | undefined {
    return this.pendingConflicts.find((conflict) => conflict.id === languageId);
  }

  conflictRows(conflict: PendingLanguageConflict): DiffRow[] {
    return this.diffSentences(
      this.splitSentences(conflict.local.body),
      this.splitSentences(conflict.remote.body)
    );
  }

  isLanguageReadOnly(languageId: string): boolean {
    return this.isLocked || this.conflictFor(languageId) !== undefined;
  }

  get nextVersion(): string {
    const numbers = this.draft.version.match(/\d+/g)?.map(Number) ?? [1, 2, 0];
    return `${numbers[0] || 1}.${(numbers[1] || 0) + 1}.0`;
  }

  // 版本差异同样按 epoch 缓存，裁定或复核变化后立即失效
  get versionDiff(): DiffRow[] {
    const key = `${this.cacheEpoch}|${this.compareBaseId}|${this.compareTargetId}|${this.selectedLanguageId}`;
    if (key === this.cachedDiffKey) return this.cachedDiff;
    const base = this.draft.versions.find((version) => version.id === this.compareBaseId);
    const target = this.draft.versions.find((version) => version.id === this.compareTargetId);
    if (!base || !target) {
      this.cachedDiff = [];
      this.cachedDiffKey = key;
      return this.cachedDiff;
    }
    const baseLanguage = base.languages.find((language) => language.id === this.selectedLanguageId);
    const targetLanguage = target.languages.find((language) => language.id === this.selectedLanguageId);
    this.cachedDiff = this.diffSentences(this.splitSentences(baseLanguage?.body ?? ''), this.splitSentences(targetLanguage?.body ?? ''));
    this.cachedDiffKey = key;
    return this.cachedDiff;
  }

  updateMeta(field: 'title' | 'eventType' | 'severity' | 'scope' | 'eventAt' | 'effectiveAt' | 'expiresAt', value: string): void {
    this.commit((draft) => {
      (draft as unknown as Record<string, unknown>)[field] = value;
      draft.status = draft.status === 'locked' ? 'draft' : draft.status;
      this.tickMeta(draft);
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
      this.tickMeta(draft);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
      this.tickMeta(draft);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    if (this.conflictFor(this.selectedLanguageId)) return; // 裁定前不改当前正文
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) {
        language[field] = value;
        this.tickLanguage(language, draft.deviceId);
      }
    });
  }

  setLanguageReviewed(checked: boolean): void {
    if (this.conflictFor(this.selectedLanguageId)) return; // 待裁定语言在裁定前保持冻结
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) {
        language.reviewed = checked;
        this.tickLanguage(language, draft.deviceId);
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
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) {
        review.status = status;
        review.updatedAt = new Date().toISOString();
      }
    });
  }

  setReviewNote(role: RoleReview['role'], note: string): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) {
        review.note = note;
        review.updatedAt = new Date().toISOString();
      }
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
        language.title = template.title[language.id] ?? language.title;
        language.body = template.body[language.id] ?? language.body;
        language.reviewed = false;
        this.tickLanguage(language, draft.deviceId);
      });
      this.tickMeta(draft);
    });
    this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  lockVersion(): void {
    if (this.hasPendingConflicts) {
      this.toastr.warning(`${this.pendingConflicts.length} 个语言版本并列待裁定，裁定前不能生成锁定版本。`, '存在待裁定冲突');
      this.activeView = 'sync';
      return;
    }
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    const revision = this.draft.versions.reduce((max, version) => Math.max(max, version.revision), 0) + 1;
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: this.draft.languages.map(snapshotLanguageOf),
      note: '发布前检查通过并锁定。', emergency: false,
      revision, originDeviceId: this.draft.deviceId
    };
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
      this.tickMeta(draft);
    });
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.toastr.success(`版本 ${snapshot.version}（修订号 ${revision}）已锁定。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = `${major}.${minor + 1}.0-emergency`;
      draft.lockedAt = undefined;
      this.tickMeta(draft);
    });
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id === 'merge-conflicts') {
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

  // ===== 断网续作合并 =====

  triggerPickFile(): void {
    if (!this.fileInput) {
      this.fileInput = document.createElement('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = '.json,application/json';
      this.fileInput.addEventListener('change', () => this.onPackageFile(this.fileInput?.files));
    }
    this.fileInput.value = '';
    this.fileInput.click();
  }

  onPackageFile(files: FileList | null | undefined): void {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.importText = String(reader.result ?? '');
      this.toastr.info(`已读入“${file.name}”，确认后执行合并。`, '整包已装载');
    };
    reader.readAsText(file);
  }

  exportPackageFile(): void {
    const now = new Date().toISOString();
    const content = exportPackage(this.draft, this.draft.deviceId, now);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `notice-sync-${this.draft.id}-r${this.draft.revision}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.toastr.success('已导出本机续作整包，网络恢复后在另一端读入合并。', '导出整包');
  }

  applyImportPackage(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.importText);
    } catch {
      this.toastr.danger('整包不是合法 JSON，未做任何修改。', '合并失败');
      return;
    }
    if (!isSyncPackage(parsed)) {
      this.toastr.danger('缺少同步整包标识，已拒绝合并。', '合并失败');
      return;
    }
    if (parsed.deviceId === this.draft.deviceId) {
      this.toastr.info('该整包来自本机，无需合并；重复回连不会产生新版本。', '已忽略');
      return;
    }
    let remote: NoticeDraft;
    try {
      remote = migrateDraft(parsed.draft, () => {
        throw new Error('invalid remote draft');
      });
    } catch {
      this.toastr.danger('整包内草稿结构不完整，已拒绝合并。', '合并失败');
      return;
    }
    if (remote.id !== this.draft.id) {
      this.toastr.danger('整包属于另一条通知，不能并入当前草稿。', '合并失败');
      return;
    }

    const before = clone(this.draft);
    const report = mergeDrafts(before, remote, new Date().toISOString());
    // 写入失败回滚由 commit/persist 保证；这里先暂存到内存草稿（保留合并草稿）。
    this.history.push(before);
    if (this.history.length > 50) this.history.shift();
    this.draft = report.merged;
    this.future = [];
    this.invalidateCaches();
    this.persist();
    this.lastMergeReport = report;
    this.importText = '';

    if (this.saveError) {
      this.toastr.warning('合并完成但本地写入失败，已回滚存储；合并草稿保留在页面，可重试写入。', '写入失败');
    } else if (report.conflictLanguages.length) {
      this.toastr.warning(
        `${report.conflictLanguages.length} 个语言两边都改过，已并列待裁定；裁定前正文不变、不能锁定。`,
        '发现并列版本'
      );
    } else {
      this.toastr.success(
        `已并入 ${report.addedLanguages.length} 个新语言、${report.addedVersions} 个锁定版本。`,
        '合并完成'
      );
    }
  }

  /** 裁定并列语言版本：side=local 保留本机正文，side=remote 采用对端正文。裁定后正文才会改变。 */
  adjudicate(conflictId: string, side: 'local' | 'remote'): void {
    this.commit((draft) => {
      const index = draft.pendingLanguageConflicts.findIndex((item) => item.id === conflictId);
      if (index < 0) return;
      const conflict = draft.pendingLanguageConflicts[index];
      const chosen = side === 'local' ? conflict.local : conflict.remote;
      const language = draft.languages.find((item) => item.id === conflict.id);
      if (language) {
        const mergedVector: VersionVector = { ...conflict.local.vector };
        for (const [key, value] of Object.entries(conflict.remote.vector)) {
          mergedVector[key] = Math.max(mergedVector[key] ?? 0, value);
        }
        language.title = chosen.title;
        language.body = chosen.body;
        language.translator = chosen.translator;
        language.reviewed = chosen.reviewed;
        language.revision = Math.max(conflict.local.revision, conflict.remote.revision) + 1;
        language.vector = { ...mergedVector, [draft.deviceId]: (mergedVector[draft.deviceId] ?? 0) + 1 };
        language.updatedAt = new Date().toISOString();
        language.updatedBy = this.editorName;
      }
      draft.pendingLanguageConflicts.splice(index, 1);
      this.tickMeta(draft);
    });
    this.toastr.success(side === 'local' ? '已保留本机版本作为裁定结果。' : '已采用对端版本作为裁定结果。', '裁定完成');
  }

  retryPersist(): void {
    this.persist();
    if (!this.saveError) this.toastr.success('合并草稿已补写到本地。', '重试成功');
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    this.future.push(clone(this.draft));
    this.draft = previous;
    this.invalidateCaches();
    this.persist();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    this.history.push(clone(this.draft));
    this.draft = next;
    this.invalidateCaches();
    this.persist();
  }

  saveNow(): void {
    this.persist();
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

  private computeChecks(): CheckResult[] {
    const checks: CheckResult[] = [];
    const requiredMeta: Array<[string, string]> = [
      ['标题', this.draft.title], ['事件类型', this.draft.eventType], ['严重程度', this.draft.severity],
      ['影响范围', this.draft.scope], ['事件时间', this.draft.eventAt], ['生效时间', this.draft.effectiveAt],
      ['失效时间', this.draft.expiresAt]
    ];
    requiredMeta.filter(([, value]) => !value).forEach(([label]) => checks.push({
      id: `meta-${label}`, category: '必填信息', level: 'error', title: `缺少${label}`,
      detail: `请补全通知的${label}后再提交发布。`
    }));
    if (!this.draft.channels.length) checks.push({
      id: 'channels', category: '发布渠道', level: 'error', title: '未选择目标渠道', detail: '至少选择一个目标发布渠道。'
    });

    if (this.hasPendingConflicts) checks.push({
      id: 'merge-conflicts', category: '版本合并', level: 'error',
      title: `${this.pendingConflicts.length} 个语言版本待裁定`,
      detail: '同一语言在两台设备上都被修改，并列版本裁定前当前正文保持不变，也不能生成锁定版本。'
    });

    this.draft.requiredLocales.forEach((locale) => {
      if (!this.draft.languages.some((language) => language.id === locale)) {
        const name = this.locales.find((item) => item.id === locale)?.name ?? locale;
        checks.push({
          id: `missing-${locale}`, category: '语言完整性', level: 'error', title: `${name}版本缺失`,
          detail: '该语言属于本次发布的必需语言，请添加并完成翻译。'
        });
      }
    });

    this.draft.languages.forEach((language) => {
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

    const eventAt = this.toTime(this.draft.eventAt);
    const effectiveAt = this.toTime(this.draft.effectiveAt);
    const expiresAt = this.toTime(this.draft.expiresAt);
    if (eventAt && effectiveAt && effectiveAt < eventAt) checks.push({
      id: 'time-effective', category: '时间冲突', level: 'warning', title: '生效时间早于事件时间',
      detail: '请确认这是预防性通知；否则调整事件时间或生效时间。'
    });
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) checks.push({
      id: 'time-expires', category: '时间冲突', level: 'error', title: '失效时间早于生效时间',
      detail: '通知有效期必须晚于生效时间。'
    });
    const unresolved = this.draft.discussions.filter((discussion) => !discussion.resolved).length;
    if (unresolved) checks.push({
      id: 'discussions', category: '逐句讨论', level: 'warning', title: `${unresolved} 条讨论尚未解决`,
      detail: '发布前请处理或明确忽略未解决讨论。'
    });
    return checks;
  }

  private tickMeta(draft: NoticeDraft): void {
    draft.metaVector = tickVector(draft.metaVector, draft.deviceId);
    draft.revision = Math.max(draft.revision, ...draft.versions.map((version) => version.revision)) + 1;
  }

  private tickLanguage(language: LanguageVersion, deviceId: string): void {
    language.revision += 1;
    language.vector = tickVector(language.vector, deviceId);
    language.updatedAt = new Date().toISOString();
    language.updatedBy = this.editorName;
  }

  private invalidateCaches(): void {
    // 裁定、复核变化、合并或撤销重做后，发布检查结果与版本差异立即失效
    this.cacheEpoch += 1;
  }

  private commit(mutator: (draft: NoticeDraft) => void): void {
    this.history.push(clone(this.draft));
    if (this.history.length > 50) this.history.shift();
    const next = clone(this.draft);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.draft = next;
    this.future = [];
    this.invalidateCaches();
    this.persist();
  }

  private persist(): void {
    const payload = JSON.stringify({ ...this.draft, updatedAt: new Date().toISOString() });
    const previous = localStorage.getItem(STORAGE_KEY);
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      // 写入成功：内存中的合并草稿即权威版本，清除失败状态
      this.saveError = '';
      this.lastSavedAt = this.formatDateTime(new Date().toISOString());
    } catch {
      // 写入失败：回滚 localStorage 到写入前内容；内存中的（合并）草稿保留
      try {
        if (previous === null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, previous);
      } catch {
        // 回滚也失败时保持原状，等待用户重试
      }
      this.saveError = '本地写入失败，已回滚存储；合并草稿保留在页面中，可点“重试写入”。';
      this.lastSavedAt = '写入失败（存储已回滚）';
    }
  }

  private resolveDeviceId(): string {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known) return known;
    const created = createDeviceId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
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
