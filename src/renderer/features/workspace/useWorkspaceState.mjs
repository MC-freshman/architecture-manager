import { useState } from 'react';
export function useWorkspaceState() {
  const [workspace,setWorkspace] = useState(null);
  const [inventory,setInventory] = useState(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('请选择一个架构工作区开始只读扫描。');
  return { workspace,setWorkspace,inventory,setInventory,busy,setBusy,message,setMessage };
}
