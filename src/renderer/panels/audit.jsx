import React, { useEffect, useState } from 'react';

export function AuditPanel({ api }) {
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const load = () => {
    setError(null);
    api.readAuditEvents({ limit: 50 }).then((data) => setAudit(data)).catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(load, []);
  return <section className="panel"><div className="panel-title"><span>审计历史（本机应用数据）</span><div className="panel-tools"><span className="muted">{audit ? `${audit.totalEvents} 事件 · 只记路径与哈希，不含正文` : '未读取'}</span><button className="small-button" onClick={load}>刷新</button></div></div>
    {error && <div className="empty">读取失败：{error}</div>}
    {!audit && !error && <div className="empty">正在读取审计事件……</div>}
    {audit && !audit.present && <div className="empty">尚无审计记录（%LOCALAPPDATA%/ArchitectureManager/audit）。</div>}
    {audit && audit.present && <div>
      {audit.corruptLines > 0 && <div className="scan-result warning">有 {audit.corruptLines} 行无法解析，已跳过。</div>}
      <div className="muted">checkpoint {audit.checkpointCount} 个 · 显示最近 {audit.events.length} 条</div>
      <div className="rows">{audit.events.slice().reverse().map((event, index) => <div className="row" key={event.transactionId || index}>
        <div>
          <span className="row-name">{event.action}</span>
          <span className={event.status === 'applied' || event.status === 'already-applied' ? 'pill good' : 'pill warn'}>{event.status}</span>
          <div className="path-line">{event.occurredAt} · {event.target}</div>
        </div>
        <div className="resource-actions"><span className={event.writePerformed ? 'pill warn' : 'pill'}>{event.writePerformed ? '已写入' : '未写入'}</span></div>
      </div>)}</div>
    </div>}
  </section>;
}
