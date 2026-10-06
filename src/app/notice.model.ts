// 通知草稿相关数据模型。
// 修订号（revision）为单机单调递增的序号；版本向量（vector）用于多设备续作合并时判定因果关系。

export type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions' | 'sync';
export type ReviewStatus = 'pending' | 'approved' | 'changes';
export type NoticeStatus = 'draft' | 'in-review' | 'locked';
export type CheckLevel = 'error' | 'warning' | 'info';

/** 版本向量：deviceId -> 该设备已发生的修改计数。 */
export type VersionVector = Record<string, number>;

export interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
  /** 语言版本修订号，每次本机修改该语言递增。 */
  revision: number;
  /** 该语言版本的因果向量。 */
  vector: VersionVector;
  updatedAt: string;
  updatedBy: string;
}

/** 锁定快照中的语言内容是不可变副本，不携带同步修订信息。 */
export interface SnapshotLanguage {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
}

export interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
  updatedAt: string;
}

export interface VersionSnapshot {
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
  languages: SnapshotLanguage[];
  note: string;
  emergency: boolean;
  /** 锁定版本修订号（旧数据迁移时补齐）。 */
  revision: number;
  originDeviceId?: string;
}

/** 同一语言在两台设备上都被修改后的并列待裁定条目。裁定前当前正文保持不变。 */
export interface PendingLanguageConflict {
  id: string;
  locale: string;
  name: string;
  local: LanguageVersion;
  remote: LanguageVersion;
  localDeviceId: string;
  remoteDeviceId: string;
  detectedAt: string;
}

export interface NoticeDraft {
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
  updatedAt: string;
  /** 本机设备 ID。 */
  deviceId: string;
  /** 草稿整体修订号。 */
  revision: number;
  /** 草稿元数据的因果向量。 */
  metaVector: VersionVector;
  /** 待裁定的并列语言版本，同一语言至多一条。 */
  pendingLanguageConflicts: PendingLanguageConflict[];
}

export interface SyncPackage {
  kind: 'emergency-notice-sync-v1';
  deviceId: string;
  exportedAt: string;
  draft: NoticeDraft;
}

export interface CheckResult {
  id: string;
  category: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

export interface DiffRow {
  left: string;
  right: string;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

export interface NoticeTemplate {
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
