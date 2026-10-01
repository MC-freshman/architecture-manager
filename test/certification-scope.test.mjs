import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { patchCertificationSelection } from '../src/core/certification-scope.mjs';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'manager-cert-scope-'));const put=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string' ? value:JSON.stringify(value));};
  const old={},next={},pins={};
  for(const [key,id,version,patch] of [['contracts','runtime-contracts','1.5.0','1.5.2'],['runner','wf-runner','0.12.0','0.12.1'],['scannerRelease','repo-lint','0.6.3','0.6.4']]) {
    for(const value of [version,patch]) {const path=join(root,'tool',id,'versions',value);put(join(path,'manifest.json'),{id,version:value});put(join(path,'SHA256SUMS'),'seal-'+value);}
    old[key]=join(root,'tool',id,'versions',version);next[key]=join(root,'tool',id,'versions',patch);pins[key]={path:old[key],sha256:sha256(readFileSync(join(old[key],'SHA256SUMS')))};
  }
  const base=join(root,'test-platform/runtime/manager-check/first'),matrixPath=join(base,'matrix.json');put(join(base,'matrix-runs/config.json'),old);put(matrixPath,{runsRoot:join(base,'matrix-runs/runs'),rows:[{kind:'workflow',id:'expert-task',version:'1.1.0',status:'PASS'}]});
  for(const [repo,key,rows] of [['tool','workflows',[{id:'expert-task',enabled:true,current:'expert-task/current.json'}]],['agent','agents',[]],['software','software',[]]])put(join(root,repo,'registry.json'),{[key]:rows});put(join(root,'tool/expert-task/current.json'),{version:'1.1.0'});
  return {root,put,next,matrixPath,proof:{matrixPath,matrixSha256:sha256(readFileSync(matrixPath)),versionsSha256:sha256(JSON.stringify(pins))}};
}
test('patches retain a hashed initial matrix and select affected additions',()=>{const f=fixture();try {assert.equal(patchCertificationSelection(f.proof,f.root,'test-platform',f.next),'workflow:expert-task');f.put(join(f.root,'agent/registry.json'),{agents:[{id:'new-expert',enabled:true,current:'new-expert/current.json'}]});f.put(join(f.root,'agent/new-expert/current.json'),{version:'1.0.0'});assert.equal(patchCertificationSelection(f.proof,f.root,'test-platform',f.next),'workflow:expert-task,agent:new-expert');f.put(join(f.root,'software/registry.json'),{software:[{id:'cli',enabled:true,invocable:false,current:'cli/current.json'}]});f.put(join(f.root,'software/cli/current.json'),{version:'1.0.0'});assert.match(patchCertificationSelection(f.proof,f.root,'test-platform',f.next),/software:cli/);}finally{rmSync(f.root,{recursive:true,force:true});}});
test('generation changes and modified initial reports cannot bypass full certification',()=>{const f=fixture();try {f.put(join(f.next.runner,'manifest.json'),{version:'0.13.0'});assert.equal(patchCertificationSelection(f.proof,f.root,'test-platform',f.next),null);f.put(join(f.next.runner,'manifest.json'),{version:'0.12.1'});f.put(f.matrixPath,{rows:[],runsRoot:'outside'});assert.equal(patchCertificationSelection(f.proof,f.root,'test-platform',f.next),null);}finally{rmSync(f.root,{recursive:true,force:true});}});
