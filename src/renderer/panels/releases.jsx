import React, { useState } from 'react';

export function ReleasePanel({ api, workspace, resources, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [repository, setRepository] = useState('tool');
  const [resourceId, setResourceId] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [upgradeFrom, setUpgradeFrom] = useState('');
  const [definitionOverride, setDefinitionOverride] = useState('');
  const [references, setReferences] = useState(null);
  const [markId, setMarkId] = useState('');
  const [markKind, setMarkKind] = useState('workflow');
  const [supersededBy, setSupersededBy] = useState('');
  const [deprecationNote, setDeprecationNote] = useState('');
  const candidates = resources.filter((resource) => resource.repository === repository);
  const previewRelease = async () => {
    if (!workspace) { setMessage('请先选择工作区。'); return; }
    try {
      const plan = await api.previewReleasePlan({ workspaceRoot, repository, resourceId, targetVersion, upgradeFrom: upgradeFrom || null, definitionOverride: definitionOverride || null });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成发布计划：${plan.target.destination}（${plan.steps[0].fileCount} 个文件）；发布 ≠ 采纳，指针切换需另生成计划。`);
    } catch (error) {
      setMessage(`发布计划被拒绝：${friendlyError(error)}`);
    }
  };
  const showReferences = async () => {
    try {
      const result = await api.listResourceReferences({ workspaceRoot, repository, resourceId });
      setReferences(result);
      setMessage(`在 ${result.scanned} 个现行发布文件中找到 ${result.references.length} 处提及。`);
    } catch (error) {
      setMessage(`引用扫描失败：${friendlyError(error)}`);
    }
  };
  const previewMark = async () => {
    try {
      const baseline = await api.readRegistryBaseline({ workspaceRoot, kind: markKind });
      const plan = await api.previewRegistryPlan({ workspaceRoot, kind: markKind, action: 'mark', id: markId, entry: { supersededBy, deprecationNote }, baselineSha256: baseline.sha256 });
      setPlanPreview(plan);
      setPlanPayload({ afterText: plan.payload.afterText });
      setMessage(`已生成 deprecated 标记计划：${plan.target.description}。尚未写入。`);
    } catch (error) {
      setMessage(`标记计划被拒绝：${friendlyError(error)}`);
    }
  };
  return <section className="panel"><div className="panel-title"><span>三仓发布向导（发布 ≠ 采纳）</span><span className="muted">新目录 + SOURCE.json + 双向 SHA256SUMS；已发布字节不覆盖</span></div>
    {!workspace && <div className="empty">选择工作区后可用。</div>}
    {workspace && <div>
      <div className="git-summary">
        <div><label className="muted">仓库</label><select className="version-select" value={repository} onChange={(event) => setRepository(event.target.value)}><option value="tool">tool</option><option value="agent">agent</option></select></div>
        <div><label className="muted">资源 ID</label><input className="filter-input" value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="如 game-pipeline" /><select className="version-select" value="" onChange={(event) => setResourceId(event.target.value)}><option value="">从指针选择…</option>{candidates.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.resourceId}</option>)}</select></div>
        <div><label className="muted">新版本 x.y.z</label><input className="filter-input" value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)} placeholder="1.1.0" /></div>
        <div><label className="muted">从旧版本复制（升级脚手架）</label><select className="version-select" value={upgradeFrom} onChange={(event) => setUpgradeFrom(event.target.value)}><option value="">全新模板</option>{(candidates.find((resource) => resource.resourceId === resourceId)?.availableVersions || []).map((version) => <option key={version} value={version}>{version}</option>)}</select></div>
      </div>
      <div className="git-actions">
        <button className="small-button" onClick={showReferences} disabled={!resourceId}>查引用影响面</button>
        <button className="small-button" onClick={previewRelease} disabled={!resourceId || !targetVersion}>生成发布计划</button>
      </div>
      {references && <div className="scan-result clean">引用影响面（切换指针前先看这里）：{references.references.length === 0 ? '现行发布文件中无提及' : <ul className="finding-list">{references.references.slice(0, 10).map((reference) => <li key={reference.path}><code>{reference.path}</code></li>)}</ul>}{references.truncated ? '（截断到 50 条）' : ''}</div>}
      <div className="git-actions"><span className="muted">标记 deprecated（不改 enabled，钉旧版的 run 仍可解析）：</span>
        <select className="version-select" value={markKind} onChange={(event) => setMarkKind(event.target.value)}><option value="workflow">workflow</option><option value="agent">agent</option><option value="skill">skill</option></select>
        <input className="filter-input" value={markId} onChange={(event) => setMarkId(event.target.value)} placeholder="资源 ID" />
        <input className="filter-input" value={supersededBy} onChange={(event) => setSupersededBy(event.target.value)} placeholder="supersededBy（必填）" />
        <input className="filter-input" value={deprecationNote} onChange={(event) => setDeprecationNote(event.target.value)} placeholder="备注（可选）" />
        <button className="small-button" onClick={previewMark} disabled={!markId || !supersededBy}>生成标记计划</button>
      </div>
      <div className="muted">结构校验可另跑 repo-lint --new-release（P12 验收集统一调用）；此处计划生成即通过双向哈希自检。</div>
    </div>}
  </section>;
}
