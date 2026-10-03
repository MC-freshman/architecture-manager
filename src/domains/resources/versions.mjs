import {existsSync,readFileSync} from 'node:fs';
import {targetPath,safeRelative} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {verifyFrozenDirectory} from './integrity.mjs';
import {validateResourceContent} from './contracts.mjs';

const ID=/^(?:_[a-z][a-z0-9-]*|[a-z0-9][a-z0-9._-]*)$/i,VERSION=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const kinds={workflows:['tool',''],agents:['agent',''],skills:['tool','skills/'],packs:['tool','packs/'],software:['software','']};
export function dependencyEntries(value) {
  if(value==null) return [];
  const entries=Array.isArray(value)?value.map(item=>typeof item==='string'?item.split('@'):[item.id,item.version]):Object.entries(value);
  if(entries.some(([id,version])=>!ID.test(id) || typeof version!=='string' || !VERSION.test(version))) throw Error('RESOURCE_DEPENDENCY_NOT_PINNED');
  return entries;
}
export function validateFrozenResource(workspaceRoot,repository,resourceId,version,context={seen:new Set(),visiting:new Set()},subdirectory='') {
  if(!['tool','agent','software'].includes(repository) || !ID.test(resourceId) || !VERSION.test(version)) throw Error('INVALID_RESOURCE_VERSION');
  const key=`${repository}/${subdirectory}${resourceId}@${version}`;
  if(context.visiting.has(key)) throw Error('RESOURCE_DEPENDENCY_CYCLE');
  if(context.seen.has(key)) return context.seen.get?.(key);
  context.visiting.add(key);
  const directory=targetPath(workspaceRoot,`${repository}/${subdirectory}${resourceId}/versions/${version}`);
  const integrity=(context.verifyDirectory || verifyFrozenDirectory)(directory);
  const get=name=>readFileSync(targetPath(directory,safeRelative(name)),'utf8');
  const manifest=validateResourceContent({repository,resourceId,version,read:get,has:name=>existsSync(targetPath(directory,safeRelative(name)))});
  const declarations=[manifest.dependencies,manifest.depends];
  if(repository==='agent') declarations.push(readJson(targetPath(directory,manifest.toolLock)));
  if(manifest.members) declarations.push({skills:manifest.members});
  for(const declaration of declarations) for(const [section,[repo,prefix]] of Object.entries(kinds)) {
    for(const [id,pin] of dependencyEntries(declaration?.[section])) validateFrozenResource(workspaceRoot,repo,id,pin,context,prefix);
  }
  context.resources?.set(key,{manifest,...integrity});
  context.visiting.delete(key);context.seen.add(key);
  return {manifest,...integrity};
}
