import {canonical} from './model.mjs';
import {digest,referencedImages} from './attachments.mjs';
import {api,localDesktop} from './storage.mjs';

const key=owner=>'cqu-download-checkpoint-v25:'+owner;
export async function archiveCheckpoint(owner){
  if(localDesktop)return api('/api/archive-state?owner='+encodeURIComponent(owner));
  const value=JSON.parse(localStorage.getItem(key(owner))||'null');
  return value?.owner===owner?value:{owner,revisionIds:[],imageIds:[],receipts:[]};
}
export function pendingArchive(store,checkpoint){
  const known=new Set(checkpoint.revisionIds||[]),pictures=new Set(checkpoint.imageIds||[]);
  return {revisions:store.revisions.filter(r=>!known.has(r.id)),images:referencedImages(store.revisions).filter(a=>!pictures.has(a.id))};
}
export async function archiveReceipt(backup,attachments,bytes){
  return {format:'CQU-ARCHIVE-1',id:crypto.randomUUID(),owner:backup.owner,
    packageHash:await digest(bytes),savedAt:new Date().toISOString(),
    revisions:await Promise.all(backup.revisions.map(async r=>({id:r.id,hash:await digest(new TextEncoder().encode(canonical(r)))}))),
    images:attachments.map(a=>({id:a.id,size:a.size,mime:a.mime}))};
}
export function browserCheckpoint(previous,receipt){
  if(previous.owner!==receipt.owner)throw Error('归档账号不一致');
  return {owner:receipt.owner,revisionIds:[...new Set([...previous.revisionIds,...receipt.revisions.map(r=>r.id)])],
    imageIds:[...new Set([...previous.imageIds,...receipt.images.map(a=>a.id)])]};
}
// Only a successful file handle close advances browser downloads. Browser saves never authorize cloud deletion.
export async function saveBrowserArchive(handle,bytes,previous,receipt){
  const writable=await handle.createWritable();
  try{await writable.write(bytes);await writable.close();}
  catch(error){try{await writable.abort();}catch{}throw error;}
  localStorage.setItem(key(receipt.owner),JSON.stringify(browserCheckpoint(previous,receipt)));
}
export async function confirmBrowserFile(receipt){
  if(localDesktop)return;
  const previous=await archiveCheckpoint(receipt.owner);
  localStorage.setItem(key(receipt.owner),JSON.stringify(browserCheckpoint(previous,receipt)));
}
