import {zip,unzip,writeXlsx} from './workbook.mjs';
import {referencedImages,digest,imageMime,validateAttachment} from './attachments.mjs';
import {materialize} from './model.mjs';
import {planTable,progressTables} from './schedule.mjs';

const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const extension={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'};
const imagePath=a=>'images/'+a.id+'.'+extension[a.mime];

// One portable file for restore, spreadsheet editing and later question OCR.
export async function createDataPackage(store,images,options={}){
  const full=store.export(),incremental=options.mode==='incremental',known=new Set(options.checkpoint?.revisionIds||[]),knownImages=new Set(options.checkpoint?.imageIds||[]);
  if(incremental&&options.checkpoint&&options.checkpoint.owner!==full.owner)throw Error('归档账号不一致');
  const backup={...full,revisions:incremental?full.revisions.filter(r=>!known.has(r.id)):full.revisions},keys=new Set(backup.revisions.map(r=>r.key));
  const completeView=materialize(full.tasks,full.revisions),view=incremental?{...completeView,
    tasks:completeView.tasks.filter(t=>keys.has('plan:'+t.id)||keys.has('task:'+t.id)),
    archivedTasks:completeView.archivedTasks.filter(t=>keys.has('plan:'+t.id)||keys.has('task:'+t.id)),
    issues:completeView.issues.filter(i=>keys.has('issue:'+i.id)),notes:Object.fromEntries(Object.entries(completeView.notes).filter(([d])=>keys.has('note:'+d)))}:completeView,entries=Object.create(null);
  const manifest={format:incremental?'CQU-DATA-2':'CQU-DATA-1',mode:incremental?'incremental':'full',owner:full.owner,exportedAt:backup.exportedAt,backup:'backup.json',images:[],externalImages:[],issues:[]};
  const allImages=referencedImages(incremental?full.revisions:backup.revisions),requiredIds=new Set(referencedImages(backup.revisions).map(a=>a.id));
  for(const meta of allImages){
    if(incremental&&knownImages.has(meta.id)){if(requiredIds.has(meta.id))manifest.externalImages.push(meta);continue;}
    const path=imagePath(meta);entries[path]=await images.get(meta);manifest.images.push({...meta,path});
  }
  let md='# 学习问题归档\n\n原图随包保留，等待OCR识别与公式核对。\n';
  for(const issue of view.issues){
    manifest.issues.push({...issue,attachments:(issue.attachments||[]).map(a=>({...a,path:imagePath(a)}))});
    md+=`\n## ${issue.subject} · ${issue.date} · ${issue.id}\n\n题目：${issue.question}\n\n卡点：${issue.description}\n\n出处：${issue.resource}\n\n状态：${issue.status}\n`;
    for(const a of issue.attachments||[])md+=`\n![题目原图](${imagePath(a)})\n`;
  }
  entries['backup.json']=JSON.stringify(backup);
  entries['manifest.json']=JSON.stringify(manifest,null,2);
  entries['问题归档.md']=md;
  // Conflicting versions remain in backup.json; tables are just the current readable view.
  entries['课表与学习记录.xlsx']=writeXlsx({'课表':planTable([...view.tasks,...view.archivedTasks]),...progressTables(view)});
  entries['使用说明.txt']=(incremental?'这是增量归档：只包含新增修订和尚未归档的原图。恢复新电脑时请按先后顺序导入所有批次，或使用“完整数据包”。externalImages中的原图保存在以前批次，问题中的同名图片链接请在整理时从旧批次images目录查找。\n':'这是完整数据包。\n')+'恢复数据：在程序点击“上传数据”，直接选择整个ZIP。\n更新课表：编辑包内“课表与学习记录.xlsx”，直接上传修改后的表格，不必重新压缩。\nOCR归档：原图与题目ID一一对应。未提交草稿不包含在内。电脑本地数据库永久保留；仅电脑验证保存后的图片可进入云端7天清理队列。';
  const result=zip(entries);if(result.length>128*1024*1024)throw Error('数据包超过128MB，请使用数据库备份并分批归档图片');return result;
}

export async function readDataPackage(buffer,existingImages=null){
  const files=await unzip(buffer,true);
  if(!files['manifest.json']||!files['backup.json'])throw Error('请上传本程序下载的完整数据包，或直接上传课表文件');
  const manifest=JSON.parse(decode(files['manifest.json']));
  if(!['CQU-DATA-1','CQU-DATA-2'].includes(manifest.format)||manifest.backup!=='backup.json'||!Array.isArray(manifest.images))throw Error('数据包格式不匹配');
  const backup=JSON.parse(decode(files['backup.json']));
  if(backup.version!==2||!Array.isArray(backup.revisions))throw Error('数据包备份无效');
  const metadata=new Map();
  for(const a of manifest.images){validateAttachment(a);if(metadata.has(a.id)||a.path!==imagePath(a))throw Error('数据包图片目录无效');metadata.set(a.id,a);}
  const attachments=[];
  const external=new Map();for(const a of manifest.externalImages||[]){validateAttachment(a);if(manifest.format!=='CQU-DATA-2'||metadata.has(a.id)||external.has(a.id))throw Error('增量图片目录无效');external.set(a.id,a);}
  const required=new Map([...referencedImages(backup.revisions),...manifest.images].map(a=>[a.id,a]));
  for(const meta of required.values()){
    validateAttachment(meta);const a=metadata.get(meta.id),bytes=a&&files[a.path];
    if(!a&&external.has(meta.id)&&existingImages){await existingImages.get(meta);continue;}
    if(!a&&external.has(meta.id))throw Error('缺少以前批次的图片，请先导入旧归档或完整数据包：'+meta.name);
    if(!bytes||bytes.length!==meta.size||await digest(bytes)!==meta.id||imageMime(bytes)!==meta.mime)throw Error('图片缺失或损坏：'+meta.name);
    attachments.push({meta,bytes});
  }
  return {backup,attachments,manifest};
}
