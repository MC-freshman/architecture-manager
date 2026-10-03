import React,{useState} from 'react';
import {friendlyError} from '../../presenter.mjs';
const labels={agent:'智能体（agent）',skill:'技能（skill）',tool:'工具／工作流（tool）',platform:'平台客户端',software:'软件／现成 MCP'};
const size=value=>value>=1024*1024*1024?(value/(1024*1024*1024)).toFixed(2)+' GB':value>=1024*1024?(value/(1024*1024)).toFixed(1)+' MB':value>=1024?(value/1024).toFixed(1)+' KB':value+' B';
export function BodyIntakePanel({api,workspace,inventory,setMessage,onIntake=null}) {
  const [type,setType]=useState('agent'),[platformId,setPlatformId]=useState(inventory?.platforms?.[0]?.id || ''),[sourcePath,setSourcePath]=useState(''),[result,setResult]=useState(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(0);
  const choose=async kind=>{try{const path=await api.selectBodySource({kind});if(path){setSourcePath(path);setResult(null);setError('');}else setMessage('已取消选择，原来源未改变。');}catch(error){setError(friendlyError(error));}};
  const scan=async()=>{
    setWorking(true);setError('');setPage(0);
    try{const value=await api.scanExternalBody({workspaceRoot:workspace,platformId:platformId || null,type,sourcePath});setResult(value);onIntake?.(value);setMessage('来源已识别；尚未安置、发布或启动本体。');}
    catch(error){setResult(null);const message=friendlyError(error);setError(message);setMessage(message);}
    finally{setWorking(false);}
  };
  const files=result?[...result.files.map(row=>({...row,label:row.included?'拟纳入':row.reason})),...result.excluded.map(row=>({...row,label:'排除：'+row.reason}))]:[];
  const entry=result?.files.find(row=>row.path===result.selectedEntry);
  return <section className="panel body-intake-panel"><div className="panel-title"><span>从本体接入</span><span className="muted">选文件／文件夹／ZIP → 识别 → 转换预览 → 确认接入</span></div>
    <p>来源不必事先放进三仓。原件保留；包内文字只是导入内容，管理台不会执行其中的指令。</p>
    <div className="wizard-grid">
      <div className="wizard-field"><label>要接入什么</label><select value={type} onChange={event=>{setType(event.target.value);setResult(null);}}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
      <div className="wizard-field"><label>所属平台（本体、环境与证据归属）</label><select value={platformId} onChange={event=>{setPlatformId(event.target.value);setResult(null);}}><option value="">稍后选择</option>{inventory?.platforms?.map(platform=><option key={platform.id} value={platform.id}>{platform.displayName || platform.id}</option>)}</select></div>
      <div className="wizard-field"><label>本体来源</label><input value={sourcePath} onChange={event=>{setSourcePath(event.target.value);setResult(null);}} placeholder="使用下方按钮选择现有文件或目录" /></div>
    </div>
    <div className="git-actions"><button className="small-button" disabled={working} onClick={()=>choose('file')}>选择文件／ZIP</button><button className="small-button" disabled={working} onClick={()=>choose('directory')}>选择文件夹</button><button className="primary-small" disabled={!workspace || !sourcePath || working} onClick={scan}>{working?'正在读取来源…':'识别并预览来源'}</button></div>
    {error && <div className="scan-result warning" role="alert">{error}</div>}
    {result && <>
      <div className="scan-result clean">识别完成：{result.sourceKind}，{result.files.length} 个文件，{size(result.bodyBytes)}。原件保留，尚未接入。</div>
      <div className="path-line">来源：{result.sourcePath}<br />来源 SHA-256：{result.sourceFingerprint}</div>
      <p>落盘估计 {size(result.space.steadyBytes)}，恢复演练峰值 {size(result.space.peakBytes)}；{result.space.freeBytes===null?'目标空闲空间待确认':`目标空闲 ${size(result.space.freeBytes)}`}{result.space.sufficient===false?'，当前空间不足。':'。'}</p>
      <div className="wizard-field"><label>确认正文／程序入口</label><select value={result.selectedEntry || ''} onChange={event=>{const value={...result,selectedEntry:event.target.value || null};setResult(value);onIntake?.(value);}}><option value="">请选择明确的入口</option>{result.choices.map(row=><option key={row.path} value={row.path}>{row.path}{row.installer?'（安装包，尚未安装）':''}</option>)}</select></div>
      <div className="muted">共享文本仓仅纳入可冻结文本与源码；缓存、凭据和程序本体不会被当成 agent／tool 发布。</div>
      <div className="notice"><strong>转换预览</strong><p>{result.conversion.description}</p><p>准备生成：{result.conversion.generatedFiles.join('、')}。确认入口、资源 ID、版本与依赖后才会生成写入计划。</p></div>
      <ul className="finding-list">{files.slice(page*50,(page+1)*50).map(row=><li key={row.path}><code>{row.path}</code> · {row.bytes==null?'目录':size(row.bytes)} · {row.label}</li>)}</ul>
      <div className="git-actions"><button className="small-button" disabled={page===0} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(files.length/50))} 页</span><button className="small-button" disabled={(page+1)*50>=files.length} onClick={()=>setPage(value=>value+1)}>下一页</button></div>
      {entry?.preview && <details open><summary>入口正文预览{entry.previewTruncated?'（截断预览，完整正文保留在来源）':''}</summary><pre className="path-line">{entry.preview}</pre></details>}
      {!onIntake && <p className="muted">转换与接入表单正在按 P10–P15 接通；当前识别不会写入三仓或启动程序。</p>}
    </>}
  </section>;
}
