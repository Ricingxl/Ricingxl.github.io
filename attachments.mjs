import {api,localDesktop} from './storage.mjs?v=2.7';
import {zip} from './workbook.mjs?v=2.7';

export const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
export function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
export const unbase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function imageMime(b){
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(hex(b.subarray(0,8))==='89504e470d0a1a0a')return 'image/png';
  if(new TextDecoder().decode(b.subarray(0,6)).match(/^GIF8[79]a$/))return 'image/gif';
  if(new TextDecoder().decode(b.subarray(0,4))==='RIFF'&&new TextDecoder().decode(b.subarray(8,12))==='WEBP')return 'image/webp';
  throw Error('仅支持真实的 JPG、PNG、WebP、GIF 图片，请将 HEIC 转为 JPG 后上传');
}
export function validateAttachment(a){
  if(!a||!/^[a-f0-9]{64}$/.test(a.id)||typeof a.name!=='string'||a.name.length>200||!['image/jpeg','image/png','image/webp','image/gif'].includes(a.mime)||!Number.isInteger(a.size)||a.size<1||a.size>6*1024*1024)throw Error('图片信息无效，每张最多6MB');
}
let dbPromise;
function database(){return dbPromise ||= new Promise((resolve,reject)=>{const r=indexedDB.open('cqu-planner-images-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('images');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export class AttachmentStore {
  constructor(owner){this.owner=owner;this.urls=new Map();}
  async markArchived(meta,state){validateAttachment(meta);localStorage.setItem('cqu-cloud-image-archive:'+this.owner+':'+meta.id,JSON.stringify({state:state.state}));}
  async put(meta,bytes){
    validateAttachment(meta);if(bytes.length!==meta.size||await digest(bytes)!==meta.id||imageMime(bytes)!==meta.mime)throw Error('图片内容校验失败');
    if(localDesktop)await api('/api/attachment',{owner:this.owner,meta,data:base64(bytes)});
    else {const db=await database();await new Promise((resolve,reject)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put(bytes,this.owner+':'+meta.id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
  }
  async add(file){
    if(file.size>6*1024*1024)throw Error('每张图片最多6MB，请裁剪或压缩后重试');
    const bytes=new Uint8Array(await file.arrayBuffer()),meta={id:await digest(bytes),name:file.name.slice(0,200),size:bytes.length,mime:imageMime(bytes)};
    await this.put(meta,bytes);return meta;
  }
  async get(meta){
    validateAttachment(meta);let bytes;
    const missing=()=>localStorage.getItem('cqu-cloud-image-archive:'+this.owner+':'+meta.id)?'原图已归档到电脑，请在电脑本地程序查看：'+meta.name:'图片未下载或校验失败：'+meta.name;
    if(localDesktop){try{const r=await api('/api/attachment?owner='+encodeURIComponent(this.owner)+'&id='+meta.id);bytes=unbase64(r.data);}catch(error){if(localStorage.getItem('cqu-cloud-image-archive:'+this.owner+':'+meta.id))throw Error(missing());throw error;}}
    else {const db=await database();bytes=await new Promise((resolve,reject)=>{const r=db.transaction('images').objectStore('images').get(this.owner+':'+meta.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
    if(!bytes||bytes.length!==meta.size||await digest(bytes)!==meta.id)throw Error(missing());
    return bytes;
  }
  async url(meta){if(!this.urls.has(meta.id))this.urls.set(meta.id,URL.createObjectURL(new Blob([await this.get(meta)],{type:meta.mime})));return this.urls.get(meta.id);}
  close(){for(const u of this.urls.values())URL.revokeObjectURL(u);this.urls.clear();}
}
export function referencedImages(revisions){return [...new Map(revisions.flatMap(r=>r.key.startsWith('issue:')?r.payload.attachments||[]:[]).map(a=>[a.id,a])).values()];}
export async function exportImageJson(store,images){const result=store.export();result.attachments={};for(const a of referencedImages(store.revisions))result.attachments[a.id]={meta:a,data:base64(await images.get(a))};return result;}
export async function importImageJson(obj,images){
  // Validate every image before writing any revision; image-only orphan blobs are harmless on a later error.
  for(const a of referencedImages(obj.revisions||[])){
    const entry=obj.attachments?.[a.id];
    if(entry){if(entry.meta.id!==a.id)throw Error('备份图片ID不一致');await images.put(a,unbase64(entry.data));}
    else await images.get(a);
  }
}
export async function issueBundle(view,images){
  const entries={},manifest={format:'CQU-ISSUE-BUNDLE-1',exportedAt:new Date().toISOString(),issues:[]};
  let md='# 学习问题与题目图片\n\n原图保留，OCR 尚未执行。请按问题ID逐题识别、核对公式并归档，不推断未提供的解题过程。\n';
  for(const issue of view.issues){
    const folder='questions/'+issue.id,files=[];
    md+=`\n## ${issue.subject} · ${issue.date} · ${issue.id}\n\n题目：${issue.question}\n\n卡点：${issue.description}\n\n出处：${issue.resource}\n\n状态：${issue.status}\n`;
    for(const [i,a] of (issue.attachments||[]).entries()){
      const extension={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'}[a.mime],path=folder+'/'+(i+1)+'-'+a.id.slice(0,12)+'.'+extension;
      entries[path]=await images.get(a);files.push({...a,path});md+=`\n![题目图片${i+1}](${path})\n`;
    }
    manifest.issues.push({...issue,attachments:files});
  }
  entries['manifest.json']=JSON.stringify(manifest,null,2);entries['问题归档.md']=md;return zip(entries);
}
