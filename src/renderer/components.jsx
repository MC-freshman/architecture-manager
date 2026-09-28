import React from 'react';

export function Stat({ label, value, hint }) {
  return <div className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

export function DashboardStats({ inventory, gitState }) {
  return <div className="stats-grid">
    <Stat label="平台" value={inventory?.platforms?.length ?? '—'} hint="独立配置入口" />
    <Stat label="共享仓" value={inventory?.sharedRepositories?.length ?? '—'} hint="tool · agent · software" />
    <Stat label="架构文档" value={inventory?.architectureDocuments?.length ?? '—'} hint="来自 versions/" />
    <Stat label="Git" value={gitState} hint={inventory?.git?.branch || '未读取分支'} />
  </div>;
}

export function PlatformPanel({ inventory, showExcluded, setShowExcluded, addPlatformDirectory, previewPlatform }) {
  return <section className="panel platform-panel">
    <div className="panel-title"><span>平台接入与视图</span><div className="panel-tools"><span className="muted">目录标记校验</span>{inventory && <button className="small-button" onClick={addPlatformDirectory}>添加平台目录</button>}</div></div>
    <div className="rows">
      {(inventory?.platforms || []).filter((platform) => showExcluded || platform.enabled).map((platform) => (
        <div className="row" key={platform.id}>
          <div className="platform-main"><span className="row-name">{platform.id}</span><span className="resource-repo">{platform.directoryRelative}</span><div className="path-line">{platform.directoryPath}</div><div className="marker-list">{platform.markers.map((marker) => <span className={marker.exists ? 'marker good' : 'marker missing'} key={marker.path}>{marker.exists ? '✓' : '×'} {marker.label}</span>)}</div></div>
          <div className="resource-actions"><span className={platform.status === 'ready' && platform.enabled ? 'pill good' : platform.enabled ? 'pill warn' : 'pill'}>{!platform.enabled ? '已排除视图' : platform.status === 'ready' ? '发现配置·待自证' : platform.status === 'missing-directory' ? '缺目录' : '缺 bridge'}</span>{inventory && <button className="small-button" onClick={() => previewPlatform(platform)}>{platform.enabled ? '排除视图' : '加入视图'}</button>}</div>
        </div>
      ))}
      {inventory && <label className="show-excluded"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} /> 显示已排除视图的平台</label>}
      {!inventory && <div className="empty">选择工作区后显示平台。添加前会检查目录和 bridge 标记文件。</div>}
    </div>
  </section>;
}

export function IntegrationPanel({ api, workspace, resources, integrationKind, setIntegrationKind, integrationOptions, integrationTargetId, setIntegrationTargetId, integrationMode, setIntegrationMode, integrationPaths, integrationPath, setIntegrationPath, integrationTarget, setIntegrationTarget, integrationText, setIntegrationText, integrationTargetVersion, setIntegrationTargetVersion, reloadIntegrationTarget, previewIntegration, friendlyError, setMessage }) {
  const chooseTarget = (next) => {
    setIntegrationTargetId(next);
    if (next === '__registry__') setIntegrationMode('registry');
  };
  const choosePath = (next) => {
    setIntegrationPath(next);
    const selected = integrationPaths.find((item) => item === next);
    if (!selected) return;
    api.readIntegrationTarget({ workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId, relativePath: selected })
      .then((detail) => { setIntegrationTarget(detail); setIntegrationText(detail.content || ''); })
      .catch((error) => setMessage(`接入目标读取失败：${friendlyError(error)}`));
  };
  return <section className="panel integration-panel">
    <div className="panel-title"><span>手动接入向导</span><span className="muted">plan → confirm → verify</span></div>
    <div className="integration-help">今后新增或切换 tool、agent、software、platform 都可以从这里生成带基线哈希的计划。DSH 按已有 bridge/config 处理；Burp/VeraCrypt 等特殊软件能力不在本向导内验证。</div>
    <div className="integration-form">
      <label>对象类型<select value={integrationKind} onChange={(event) => { const next = event.target.value; setIntegrationKind(next); setIntegrationMode(next === 'platform' ? 'config' : 'pointer'); setIntegrationTargetId(''); setIntegrationTarget(null); }}><option value="platform">platform</option><option value="tool">tool</option><option value="agent">agent</option><option value="software">software</option></select></label>
      <label>对象<select value={integrationTargetId} onChange={(event) => chooseTarget(event.target.value)}><option value="">选择对象</option>{integrationOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {integrationKind !== 'platform' && <label>动作<select value={integrationMode} onChange={(event) => setIntegrationMode(event.target.value)}><option value="pointer">切换 current 指针</option><option value="registry">修改 registry</option></select></label>}
      <label>目标文件<select value={integrationPath} onChange={(event) => choosePath(event.target.value)}><option value="">选择目标</option>{integrationPaths.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
      {integrationMode === 'pointer' && integrationTarget && <label>目标版本<select value={integrationTargetVersion} onChange={(event) => setIntegrationTargetVersion(event.target.value)}><option value="">选择已发布版本</option>{(resources.find((item) => item.repository === integrationKind && item.resourceId === integrationTargetId)?.availableVersions || []).map((version) => <option key={version} value={version}>{version}</option>)}</select></label>}
    </div>
    {integrationTarget && integrationMode !== 'pointer' && <><div className="path-line">基线 SHA-256：{integrationTarget.sha256 || '新文件'} · 目标：{integrationTarget.path}</div><textarea className="integration-editor" value={integrationText} onChange={(event) => setIntegrationText(event.target.value)} spellCheck={false} /></>}
    <div className="resource-actions"><button className="small-button" onClick={reloadIntegrationTarget} disabled={!integrationTarget}>重新读取目标</button><button className="small-button primary-small" onClick={previewIntegration} disabled={!integrationTarget || (integrationMode === 'pointer' ? !integrationTargetVersion : !integrationText)}>生成接入计划</button></div>
  </section>;
}

export function CatalogPanel({ api, workspace, inventory, catalogFilter, setCatalogFilter, agents, skills, skillFilter, setSkillFilter, catalogDetail, setCatalogDetail, skillDetail, setSkillDetail, openCatalog, previewRegistryAction, friendlyError, setMessage }) {
  const openSkillContent = async (item) => {
    try {
      const detail = await api.readCatalogEntry({ workspaceRoot: workspace, kind: 'skill', id: item.id });
      const visibleSkills = detail.catalog?.skills?.filter((skill) => !skillFilter || skill.id.toLowerCase().includes(skillFilter.toLowerCase()));
      setSkillDetail({ ...detail, visibleSkills });
    } catch (error) { setMessage(`读取技能正文失败：${friendlyError(error)}`); }
  };
  const readSkill = async (skill) => {
    try { setSkillDetail({ ...skillDetail, selectedSkill: await api.readSkillContent({ workspaceRoot: workspace, catalogId: skillDetail.id, id: skill.id, version: skill.version }) }); }
    catch (error) { setMessage(`技能正文读取失败：${friendlyError(error)}`); }
  };
  return <section className="panel catalog-panel">
    <div className="panel-title"><span>Agent 与 Skill 管理</span><div className="panel-tools"><input className="filter-input" value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value)} placeholder="筛选 id" />{inventory && <><button className="small-button" onClick={() => previewRegistryAction('agent', 'add')}>从文件添加 agent</button><button className="small-button" onClick={() => previewRegistryAction('skill', 'add')}>从文件添加 skill 目录</button></>}</div></div>
    <div className="catalog-columns">
      <div><div className="subheading">Agent（{agents.length}）</div>{agents.map((item) => <div className="catalog-row" key={`agent-${item.id}`}><div><button className="link-button" onClick={() => openCatalog('agent', item.id)}>{item.id}</button><span className={item.enabled === false ? 'pill' : 'pill good'}>{item.enabled === false ? '停用' : '启用'}</span><div className="resource-repo">版本 {item.version || '按 current 读取'} · {item.deprecated ? '已弃用' : '现行'}</div></div><div className="resource-actions"><button className="small-button" onClick={() => openCatalog('agent', item.id)}>查看全部</button><button className="small-button" onClick={() => previewRegistryAction('agent', item.enabled === false ? 'enable' : 'disable', item)}>{item.enabled === false ? '启用计划' : '停用计划'}</button><button className="small-button danger-button" onClick={() => previewRegistryAction('agent', 'remove', item)}>移除计划</button></div></div>)}</div>
      <div><div className="subheading">Skill 目录（{skills.length}）</div>{skills.map((item) => <div className="catalog-row" key={`skill-${item.id}`}><div><button className="link-button" onClick={() => openCatalog('skill', item.id)}>{item.id}</button><span className={item.enabled === false ? 'pill' : 'pill good'}>{item.enabled === false ? '停用' : '启用'}</span><div className="resource-repo">{item.path}</div></div><div className="resource-actions"><button className="small-button" onClick={() => openCatalog('skill', item.id)}>查看目录</button><button className="small-button" onClick={() => openSkillContent(item)}>查看技能内容</button><button className="small-button" onClick={() => previewRegistryAction('skill', item.enabled === false ? 'enable' : 'disable', item)}>{item.enabled === false ? '启用计划' : '停用计划'}</button><button className="small-button danger-button" onClick={() => previewRegistryAction('skill', 'remove', item)}>移除计划</button></div></div>)}</div>
    </div>
    {catalogDetail && <div className="catalog-detail"><div className="editor-heading"><strong>{catalogDetail.kind} / {catalogDetail.id}</strong><button className="small-button" onClick={() => setCatalogDetail(null)}>关闭详情</button></div><div className="path-line">{catalogDetail.promptPath || catalogDetail.catalogPath || catalogDetail.registryPath}</div><pre>{catalogDetail.kind === 'agent' ? `${JSON.stringify(catalogDetail.manifest, null, 2)}\n\n${catalogDetail.prompt || ''}` : catalogDetail.catalogText || JSON.stringify(catalogDetail.catalog, null, 2)}</pre></div>}
    {skillDetail && <div className="catalog-detail"><div className="editor-heading"><strong>{skillDetail.id} 的技能条目（{skillDetail.visibleSkills?.length || 0}/{skillDetail.skillCount}）</strong><div className="panel-tools"><input className="filter-input" value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} placeholder="筛选技能 id" /><button className="small-button" onClick={() => setSkillDetail(null)}>关闭详情</button></div></div><div className="skill-detail-list">{(skillDetail.visibleSkills || []).map((skill) => <div className="catalog-row" key={`${skill.id}-${skill.version}`}><span><strong>{skill.id}</strong><span className="resource-repo">v{skill.version} · {skill.sourcePath || ''}</span></span><button className="small-button" onClick={() => readSkill(skill)}>读取正文</button></div>)}</div>{skillDetail.selectedSkill && <pre>{skillDetail.selectedSkill.content}</pre>}</div>}
    {!inventory && <div className="empty">选择工作区后读取 agent registry 和 skill 目录。正文只读查看，启用/停用/移除先生成计划。</div>}
  </section>;
}

export function ResourcePanel({ inventory, resources, resourceFilter, setResourceFilter, targetVersions, setTargetVersions, previewResource }) {
  const visible = resources.filter((resource) => !resourceFilter || `${resource.repository}/${resource.resourceId}`.toLowerCase().includes(resourceFilter.toLowerCase()));
  return <section className="panel"><div className="panel-title"><span>三仓资源</span><div className="panel-tools"><input className="filter-input" value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} placeholder="筛选资源" /><span className="muted">current 只读</span></div></div><div className="rows resource-rows">
    {visible.map((resource) => { const key = `${resource.repository}/${resource.resourceId}`; return <div className="row resource-row" key={key}><div><span className="row-name">{resource.resourceId}</span><span className="resource-repo">{resource.repository}</span></div><div className="resource-actions"><span className={resource.valid ? 'pill good' : 'pill warn'}>{resource.version || '无版本'}</span><select className="version-select" value={targetVersions[key] || ''} onChange={(event) => setTargetVersions((state) => ({ ...state, [key]: event.target.value }))}><option value="">选择版本</option>{resource.availableVersions?.map((version) => <option key={version} value={version}>{version}</option>)}</select><button className="small-button" disabled={!targetVersions[key]} onClick={() => previewResource(resource)}>生成切换计划</button></div></div>; })}
    {!inventory && <div className="empty">选择工作区后显示资源。</div>}{inventory && resources.length === 0 && <div className="empty">没有发现 current.json 指针。</div>}
  </div></section>;
}

export function DocumentPanel({ documentSummaries, visibleDocuments, documentFilter, setDocumentFilter, selectedDocument, documentDraft, setDocumentDraft, sensitiveConfirmed, setSensitiveConfirmed, openDocument, previewDocument }) {
  return <section className="panel document-panel"><div className="panel-title"><span>更新计划与说明文档</span><div className="panel-tools"><input className="filter-input" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} placeholder="搜索文件名或类型" /><span className="muted">{visibleDocuments.length}/{documentSummaries.length} 篇</span></div></div><div className="document-list">
    {visibleDocuments.map((item) => <button className="document-item" key={item.path} onClick={() => openDocument(item.path)}><span><strong>{item.path.replace('versions/', '')}</strong><small>{item.checklistTotal ? ` · ${item.checklistDone}/${item.checklistTotal} 项完成` : item.pItems.length ? ` · ${item.pItems.length} 个 P 项` : ` · ${item.bytes} 字节`}</small></span><span className="document-badges"><span className="pill">{item.kind === 'implementation-table' ? 'P表' : item.kind === 'proposal' ? '方案' : item.kind === 'ledger' ? '台账' : item.kind === 'top-level-requirements' ? '顶层要求' : '文档'}</span>{item.completionPercent != null && <span className="pill good">{item.completionPercent}%</span>}</span></button>)}
    {visibleDocuments.length === 0 && <div className="empty">{documentSummaries.length ? '没有匹配的文档。' : '选择工作区后显示全部方案、P 表、台账和顶层要求。'}</div>}
  </div>{selectedDocument && <div className="editor-box"><div className="editor-heading"><strong>{selectedDocument.path}</strong><span className="muted">SHA-256 {selectedDocument.sha256.slice(0, 12)}…</span></div><textarea value={documentDraft} onChange={(event) => setDocumentDraft(event.target.value)} spellCheck={false} />{selectedDocument.sensitive && <label className="sensitive-confirm"><input type="checkbox" checked={sensitiveConfirmed} onChange={(event) => setSensitiveConfirmed(event.target.checked)} /> 我确认这是顶层治理要求的变更预览</label>}<button className="small-button" onClick={previewDocument}>生成文档变更计划</button></div>}</section>;
}

export function SoftwarePanel({ inventory, software, softwareResults, checkSoftware, previewSoftwareLocation, previewSoftware }) {
  return <section className="panel software-panel"><div className="panel-title"><span>软件中心</span><span className="muted">recipe / connector</span></div><div className="rows">
    {software.map((item) => { const result = softwareResults[item.id]; return <div className="software-row" key={item.id}><div className="software-main"><span className="row-name">{item.displayName}</span><span className="resource-repo">{item.id} · {item.version}</span><div className="software-meta">{item.transport || '未声明'} · {item.bodyExists === true ? '本体已发现' : item.bodyExists === false ? '本体未发现' : '路径待核对'} · {item.snapshotFrozen ? '快照已冻结' : '快照待核验'}</div><div className="software-path"><strong>绝对路径：</strong>{item.bodyPath || '配方未声明'}<br /><strong>工作区相对配方：</strong>{item.versionRoot}<br /><strong>入口：</strong>{item.entrypoint || item.versionCall?.[0] || '由 connector/provider 处理'}{item.endpoint && <><br /><strong>端点：</strong>{item.endpoint}</>}</div></div><div className="resource-actions software-actions"><span className={result?.status === 'PASS' ? 'pill good' : result ? 'pill warn' : 'pill'}>{result?.status || '未检查'}</span><button className="small-button" onClick={() => checkSoftware(item)}>健康检查</button><button className="small-button" onClick={() => previewSoftwareLocation(item)}>打开位置</button><button className="small-button" onClick={() => previewSoftware(item)}>启动计划</button></div></div>; })}
    {!inventory && <div className="empty">选择工作区后显示软件。</div>}
  </div></section>;
}

export function GitPanel({ gitDetails, workspace, refreshGit, previewGit, sensitiveScan }) {
  return <section className="panel git-panel"><div className="panel-title"><span>Git 与备份</span><span className="muted">计划预览</span></div><div className="git-summary"><div><span className="muted">分支</span><code>{gitDetails?.branch || '—'}</code></div><div><span className="muted">HEAD</span><code>{gitDetails?.head ? `${gitDetails.head.slice(0, 12)}…` : '—'}</code></div><div><span className="muted">远端</span><code>{gitDetails?.upstream || gitDetails?.remotes?.[0] || '未绑定'}</code></div><div><span className="muted">同步</span><span>{gitDetails?.ahead == null ? '未设置 upstream' : `ahead ${gitDetails.ahead} · behind ${gitDetails.behind}`}</span></div><div><span className="muted">改动</span><span>{gitDetails?.status?.length ?? '—'} 项</span></div></div><div className="git-actions"><button className="small-button" onClick={refreshGit} disabled={!workspace}>刷新并扫敏感文件</button><button className="small-button" onClick={() => previewGit('commit')} disabled={!workspace}>提交计划</button><button className="small-button" onClick={() => previewGit('push')} disabled={!workspace}>推送计划</button><button className="small-button" onClick={() => previewGit('backup')} disabled={!workspace}>备份计划</button><button className="small-button" onClick={() => previewGit('rollback')} disabled={!workspace}>回滚计划</button></div>{sensitiveScan && <div className={sensitiveScan.clean ? 'scan-result clean' : 'scan-result warning'}>{sensitiveScan.clean ? '敏感文件扫描通过' : `发现 ${sensitiveScan.findings.length} 项待核对`}<span className="muted"> · 所有计划仍需确认后执行</span></div>}{sensitiveScan?.findings?.length > 0 && <ul className="finding-list">{sensitiveScan.findings.slice(0, 8).map((finding) => <li key={`${finding.path}-${finding.kind}`}><code>{finding.path}</code> · {finding.kind}</li>)}</ul>}</section>;
}

export function SafetyPanel() {
  return <section className="panel"><div className="panel-title"><span>安全边界</span><span className="muted">P1–P4</span></div><ul className="checks"><li><span className="check">✓</span>页面没有 Node 文件系统权限</li><li><span className="check">✓</span>扫描器明确标记 writePerformed=false</li><li><span className="check">✓</span>路径越界在 API 层拒绝</li><li><span className="check">✓</span>后续写入必须经过计划层</li></ul></section>;
}

export function HelpPanel() {
  return <section className="panel help-panel"><div className="panel-title"><span>新手操作</span><span className="muted">不需要控制台</span></div><ol className="help-list"><li>点击“选择工作区”，选中自己的 `E:\ai` 架构目录。</li><li>平台先看目录和 bridge 标记；添加、排除只改变本机管理视图，不删除平台文件。</li><li>Agent/Skill 点“查看全部”看正文，启用、停用、移除和添加都会先生成 registry 计划。</li><li>手动接入向导统一处理平台配置、tool/agent/software 指针和 registry；每次都是 plan → 确认 → verify。</li><li>软件中心显示绝对路径、相对路径和入口；打开目录或启动都保留人工确认。</li></ol></section>;
}

export function PlanPreview({ planPreview, executePlan, closePlan, planWriteKinds }) {
  if (!planPreview) return null;
  return <section className="plan-preview"><div className="panel-title"><span>计划预览</span><div className="plan-buttons">{planWriteKinds.includes(planPreview.kind) && <button className="small-button primary-small" onClick={executePlan}>确认并执行</button>}{planPreview.kind === 'software-action' && planPreview.target?.mode === 'open-location' && <button className="small-button primary-small" onClick={executePlan}>确认打开目录</button>}<button className="small-button" onClick={closePlan}>关闭</button></div></div><div className="plan-meta"><code>{planPreview.planId}</code><span className="read-only-badge">尚未执行</span></div>{planWriteKinds.includes(planPreview.kind) && <div className="plan-explain">执行前会重新检查基线哈希；确认后才会写入，执行结果会立即回读验证。平台排除只写本机管理视图，不删除目录。</div>}{planPreview.kind === 'software-action' && <div className="plan-explain">软件动作需要人工确认；启动计划仍由已登记 connector/provider 处理，打开位置只会打开配方声明的目录。</div>}<pre>{JSON.stringify(planPreview, null, 2)}</pre></section>;
}

