import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = window.architectureManager;

const friendlyError = (error) => {
  const code = String(error?.message ?? error);
  const hints = {
    DOCUMENT_BASELINE_MISMATCH: '文档在读取后发生了变化，请重新打开文档再编辑。',
    EXTERNAL_CHANGE_DETECTED: '目标文件已被其他程序修改，管理台已阻止覆盖，请重新扫描。',
    TOP_LEVEL_CONFIRMATION_REQUIRED: '顶层治理文件需要勾选确认后才能生成计划。',
    TARGET_VERSION_UNAVAILABLE: '目标版本不在当前共享仓目录中，请先确认版本已发布。',
    POINTER_BASELINE_REQUIRED: '这个指针缺少基线哈希，请重新扫描工作区。',
    CATALOG_BASELINE_MISMATCH: 'registry 在读取后发生了变化，请重新扫描工作区。',
    CATALOG_ENTRY_ALREADY_EXISTS: '这个条目已经存在，请先查看现有条目。',
    CATALOG_ENTRY_NOT_FOUND: '没有找到这个条目。',
    CATALOG_CURRENT_NOT_FOUND: 'agent 的 current.json 不存在，不能注册。',
    SKILL_CATALOG_NOT_FOUND: '技能目录文件不存在，不能注册。',
    PLATFORM_PATH_OUTSIDE_WORKSPACE: '平台目录必须位于当前工作区内。',
    SOFTWARE_BODY_PATH_NOT_FOUND: '软件配方声明的本体路径不存在。',
    TRANSACTION_TARGET_OUTSIDE_WORKSPACE: '目标路径不在当前工作区内，操作已阻止。',
    TRANSACTION_KIND_UNSUPPORTED: '此类计划暂时只能查看，尚未提供安全执行器。'
  };
  return hints[code] ? `${hints[code]}（${code}）` : code;
};

function Stat({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('请选择一个架构工作区开始只读扫描。');
  const [showExcluded, setShowExcluded] = useState(false);
  const [planPreview, setPlanPreview] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentDraft, setDocumentDraft] = useState('');
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [softwareResults, setSoftwareResults] = useState({});
  const [gitDetails, setGitDetails] = useState(null);
  const [sensitiveScan, setSensitiveScan] = useState(null);
  const [planPayload, setPlanPayload] = useState(null);
  const [catalogDetail, setCatalogDetail] = useState(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [skillDetail, setSkillDetail] = useState(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [targetVersions, setTargetVersions] = useState({});

  const scan = async (root) => {
    if (!root) return;
    setBusy(true);
    setMessage('正在只读扫描工作区……');
    try {
      const result = await api.scanWorkspace(root);
      setWorkspace(result.workspaceRoot);
      setInventory(result);
      setGitDetails(result.git);
      setPlanPreview(null); setPlanPayload(null); setSelectedDocument(null); setCatalogDetail(null); setSkillDetail(null); setSoftwareResults({});
      setMessage(result.errors.length === 0 ? '扫描完成，当前页面没有执行写入。' : `扫描完成，发现 ${result.errors.length} 个待处理问题。`);
    } catch (error) {
      setMessage(`扫描失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshGit = async () => {
    if (!workspace) return;
    try {
      const [details, scanResult] = await Promise.all([
        api.inspectGit(workspace),
        api.scanSensitiveFiles(workspace)
      ]);
      setGitDetails(details);
      setSensitiveScan(scanResult);
      setMessage(`Git 状态已刷新：${details.status?.length || 0} 项改动，敏感文件扫描 ${scanResult.clean ? '通过' : `发现 ${scanResult.findings.length} 项待核对`}。`);
    } catch (error) {
      setMessage(`Git 状态读取失败：${friendlyError(error)}`);
    }
  };

  useEffect(() => {
    api.getDefaultWorkspace().then((root) => root && scan(root)).catch((error) => setMessage(`启动失败：${friendlyError(error)}`));
  }, []);

  const gitState = useMemo(() => {
    if (!inventory?.git) return '未扫描';
    if (inventory.git.error) return '不可用';
    if (!inventory.git.isRepository) return '未绑定 Git';
    return inventory.git.status.length === 0 ? '干净' : `${inventory.git.status.length} 项改动`;
  }, [inventory]);

  const resources = useMemo(() => (inventory?.sharedRepositories || []).flatMap((repo) => (
    (repo.pointers || []).map((pointer) => ({ ...pointer, repository: repo.repository }))
  )), [inventory]);

  const documentSummaries = inventory?.documentSummaries || [];
  const visibleDocuments = useMemo(() => documentSummaries.filter((item) => !documentFilter || item.path.toLowerCase().includes(documentFilter.toLowerCase()) || item.kind.includes(documentFilter.toLowerCase())), [documentSummaries, documentFilter]);
  const software = inventory?.software || [];
  const agents = useMemo(() => (inventory?.agents || []).filter((item) => !catalogFilter || item.id.toLowerCase().includes(catalogFilter.toLowerCase())), [inventory, catalogFilter]);
  const skills = useMemo(() => (inventory?.skills || []).filter((item) => !catalogFilter || item.id.toLowerCase().includes(catalogFilter.toLowerCase())), [inventory, catalogFilter]);

  const previewPlatform = async (platform) => {
    const currentEnabled = platform.enabled;
    const desiredEnabled = !currentEnabled;
    try {
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId: platform.id, currentEnabled, desiredEnabled, directoryRelative: platform.directoryRelative, markers: platform.markers });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成本地视图计划：${platform.id} 将${desiredEnabled ? '显示' : '排除'}。尚未写入。`);
    } catch (error) {
      setMessage(`计划生成失败：${friendlyError(error)}`);
    }
  };

  const addPlatformDirectory = async () => {
    if (!workspace) return;
    const selected = await api.selectDirectory();
    if (!selected) return;
    const platformId = selected.split(/[\\/]/).filter(Boolean).pop();
    if (!inventory?.platforms?.some((item) => item.id === platformId)) {
      setMessage(`未识别的平台目录：${platformId}。请选择 codex、qoder、doubao、workbuddy、zcode 或 dsh 目录。`);
      return;
    }
    try {
      const inspected = await api.inspectPlatform({ workspaceRoot: workspace, platformId, directoryRelative: selected });
      if (!inspected.validForView) {
        setMessage(`平台目录校验未通过：${inspected.status}。需要目录和 bridge 标记文件。`);
        return;
      }
      const currentEnabled = inventory.platforms.find((item) => item.id === platformId)?.enabled ?? false;
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId, currentEnabled, desiredEnabled: true, directoryRelative: inspected.directoryRelative, markers: inspected.markers });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已验证 ${platformId}：bridge 和目录标记齐全，生成加入管理视图计划。`);
    } catch (error) {
      setMessage(`平台目录验证失败：${friendlyError(error)}`);
    }
  };

  const openCatalog = async (kind, id) => {
    try {
      setCatalogDetail(await api.readCatalogEntry({ workspaceRoot: workspace, kind, id }));
      setSkillDetail(null); setSkillFilter('');
    } catch (error) {
      setMessage(`读取${kind === 'agent' ? 'agent' : 'skill'}内容失败：${friendlyError(error)}`);
    }
  };

  const previewRegistryAction = async (kind, action, item = null) => {
    if (!workspace || !inventory?.catalogRegistries?.[kind]?.sha256) return;
    let id = item?.id;
    try {
      let entry = {};
      if (action === 'add') {
        const selected = await api.selectCatalog({ workspaceRoot: workspace, kind });
        if (!selected) return;
        id = selected.id; entry = selected.entry;
      }
      if (!id) return;
      const plan = await api.previewRegistryPlan({ workspaceRoot: workspace, kind, action, id, entry, baselineSha256: inventory.catalogRegistries[kind].sha256 });
      setPlanPreview(plan);
      setPlanPayload({ afterText: plan.payload.afterText });
      setMessage(`已生成 ${kind} registry ${action} 计划，尚未写入。`);
    } catch (error) {
      setMessage(`registry 计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewResource = async (resource) => {
    const target = targetVersions[`${resource.repository}/${resource.resourceId}`];
    if (!target) return;
    try {
      const plan = await api.previewResourcePlan({
        workspaceRoot: workspace,
        repository: resource.repository,
        resourceId: resource.resourceId,
        currentVersion: resource.version,
        targetVersion: target,
        availableVersions: resource.availableVersions,
        baselineSha256: resource.sha256
      });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成资源指针计划：${resource.repository}/${resource.resourceId}。尚未写入。`);
    } catch (error) {
      setMessage(`资源计划被拒绝：${friendlyError(error)}`);
    }
  };

  const openDocument = async (path) => {
    try {
      const document = await api.readDocument({ workspaceRoot: workspace, relativePath: path });
      setSelectedDocument(document);
      setDocumentDraft(document.content);
      setSensitiveConfirmed(false);
      setMessage(`已读取 ${path}，编辑仍只在本地内存中。`);
    } catch (error) {
      setMessage(`文档读取失败：${friendlyError(error)}`);
    }
  };

  const previewDocument = async () => {
    if (!selectedDocument) return;
    try {
      const plan = await api.previewDocumentPlan({
        workspaceRoot: workspace,
        relativePath: selectedDocument.path,
        beforeText: selectedDocument.content,
        afterText: documentDraft,
        baselineSha256: selectedDocument.sha256,
        highSensitivityConfirmed: sensitiveConfirmed
      });
      setPlanPreview(plan);
      setPlanPayload({ afterText: documentDraft });
      setMessage(`已生成文档变更计划：${selectedDocument.path}。尚未写入。`);
    } catch (error) {
      setMessage(`文档计划被拒绝：${friendlyError(error)}`);
    }
  };

  const checkSoftware = async (item) => {
    try {
      const result = await api.softwareHealth({ workspaceRoot: workspace, softwareId: item.id });
      setSoftwareResults((state) => ({ ...state, [item.id]: result }));
      setMessage(`${item.id} 健康检查：${result.status}`);
    } catch (error) {
      setMessage(`软件健康检查失败：${friendlyError(error)}`);
    }
  };

  const previewSoftware = async (item) => {
    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, mode: 'launch' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 ${item.id} 启动计划。尚未启动软件。`);
    } catch (error) {
      setMessage(`软件启动计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewSoftwareLocation = async (item) => {
    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, mode: 'open-location' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成打开 ${item.id} 本体目录的计划，确认后才会打开资源管理器。`);
    } catch (error) {
      setMessage(`软件位置计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewGit = async (action) => {
    if (!workspace) return;
    const input = { workspaceRoot: workspace, action };
    if (action === 'commit') input.message = window.prompt('输入提交说明', '更新架构管理台') || '';
    if (action === 'push') input.remote = window.prompt('输入远端名称', 'origin') || '';
    if (action === 'rollback') input.commit = window.prompt('输入要回滚的提交 SHA（将生成 revert 计划）', '') || '';
    if (action === 'backup') input.backupName = window.prompt('输入备份名称', `before-${new Date().toISOString().slice(0, 10)}`) || '';
    try {
      const plan = await api.previewGitPlan(input);
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 Git ${action} 计划。尚未执行任何 Git 或文件写入。`);
    } catch (error) {
      setMessage(`Git 计划被拒绝：${friendlyError(error)}`);
    }
  };

  const executePlan = async () => {
    if (!planPreview) return;
    if (planPreview.kind === 'software-action' && planPreview.target?.mode === 'open-location') {
      if (!await api.confirm(`确认打开软件目录？\n\n${planPreview.target.bodyPath}`)) return;
      try {
        await api.openSoftwareLocation({ workspaceRoot: workspace, softwareId: planPreview.target.softwareId, expectedPath: planPreview.target.bodyPath });
        setPlanPreview(null);
        setMessage('已打开软件本体目录。');
      } catch (error) {
        setMessage(`软件目录打开失败：${friendlyError(error)}`);
      }
      return;
    }
    if (!['document-edit', 'resource-pointer', 'platform-view', 'registry-edit'].includes(planPreview.kind)) return;
    const target = planPreview.target?.path || (planPreview.kind === 'platform-view' ? `本地管理视图/platform:${planPreview.target?.platformId}` : `${planPreview.target?.repository}/${planPreview.target?.resourceId}/current.json`);
    if (!await api.confirm(`确认执行此计划？\n\n目标：${target}\n\n执行前会再次核对文件状态，失败会阻止覆盖。`)) return;
    setBusy(true);
    try {
      const applied = await api.applyPlan({ plan: planPreview, afterText: planPayload?.afterText, actor: 'local-user' });
      const verification = await api.verifyPlan({ plan: planPreview });
      const refreshed = await api.scanWorkspace(workspace);
      setInventory(refreshed);
      setGitDetails(refreshed.git);
      setPlanPreview(null);
      setPlanPayload(null);
      setMessage(`计划已${applied.status === 'already-applied' ? '确认已执行' : '执行'}，验证${verification.ok ? '通过' : '未通过'}。`);
    } catch (error) {
      setMessage(`计划执行失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ARCHITECTURE MANAGER · 3.4.0</div>
          <h1>架构管理台</h1>
          <p className="subtitle">独立用户版 · 本地只读盘点</p>
        </div>
        <button className="primary-button" onClick={async () => scan(await api.selectWorkspace())} disabled={busy}>
          {busy ? '扫描中…' : '选择工作区'}
        </button>
      </header>

      <section className="workspace-bar">
        <span className="status-dot" />
        <span className="workspace-label">当前工作区</span>
        <code>{workspace || '尚未选择'}</code>
        <span className="read-only-badge">只读模式</span>
      </section>

      <section className="content">
        <div className="notice" role="status" aria-live="polite"><strong>当前状态：</strong>{message}</div>
        <div className="stats-grid">
          <Stat label="平台" value={inventory?.platforms?.length ?? '—'} hint="独立配置入口" />
          <Stat label="共享仓" value={inventory?.sharedRepositories?.length ?? '—'} hint="tool · agent · software" />
          <Stat label="架构文档" value={inventory?.architectureDocuments?.length ?? '—'} hint="来自 versions/" />
          <Stat label="Git" value={gitState} hint={inventory?.git?.branch || '未读取分支'} />
        </div>

        <div className="panel-grid">
          <section className="panel platform-panel">
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
          </section>
          <section className="panel catalog-panel">
            <div className="panel-title"><span>Agent 与 Skill 管理</span><div className="panel-tools"><input className="filter-input" value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value)} placeholder="筛选 id" />{inventory && <><button className="small-button" onClick={() => previewRegistryAction('agent', 'add')}>从文件添加 agent</button><button className="small-button" onClick={() => previewRegistryAction('skill', 'add')}>从文件添加 skill 目录</button></>}</div></div>
            <div className="catalog-columns">
              <div><div className="subheading">Agent（{agents.length}）</div>{agents.map((item) => <div className="catalog-row" key={`agent-${item.id}`}><div><button className="link-button" onClick={() => openCatalog('agent', item.id)}>{item.id}</button><span className={item.enabled === false ? 'pill' : 'pill good'}>{item.enabled === false ? '停用' : '启用'}</span><div className="resource-repo">版本 {item.version || '按 current 读取'} · {item.deprecated ? '已弃用' : '现行'}</div></div><div className="resource-actions"><button className="small-button" onClick={() => openCatalog('agent', item.id)}>查看全部</button><button className="small-button" onClick={() => previewRegistryAction('agent', item.enabled === false ? 'enable' : 'disable', item)}>{item.enabled === false ? '启用计划' : '停用计划'}</button><button className="small-button danger-button" onClick={() => previewRegistryAction('agent', 'remove', item)}>移除计划</button></div></div>)}</div>
              <div><div className="subheading">Skill 目录（{skills.length}）</div>{skills.map((item) => <div className="catalog-row" key={`skill-${item.id}`}><div><button className="link-button" onClick={() => openCatalog('skill', item.id)}>{item.id}</button><span className={item.enabled === false ? 'pill' : 'pill good'}>{item.enabled === false ? '停用' : '启用'}</span><div className="resource-repo">{item.path}</div></div><div className="resource-actions"><button className="small-button" onClick={() => openCatalog('skill', item.id)}>查看目录</button><button className="small-button" onClick={async () => { try { const detail = await api.readCatalogEntry({ workspaceRoot: workspace, kind: 'skill', id: item.id }); const selected = detail.catalog?.skills?.filter((skill) => !skillFilter || skill.id.toLowerCase().includes(skillFilter.toLowerCase())); setSkillDetail({ ...detail, visibleSkills: selected }); } catch (error) { setMessage(`读取技能正文失败：${friendlyError(error)}`); } }}>查看技能内容</button><button className="small-button" onClick={() => previewRegistryAction('skill', item.enabled === false ? 'enable' : 'disable', item)}>{item.enabled === false ? '启用计划' : '停用计划'}</button><button className="small-button danger-button" onClick={() => previewRegistryAction('skill', 'remove', item)}>移除计划</button></div></div>)}</div>
            </div>
            {catalogDetail && <div className="catalog-detail"><div className="editor-heading"><strong>{catalogDetail.kind} / {catalogDetail.id}</strong><button className="small-button" onClick={() => setCatalogDetail(null)}>关闭详情</button></div><div className="path-line">{catalogDetail.promptPath || catalogDetail.catalogPath || catalogDetail.registryPath}</div><pre>{catalogDetail.kind === 'agent' ? `${JSON.stringify(catalogDetail.manifest, null, 2)}\n\n${catalogDetail.prompt || ''}` : catalogDetail.catalogText || JSON.stringify(catalogDetail.catalog, null, 2)}</pre></div>}
            {skillDetail && <div className="catalog-detail"><div className="editor-heading"><strong>{skillDetail.id} 的技能条目（{skillDetail.visibleSkills?.length || 0}/{skillDetail.skillCount}）</strong><div className="panel-tools"><input className="filter-input" value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} placeholder="筛选技能 id" /><button className="small-button" onClick={() => setSkillDetail(null)}>关闭详情</button></div></div><div className="skill-detail-list">{(skillDetail.visibleSkills || []).map((skill) => <div className="catalog-row" key={`${skill.id}-${skill.version}`}><span><strong>{skill.id}</strong><span className="resource-repo">v{skill.version} · {skill.sourcePath || ''}</span></span><button className="small-button" onClick={async () => { try { setSkillDetail({ ...skillDetail, selectedSkill: await api.readSkillContent({ workspaceRoot: workspace, catalogId: skillDetail.id, id: skill.id, version: skill.version }) }); } catch (error) { setMessage(`技能正文读取失败：${friendlyError(error)}`); } }}>读取正文</button></div>)}</div>{skillDetail.selectedSkill && <pre>{skillDetail.selectedSkill.content}</pre>}</div>}
            {!inventory && <div className="empty">选择工作区后读取 agent registry 和 skill 目录。正文只读查看，启用/停用/移除先生成计划。</div>}
          </section>
          <section className="panel">
            <div className="panel-title"><span>安全边界</span><span className="muted">P1</span></div>
            <ul className="checks">
              <li><span className="check">✓</span>页面没有 Node 文件系统权限</li>
              <li><span className="check">✓</span>扫描器明确标记 writePerformed=false</li>
              <li><span className="check">✓</span>路径越界在 API 层拒绝</li>
              <li><span className="check">✓</span>后续写入必须经过计划层</li>
            </ul>
          </section>
          <section className="panel help-panel">
            <div className="panel-title"><span>新手操作</span><span className="muted">不需要控制台</span></div>
            <ol className="help-list">
              <li>点击“选择工作区”，选中自己的 `E:\ai` 架构目录。</li>
              <li>平台先看目录和 bridge 标记；添加、排除只改变本机管理视图，不删除平台文件。</li>
              <li>Agent/Skill 点“查看全部”看正文，启用、停用、移除和添加都会先生成 registry 计划。</li>
              <li>更新计划按 P 项和复选框显示进度；文档编辑、指针和 registry 写入都要确认。</li>
              <li>软件中心显示绝对路径、相对路径和入口；打开目录或启动都保留人工确认。</li>
            </ol>
          </section>
          <section className="panel">
            <div className="panel-title"><span>三仓资源</span><div className="panel-tools"><input className="filter-input" value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} placeholder="筛选资源" /><span className="muted">current 只读</span></div></div>
            <div className="rows resource-rows">
              {resources.filter((resource) => !resourceFilter || `${resource.repository}/${resource.resourceId}`.toLowerCase().includes(resourceFilter.toLowerCase())).map((resource) => (
                <div className="row resource-row" key={`${resource.repository}/${resource.resourceId}`}>
                  <div><span className="row-name">{resource.resourceId}</span><span className="resource-repo">{resource.repository}</span></div>
                  <div className="resource-actions"><span className={resource.valid ? 'pill good' : 'pill warn'}>{resource.version || '无版本'}</span><select className="version-select" value={targetVersions[`${resource.repository}/${resource.resourceId}`] || ''} onChange={(event) => setTargetVersions((state) => ({ ...state, [`${resource.repository}/${resource.resourceId}`]: event.target.value }))}><option value="">选择版本</option>{resource.availableVersions?.map((version) => <option key={version} value={version}>{version}</option>)}</select><button className="small-button" disabled={!targetVersions[`${resource.repository}/${resource.resourceId}`]} onClick={() => previewResource(resource)}>生成切换计划</button></div>
                </div>
              ))}
              {!inventory && <div className="empty">选择工作区后显示资源。</div>}
              {inventory && resources.length === 0 && <div className="empty">没有发现 current.json 指针。</div>}
            </div>
          </section>
          <section className="panel document-panel">
            <div className="panel-title"><span>更新计划与说明文档</span><div className="panel-tools"><input className="filter-input" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} placeholder="搜索文件名或类型" /><span className="muted">{visibleDocuments.length}/{documentSummaries.length} 篇</span></div></div>
            <div className="document-list">
              {visibleDocuments.map((item) => (
                <button className="document-item" key={item.path} onClick={() => openDocument(item.path)}>
                  <span><strong>{item.path.replace('versions/', '')}</strong><small>{item.checklistTotal ? ` · ${item.checklistDone}/${item.checklistTotal} 项完成` : item.pItems.length ? ` · ${item.pItems.length} 个 P 项` : ` · ${item.bytes} 字节`}</small></span>
                  <span className="document-badges"><span className="pill">{item.kind === 'implementation-table' ? 'P表' : item.kind === 'proposal' ? '方案' : item.kind === 'ledger' ? '台账' : item.kind === 'top-level-requirements' ? '顶层要求' : '文档'}</span>{item.completionPercent != null && <span className="pill good">{item.completionPercent}%</span>}</span>
                </button>
              ))}
              {inventory && visibleDocuments.length === 0 && <div className="empty">没有匹配的文档。</div>}
              {!inventory && <div className="empty">选择工作区后显示全部方案、P 表、台账和顶层要求。</div>}
            </div>
            {selectedDocument && <div className="editor-box">
              <div className="editor-heading"><strong>{selectedDocument.path}</strong><span className="muted">SHA-256 {selectedDocument.sha256.slice(0, 12)}…</span></div>
              <textarea value={documentDraft} onChange={(event) => setDocumentDraft(event.target.value)} spellCheck={false} />
              {selectedDocument.sensitive && <label className="sensitive-confirm"><input type="checkbox" checked={sensitiveConfirmed} onChange={(event) => setSensitiveConfirmed(event.target.checked)} /> 我确认这是顶层治理要求的变更预览</label>}
              <button className="small-button" onClick={previewDocument}>生成文档变更计划</button>
            </div>}
          </section>
          <section className="panel software-panel">
            <div className="panel-title"><span>软件中心</span><span className="muted">recipe / connector</span></div>
            <div className="rows">
              {software.map((item) => {
                const result = softwareResults[item.id];
                return <div className="software-row" key={item.id}>
                  <div className="software-main"><span className="row-name">{item.displayName}</span><span className="resource-repo">{item.id} · {item.version}</span><div className="software-meta">{item.transport || '未声明'} · {item.bodyExists === true ? '本体已发现' : item.bodyExists === false ? '本体未发现' : '路径待核对'} · {item.snapshotFrozen ? '快照已冻结' : '快照待核验'}</div><div className="software-path"><strong>绝对路径：</strong>{item.bodyPath || '配方未声明'}<br /><strong>工作区相对配方：</strong>{item.versionRoot}<br /><strong>入口：</strong>{item.entrypoint || item.versionCall?.[0] || '由 connector/provider 处理'}{item.endpoint && <><br /><strong>端点：</strong>{item.endpoint}</>}</div></div>
                  <div className="resource-actions software-actions"><span className={result?.status === 'PASS' ? 'pill good' : result ? 'pill warn' : 'pill'}>{result?.status || '未检查'}</span><button className="small-button" onClick={() => checkSoftware(item)}>健康检查</button><button className="small-button" onClick={() => previewSoftwareLocation(item)}>打开位置</button><button className="small-button" onClick={() => previewSoftware(item)}>启动计划</button></div>
                </div>;
              })}
              {!inventory && <div className="empty">选择工作区后显示软件。</div>}
            </div>
          </section>
          <section className="panel git-panel">
            <div className="panel-title"><span>Git 与备份</span><span className="muted">计划预览</span></div>
            <div className="git-summary">
              <div><span className="muted">分支</span><code>{gitDetails?.branch || '—'}</code></div>
              <div><span className="muted">HEAD</span><code>{gitDetails?.head ? `${gitDetails.head.slice(0, 12)}…` : '—'}</code></div>
              <div><span className="muted">远端</span><code>{gitDetails?.upstream || gitDetails?.remotes?.[0] || '未绑定'}</code></div>
              <div><span className="muted">同步</span><span>{gitDetails?.ahead == null ? '未设置 upstream' : `ahead ${gitDetails.ahead} · behind ${gitDetails.behind}`}</span></div>
              <div><span className="muted">改动</span><span>{gitDetails?.status?.length ?? '—'} 项</span></div>
            </div>
            <div className="git-actions">
              <button className="small-button" onClick={refreshGit} disabled={!workspace}>刷新并扫敏感文件</button>
              <button className="small-button" onClick={() => previewGit('commit')} disabled={!workspace}>提交计划</button>
              <button className="small-button" onClick={() => previewGit('push')} disabled={!workspace}>推送计划</button>
              <button className="small-button" onClick={() => previewGit('backup')} disabled={!workspace}>备份计划</button>
              <button className="small-button" onClick={() => previewGit('rollback')} disabled={!workspace}>回滚计划</button>
            </div>
            {sensitiveScan && <div className={sensitiveScan.clean ? 'scan-result clean' : 'scan-result warning'}>{sensitiveScan.clean ? '敏感文件扫描通过' : `发现 ${sensitiveScan.findings.length} 项待核对`}<span className="muted"> · 所有计划仍需确认后执行</span></div>}
            {sensitiveScan?.findings?.length > 0 && <ul className="finding-list">{sensitiveScan.findings.slice(0, 8).map((finding) => <li key={`${finding.path}-${finding.kind}`}><code>{finding.path}</code> · {finding.kind}</li>)}</ul>}
          </section>
        </div>
        {planPreview && <section className="plan-preview">
          <div className="panel-title"><span>计划预览</span><div className="plan-buttons">{['document-edit', 'resource-pointer', 'platform-view', 'registry-edit'].includes(planPreview.kind) && <button className="small-button primary-small" onClick={executePlan}>确认并执行</button>}{planPreview.kind === 'software-action' && planPreview.target?.mode === 'open-location' && <button className="small-button primary-small" onClick={executePlan}>确认打开目录</button>}<button className="small-button" onClick={() => { setPlanPreview(null); setPlanPayload(null); }}>关闭</button></div></div>
          <div className="plan-meta"><code>{planPreview.planId}</code><span className="read-only-badge">尚未执行</span></div>
          {['document-edit', 'resource-pointer', 'platform-view', 'registry-edit'].includes(planPreview.kind) && <div className="plan-explain">执行前会重新检查基线哈希；确认后才会写入，执行结果会立即回读验证。平台排除只写本机管理视图，不删除目录。</div>}
          {planPreview.kind === 'software-action' && <div className="plan-explain">软件动作需要人工确认；启动计划仍由已登记 connector/provider 处理，打开位置只会打开配方声明的目录。</div>}
          <pre>{JSON.stringify(planPreview, null, 2)}</pre>
        </section>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
