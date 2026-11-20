export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function validateRevision(r) {
  const fields = ['id', 'key', 'parents', 'payload', 'source', 'createdAt'];
  if (!r || typeof r !== 'object' || Object.keys(r).length !== fields.length || !fields.every(k => Object.hasOwn(r, k))) {
    throw Error('记录字段不符合版本2格式');
  }
  if (typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(r.id)) throw Error('记录ID无效');
  if (!Array.isArray(r.parents) || r.parents.length > 20 || new Set(r.parents).size !== r.parents.length ||
      !r.parents.every(p => typeof p === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(p) && p !== r.id)) throw Error('版本关系无效');
  if (typeof r.key !== 'string' || !/^((?:task|plan|issue):[a-zA-Z0-9-]{1,100}|note:\d{4}-\d{2}-\d{2})$/.test(r.key)) throw Error('记录类型无效');
  if (typeof r.source !== 'string' || r.source.length > 100 || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) throw Error('来源或时间无效');
  const p = r.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('缺少记录内容');
  if (r.key.startsWith('task:')) {
    if (p.id !== r.key.slice(5) || typeof p.detail !== 'string' || p.detail.length > 10000 ||
        typeof p.subject !== 'string' || p.subject.length > 100 || typeof p.time !== 'string' || p.time.length > 100 ||
        !['pending', 'partial', 'delayed', 'done'].includes(p.status)) throw Error('任务内容无效');
    for (const key of ['plannedMinutes', 'actualMinutes', 'questionsAttempted', 'questionsCorrect', 'videoPositionSec']) {
      if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > (key === 'videoPositionSec' ? 86400 : key.includes('Minutes') ? 1440 : 10000))) throw Error('数值超出范围');
    }
    if (p.questionsCorrect != null && (p.questionsAttempted == null || p.questionsCorrect > p.questionsAttempted)) throw Error('答对数量不能超过做题数量');
    if (typeof p.feedback !== 'string' || p.feedback.length > 20000) throw Error('反馈内容无效');
  } else if (r.key.startsWith('plan:')) {
    validatePlan(p);
    if (p.id !== r.key.slice(5)) throw Error('课表ID不匹配');
  } else if (r.key.startsWith('issue:')) {
    if (p.id !== r.key.slice(6) || typeof p.taskId !== 'string' || (p.taskId && !/^[a-zA-Z0-9-]{1,100}$/.test(p.taskId)) ||
        typeof p.subject !== 'string' || p.subject.length > 100 ||
        !['open','resolved'].includes(p.status)) throw Error('问题记录无效');
    for (const field of ['question','description','resource']) if (typeof p[field] !== 'string' || p[field].length > (field === 'resource' ? 2000 : 20000)) throw Error('问题内容无效');
    if(p.attachments!==undefined && (!Array.isArray(p.attachments)||p.attachments.length>6||new Set(p.attachments.map(a=>a?.id)).size!==p.attachments.length||p.attachments.some(a=>!a||!/^[a-f0-9]{64}$/.test(a.id)||typeof a.name!=='string'||a.name.length>200||!['image/jpeg','image/png','image/webp','image/gif'].includes(a.mime)||!Number.isInteger(a.size)||a.size<1||a.size>6*1024*1024)))throw Error('题目图片信息无效');
    if (!p.question.trim() && !p.description.trim() && !p.attachments?.length) throw Error('请填写题目、问题说明或上传图片');
  } else {
    if (typeof p.reflection !== 'string' || typeof p.adjustment !== 'string' || p.reflection.length > 20000 || p.adjustment.length > 20000 ||
        (p.actualTotal != null && (!Number.isInteger(p.actualTotal) || p.actualTotal < 0 || p.actualTotal > 1440))) throw Error('每日反馈无效');
  }
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw Error('学习日期无效');
  const parsed = new Date(p.date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== p.date) throw Error('不存在这个日期');
  if (r.key.startsWith('note:') && r.key !== 'note:' + p.date) throw Error('日期与记录ID不一致');
  if (p.deleted !== undefined && typeof p.deleted !== 'boolean') throw Error('删除标记无效');
  if (canonical(r).length > 60000) throw Error('单条记录过大');
  return r;
}

export function validatePlan(p) {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(p.id) || typeof p.detail !== 'string' || !p.detail.trim() || p.detail.length > 10000 ||
      typeof p.subject !== 'string' || !p.subject.trim() || p.subject.length > 100 ||
      !['学习','本科课','其他'].includes(p.category) || typeof p.location !== 'string' || p.location.length > 1000 ||
      typeof p.remarks !== 'string' || p.remarks.length > 5000 || !Number.isInteger(p.plannedMinutes) || p.plannedMinutes < 0 || p.plannedMinutes > 1440) throw Error('课表内容无效');
  for (const field of ['startTime','endTime']) if (typeof p[field] !== 'string' || (p[field] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p[field]) && !(field === 'endTime' && p[field] === '24:00'))) throw Error('请使用HH:MM时间格式');
  if (Boolean(p.startTime) !== Boolean(p.endTime) || (p.startTime && p.endTime <= p.startTime)) throw Error('结束时间必须晚于开始时间，跨日安排请分成两天');
}

export function planFromTask(t) {
  const match = /^(\d{2}:\d{2})[–—~-](\d{2}:\d{2})$/.exec((t.time || '').replaceAll(' ',''));
  return {id:t.id,date:t.date,startTime:t.startTime ?? match?.[1] ?? '',endTime:t.endTime ?? match?.[2] ?? '',category:t.category || '学习',subject:t.subject,detail:t.detail,plannedMinutes:t.plannedMinutes,location:t.location || '',remarks:t.remarks || ''};
}

// 先检查整个批次，任何一条无效都不改变原来的记录。
export function mergeRevisions(existing, incoming) {
  const records = new Map(existing.map(r => [r.id, r]));
  for (const rev of incoming) {
    validateRevision(rev);
    if (records.has(rev.id) && canonical(records.get(rev.id)) !== canonical(rev)) throw Error('同一ID出现不同内容');
    records.set(rev.id, rev);
  }
  const indegree = new Map(), children = new Map();
  for (const rev of records.values()) {
    indegree.set(rev.id, rev.parents.length);
    for (const parentId of rev.parents) {
      const parent = records.get(parentId);
      if (!parent || parent.key !== rev.key) throw Error('缺少同一记录的父版本');
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(rev.id);
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < ready.length; i++) {
    for (const id of children.get(ready[i]) || []) {
      indegree.set(id, indegree.get(id) - 1);
      if (indegree.get(id) === 0) ready.push(id);
    }
  }
  if (ready.length !== records.size) throw Error('版本关系形成循环');
  return ready.map(id => records.get(id));
}

export function headsFor(revisions) {
  const consumed = new Set(revisions.flatMap(r => r.parents));
  const groups = new Map();
  for (const rev of revisions) {
    if (!consumed.has(rev.id)) {
      if (!groups.has(rev.key)) groups.set(rev.key, []);
      groups.get(rev.key).push(rev);
    }
  }
  return groups;
}

export function materialize(seed, revisions) {
  const groups = headsFor(revisions), plans = new Map(seed.map(t => [t.id, planFromTask(t)]));
  const progress = new Map(), notes = {}, issues = [], conflicts = [], archivedTasks = [];
  for (const [key, heads] of groups) {
    const p = heads[0].payload, conflict = heads.length > 1;
    if (conflict) conflicts.push({key,heads});
    if (key.startsWith('plan:')) plans.set(p.id,{...p,planConflict:conflict});
    else if (key.startsWith('task:')) {
      progress.set(p.id, {...p,progressConflict:conflict});
      if (!plans.has(p.id)) plans.set(p.id,planFromTask(p));
    } else if (key.startsWith('issue:')) {
      if (!p.deleted || conflict) issues.push({...p,conflict});
    } else notes[key.slice(5)] = conflict ? {date:p.date,conflict:true} : {...p};
  }
  const tasks = [];
  for (const [id, plan] of plans) {
    const p = progress.get(id), item = {...plan, time:plan.startTime ? `${plan.startTime}–${plan.endTime}` : '—',status:'pending',actualMinutes:null,feedback:''};
    if (p) {
      for (const field of ['status','actualMinutes','feedback','questionsAttempted','questionsCorrect','videoPositionSec']) if (p[field] !== undefined) item[field]=p[field];
      item.progressDate=p.date;
      if (p.progressConflict) Object.assign(item,{status:'conflict',actualMinutes:null,feedback:'请先处理同步冲突'});
    }
    if ((plan.deleted && !plan.planConflict) || (p?.deleted && !p.progressConflict)) {
      if (p) archivedTasks.push({...item,archived:true});
    } else tasks.push(item);
  }
  const sort = (a,b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '') || a.id.localeCompare(b.id);
  return {tasks:tasks.sort(sort),archivedTasks:archivedTasks.sort(sort),notes,issues:issues.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)),conflicts};
}
