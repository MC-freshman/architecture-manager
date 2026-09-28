import React from 'react';

export function PlanPreview({ planPreview, executePlan, closePlan, planWriteKinds }) {
  if (!planPreview) return null;
  return <section className="plan-preview"><div className="panel-title"><span>计划预览</span><div className="plan-buttons">{planWriteKinds.includes(planPreview.kind) && <button className="small-button primary-small" onClick={executePlan}>确认并执行</button>}{planPreview.kind === 'software-action' && planPreview.target?.mode === 'open-location' && <button className="small-button primary-small" onClick={executePlan}>确认打开目录</button>}<button className="small-button" onClick={closePlan}>关闭</button></div></div><div className="plan-meta"><code>{planPreview.planId}</code><span className="read-only-badge">尚未执行</span></div>{planWriteKinds.includes(planPreview.kind) && <div className="plan-explain">执行前会重新检查基线哈希；确认后才会写入，执行结果会立即回读验证。平台排除只写本机管理视图，不删除目录。</div>}{planPreview.kind === 'software-action' && <div className="plan-explain">软件动作需要人工确认；启动计划仍由已登记 connector/provider 处理，打开位置只会打开配方声明的目录。</div>}<pre>{JSON.stringify(planPreview, null, 2)}</pre></section>;
}
