import declarations from '../../app/operations.json' with {type:'json'};

export function taskClient(api,workspaceSession) {
  // Electron contextBridge freezes its public methods. Copy them before wrapping:
  // a Proxy cannot substitute a non-configurable, read-only target property.
  return Object.fromEntries(Object.keys(api).map(method=>{
    const operation=declarations.operations[method];
    return [method,operation?.backend?(...args)=>api[method](...args,{__managerTaskContext:true,jobId:globalThis.crypto.randomUUID(),workspaceSession}):api[method]];
  }));
}
export function progressMatches(progress,workspace,workspaceSession) {
  if(progress.workspaceSession) return progress.workspaceSession===workspaceSession;
  return !workspace || !progress.workspaceRoot || progress.workspaceRoot===workspace;
}
export async function cancelTaskProgress(api,progress,workspace,workspaceSession) {
  const workspaceRoot=progress.workspaceRoot || workspace;
  if(progress.jobId) return api.cancelTask({jobId:progress.jobId,workspaceRoot,workspaceSession});
  const result=await api.cancelOnboarding({workspaceRoot,platformId:progress.platformId});
  return result.status==='cancellation-requested';
}
