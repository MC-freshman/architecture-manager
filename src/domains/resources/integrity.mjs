import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {targetPath,safeRelative} from '../../core/paths.mjs';
import {sha256} from '../../core/hash.mjs';

export function releaseFiles(directory,prefix='') {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const name=prefix+entry.name;
    if(entry.isSymbolicLink() || lstatSync(join(directory,entry.name)).isSymbolicLink()) throw Error('RELEASE_SYMBOLIC_LINK');
    return entry.isDirectory()?releaseFiles(join(directory,entry.name),name+'/'):[name];
  }).sort();
}
export function verifyFrozenDirectory(directory) {
  if(!existsSync(directory) || !existsSync(join(directory,'SHA256SUMS'))) throw Error('TARGET_VERSION_NOT_FROZEN');
  const sums=readFileSync(join(directory,'SHA256SUMS'),'utf8');
  const entries=new Map(),aliases=new Set();
  for(const line of sums.split(/\r?\n/).filter(line=>line.trim())) {
    const match=/^([A-Fa-f0-9]{64})\s+\*?(.+)$/.exec(line);
    if(!match) throw Error('RELEASE_CHECKSUM_FORMAT');
    const name=match[2].replaceAll('\\','/'),normalized=safeRelative(name),alias=normalized.toLowerCase();
    if(normalized!==name || alias==='sha256sums' || aliases.has(alias)) throw Error('RELEASE_CHECKSUM_DUPLICATE');
    aliases.add(alias);entries.set(name,match[1].toLowerCase());
    if(sha256(readFileSync(targetPath(directory,name)))!==match[1].toLowerCase()) throw Error('RELEASE_HASH_MISMATCH');
  }
  const actual=releaseFiles(directory).filter(name=>name!=='SHA256SUMS');
  if(!entries.size || JSON.stringify([...entries.keys()].sort())!==JSON.stringify(actual)) throw Error('RELEASE_FILE_SET_MISMATCH');
  return {directory,sumsSha256:sha256(sums),files:entries};
}
