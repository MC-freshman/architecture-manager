import React from 'react';

export function ResourcePanel({ inventory, resources, resourceFilter, setResourceFilter, targetVersions, setTargetVersions, previewResource }) {
  const visible = resources.filter((resource) => !resourceFilter || (resource.repository + '/' + resource.resourceId).toLowerCase().includes(resourceFilter.toLowerCase()));
  return <section className="panel"><div className="panel-title"><span>三仓资源</span><div className="panel-tools"><input className="filter-input" value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} placeholder="筛选资源" /><span className="muted">current 只读</span></div></div><div className="rows resource-rows">
    {visible.map((resource) => { const key = resource.repository + '/' + resource.resourceId; return <div className="row resource-row" key={key}><div><span className="row-name">{resource.resourceId}</span><span className="resource-repo">{resource.repository}</span></div><div className="resource-actions"><span className={resource.valid ? 'pill good' : 'pill warn'}>{resource.version || '无版本'}</span><select className="version-select" value={targetVersions[key] || ''} onChange={(event) => setTargetVersions((state) => ({ ...state, [key]: event.target.value }))}><option value="">选择版本</option>{resource.availableVersions?.map((version) => <option key={version} value={version}>{version}</option>)}</select><button className="small-button" disabled={!targetVersions[key]} onClick={() => previewResource(resource)}>生成切换计划</button></div></div>; })}
    {!inventory && <div className="empty">选择工作区后显示资源。</div>}{inventory && resources.length === 0 && <div className="empty">没有发现 current.json 指针。</div>}
  </div></section>;
}
