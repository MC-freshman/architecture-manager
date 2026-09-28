import React from 'react';

export function PlatformPanel({ inventory, showExcluded, setShowExcluded, addPlatformDirectory, previewPlatform }) {
  return <section className="panel platform-panel">
    <div className="panel-title"><span>平台接入与视图</span><div className="panel-tools"><span className="muted">配置发现；尚非接入认证</span>{inventory && <button className="small-button" onClick={addPlatformDirectory}>添加平台目录</button>}</div></div>
    <div className="rows">
      {(inventory?.platforms || []).filter((platform) => showExcluded || platform.enabled).map((platform) => (
        <div className="row" key={platform.id}>
          <div className="platform-main"><span className="row-name">{platform.id}</span><span className="resource-repo">{platform.directoryRelative}</span><div className="path-line">{platform.directoryPath}</div><div className="marker-list">{platform.markers.map((marker) => <span className={marker.exists ? 'marker good' : 'marker missing'} key={marker.path}>{marker.exists ? '✓' : '×'} {marker.label}</span>)}</div>{platform.bridgeLocation === 'legacy' && <div className="path-line">旧位置可读；标准位置为 {platform.id}/bridge.json</div>}{platform.bridgeConflict && <div className="path-line">两份 bridge.json 内容不同，请先处理冲突；管理台不会自动覆盖。</div>}</div>
          <div className="resource-actions"><span className={platform.status === 'ready' && platform.enabled ? 'pill good' : platform.enabled ? 'pill warn' : 'pill'}>{!platform.enabled ? '已排除视图' : platform.status === 'ready' ? '发现配置·待自证' : platform.status === 'bridge-conflict' ? '配置冲突' : platform.status === 'missing-directory' ? '缺目录' : '缺 bridge.json'}</span>{inventory && <button className="small-button" onClick={() => previewPlatform(platform)}>{platform.enabled ? '排除视图' : '加入视图'}</button>}</div>
        </div>
      ))}
      {inventory && <label className="show-excluded"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} /> 显示已排除视图的平台</label>}
      {!inventory && <div className="empty">选择工作区后显示平台。添加前会检查目录和 bridge 标记文件。</div>}
    </div>
  </section>;
}
