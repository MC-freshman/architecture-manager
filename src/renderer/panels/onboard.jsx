import React, { useEffect, useState } from 'react';

const STEPS = ['选择平台', '完整配置', '准备环境', '客户端入口', '检查与接入', '登记与恢复'];
const EMPTY = { displayName: '', pythonExecutable: '', environmentManifest: '', scriptEnvironment: '', executionBackend: '', peerDispatcherModule: '', peerContentRoot: '', softwareGateway: '', softwareEnvironment: '', clientKind: 'cli', clientExecutable: '', clientArgs: [], probeTool: '', probeArguments: {} };

export function OnboardPanel({ api, workspace, inventory, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [selection, setSelection] = useState('__new__');
  const [newId, setNewId] = useState('');
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const [snapshot, setSnapshot] = useState(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  const [localError, setLocalError] = useState('');
  const platformId = selection === '__new__' ? newId : selection;
  const input = () => ({ workspaceRoot: workspace, platformId, fields, confirmed });
  const field = (key, value) => setFields((old) => ({ ...old, [key]: value }));
  useEffect(() => {
    if (!workspace || !/^[a-z][a-z0-9-]{1,30}$/.test(platformId)) { setSnapshot(null); return; }
    let active = true;
    api.readOnboardingConfig({ workspaceRoot: workspace, platformId }).then((data) => {
      if (!active) return;
      setSnapshot(data); setFields(data.fields); setLocalError('');
    }).catch((error) => { if (active) setLocalError(friendlyError(error)); });
    return () => { active = false; };
  }, [workspace, platformId, inventory]);
  const act = async (operation, message) => {
    setWorking(true); setLocalError('');
    try {
      const value = await operation();
      if (value?.schema === 'architecture-manager-plan/v1') { setPlanPreview(value); setPlanPayload(null); }
      else setResult(value);
      if (message) setMessage(message);
      return value;
    } catch (error) { const text = friendlyError(error); setLocalError(text); setMessage(text); }
    finally { setWorking(false); }
  };
  const selectFile = async (key) => { const path = await api.selectOnboardingFile(); if (path) field(key, path); else setLocalError('已取消选择文件。'); };
  const run = async () => {
    if (!await api.confirm(`开始 ${platformId} 的接入检查？将使用它自己的配置和环境，保存逐步记录。没有通过的能力不会被声明为已接入。`)) return;
    return act(() => api.runOnboardingPipeline({ workspaceRoot: workspace, platformId, includeMatrix: true }), '接入执行结果已返回。');
  };
  const fileField = (key, label) => <label className="onboarding-field" key={key}><span>{label}</span><div className="onboarding-input"><input value={fields[key] || ''} onChange={(event) => field(key, event.target.value)} /><button className="small-button" disabled={working} onClick={() => selectFile(key)}>选择文件</button></div></label>;
  return <section className="panel onboarding-panel">
    <div className="panel-title"><span>平台接入向导</span><span className="muted">配置、环境、入口与验证由管理台执行</span></div>
    {!workspace ? <div className="empty">请先选择你的架构工作区。</div> : <>
      <nav className="onboarding-steps" aria-label="接入步骤">{STEPS.map((name, index) => <button className={`small-button ${step === index ? 'primary-small' : ''}`} key={name} onClick={() => setStep(index)}>{index + 1}. {name}</button>)}</nav>
      {localError && <div role="alert" className="onboarding-error">{localError}</div>}
      {step === 0 && <>
        <label className="onboarding-field"><span>操作对象</span><select value={selection} onChange={(event) => { setSelection(event.target.value); setResult(null); setConfirmed(false); }}><option value="__new__">新增平台</option>{(inventory?.platforms || []).map((item) => <option key={item.id} value={item.id}>{item.id} · 修复或升级接入</option>)}</select></label>
        {selection === '__new__' && <label className="onboarding-field"><span>平台 ID</span><input value={newId} onChange={(event) => setNewId(event.target.value.toLowerCase())} placeholder="例如 my-client" /></label>}
        <label className="onboarding-field"><span>显示名称</span><input value={fields.displayName || ''} onChange={(event) => field('displayName', event.target.value)} /></label>
        {selection === '__new__' && <label className="sensitive-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 允许在本工作区创建该平台一级目录</label>}
        <p className="muted">已有平台会保留原配置和运行锁；预览中列出本轮要修改的文件。</p>
      </>}
      {step === 1 && <>
        <p>目标：{platformId || '未选平台'}。三仓根路径自动取当前工作区。</p>
        {snapshot && <div className="onboarding-versions">{Object.values(snapshot.versions).map((item) => <span className="pill" key={item.id}>{item.id} {item.version}</span>)}</div>}
        {fileField('pythonExecutable', 'Python 解释器')}
        <details><summary>高级配置：环境、委派与软件位置</summary>{[['environmentManifest', '环境清单'], ['executionBackend', '隔离后端配置'], ['peerDispatcherModule', '委派 provider'], ['softwareGateway', '软件连接器'], ['softwareEnvironment', '软件本体登记']].map(([key, label]) => fileField(key, label))}
        <label className="onboarding-field"><span>脚本环境目录</span><input value={fields.scriptEnvironment || ''} onChange={(event) => field('scriptEnvironment', event.target.value)} /></label>
        <label className="onboarding-field"><span>委派内容目录</span><input value={fields.peerContentRoot || ''} onChange={(event) => field('peerContentRoot', event.target.value)} /></label></details>
        <button className="small-button primary-small" disabled={working || !snapshot || (selection === '__new__' && !confirmed)} onClick={() => act(() => api.previewOnboardingConfigPlan(input()), '完整配置计划已生成，请核对后确认执行。')}>预览并保存完整配置</button>
      </>}
      {step === 2 && <>
        <p>所需解释器和库安装在 {platformId || '所选平台'}/runtime 内；缺少系统设施时会暂停并告诉你需要点击什么。</p>
        {fileField('pythonExecutable', '用于准备环境的 Python')}
        <button className="small-button primary-small" disabled={working || !snapshot || !snapshot.exists || !api.previewOnboardingRuntimePlan} onClick={() => act(() => api.previewOnboardingRuntimePlan(input()), '环境准备计划已生成；安装前先核对下载和磁盘位置。')}>准备独立运行环境</button>
        <p className="muted">软件本体位置与 provider 可在软件中心绑定；未安装的项目会保留明确缺口。</p>
      </>}
      {step === 3 && <>
        <label className="onboarding-field"><span>客户端接口</span><select value={fields.clientKind} onChange={(event) => field('clientKind', event.target.value)}><option value="cli">JSON CLI 客户端入口</option><option value="mcp-stdio">MCP stdio 客户端入口</option><option value="manual-native">原生客户端测试回执</option></select></label>
        {fileField('clientExecutable', '客户端入口程序')}
        <label className="onboarding-field"><span>入口参数（每行一项）</span><textarea value={(fields.clientArgs || []).join('\n')} onChange={(event) => field('clientArgs', event.target.value.split('\n').filter(Boolean))} /></label>
        {fields.clientKind === 'mcp-stdio' && <label className="onboarding-field"><span>只读回环工具名</span><input value={fields.probeTool || ''} onChange={(event) => field('probeTool', event.target.value)} /></label>}
        <p className="muted">入口需返回本次随机挑战和配置摘要。连通服务与原生客户端已注册会分别显示。</p>
        <button className="small-button" disabled={working || !snapshot} onClick={() => act(() => api.previewOnboardingConfigPlan(input()), '客户端配置计划已生成。')}>保存客户端入口</button>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists || !api.probeOnboardingClient} onClick={() => act(() => api.probeOnboardingClient({ workspaceRoot: workspace, platformId }), '客户端测试结果已返回。')}>测试真实客户端入口</button>
      </>}
      {step === 4 && <>
        <p>开始前请保存配置并完成环境与入口准备。首次接入执行完整矩阵；失败会停在具体步骤。</p>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists} onClick={run}>{working ? '接入检查中…' : '开始接入／继续检查'}</button>
        <button className="small-button" disabled={!working || !api.cancelOnboarding} onClick={() => api.cancelOnboarding({ workspaceRoot: workspace, platformId })}>停止本次接入</button>
      </>}
      {step === 5 && <>
        <p>治理文档和 Git 记录与检查证据一起保存。只有全部必需步骤通过，才显示“接入完成”。</p>
        <button className="small-button" disabled={working || !snapshot?.exists || !api.previewOnboardingGovernancePlan} onClick={() => act(() => api.previewOnboardingGovernancePlan({ workspaceRoot: workspace, platformId }), '治理文档计划已生成。')}>预览治理登记</button>
        <button className="small-button" disabled={working || !snapshot?.exists || !api.readOnboardingState} onClick={() => act(() => api.readOnboardingState({ workspaceRoot: workspace, platformId }))}>查看接入记录与恢复点</button>
      </>}
      {result && <div className="onboarding-result" role="status"><strong>{result.status || result.stage || (result.stoppedAt ? `停止在：${result.stoppedAt}` : '已返回')}</strong>{(result.steps || []).map((item) => <p key={item.step}>{item.step}：{item.status || item.result?.stage || '已返回'} {(item.result?.issues || []).join('；')}</p>)}{result.issues?.map((issue, index) => <p key={index}>{issue}</p>)}<details><summary>证据与读数</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
      <div className="onboarding-footer"><button className="small-button" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</button><span>{step + 1} / {STEPS.length}</span><button className="small-button" disabled={step === STEPS.length - 1 || !platformId} onClick={() => setStep(step + 1)}>下一步</button></div>
    </>}
  </section>;
}
