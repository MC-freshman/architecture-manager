import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outIndex=process.argv.indexOf('--out');
const out=outIndex>=0?path.resolve(process.argv[outIndex+1]):path.join(os.tmpdir(),'architecture-manager-conform');
fs.mkdirSync(out,{recursive:true});
const steps=[
  ['lint',[path.join(root,'node_modules/eslint/bin/eslint.js'),'src','scripts']],
  ['preload',[path.join(root,'scripts/generate-preload.mjs'),'--check']],
  ['tests',['--test','--test-reporter=tap','--test-concurrency=1']]
];
const proofIndex=process.argv.indexOf('--release-proof');
if(proofIndex>=0) steps.push(['release-proof',[path.join(root,'scripts/release-proof.mjs'),path.resolve(process.argv[proofIndex+1])]]);
const results=[];
for(const [name,args] of steps) {
  const start=performance.now();
  const result=spawnSync(process.execPath,args,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:600000});
  fs.writeFileSync(path.join(out,name+'.stdout'),result.stdout || '');fs.writeFileSync(path.join(out,name+'.stderr'),result.stderr || '');
  const row={name,ok:result.status===0,durationMs:performance.now()-start,exitCode:result.status,error:result.error?.message || null};
  if(name==='tests') for(const key of ['tests','pass','fail','skipped','cancelled']) row[key]=Number(result.stdout?.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1] || 0);
  results.push(row);console.log(JSON.stringify(row));
  if(!row.ok) break;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function files(directory,prefix='') {return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name),prefix+entry.name+'/'):[{path:prefix+entry.name,sha256:sha(fs.readFileSync(path.join(directory,entry.name)))}]);}
const sources=[...files(path.join(root,'src'),'src/'),...files(path.join(root,'scripts'),'scripts/'),{path:'package-lock.json',sha256:sha(fs.readFileSync(path.join(root,'package-lock.json')))}];
const report={schema:'architecture-manager-conform/v1',recordedAt:new Date().toISOString(),ok:results.length===steps.length && results.every(row=>row.ok),results,sources,node:process.version,implementationComplete:false};
report.digest=sha(JSON.stringify({ok:report.ok,results:results.map(({durationMs,...row})=>row),sources}));
fs.writeFileSync(path.join(out,'conform.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,digest:report.digest,evidence:out}));
if(!report.ok) process.exitCode=1;
