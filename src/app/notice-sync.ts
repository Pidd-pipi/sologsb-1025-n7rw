import {
  LanguageVersion,
  NoticeDraft,
  PendingLanguageConflict,
  RoleReview,
  SyncPackage,
  VersionSnapshot,
  VersionVector
} from './notice.model';

// 断网续作合并：通知草稿、语言版本、锁定版本按修订号与版本向量做续作合并。
// - 不同语言：直接并入；
// - 同一语言：构成因果则取较新，双方都改过（向量并发）则并列待裁定，裁定前当前正文不变；
// - 锁定版本：按 revision 去重，重复回连不会多出语言版本或锁定版本；
// - 待裁定未决时不允许生成锁定版本（由界面层据此门禁）。

const PACKAGE_KIND = 'emergency-notice-sync-v1';

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDeviceId(): string {
  return uid('device');
}

/** a 是否严格先于 b（a 因果在 b 之前）。 */
export function vectorBefore(a: VersionVector, b: VersionVector): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let strictlyLess = false;
  for (const key of keys) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (av > bv) return false;
    if (av < bv) strictlyLess = true;
  }
  return strictlyLess;
}

/** 两向量是否并发（互不构成因果）。 */
export function vectorConcurrent(a: VersionVector, b: VersionVector): boolean {
  return !vectorBefore(a, b) && !vectorBefore(b, a) && !vectorEqual(a, b);
}

export function vectorEqual(a: VersionVector, b: VersionVector): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

/** 合并向量取各设备分量的最大值。 */
export function mergeVectors(...vectors: VersionVector[]): VersionVector {
  const merged: VersionVector = {};
  for (const vector of vectors) {
    for (const [key, value] of Object.entries(vector)) {
      merged[key] = Math.max(merged[key] ?? 0, value);
    }
  }
  return merged;
}

/** 以 parent 为因果基底打一个新点：保留基底中所有其它设备的分量，仅把本设备分量加一。 */
export function tickVector(parent: VersionVector, deviceId: string): VersionVector {
  return { ...mergeVectors(parent), [deviceId]: (parent[deviceId] ?? 0) + 1 };
}

export interface MergeReport {
  merged: NoticeDraft;
  addedLanguages: string[];
  conflictLanguages: string[];
  addedVersions: number;
  skippedDuplicateVersions: number;
  metaUpdatedFromRemote: boolean;
  remoteDeviceId: string;
}

/** 内容层面完全一致：正文、标题、译者、复核状态都未分叉。 */
function sameLanguageContent(a: LanguageVersion, b: LanguageVersion): boolean {
  return a.title === b.title && a.body === b.body && a.translator === b.translator && a.reviewed === b.reviewed;
}

function mergeLanguageLists(
  localList: LanguageVersion[],
  remoteList: LanguageVersion[],
  existingConflicts: PendingLanguageConflict[],
  remoteDeviceId: string,
  localDeviceId: string,
  detectedAt: string
): { languages: LanguageVersion[]; conflicts: PendingLanguageConflict[]; added: string[]; conflictIds: string[] } {
  const languages: LanguageVersion[] = [];
  const conflicts = [...existingConflicts];
  const resolvedConflictIds = new Set<string>();
  const added: string[] = [];
  const conflictIds: string[] = [];
  const remoteById = new Map(remoteList.map((language) => [language.id, language]));
  const seen = new Set<string>();

  for (const local of localList) {
    seen.add(local.id);
    const remote = remoteById.get(local.id);
    if (!remote) {
      languages.push(local);
      continue;
    }
    if (vectorBefore(remote.vector, local.vector) || vectorEqual(remote.vector, local.vector)) {
      // 本机较新或双方一致，保留本机；向量吸收远端分量。
      languages.push({ ...local, vector: mergeVectors(local.vector, remote.vector) });
      resolvedConflictIds.add(local.id);
    } else if (vectorBefore(local.vector, remote.vector)) {
      // 远端在因果上已包含本机版本（对端已完成并入/裁定）：采用远端，旧冲突随之消解。
      languages.push({ ...remote, vector: mergeVectors(local.vector, remote.vector) });
      resolvedConflictIds.add(local.id);
    } else if (sameLanguageContent(local, remote)) {
      // 向量并发但内容一致（常见于同一初始稿分发到两台设备各自打了等价标记）：
      // 合流向量即可，不算“两边都改过内容”，也不能让任何一侧静默覆盖。
      languages.push({ ...local, vector: mergeVectors(local.vector, remote.vector) });
      resolvedConflictIds.add(local.id);
    } else {
      // 并发：同一语言两边都改过——并列待裁定。
      // 关键：裁定前当前正文必须保持本机版本，哪怕对端修订号更大也不静默替换。
      languages.push({ ...local, vector: mergeVectors(local.vector, remote.vector) });
      const knownIndex = conflicts.findIndex((item) => item.id === local.id);
      const entry: PendingLanguageConflict = {
        id: local.id,
        locale: local.locale,
        name: local.name,
        local: knownIndex >= 0 ? conflicts[knownIndex].local : local,
        remote,
        localDeviceId: knownIndex >= 0 ? conflicts[knownIndex].localDeviceId : localDeviceId,
        remoteDeviceId,
        detectedAt: knownIndex >= 0 ? conflicts[knownIndex].detectedAt : detectedAt
      };
      if (knownIndex >= 0) conflicts[knownIndex] = entry;
      else conflicts.push(entry);
      conflictIds.push(local.id);
    }
  }

  // 远端独有语言直接并入（按 locale 去重，重复回连不多出语言版本）。
  const existingLocales = new Set(languages.map((language) => language.locale));
  for (const remote of remoteList) {
    if (seen.has(remote.id)) continue;
    if (existingLocales.has(remote.locale)) continue;
    languages.push(remote);
    added.push(remote.name);
  }
  // 已具备明确因果先后或内容一致的旧待裁定条目，应随本次合并消解。
  const liveLanguageIds = new Set(languages.map((language) => language.id));
  const remainingConflicts = conflicts.filter(
    (conflict) => !resolvedConflictIds.has(conflict.id) && liveLanguageIds.has(conflict.id)
  );
  return { languages, conflicts: remainingConflicts, added, conflictIds };
}

function mergeVersions(local: VersionSnapshot[], remote: VersionSnapshot[]): { versions: VersionSnapshot[]; added: number; skipped: number } {
  const byRevision = new Map<number, VersionSnapshot>();
  for (const version of local) byRevision.set(version.revision, version);
  let added = 0;
  let skipped = 0;
  for (const remoteVersion of remote) {
    const known = byRevision.get(remoteVersion.revision);
    if (known) {
      // 同一修订号视为同一锁定版本；保留信息更完整的一份，绝不重复新增。
      skipped++;
      if (!known.originDeviceId && remoteVersion.originDeviceId) {
        byRevision.set(remoteVersion.revision, { ...remoteVersion, id: known.id });
      }
      continue;
    }
    byRevision.set(remoteVersion.revision, remoteVersion);
    added++;
  }
  const versions = [...byRevision.values()].sort((a, b) => a.revision - b.revision);
  return { versions, added, skipped };
}

function mergeReviews(local: RoleReview[], remote: RoleReview[]): RoleReview[] {
  const byRole = new Map(local.map((review) => [review.role, review]));
  for (const remoteReview of remote) {
    const known = byRole.get(remoteReview.role);
    if (!known || (remoteReview.updatedAt ?? '') > (known.updatedAt ?? '')) {
      byRole.set(remoteReview.role, remoteReview);
    }
  }
  return local.map((review) => byRole.get(review.role) ?? review);
}

/** 元数据“晚到整包不能覆盖”：仅在远端因果更新时才采用远端值。 */
function mergeMeta(local: NoticeDraft, remote: NoticeDraft): { metaUpdatedFromRemote: boolean; metaVector: VersionVector } {
  let metaUpdatedFromRemote = false;
  const metaVector = mergeVectors(local.metaVector, remote.metaVector);
  if (vectorBefore(local.metaVector, remote.metaVector)) {
    const fields: Array<keyof NoticeDraft> = [
      'title', 'eventType', 'severity', 'scope', 'channels',
      'eventAt', 'effectiveAt', 'expiresAt', 'requiredLocales',
      'status', 'version', 'lockedAt', 'emergencyRevision'
    ];
    for (const field of fields) {
      (local as unknown as Record<string, unknown>)[field as string] =
        (remote as unknown as Record<string, unknown>)[field as string];
    }
    metaUpdatedFromRemote = true;
  } else if (vectorConcurrent(local.metaVector, remote.metaVector)) {
    // 元数据并发修改：以集合合并渠道与必需语言，标量保留本机，避免晚到整包静默覆盖。
    local.channels = [...new Set([...local.channels, ...remote.channels])];
    local.requiredLocales = [...new Set([...local.requiredLocales, ...remote.requiredLocales])];
    if (remote.status === 'locked' && local.status !== 'locked') {
      local.status = 'locked';
      local.lockedAt = remote.lockedAt ?? local.lockedAt;
    }
  }
  return { metaUpdatedFromRemote, metaVector };
}

/**
 * 把远端整包续作合并进本机草稿，返回合并报告。纯函数，不修改入参。
 */
export function mergeDrafts(localDraft: NoticeDraft, remoteDraft: NoticeDraft, now: string): MergeReport {
  if (localDraft.id !== remoteDraft.id) {
    throw new Error('两份草稿不属于同一通知，无法合并。');
  }
  const local: NoticeDraft = JSON.parse(JSON.stringify(localDraft)) as NoticeDraft;
  const remote: NoticeDraft = JSON.parse(JSON.stringify(remoteDraft)) as NoticeDraft;
  const remoteDeviceId = remote.deviceId;

  const { metaUpdatedFromRemote, metaVector } = mergeMeta(local, remote);
  const { languages, conflicts, added, conflictIds } = mergeLanguageLists(
    local.languages, remote.languages, local.pendingLanguageConflicts ?? [], remoteDeviceId, local.deviceId, now
  );
  const { versions, added: addedVersions, skipped } = mergeVersions(local.versions, remote.versions);

  local.languages = languages;
  local.versions = versions;
  local.reviews = mergeReviews(local.reviews ?? [], remote.reviews ?? []);
  local.discussions = mergeDiscussions(local.discussions ?? [], remote.discussions ?? []);
  local.pendingLanguageConflicts = conflicts;
  local.metaVector = metaVector;
  // 整包修订号取因果合并后的最大值；重复回连、已并入内容不会再抬升。
  local.revision = Math.max(local.revision ?? 0, remote.revision ?? 0);
  // 有待裁定冲突时不能停留在锁定态，也不允许新增锁定版本。
  if (conflicts.length && local.status === 'locked') local.status = 'in-review';
  local.updatedAt = now;

  return {
    merged: local,
    addedLanguages: added,
    conflictLanguages: conflictIds,
    addedVersions,
    skippedDuplicateVersions: skipped,
    metaUpdatedFromRemote,
    remoteDeviceId
  };
}

function mergeDiscussions<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const byId = new Map(local.map((item) => [item.id, item]));
  for (const item of remote) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** 导出本机续作整包（用于离线交换：文件、U 盘或模拟上行）。 */
export function exportPackage(draft: NoticeDraft, deviceId: string, now: string): string {
  const syncPackage: SyncPackage = {
    kind: PACKAGE_KIND,
    deviceId,
    exportedAt: now,
    draft: JSON.parse(JSON.stringify(draft)) as NoticeDraft
  };
  return JSON.stringify(syncPackage, null, 2);
}

export function isSyncPackage(value: unknown): value is SyncPackage {
  return typeof value === 'object' && value !== null && (value as SyncPackage).kind === PACKAGE_KIND
    && typeof (value as SyncPackage).deviceId === 'string'
    && typeof (value as SyncPackage).draft === 'object' && (value as SyncPackage).draft !== null;
}
