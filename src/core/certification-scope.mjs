import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { targetPath } from './paths.mjs';
import { sha256 } from './hash.mjs';
import { inside } from './json.mjs';

// Retain the actual initial matrix across patch updates; changed generations
// still require the full matrix. A partial report never reaches this function.
export function patchCertificationSelection(proof, workspaceRoot, platformId, config) {
  try {
    const base=targetPath(workspaceRoot,`${platformId}/runtime/manager-check`);
    if(!inside(base,proof.matrixPath) || sha256(readFileSync(proof.matrixPath))!==proof.matrixSha256) return null;
    const report=JSON.parse(readFileSync(proof.matrixPath,'utf8'));
    const originalPath=report.provenance?.base?.path || report.recovery?.base?.path || proof.matrixPath;
    const original=JSON.parse(readFileSync(originalPath,'utf8'));
    const provenance=report.recovery?.base || report.provenance?.base;
    if(provenance && sha256(readFileSync(originalPath))!==provenance.sha256) return null;
    if(!inside(base,originalPath) || !original.rows?.length || !original.runsRoot) return null;
    const configPath=join(dirname(original.runsRoot),'config.json');
    if(!inside(base,configPath) || !existsSync(configPath)) return null;
    const previous=JSON.parse(readFileSync(configPath,'utf8'));const pins={};
    for(const key of ['contracts','runner','scannerRelease']) {
      const path=previous[key];
      const id=key==='contracts' ? 'runtime-contracts':key==='runner' ? 'wf-runner':'repo-lint';
      if(!inside(targetPath(workspaceRoot,`tool/${id}/versions`),path)) return null;
      const oldVersion=JSON.parse(readFileSync(join(path,'manifest.json'),'utf8')).version;
      const nextVersion=JSON.parse(readFileSync(join(config[key],'manifest.json'),'utf8')).version;
      if(!/^\d+\.\d+\.\d+$/.test(oldVersion) || !/^\d+\.\d+\.\d+$/.test(nextVersion) || oldVersion.split('.').slice(0,2).join('.')!==nextVersion.split('.').slice(0,2).join('.')) return null;
      pins[key]={path,sha256:sha256(readFileSync(join(path,'SHA256SUMS')))};
    }
    if(sha256(JSON.stringify(pins))!==proof.versionsSha256) return null;
    const prior=new Map(report.rows.filter(row=>row.kind&&row.id).map(row=>[`${row.kind}:${row.id}`,String(row.version)]));
    const affected=new Set(['workflow:expert-task']);
    for(const [repo,section,kind] of [['tool','workflows','workflow'],['agent','agents','agent'],['software','software','software']]) {
      const registry=JSON.parse(readFileSync(targetPath(workspaceRoot,`${repo}/registry.json`),'utf8'));
      for(const entry of registry[section] || []) if(entry.enabled && entry.invocable!==false) {
        const pointer=JSON.parse(readFileSync(targetPath(workspaceRoot,`${repo}/${entry.current}`),'utf8'));
        const key=`${kind}:${entry.id}`;if(prior.get(key)!==pointer.version) affected.add(key);
      }
    }
    return [...affected].join(',');
  } catch {return null;}
}
