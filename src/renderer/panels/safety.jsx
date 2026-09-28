import React from 'react';

export function SafetyPanel() {
  return <section className="panel"><div className="panel-title"><span>安全边界</span><span className="muted">P1–P4</span></div><ul className="checks"><li><span className="check">✓</span>页面没有 Node 文件系统权限</li><li><span className="check">✓</span>扫描器明确标记 writePerformed=false</li><li><span className="check">✓</span>路径越界在 API 层拒绝</li><li><span className="check">✓</span>后续写入必须经过计划层</li></ul></section>;
}

export function HelpPanel() {
  return <section className="panel help-panel"><div className="panel-title"><span>新手操作</span><span className="muted">不需要控制台</span></div><ol className="help-list"><li>点击“选择工作区”，选中自己的 E:\ai 架构目录。</li><li>平台先看目录和 bridge 标记；添加、排除只改变本机管理视图，不删除平台文件。</li><li>Agent/Skill 点“查看全部”看正文，启用、停用、移除和添加都会先生成 registry 计划。</li><li>手动接入向导统一处理平台配置、tool/agent/software 指针和 registry；每次都是 plan → 确认 → verify。</li><li>软件中心显示绝对路径、相对路径和入口；打开目录或启动都保留人工确认。</li></ol></section>;
}
