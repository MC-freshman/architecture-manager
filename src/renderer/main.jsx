import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = window.architectureManager;

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

  const scan = async (root) => {
    if (!root) return;
    setBusy(true);
    setMessage('正在只读扫描工作区……');
    try {
      const result = await api.scanWorkspace(root);
      setWorkspace(result.workspaceRoot);
      setInventory(result);
      setMessage(result.errors.length === 0 ? '扫描完成，当前页面没有执行写入。' : `扫描完成，发现 ${result.errors.length} 个待处理问题。`);
    } catch (error) {
      setMessage(`扫描失败：${error.message}`);
    } finally {
      setBusy(false);
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

  const previewPlatform = async (platform) => {
    const currentEnabled = platformView[platform.id] ?? platform.directoryExists;
    const desiredEnabled = !currentEnabled;
    try {
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId: platform.id, currentEnabled, desiredEnabled });
      setPlatformView((state) => ({ ...state, [platform.id]: desiredEnabled }));
      setPlanPreview(plan);
      setMessage(`已生成本地视图计划：${platform.id} 将${desiredEnabled ? '显示' : '排除'}。尚未写入。`);
    } catch (error) {
      setMessage(`计划生成失败：${error.message}`);
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
        availableVersions: resource.availableVersions
      });
      setPlanPreview(plan);
      setMessage(`已生成资源指针计划：${resource.repository}/${resource.resourceId}。尚未写入。`);
    } catch (error) {
      setMessage(`资源计划被拒绝：${error.message}`);
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
        <div className="notice"><strong>当前状态：</strong>{message}</div>
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
        </div>
        {planPreview && <section className="plan-preview">
          <div className="panel-title"><span>计划预览</span><button className="small-button" onClick={() => setPlanPreview(null)}>关闭</button></div>
          <div className="plan-meta"><code>{planPreview.planId}</code><span className="read-only-badge">尚未执行</span></div>
          <pre>{JSON.stringify(planPreview, null, 2)}</pre>
        </section>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
