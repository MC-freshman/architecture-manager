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
  const [platformView, setPlatformView] = useState({});
  const [planPreview, setPlanPreview] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentDraft, setDocumentDraft] = useState('');
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [softwareResults, setSoftwareResults] = useState({});
  const [gitDetails, setGitDetails] = useState(null);
  const [sensitiveScan, setSensitiveScan] = useState(null);
  const [planPayload, setPlanPayload] = useState(null);

  const scan = async (root) => {
    if (!root) return;
    setBusy(true);
    setMessage('正在只读扫描工作区……');
    try {
      const result = await api.scanWorkspace(root);
      setWorkspace(result.workspaceRoot);
      setInventory(result);
      setGitDetails(result.git);
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
    api.getDefaultWorkspace().then((root) => root && scan(root));
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

  const planDocuments = useMemo(() => (inventory?.architectureDocuments || []).filter((path) => /实施表|方案|台账|基本原则/.test(path)), [inventory]);
  const software = inventory?.software || [];

  const previewPlatform = async (platform) => {
    const currentEnabled = platformView[platform.id] ?? platform.directoryExists;
    const desiredEnabled = !currentEnabled;
    try {
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId: platform.id, currentEnabled, desiredEnabled });
      setPlatformView((state) => ({ ...state, [platform.id]: desiredEnabled }));
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成本地视图计划：${platform.id} 将${desiredEnabled ? '显示' : '排除'}。尚未写入。`);
    } catch (error) {
      setMessage(`计划生成失败：${friendlyError(error)}`);
    }
  };

  const previewResource = async (resource) => {
    const target = window.prompt(`输入 ${resource.repository}/${resource.resourceId} 的目标版本`, resource.availableVersions?.find((version) => version !== resource.version) || '');
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
    if (!planPreview || !['document-edit', 'resource-pointer'].includes(planPreview.kind)) return;
    const target = planPreview.target?.path || `${planPreview.target?.repository}/${planPreview.target?.resourceId}/current.json`;
    if (!window.confirm(`确认执行此计划？\n\n目标：${target}\n\n执行前会再次核对文件哈希，失败会阻止覆盖。`)) return;
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
          <section className="panel">
            <div className="panel-title"><span>平台状态</span><span className="muted">只读</span></div>
            <div className="rows">
              {(inventory?.platforms || []).map((platform) => (
                <div className="row" key={platform.id}>
                  <span className="row-name">{platform.id}</span>
                  <span className={platform.bridge ? 'pill good' : 'pill warn'}>{platform.bridge ? '已发现 bridge' : '待核对'}</span>
                  {inventory && <button className="small-button" onClick={() => previewPlatform(platform)}>{(platformView[platform.id] ?? platform.directoryExists) ? '排除视图' : '恢复视图'}</button>}
                </div>
              ))}
              {!inventory && <div className="empty">选择工作区后显示平台。</div>}
            </div>
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
              <li>先查看平台、资源、文档和软件状态；所有按钮先生成计划。</li>
              <li>编辑文档后查看哈希变化，再点击“执行计划”确认写入。</li>
              <li>执行后管理台会重新扫描并验证；遇到外部修改会自动拒绝。</li>
            </ol>
          </section>
          <section className="panel">
            <div className="panel-title"><span>三仓资源</span><span className="muted">current 只读</span></div>
            <div className="rows resource-rows">
              {resources.slice(0, 12).map((resource) => (
                <div className="row resource-row" key={`${resource.repository}/${resource.resourceId}`}>
                  <div><span className="row-name">{resource.resourceId}</span><span className="resource-repo">{resource.repository}</span></div>
                  <div className="resource-actions"><span className={resource.valid ? 'pill good' : 'pill warn'}>{resource.version || '无版本'}</span><button className="small-button" onClick={() => previewResource(resource)}>生成切换计划</button></div>
                </div>
              ))}
              {!inventory && <div className="empty">选择工作区后显示资源。</div>}
              {inventory && resources.length > 12 && <div className="muted resource-more">其余 {resources.length - 12} 项将在完整资源页展示。</div>}
            </div>
          </section>
          <section className="panel document-panel">
            <div className="panel-title"><span>更新计划与文档</span><span className="muted">编辑预览</span></div>
            <div className="document-list">
              {planDocuments.slice(0, 10).map((path) => (
                <button className="document-item" key={path} onClick={() => openDocument(path)}>
                  <span>{path.replace('versions/', '')}</span>
                  <span className="pill">{path.includes('实施表') ? 'P表' : path.includes('方案') ? '方案' : path.includes('台账') ? '台账' : '顶层要求'}</span>
                </button>
              ))}
              {!inventory && <div className="empty">选择工作区后显示方案和文档。</div>}
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
                  <div className="software-main"><span className="row-name">{item.displayName}</span><span className="resource-repo">{item.id} · {item.version}</span><div className="software-meta">{item.transport || '未声明'} · {item.bodyExists === true ? '本体已发现' : item.bodyExists === false ? '本体未发现' : '路径待核对'} · {item.snapshotFrozen ? '快照已冻结' : '快照待核验'}</div></div>
                  <div className="resource-actions"><span className={result?.status === 'PASS' ? 'pill good' : result ? 'pill warn' : 'pill'}>{result?.status || '未检查'}</span><button className="small-button" onClick={() => checkSoftware(item)}>健康检查</button><button className="small-button" onClick={() => previewSoftware(item)}>启动计划</button></div>
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
          <div className="panel-title"><span>计划预览</span><div className="plan-buttons">{['document-edit', 'resource-pointer'].includes(planPreview.kind) && <button className="small-button primary-small" onClick={executePlan}>确认并执行</button>}<button className="small-button" onClick={() => { setPlanPreview(null); setPlanPayload(null); }}>关闭</button></div></div>
          <div className="plan-meta"><code>{planPreview.planId}</code><span className="read-only-badge">尚未执行</span></div>
          {['document-edit', 'resource-pointer'].includes(planPreview.kind) && <div className="plan-explain">执行前会重新检查基线哈希；确认后才会写入，执行结果会立即回读验证。</div>}
          <pre>{JSON.stringify(planPreview, null, 2)}</pre>
        </section>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
