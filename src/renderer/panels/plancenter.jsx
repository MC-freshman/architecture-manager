import React, { useEffect, useState } from 'react';

export function PlanCenterPanel({ api, workspace }) {
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const load = () => {
    if (!workspace) return;
    setError(null);
    api.parseImplementationTables(workspace).then((data) => setParsed(data)).catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(() => {
    setParsed(null);
    load();
  }, [workspace]);
  return <section className="panel"><div className="panel-title"><span>计划中心（versions/ 里的 P 表）</span><div className="panel-tools"><span className="muted">{parsed ? `${parsed.documents.length} 份实施表` : '未解析'}</span><button className="small-button" onClick={load} disabled={!workspace}>重新解析</button></div></div>
    {error && <div className="empty">解析失败：{error}</div>}
    {!parsed && !error && <div className="empty">选择工作区后解析 versions/ 下的 P 步表（只读；状态仍以文档本身为准）。</div>}
    {parsed && parsed.documents.length === 0 && <div className="empty">versions/ 里没有带 P 步表的文档。</div>}
    {parsed && parsed.documents.map((document) => <div key={document.path}>
      <div className="panel-subtitle">{document.path} · {document.steps.length} 步</div>
      <div className="rows">{document.steps.map((step) => <div className="row" key={document.path + step.id}>
        <div>
          <span className="row-name">{step.id} {step.name}</span>
          <div className="path-line">{step.duration || '时长未写'} · 产物：{(step.artifacts || '未写').slice(0, 80)}</div>
          <div className="path-line">判据：{(step.criteria || '未写').slice(0, 160)}</div>
        </div>
      </div>)}</div>
    </div>)}
  </section>;
}
