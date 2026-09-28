import React from 'react';

export function SafetyPanel() {
  return <section className="panel"><div className="panel-title"><span>安全边界</span><span className="muted">P1–P4</span></div><ul className="checks"><li><span className="check">✓</span>页面没有 Node 文件系统权限</li><li><span className="check">✓</span>扫描器明确标记 writePerformed=false</li><li><span className="check">✓</span>路径越界在 API 层拒绝</li><li><span className="check">✓</span>后续写入必须经过计划层</li></ul></section>;
}

export function HelpPanel() {
  return <section className="panel help-panel"><div className="panel-title"><span>新手操作</span><span className="muted">不需要控制台</span></div><ol className="help-list"><li>点击“选择工作区”，选中自己的 E:\ai 架构目录。</li><li>接入已支持的平台：在“接入与版本向导”选“平台”和客户端，预览创建根级 bridge.json，确认执行；再回到平台面点“检查单格调用”。配置保存不等于接入完成。</li><li>切换 tool 或 agent 默认版本：在资源面选择已发布版本，预览并确认；现有运行不会跟着换版。</li><li>新软件先在“软件中心”选择下载文件和所属平台，做备份与恢复演练；便携 CLI 可继续尝试发布版本查询配方。安装包、GUI、MCP 等未适配类型会保留待办状态。</li><li>每次计划先读白话说明，技术详情可展开；“排除视图”只隐藏显示，不删除文件。</li></ol></section>;
}
