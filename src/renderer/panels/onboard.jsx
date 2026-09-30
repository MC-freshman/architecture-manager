import React, { useState } from 'react';

export function OnboardPanel({ api, workspace, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [platformId, setPlatformId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [card, setCard] = useState(null);
  const previewScaffold = async () => {
    if (!workspace) { setMessage('请先选择工作区。'); return; }
    try {
      const plan = await api.previewPlatformScaffoldPlan({ workspaceRoot, platformId, displayName, confirmed });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 ${platformId} 平台脚手架计划（一级目录创建 = 你的 BP-1 授权动作，确认后才会写入）。`);
    } catch (error) {
      setMessage(`脚手架计划被拒绝：${friendlyError(error)}`);
    }
  };
  const loadDrafts = async () => {
    try {
      setDrafts(await api.onboardingDraft({ workspaceRoot, platformId }));
      setMessage('已生成治理文档五件套增补草案（草稿仅展示，应用走文档计划）。');
    } catch (error) {
      setMessage(`草案生成失败：${friendlyError(error)}`);
    }
  };
  const loadCard = async () => {
    try {
      setCard(await api.onboardingCard({ workspaceRoot, platformId }));
    } catch (error) {
      setMessage(`指令卡生成失败：${friendlyError(error)}`);
    }
  };
  return <section className="panel"><div className="panel-title"><span>新平台接入向导</span><span className="muted">脚手架 → 配置补全 → 预检/矩阵 → 真实提交一格 → 治理联动</span></div>
    {!workspace && <div className="empty">选择工作区后可用。</div>}
    {workspace && <div>
      <div className="integration-form">
        <label>新平台 ID（小写英文）<input value={platformId} onChange={(event) => setPlatformId(event.target.value.toLowerCase())} placeholder="例如 claude-code" /></label>
        <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="可选" /></label>
      </div>
      <label className="sensitive-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 我确认要在当前工作区创建这个一级目录（BP-1 用户授权）</label>
      <div className="git-actions">
        <button className="small-button" onClick={previewScaffold} disabled={!platformId || !confirmed}>生成脚手架计划</button>
        <button className="small-button" onClick={loadDrafts} disabled={!platformId}>治理文档草案</button>
        <button className="small-button" onClick={loadCard} disabled={!platformId}>真实提交指令卡</button>
      </div>
      {drafts && <div className="rows">{drafts.drafts.map((draft) => <div className="row" key={draft.path}><div><span className="row-name">{draft.path}</span><div className="path-line">[{draft.section}] {draft.draft.slice(0, 120)}</div></div></div>)}</div>}
      {card && <div className="editor-box"><pre className="path-line">{card.card}</pre></div>}
      <div className="muted">脚手架只生成骨架与 <code>&lt;PIN&gt;</code> 占位；矩阵 FAIL 0 与 0 declaredAbsent 仍须由该平台自证（BP-2），真实提交一格不可省。</div>
    </div>}
  </section>;
}
