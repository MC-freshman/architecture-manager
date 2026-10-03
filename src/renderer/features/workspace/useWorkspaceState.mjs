import { useState,useRef,useCallback } from 'react';
export function useWorkspaceState() {
  const [workspace,updateWorkspace] = useState(null);
  const [workspaceSession,setWorkspaceSession] = useState(()=>globalThis.crypto.randomUUID());
  const rootRef=useRef(null);
  const setWorkspace=useCallback(root=>{if(root!==rootRef.current) {rootRef.current=root;setWorkspaceSession(globalThis.crypto.randomUUID());setJobs({});}updateWorkspace(root);},[]);
  const [inventory,setInventory] = useState(null);
  const [busy,setBusy] = useState(false);
  const [jobs,setJobs] = useState({});
  const recordProgress=useCallback(progress=>setJobs(current=>{
    if(!progress.jobId) return current;
    if(progress.state==='settled') {const next={...current};delete next[progress.jobId];return next;}
    return {...current,[progress.jobId]:progress};
  }),[]);
  const [message,setMessage] = useState('请选择一个架构工作区开始只读扫描。');
  return { workspace,setWorkspace,workspaceSession,inventory,setInventory,busy:busy || Object.keys(jobs).length>0,setBusy,message,setMessage,recordProgress };
}
