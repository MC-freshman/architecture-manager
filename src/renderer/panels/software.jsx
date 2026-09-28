import React, { useEffect, useState } from 'react';

export function SoftwarePanel({ api, workspace, inventory, software, softwareResults, checkSoftware, previewSoftwareLocation, previewSoftware, previewSoftwareImport, previewSoftwareRecipe, setMessage }) {
  const [platformId, setPlatformId] = useState('codex');
  const [softwareId, setSoftwareId] = useState('');
  const [intakeKind, setIntakeKind] = useState('portable-file');
  const [sourcePath, setSourcePath] = useState('');
  const [intakes, setIntakes] = useState([]);
  const [recipeId, setRecipeId] = useState('');
  const [bodyName, setBodyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [upstreamVersion, setUpstreamVersion] = useState('');
  const [license, setLicense] = useState('unknown');
  const [versionFlag, setVersionFlag] = useState('--version');
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    api.listSoftwareIntakes({ workspaceRoot: workspace, platformId }).then((rows) => { if (active) setIntakes(rows); }).catch(() => { if (active) setIntakes([]); });
    return () => { active = false; };
  }, [api, workspace, platformId, inventory]);
  const selectedIntake = intakes.find((item) => item.id === recipeId);
  const chooseSource = async () => {
    try { setSourcePath(await api.selectSoftwareSource(intakeKind) || ''); }
    catch (error) { setMessage(`选择文件失败：${String(error?.message ?? error)}`); }
  };
  return <section className="panel software-panel"><div className="panel-title"><span>软件中心</span><span className="muted">recipe / connector</span></div><div className="rows">
    {inventory && <div className="software-intake"><div className="integration-help">添加新软件：从“下载”位置选择文件或已解压目录。管理台会复制到所属平台的 runtime/software，并做完整备份与真实恢复演练；共享 software 仓只放后续配方，不放程序本体。</div><div className="integration-form"><label>所属平台<select value={platformId} onChange={(event) => setPlatformId(event.target.value)}>{(inventory.platforms || []).filter((item) => item.directoryExists).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><label>软件 ID（英文小写）<input value={softwareId} onChange={(event) => setSoftwareId(event.target.value.toLowerCase())} placeholder="例如 my-editor" /></label><label>下载内容<select value={intakeKind} onChange={(event) => { setIntakeKind(event.target.value); setSourcePath(''); }}><option value="portable-file">便携程序文件</option><option value="unpacked-directory">已解压软件目录</option><option value="installer">安装包（只登记，不自动安装）</option></select></label></div><div className="path-line">所选来源：{sourcePath || '尚未选择'}</div><div className="resource-actions"><button className="small-button" onClick={chooseSource}>选择文件或目录</button><button className="small-button primary-small" disabled={!workspace || !sourcePath || !/^[a-z0-9][a-z0-9._-]*$/.test(softwareId)} onClick={() => previewSoftwareImport({ platformId, softwareId, sourcePath, intakeKind })}>预览安置与备份计划</button></div></div>}
    {inventory && <div className="software-intake"><div className="integration-help">发布配方：目前自动向导仅覆盖已安置的 Windows 便携 CLI 程序，并且只声明经过真实询问的“版本查询”能力。安装包、GUI、HTTP/MCP 或其它业务操作需要对应适配器与能力验证，界面不会把它们报为已接入。</div><div className="integration-form"><label>已安置的软件<select value={recipeId} onChange={(event) => { setRecipeId(event.target.value); setBodyName(''); }}><option value="">选择软件</option>{intakes.map((item) => <option key={item.id} value={item.id}>{item.id}{item.restored ? '' : ' · 备份待核验'}</option>)}</select></label><label>程序入口<select value={bodyName} onChange={(event) => setBodyName(event.target.value)}><option value="">选择 exe</option>{(selectedIntake?.files || []).filter((name) => name.toLowerCase().endsWith('.exe')).map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>软件名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 My Editor" /></label><label>上游版本<input value={upstreamVersion} onChange={(event) => setUpstreamVersion(event.target.value)} placeholder="须与版本查询输出一致" /></label><label>许可证<input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="不确定可填 unknown" /></label><label>版本参数<select value={versionFlag} onChange={(event) => setVersionFlag(event.target.value)}><option value="--version">--version</option><option value="-V">-V</option><option value="-v">-v</option></select></label></div><div className="resource-actions"><button className="small-button primary-small" disabled={!selectedIntake?.restored || selectedIntake?.intakeKind === 'installer' || !bodyName || !displayName.trim() || !upstreamVersion.trim()} onClick={() => previewSoftwareRecipe({ platformId, softwareId: recipeId, bodyName, displayName, upstreamVersion, license, versionFlag })}>询问版本并预览配方</button></div></div>}
    {software.map((item) => { const result = softwareResults[item.id]; return <div className="software-row" key={item.id}><div className="software-main"><span className="row-name">{item.displayName}</span><span className="resource-repo">{item.id} · {item.version}</span><div className="software-meta">{item.transport || '未声明'} · {item.bodyExists === true ? '本体已发现' : item.bodyExists === false ? '本体未发现' : '路径待核对'} · {item.snapshotFrozen ? '快照已冻结' : '快照待核验'}</div><div className="software-path"><strong>绝对路径：</strong>{item.bodyPath || '配方未声明'}<br /><strong>工作区相对配方：</strong>{item.versionRoot}<br /><strong>入口：</strong>{item.entrypoint || item.versionCall?.[0] || '由 connector/provider 处理'}{item.endpoint && <><br /><strong>端点：</strong>{item.endpoint}</>}</div></div><div className="resource-actions software-actions"><span className={result?.status === 'PASS' ? 'pill good' : result ? 'pill warn' : 'pill'}>{result?.status || '未检查'}</span><button className="small-button" onClick={() => checkSoftware(item)}>健康检查</button><button className="small-button" onClick={() => previewSoftwareLocation(item)}>打开位置</button><button className="small-button" onClick={() => previewSoftware(item)}>启动计划</button></div></div>; })}
    {!inventory && <div className="empty">选择工作区后显示软件。</div>}
  </div></section>;
}
