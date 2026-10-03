import declarations from '../../app/operations.json' with {type:'json'};

export function taskClient(api,workspaceSession) {
  return new Proxy(api,{get(target,method) {
    const operation=declarations.operations[method];
    if(!operation?.backend) return target[method];
    return (...args)=>target[method](...args,{__managerTaskContext:true,jobId:globalThis.crypto.randomUUID(),workspaceSession});
  }});
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
