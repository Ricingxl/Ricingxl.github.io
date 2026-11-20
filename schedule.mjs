import {canonical, materialize, mergeRevisions, planFromTask, validateRevision} from './model.mjs';

export const formats = {
  '课表': {version:'CQU-PLAN-1', headers:['格式版本','操作','任务ID','日期','开始时间','结束时间','类型','科目','任务内容','计划分钟','地点','备注']},
  '学习进度': {version:'CQU-PROGRESS-1', headers:['格式版本','任务ID','学习日期','状态','实际分钟','做题数量','答对数量','视频进度秒','原任务反馈']},
  '问题记录': {version:'CQU-ISSUE-1', headers:['格式版本','问题ID','任务ID','日期','科目','题号或题目','卡点或问题','题目出处','状态']},
  '每日反馈': {version:'CQU-NOTE-1', headers:['格式版本','日期','自报总分钟','今日反馈','调整需求']},
};
export const statusNames = {pending:'待完成',partial:'部分完成',delayed:'顺延',done:'已完成'};
const cloneFields = (object, keys) => Object.fromEntries(keys.map(k => [k, object[k] ?? null]));
export const addDays = (date, days) => new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function weekDates(date) {
  const day = new Date(date+'T00:00:00Z').getUTCDay();
  const start = addDays(date, -((day+6)%7));
  return Array.from({length:7}, (_,i)=>addDays(start,i));
}
export function minuteOfDay(time) { return Number(time.slice(0,2))*60+Number(time.slice(3,5)); }
export function overlaps(tasks) {
  const result=[], grouped=new Map();
  for (const t of tasks) {
    if (!t.startTime || !t.endTime || t.deleted) continue;
    if (!grouped.has(t.date)) grouped.set(t.date,[]);
    grouped.get(t.date).push(t);
  }
  for (const [date, items] of grouped) {
    items.sort((a,b)=>a.startTime.localeCompare(b.startTime));
    for (let i=0;i<items.length;i++) for(let j=i+1;j<items.length && items[j].startTime<items[i].endTime;j++) {
      result.push({date,first:items[i],second:items[j]});
      if(result.length>=100)return result;
    }
  }
  return result;
}
export function planTable(tasks) {
  return [formats['课表'].headers, ...tasks.map(t => {const p=planFromTask(t);return [formats['课表'].version,t.archived?'删除':'保存',p.id,p.date,p.startTime,p.endTime,p.category,p.subject,p.detail,p.plannedMinutes,p.location,p.remarks];})];
}
export function progressTables(view) {
  const list=[...view.tasks,...view.archivedTasks];
  return {
    '学习进度':[formats['学习进度'].headers,...list.filter(t=>t.progressDate && t.status!=='conflict').map(t=>['CQU-PROGRESS-1',t.id,t.progressDate,statusNames[t.status],t.actualMinutes??'',t.questionsAttempted??'',t.questionsCorrect??'',t.videoPositionSec??'',t.feedback])],
    '问题记录':[formats['问题记录'].headers,...view.issues.filter(i=>!i.conflict).map(i=>['CQU-ISSUE-1',i.id,i.taskId,i.date,i.subject,i.question,i.description,i.resource,i.status==='resolved'?'已解决':'待解决'])],
    '每日反馈':[formats['每日反馈'].headers,...Object.entries(view.notes).filter(([,n])=>!n.conflict).sort(([a],[b])=>a.localeCompare(b)).map(([d,n])=>['CQU-NOTE-1',d,n.actualTotal??'',n.reflection,n.adjustment])],
  };
}
export function csvEncode(table) {
  return '\ufeff'+table.map(row=>row.map(v=>{let text=String(v??'');if(typeof v==='string'&&/^[=+@\-\t\r']/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
}
export function csvDecode(text) {
  text=text.replace(/^\ufeff/,'');
  const rows=[],row=[];let value='',quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;afterQuote=true;}}else value+=c;}
    else if(c==='"'&&!value&&!afterQuote)quoted=true;
    else if(c===','||c==='\r'||c==='\n') {
      row.push(value);value='';afterQuote=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row.splice(0));}
    } else {if(afterQuote||c==='"')throw Error('CSV引号格式错误');value+=c;}
    if(value.length>30000||rows.length>5000||row.length>30)throw Error('表格过大，请分批上传');
  }
  if(quoted)throw Error('CSV引号未闭合');
  if(value||row.length) {row.push(value);rows.push(row);}
  while(rows.length && !rows.at(-1).some(c=>String(c).trim()))rows.pop();
  return rows.map(r=>r.map(v=>/^'[=+@\-\t\r']/.test(v)?v.slice(1):v));
}
export function identifyTable(rows) {
  return Object.keys(formats).find(name=>canonical(rows[0])===canonical(formats[name].headers));
}
function dateCell(value) {
  if(typeof value==='number')value=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000).toISOString().slice(0,10);
  const s=String(value??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('日期请填写YYYY-MM-DD或Excel日期单元格');
  return s;
}
function timeCell(value) {
  if(value===''||value==null)return '';
  if(typeof value==='number') {
    const minutes=Math.round(value*1440);
    if(minutes<0||minutes>1440)throw Error('时间数值不正确');
    return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  }
  const s=String(value).trim(),match=/^(\d{1,2}):(\d{2})(?::00)?$/.exec(s);
  if(!match)throw Error('时间请使用HH:MM');
  return match[1].padStart(2,'0')+':'+match[2];
}
function integer(value, optional=false) {
  if((value===''||value==null)&&optional)return null;
  if(value===''||value==null||!Number.isInteger(Number(value)))throw Error('分钟、数量请填写整数');
  return Number(value);
}
async function newId(prefix, fields) {
  const bytes=new TextEncoder().encode(canonical(fields));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return prefix+'-'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}

// 计划与真实进度分开保存，修改日期或内容不会改写过去的学习反馈。
export async function previewTables(tables, store) {
  const errors=[],changes=[],incoming=[],keys=new Set(),view=store.view();
  const known=new Map([...view.tasks,...view.archivedTasks].map(t=>[t.id,t]));
  const ordered=Object.entries(tables).sort(([a],[b])=>(a==='课表'?-1:b==='课表'?1:0));
  for(const [sheet,rows] of ordered) {
    if(sheet==='填写说明')continue;
    const schema=formats[sheet];
    if(!schema||!Array.isArray(rows)||canonical(rows[0])!==canonical(schema.headers)) {errors.push(`${sheet}：表头与固定模板不一致，请重新下载模板`);continue;}
    if(rows.length>5001){errors.push(`${sheet}超过5000行`);continue;}
    for(let n=1;n<rows.length;n++) {
      const values=rows[n];if(!values.some(v=>v!==''&&v!=null))continue;
      const label=`${sheet} 第${n+1}行`;
      try {
        if(values.length>schema.headers.length&&values.slice(schema.headers.length).some(v=>v!==''&&v!=null))throw Error('存在模板之外的数据列');
        const cells=schema.headers.map((_,i)=>values[i]??'');
        if(cells[0]!==schema.version)throw Error('格式版本不正确');
        let key,payload,old,title;
        if(sheet==='课表') {
          if(!['保存','删除'].includes(cells[1]))throw Error('操作只能是保存或删除');
          let id=String(cells[2]||'');
          if(!id && cells[1]==='保存') id=await newId('task',[dateCell(cells[3]),timeCell(cells[4]),timeCell(cells[5]),String(cells[6]),String(cells[7]),String(cells[8]),integer(cells[9]),String(cells[10]),String(cells[11])]);
          const t=known.get(id);
          key='plan:'+id;
          if(cells[1]==='删除') {
            if(!cells[2])throw Error('删除操作必须填写任务ID');
            payload=t?{...planFromTask(t),deleted:true}:{id,date:dateCell(cells[3]),startTime:timeCell(cells[4]),endTime:timeCell(cells[5]),category:String(cells[6]),subject:String(cells[7]),detail:String(cells[8]),plannedMinutes:integer(cells[9]),location:String(cells[10]),remarks:String(cells[11]),deleted:true};
          } else payload={id,date:dateCell(cells[3]),startTime:timeCell(cells[4]),endTime:timeCell(cells[5]),category:String(cells[6]??''),subject:String(cells[7]??''),detail:String(cells[8]??''),plannedMinutes:integer(cells[9]),location:String(cells[10]??''),remarks:String(cells[11]??''),deleted:false};
          old=t?{...planFromTask(t),deleted:Boolean(t.archived)}:null;
          title=payload.detail;known.set(id,{...t,...payload,time:payload.startTime?payload.startTime+'–'+payload.endTime:'—'});
        } else if(sheet==='学习进度') {
          const t=known.get(String(cells[1]??''));if(!t)throw Error('任务ID不存在，请先导入对应课表');
          key='task:'+t.id;
          const status=Object.keys(statusNames).find(k=>statusNames[k]===cells[3]);if(!status)throw Error('任务状态不正确');
          payload={id:t.id,date:dateCell(cells[2]),time:t.time||'—',subject:t.subject,detail:t.detail,plannedMinutes:t.plannedMinutes,status,actualMinutes:integer(cells[4],true),questionsAttempted:integer(cells[5],true),questionsCorrect:integer(cells[6],true),videoPositionSec:integer(cells[7],true),feedback:String(cells[8]??'')};
          const heads=store.revisions.filter(r=>r.key===key);old=heads.length?{...t,date:t.progressDate||t.date}:null;title=t.detail;
        } else if(sheet==='问题记录') {
          const id=String(cells[1]||await newId('issue',[String(cells[2]),dateCell(cells[3]),...cells.slice(4).map(String)])),taskId=String(cells[2]??'');
          if(taskId&&!known.has(taskId))throw Error('关联任务ID不存在');
          if(!['待解决','已解决'].includes(cells[8]))throw Error('问题状态只能是待解决或已解决');
          key='issue:'+id;payload={id,taskId,date:dateCell(cells[3]),subject:String(cells[4]??''),question:String(cells[5]??''),description:String(cells[6]??''),resource:String(cells[7]??''),status:cells[8]==='已解决'?'resolved':'open'};
          old=view.issues.find(i=>i.id===id)||null;title=payload.question||payload.description;
          // 表格只更新文字，保留已上传的原图；完整图片随JSON或问题ZIP下载。
          if(old?.attachments)payload.attachments=old.attachments;
        } else {
          const date=dateCell(cells[1]);key='note:'+date;
          payload={date,actualTotal:integer(cells[2],true),reflection:String(cells[3]??''),adjustment:String(cells[4]??'')};old=view.notes[date]||null;title=date+' 每日反馈';
        }
        if(keys.has(key))throw Error('同一记录在文件内重复出现');keys.add(key);
        if(store.parents(key).length>1)throw Error('此记录有同步冲突，请先在程序中处理');
        const revision={id:crypto.randomUUID(),key,parents:store.parents(key),payload,source:'固定表格导入',createdAt:new Date().toISOString()};
        validateRevision(revision);
        if(old && canonical(cloneFields(old,Object.keys(payload)))===canonical(payload))continue;
        const differences=Object.keys(payload).filter(k=>canonical(old?.[k]??null)!==canonical(payload[k])).map(k=>({field:k,before:old?.[k]??'',after:payload[k]}));
        incoming.push(revision);changes.push({sheet,row:n+1,key,title,operation:payload.deleted?'删除':old?'更新':'新增',differences});
      } catch(error) {errors.push(label+'：'+error.message);}
    }
  }
  if(errors.length)return {errors,changes:[],revisions:[],warnings:[],fingerprint:canonical(store.revisions)};
  const next=mergeRevisions(store.revisions,incoming), nextView=materialize(store.seed,next);
  const warnings=overlaps(nextView.tasks).map(c=>`${c.date} ${c.first.startTime}–${c.first.endTime}「${c.first.detail}」与「${c.second.detail}」时间重叠`);
  return {errors,changes,revisions:incoming,warnings,fingerprint:canonical(store.revisions),owner:store.owner};
}
