import {
  LanguageVersion,
  NoticeDraft,
  RoleReview,
  VersionSnapshot,
  VersionVector
} from './notice.model';
import { createDeviceId, uid } from './notice-sync';

// 旧数据迁移：为草稿、语言版本、锁定版本补齐修订号与版本向量。
// 幂等：重复执行不会重复抬修订号，重复回连也不会多出语言版本。

type LegacyLanguage = Partial<LanguageVersion> & { id: string };
type LegacySnapshot = Partial<VersionSnapshot> & { id: string; languages: LegacyLanguage[] };
type LegacyDraft = Partial<NoticeDraft> & {
  id?: string;
  languages?: LegacyLanguage[];
  versions?: LegacySnapshot[];
  reviews?: RoleReview[];
};

export function looksLikeDraft(value: unknown): value is NoticeDraft {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as LegacyDraft;
  return !!candidate.id && Array.isArray(candidate.languages) && Array.isArray(candidate.versions);
}

export function migrateDraft(raw: unknown, fallback: () => NoticeDraft, currentDeviceId?: string): NoticeDraft {
  if (!looksLikeDraft(raw)) return fallback();
  const legacy = raw as LegacyDraft;
  // 已带设备 ID 的（如对端整包）沿用其来源设备；旧数据补写时使用本机稳定 ID，保证跨刷新一致。
  const deviceId = legacy.deviceId ?? currentDeviceId ?? createDeviceId();

  // 锁定版本按时间线顺序补齐修订号（旧数据没有 revision 字段）。
  const versions: VersionSnapshot[] = (legacy.versions ?? []).map((snapshot, index) => ({
    id: snapshot.id,
    label: snapshot.label ?? '历史版本',
    createdAt: snapshot.createdAt ?? '',
    version: snapshot.version ?? `1.${index}.0`,
    title: snapshot.title ?? '',
    severity: snapshot.severity ?? '',
    scope: snapshot.scope ?? '',
    eventAt: snapshot.eventAt ?? '',
    effectiveAt: snapshot.effectiveAt ?? '',
    expiresAt: snapshot.expiresAt ?? '',
    channels: snapshot.channels ?? [],
    languages: (snapshot.languages ?? []).map((language) => ({
      id: language.id,
      locale: language.locale ?? language.id,
      name: language.name ?? language.id,
      title: language.title ?? '',
      body: language.body ?? '',
      translator: language.translator ?? '',
      reviewed: language.reviewed ?? false
    })),
    note: snapshot.note ?? '',
    emergency: snapshot.emergency ?? false,
    revision: typeof snapshot.revision === 'number' ? snapshot.revision : index + 1,
    originDeviceId: snapshot.originDeviceId
  }));

  // 语言版本：已有修订号保留；缺失的统一补为 1，并播种只含本设备分量的因果向量。
  const languages: LanguageVersion[] = (legacy.languages ?? []).map((language) => {
    const revision = typeof language.revision === 'number' ? language.revision : 1;
    const vector: VersionVector = language.vector
      ? { ...language.vector }
      : { [deviceId]: revision };
    return {
      id: language.id,
      locale: language.locale ?? language.id,
      name: language.name ?? language.id,
      title: language.title ?? '',
      body: language.body ?? '',
      translator: language.translator ?? '',
      reviewed: language.reviewed ?? false,
      revision,
      vector,
      updatedAt: language.updatedAt ?? '',
      updatedBy: language.updatedBy ?? ''
    };
  });

  const reviews: RoleReview[] = (legacy.reviews ?? []).map((review) => ({
    ...review,
    updatedAt: review.updatedAt ?? ''
  }));

  // 草稿整体修订号：至少不低于任一锁定版本与语言版本，保证后续续作在其之后。
  const seededRevision = Math.max(
    versions.length,
    ...languages.map((language) => language.revision),
    1
  );
  const metaVector: VersionVector = legacy.metaVector
    ? { ...legacy.metaVector }
    : { [deviceId]: seededRevision };

  return {
    id: legacy.id as string,
    title: legacy.title ?? '',
    eventType: legacy.eventType ?? '',
    severity: legacy.severity ?? '',
    scope: legacy.scope ?? '',
    channels: legacy.channels ?? [],
    eventAt: legacy.eventAt ?? '',
    effectiveAt: legacy.effectiveAt ?? '',
    expiresAt: legacy.expiresAt ?? '',
    requiredLocales: legacy.requiredLocales ?? ['zh-CN'],
    languages,
    discussions: legacy.discussions ?? [],
    reviews,
    versions,
    status: legacy.status ?? 'draft',
    version: legacy.version ?? '1.0.0-draft',
    lockedAt: legacy.lockedAt,
    emergencyRevision: legacy.emergencyRevision ?? false,
    updatedAt: legacy.updatedAt ?? new Date().toISOString(),
    deviceId,
    revision: typeof legacy.revision === 'number' ? legacy.revision : seededRevision,
    metaVector,
    pendingLanguageConflicts: Array.isArray(legacy.pendingLanguageConflicts) ? legacy.pendingLanguageConflicts : []
  };
}

/** 生成新语言版本时使用的初始修订信息。 */
export function seedLanguageRevision(
  language: Omit<LanguageVersion, 'revision' | 'vector' | 'updatedAt' | 'updatedBy'>,
  deviceId: string,
  now: string,
  editor: string
): LanguageVersion {
  return {
    ...language,
    revision: 1,
    vector: { [deviceId]: 1 },
    updatedAt: now,
    updatedBy: editor
  };
}

export function newDiscussionId(): string {
  return uid('discussion');
}
