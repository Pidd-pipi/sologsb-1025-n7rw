// 断网续作合并语义验证脚本（直连 notice-sync / notice-migrate 真实模块）
import assert from 'node:assert';
import { mergeDrafts, exportPackage, isSyncPackage, tickVector, createDeviceId } from '../src/app/notice-sync';
import { migrateDraft } from '../src/app/notice-migrate';
import type { LanguageVersion, NoticeDraft } from '../src/app/notice.model';

let passed = 0;
const ok = (name: string, cond: boolean) => { assert.ok(cond, name); console.log('PASS', name); passed++; };

const now = () => new Date().toISOString();
const deviceA = 'device-AAAA';
const deviceB = 'device-BBBB';

function makeDraft(deviceId: string, rev = 1): NoticeDraft {
  const language = (id: string, locale: string, name: string, body: string, revision = 1, vector?: Record<string, number>): LanguageVersion => ({
    id, locale, name, title: name + '标题', body, translator: '译者', reviewed: true,
    revision, vector: vector ?? { [deviceId]: revision }, updatedAt: now(), updatedBy: '编辑'
  });
  return {
    id: 'notice-x', title: 'T', eventType: '台风', severity: '橙色', scope: 'S',
    channels: ['短信'], eventAt: '', effectiveAt: '', expiresAt: '',
    requiredLocales: ['zh-CN'],
    languages: [language('zh-CN', 'zh-CN', '简体中文', '共同初始正文。', 1)],
    discussions: [],
    reviews: [
      { role: '编辑', owner: 'a', status: 'pending', note: '', updatedAt: '' },
      { role: '法务', owner: 'b', status: 'pending', note: '', updatedAt: '' },
      { role: '翻译', owner: 'c', status: 'pending', note: '', updatedAt: '' },
      { role: '发布人', owner: 'd', status: 'pending', note: '', updatedAt: '' }
    ],
    versions: [
      {
        id: 'v1', label: 'v1', createdAt: now(), version: '1.0.0', title: 'T', severity: '橙色', scope: 'S',
        eventAt: '', effectiveAt: '', expiresAt: '', channels: ['短信'],
        languages: [{ id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: 't', body: 'x', translator: '', reviewed: true }],
        note: '', emergency: false, revision: 1, originDeviceId: deviceId
      }
    ],
    status: 'draft', version: '1.0.0-draft', emergencyRevision: false,
    updatedAt: now(), deviceId, revision: rev, metaVector: { [deviceId]: rev }, pendingLanguageConflicts: []
  };
}

function editLanguage(draft: NoticeDraft, id: string, body: string, reviewed = true): void {
  const l = draft.languages.find((x) => x.id === id)!;
  l.body = body;
  l.title = body.slice(0, 4);
  l.revision += 1;
  l.vector = tickVector(l.vector, draft.deviceId);
  l.updatedAt = now();
  l.reviewed = reviewed;
}

/** 模拟整包分发：对端拿到与本机完全相同的内容与因果向量，仅切换设备身份。 */
function distribute(from: NoticeDraft, toDeviceId: string): NoticeDraft {
  const copy = JSON.parse(JSON.stringify(from)) as NoticeDraft;
  copy.deviceId = toDeviceId;
  return copy;
}

// 场景 1：不同语言直接并入
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB); // B 持有共同初始稿（同内容同向量）
  b.languages.push({
    id: 'en', locale: 'en', name: 'English', title: 'EN', body: 'Only remote has English.',
    translator: 'b', reviewed: false, revision: 1, vector: { [deviceB]: 1 }, updatedAt: now(), updatedBy: 'b'
  });
  const r = mergeDrafts(a, b, now());
  ok('场景1 并入远端独有语言', r.merged.languages.some((l) => l.id === 'en'));
  ok('场景1 本机语言仍在', r.merged.languages.some((l) => l.id === 'zh-CN'));
  ok('场景1 addedLanguages 标记 English', r.addedLanguages.includes('English'));
  ok('场景1 无冲突', r.merged.pendingLanguageConflicts.length === 0);
}

// 场景 2：同一语言单边修改——晚到整包不能覆盖另一端的新版本
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB); // B 仍停留在共同初始稿
  editLanguage(a, 'zh-CN', 'A 端更新的正文。'); // A 先继续改出 A:2
  // B 的整包晚到，但其 zh 是旧内容
  const r = mergeDrafts(a, b, now());
  const zh = r.merged.languages.find((l) => l.id === 'zh-CN')!;
  ok('场景2 晚到旧整包不覆盖 A 的新正文', zh.body === 'A 端更新的正文。');
  ok('场景2 无并列冲突', r.merged.pendingLanguageConflicts.length === 0);
}

// 场景 3：同一语言两边都改过——并列待裁定，裁定前当前正文不变
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  editLanguage(a, 'zh-CN', 'A 端改写正文。'); // A:2
  editLanguage(b, 'zh-CN', 'B 端改写正文。'); // {A:1,B:1}，与 A:2 并发
  const r = mergeDrafts(a, b, now());
  ok('场景3 产生 1 条待裁定', r.merged.pendingLanguageConflicts.length === 1);
  const zh = r.merged.languages.find((l) => l.id === 'zh-CN')!;
  ok('场景3 裁定前当前正文保持本机版本', zh.body === 'A 端改写正文。');
  ok('场景3 冲突两侧内容正确', r.merged.pendingLanguageConflicts[0].remote.body === 'B 端改写正文。');

  // 模拟裁定：选择 remote（复刻组件 adjudicate 逻辑）
  const c = r.merged.pendingLanguageConflicts[0];
  const mergedVec = { ...c.local.vector };
  for (const [k, v] of Object.entries(c.remote.vector)) mergedVec[k] = Math.max(mergedVec[k] ?? 0, v);
  zh.body = c.remote.body; zh.title = c.remote.title;
  zh.revision = Math.max(c.local.revision, c.remote.revision) + 1;
  zh.vector = { ...mergedVec, [deviceA]: (mergedVec[deviceA] ?? 0) + 1 };
  r.merged.pendingLanguageConflicts = [];

  // 裁定后 B 再回连不会重新报同一冲突（A 的向量已因果包含 B:2）
  const r2 = mergeDrafts(r.merged, b, now());
  ok('场景3 裁定后重复回连不重生冲突', r2.merged.pendingLanguageConflicts.length === 0);
  const zh2 = r2.merged.languages.find((l) => l.id === 'zh-CN')!;
  ok('场景3 裁定结果不被旧整包覆盖', zh2.body === 'B 端改写正文。');
}

// 场景 3b：即使对端修订号更大，裁定前当前正文也必须保持本机版本
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  editLanguage(b, 'zh-CN', 'B 端连续三次改写之一。');
  editLanguage(b, 'zh-CN', 'B 端连续三次改写之二。');
  editLanguage(b, 'zh-CN', 'B 端高修订号正文。'); // B: 更高 revision，向量仍与 A:2 并发
  editLanguage(a, 'zh-CN', 'A 端改写正文。');
  const r = mergeDrafts(a, b, now());
  const zh = r.merged.languages.find((l) => l.id === 'zh-CN')!;
  ok('场景3b 待裁定保留本机正文，不被高修订号对端替换', zh.body === 'A 端改写正文。');
  ok('场景3b 对端版本完整保留在待裁定条目中', r.merged.pendingLanguageConflicts[0].remote.body === 'B 端高修订号正文。');
}

// 场景 3c：待裁定未决时对端又并入了本机旧版（变成因果关系），冲突自动消解
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  editLanguage(a, 'zh-CN', 'A 端改写正文。');
  editLanguage(b, 'zh-CN', 'B 端改写正文。');
  const r1 = mergeDrafts(a, b, now());
  ok('场景3c 先形成并列待裁定', r1.merged.pendingLanguageConflicts.length === 1);
  // B 收到 A 的整包并完成并入（其语言向量现在因果包含 A 的修改），随后 B 再回连
  const bMerged = distribute(r1.merged, deviceB);
  editLanguage(bMerged, 'zh-CN', 'B 并入 A 之后的最新正文。'); // {A:2,B:2}+B 新 tick，因果包含 A
  const r2 = mergeDrafts(r1.merged, bMerged, now());
  ok('场景3c 因果明确后旧待裁定自动消解', r2.merged.pendingLanguageConflicts.length === 0);
  const zh = r2.merged.languages.find((l) => l.id === 'zh-CN')!;
  ok('场景3c 采用因果最新正文', zh.body === 'B 并入 A 之后的最新正文。');
}

// 场景 4：锁定版本按修订号去重，重复回连不多出版本；语言不重复
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  // B 上新增一个锁定版本 revision 2
  b.versions.push({
    id: 'v2-b', label: 'locked-on-b', createdAt: now(), version: '2.0.0', title: 'T', severity: '橙色',
    scope: 'S', eventAt: '', effectiveAt: '', expiresAt: '', channels: ['短信'],
    languages: [], note: '', emergency: false, revision: 2, originDeviceId: deviceB
  });
  const first = mergeDrafts(a, b, now());
  ok('场景4 首次并入锁定版本', first.merged.versions.length === 2 && first.addedVersions === 1);
  const second = mergeDrafts(first.merged, b, now());
  ok('场景4 重复回连不多出锁定版本', second.merged.versions.length === 2);
  ok('场景4 重复锁定版本全部跳过且无新增', second.skippedDuplicateVersions === 2 && second.addedVersions === 0);
  const third = mergeDrafts(second.merged, b, now());
  ok('场景4 第三次回连仍稳定', third.merged.versions.length === 2);
  ok('场景4 语言版本不重复', new Set(third.merged.languages.map((l) => l.locale)).size === third.merged.languages.length);
}

// 场景 5：待裁定未决时锁定门禁由检查结果体现（数据层保证状态不被远端 locked 覆盖冲突态）
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  editLanguage(a, 'zh-CN', 'A 改写。');
  editLanguage(b, 'zh-CN', 'B 改写。');
  b.status = 'locked'; b.lockedAt = now();
  const r = mergeDrafts(a, b, now());
  ok('场景5 有冲突时不停留在 locked', r.merged.status !== 'locked');
  ok('场景5 仍保留 1 条待裁定', r.merged.pendingLanguageConflicts.length === 1);
}

// 场景 6：元数据晚到整包不覆盖另一端更新
{
  const a = makeDraft(deviceA, 1);
  const b = makeDraft(deviceB, 1);
  a.title = 'A 更新标题';
  a.metaVector = tickVector(a.metaVector, deviceA); // A:2
  b.title = 'B 的旧标题';
  // B 的 metaVector 仍 B:1（初始），与 A:2 并发初始场景：B 没见过 A
  const r = mergeDrafts(a, b, now());
  ok('场景6 并发时保留本机标题，不被晚到包覆盖', r.merged.title === 'A 更新标题');
  ok('场景6 渠道取并集', r.merged.channels.includes('短信'));
}

// 场景 7：导出/导入整包往返
{
  const a = makeDraft(deviceA);
  const text = exportPackage(a, deviceA, now());
  const parsed = JSON.parse(text);
  ok('场景7 整包可识别', isSyncPackage(parsed));
  ok('场景7 非整包被拒绝', !isSyncPackage({ foo: 1 }));
}

// 场景 8：旧数据迁移补齐修订号，且幂等
{
  const old = {
    id: 'legacy-1',
    title: '旧稿', eventType: '台风', severity: '黄色', scope: '片区', channels: [],
    eventAt: '', effectiveAt: '', expiresAt: '', requiredLocales: ['zh-CN'],
    languages: [
      { id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: 't', body: 'b', translator: 'x', reviewed: false },
      { id: 'en', locale: 'en', name: 'English', title: 't', body: 'b', translator: 'y', reviewed: false }
    ],
    discussions: [],
    reviews: [{ role: '编辑', owner: 'a', status: 'pending', note: '' }],
    versions: [
      { id: 'old-v1', version: '1.0.0', label: 'a', createdAt: '', title: '', severity: '', scope: '', eventAt: '', effectiveAt: '', expiresAt: '', channels: [], languages: [], note: '', emergency: false },
      { id: 'old-v2', version: '1.1.0', label: 'b', createdAt: '', title: '', severity: '', scope: '', eventAt: '', effectiveAt: '', expiresAt: '', channels: [], languages: [], note: '', emergency: false }
    ],
    status: 'draft', version: '1.1.0', emergencyRevision: false, updatedAt: ''
  };
  const migrated = migrateDraft(old, () => { throw new Error('should not fallback'); });
  ok('场景8 语言版本补齐 revision=1', migrated.languages.every((l) => l.revision === 1));
  ok('场景8 锁定版本按时间线补齐 1/2', migrated.versions[0].revision === 1 && migrated.versions[1].revision === 2);
  ok('场景8 草稿 revision 不低于最高锁定版本', migrated.revision === 2);
  ok('场景8 设备 ID 已生成', typeof migrated.deviceId === 'string' && migrated.deviceId.length > 0);
  ok('场景8 metaVector 已播种', Object.values(migrated.metaVector)[0] === 2);
  const again = migrateDraft(migrated, () => { throw new Error('should not fallback'); });
  ok('场景8 迁移幂等：修订号不变', again.revision === 2 && again.versions[1].revision === 2);
  ok('场景8 迁移幂等：语言不重复', again.languages.length === 2);

  // 旧数据在同一浏览器多次加载，用同一个本机设备 ID 补齐，因果向量必须稳定
  const stableDevice = 'device-STABLE';
  const load1 = migrateDraft(JSON.parse(JSON.stringify(old)), () => { throw new Error('x'); }, stableDevice);
  const load2 = migrateDraft(JSON.parse(JSON.stringify(load1)), () => { throw new Error('x'); }, stableDevice);
  ok('场景8 跨刷新设备 ID 稳定', load2.deviceId === stableDevice);
  ok('场景8 跨刷新 metaVector 不被重新播种', load2.metaVector[stableDevice] === 2);

  // 旧数据两台设备迁移后各自编辑同一语言 -> 正确识别并发冲突（而非被当因果覆盖）
  const onA = migrateDraft(JSON.parse(JSON.stringify(old)), () => { throw new Error('x'); });
  const onB = migrateDraft(JSON.parse(JSON.stringify(old)), () => { throw new Error('x'); });
  onA.deviceId = deviceA; onA.languages.forEach((l) => { l.vector = { [deviceA]: 1 }; });
  onB.deviceId = deviceB; onB.languages.forEach((l) => { l.vector = { [deviceB]: 1 }; });
  onA.metaVector = { [deviceA]: 2 }; onB.metaVector = { [deviceB]: 2 };
  editLanguage(onA, 'zh-CN', 'A 迁移后改写。');
  editLanguage(onB, 'zh-CN', 'B 迁移后改写。');
  const r = mergeDrafts(onA, onB, now());
  ok('场景8 迁移旧稿两边改同一语言 -> 并列待裁定', r.merged.pendingLanguageConflicts.length === 1);
}

// 场景 9：不同 id 草稿拒绝合并
{
  const a = makeDraft(deviceA);
  const b = makeDraft(deviceB);
  b.id = 'notice-other';
  assert.throws(() => mergeDrafts(a, b, now()));
  ok('场景9 非同通知拒绝合并', true);
}

// 场景 10：重复回连新增语言也不重复
{
  const a = makeDraft(deviceA);
  const b = distribute(a, deviceB);
  b.languages.push({
    id: 'ja', locale: 'ja', name: '日本語', title: 'JA', body: 'Japanese only.',
    translator: 'b', reviewed: false, revision: 1, vector: { [deviceB]: 1 }, updatedAt: now(), updatedBy: 'b'
  });
  const r1 = mergeDrafts(a, b, now());
  const r2 = mergeDrafts(r1.merged, b, now());
  const r3 = mergeDrafts(r2.merged, b, now());
  const jaCount = r3.merged.languages.filter((l) => l.locale === 'ja').length;
  ok('场景10 多次回连 ja 只有一份', jaCount === 1);
}

console.log(`\n全部 ${passed} 项断言通过。`);
void createDeviceId;
