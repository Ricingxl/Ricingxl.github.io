import {firebaseConfig, allowedEmail, allowedUid} from './firebase-config.js?v=2.7';
import {isAllowedAccount} from './identity.mjs?v=2.7';
import {LocalStore, localDesktop, api, today, legacyRevisions, uuid} from './storage.mjs?v=2.7';

import {canonical} from './model.mjs?v=2.7';
import {formats, planTable, progressTables, csvEncode, csvDecode, identifyTable, previewTables, weekDates, addDays, minuteOfDay, overlaps} from './schedule.mjs?v=2.7';
import {writeXlsx, readXlsx} from './workbook.mjs?v=2.7';
import {weekView,issuesView,transferView} from './views.mjs?v=2.7';
import {AttachmentStore,referencedImages,exportImageJson,importImageJson,issueBundle,base64} from './attachments.mjs?v=2.7';
import {questionEditor,questionEntry,rowQuestions,formSnapshot,restoreForm} from './editors.mjs?v=2.7';
import {downloadCloudImages,uploadCloudImages} from './cloud-images.mjs?v=2.7';
import {createDataPackage,readDataPackage} from './data-package.mjs?v=2.7';
import {archiveCheckpoint,pendingArchive,archiveReceipt,saveBrowserArchive,confirmBrowserFile} from './archive.mjs?v=2.7';
import {bindCourseGestures} from './course-interactions.mjs?v=2.7';
import {showCourseTimeEditor} from './course-editor.mjs?v=2.7';

const app = document.getElementById('app');
const state = {seed: [], tasks: [], archivedTasks: [], issues: [], issueFilter:'open', weekMode:'table', tablePreview:null, notes: {}, conflicts: [], selected: today(), page: 'today', filter: 'all'};
let store, sdk, auth, db, user = null, unsubscribe, cloudEpoch = 0;
let syncing = false, cloudError = '', lastSync = '', profiles = ['local'];
let activeSaves = 0, activeUploads = 0, dirty = false, images, draftError = false, transferBusy = false;
const draftPrefix = () => 'cqu-drafts-v23:' + store.owner + ':';
const draftKey = form => form.dataset.record === 'new-issue' ? 'new-issue:'+state.selected : form.dataset.record;
function rememberDraft(form) {
  draftForms.add(form);dirty=true;
  try {localStorage.setItem(draftPrefix()+form.dataset.draftKey, JSON.stringify(formSnapshot(form,renderedParents.get(form.dataset.record))));draftError=false;}
  catch(error){draftError=true;toast('草稿暂存失败，请提交保存后再关闭：'+error.message);}
  syncLabel();
}
function captureDrafts(){for(const form of draftForms)if(form.isConnected)rememberDraft(form);}
async function installInitialPlans(){
  const existing=new Set(store.revisions.map(r=>r.key));
  const incoming=state.initialPlans.filter(r=>!existing.has(r.key));
  if(incoming.length){if(localDesktop&&store.revisions.length)await api('/api/backup',{owner:store.owner});await store.merge(incoming);}
}
function restoreDrafts(){
  draftForms.clear();
  for(const form of app.querySelectorAll('form[data-record]')){
    form.dataset.draftKey=draftKey(form);
    try{const draft=JSON.parse(localStorage.getItem(draftPrefix()+form.dataset.draftKey)||'null');if(draft){restoreForm(form,draft,html);if(draft.parents)renderedParents.set(form.dataset.record,draft.parents);draftForms.add(form);}}
    catch(error){draftError=true;toast('这条草稿无法读取，原缓存保留');}
  }
  dirty=draftForms.size>0;paintImages();
  for(const el of app.querySelectorAll('.week-event')){const text=el.querySelector('.event-content');if(text)el.style.setProperty('--overflow',Math.max(0,text.scrollHeight-el.clientHeight+16)+'px');}
}
function paintImages(){
  for(const row of app.querySelectorAll('.question-entry')){
    const list=JSON.parse(row.dataset.attachments||'[]');
    row.querySelector('.question-images').innerHTML=list.map((a,i)=>`<figure><a data-image="${html(JSON.stringify(a))}" target="_blank" rel="noopener"><img alt="${html(a.name)}" /></a><figcaption>${html(a.name)} <button type="button" class="small-link" data-remove-image="${i}">移除</button></figcaption></figure>`).join('');
  }
  app.querySelectorAll('.question-editor').forEach(editor=>editor.querySelectorAll('.question-number').forEach((n,i)=>n.textContent=i+1));
  for(const link of app.querySelectorAll('[data-image]')){
    if(link.dataset.loading)continue;link.dataset.loading='true';const meta=JSON.parse(link.dataset.image),ownerImages=images;
    void ownerImages.url(meta).then(url=>{if(link.isConnected){link.href=url;link.querySelector('img').src=url;}}).catch(error=>{if(link.isConnected)link.replaceChildren(document.createTextNode(error.message));});
  }
}
const acknowledged = new Set();
const renderedParents = new Map(), draftForms = new Set();
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const cnDate = value => {const d = new Date(value + 'T12:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日 · 星期${'日一二三四五六'[d.getDay()]}`;};
const tasksFor = date => state.tasks.filter(t => t.date === date && t.category !== '本科课');
const done = list => list.filter(t => t.status === 'done').length;
const sum = (list, key) => list.reduce((n, t) => n + (Number(t[key]) || 0), 0);
const percent = list => list.length ? Math.round(100 * done(list) / list.length) : 0;
const labels = {pending: '待完成', partial: '部分完成', delayed: '顺延', done: '已完成', conflict: '待处理冲突'};
const pages = {today: '今日任务', week:'每周课表', issues:'问题与错题', calendar: '学习日历', stats: '进度统计', feedback: '每日反馈', data: '同步与归档'};
const dates = () => [...new Set([...state.tasks.map(t => t.date), ...Object.keys(state.notes), state.selected])].sort();
const pending = () => user && store?.owner === user.uid ? store.revisions.filter(r => !acknowledged.has(r.id)).length : 0;
const localLabel = () => localDesktop ? '已保存到电脑数据库' : '已保存到浏览器';

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message; element.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 4500);
}
function failure(error) { console.error(error); toast(error.message || '操作失败，未标记保存成功'); }
function syncLabel() {
  let label = activeUploads ? '正在保存图片…' : dirty ? (draftError?'草稿暂存失败，请提交保存':'草稿已暂存 · 可自由切换，提交后归档') : activeSaves ? '正在保存到本地…' : localLabel();
  if (cloudError) label += ' · ' + cloudError;
  else if (user && store.owner === user.uid) label += syncing ? ' · 正在同步' : pending() ? ` · ${pending()}条等待上传` : lastSync ? ' · 云端已确认' : ' · 等待同步';
  else label += ' · 未连接云端';
  const el = document.getElementById('syncStatus'); el.textContent = label;
  el.className = 'sync-status ' + (lastSync && !pending() && !cloudError && !activeSaves && !dirty ? 'cloud' : 'local'); el.title = label;
}
function refresh(force = false) {
  syncLabel();
  if (!force && (dirty || document.activeElement?.matches('input,textarea,select'))) return;
  Object.assign(state, store.view()); render();
}
function heading(title, detail) { return `<div class="heading"><div><div class="eyebrow">CQU STUDY PLANNER</div><h1>${html(title)}</h1><p>${html(detail)}</p></div><label class="date-switch"><span>学习日期</span><input type="date" id="selectedDate" value="${state.selected}" /></label></div>`; }
function stat(label, value, extra = '') { return `<div class="stat-card"><div class="stat-label">${html(label)}</div><div class="stat-value">${html(value)}</div><div class="stat-sub">${html(extra)}</div></div>`; }
function numberField(t, key, label, max) {
  return `<label>${label}<input class="minutes-input" type="number" min="0" max="${max}" step="1" name="${key}" value="${t[key] ?? ''}" /></label>`;
}
function taskRow(t) {
  const locked = t.status === 'conflict' || t.planConflict;
  return `<form class="task-row ${t.status === 'done' ? 'done' : ''}" data-record="task:${html(t.id)}"><fieldset class="task-inner" ${locked ? 'disabled' : ''}><div class="task-time">${html(t.time)}</div><input class="task-check" type="checkbox" name="check" ${t.status === 'done' ? 'checked' : ''} aria-label="完成：${html(t.detail)}"/><div><div class="task-subject">${html(t.subject)}</div><div class="task-detail">${html(t.detail)}</div>${t.progressDate&&t.progressDate!==t.date?`<p class="footnote">已有学习记录日期：${html(t.progressDate)}（课表调整保留原日期）</p>`:''}<div class="task-extra">${numberField(t, 'actualMinutes', '实际分钟', 1440)}<select name="status" aria-label="任务状态">${Object.entries(labels).filter(([k]) => k !== 'conflict' || locked).map(([key, value]) => `<option value="${key}" ${t.status === key ? 'selected' : ''}>${value}</option>`).join('')}</select></div>${questionEditor(html)}<details class="task-detail-form"><summary>原任务反馈、题量与视频进度${t.feedback ? ' · 已填写' : ''}</summary><div class="task-extra">${numberField(t, 'questionsAttempted', '做题数量', 10000)}${numberField(t, 'questionsCorrect', '答对数量', 10000)}${numberField(t, 'videoPositionSec', '视频进度（秒）', 86400)}</div><textarea class="task-note" name="feedback" maxlength="20000" placeholder="卡点、错题、尚未完成内容">${html(t.feedback)}</textarea></details><button type="submit" class="button save-task">保存进度与问题</button></div><div class="mini-status">${html(labels[t.status])}</div></fieldset>${locked ? '<button type="button" class="small-link" data-page="data">查看并处理冲突 →</button>' : ''}</form>`;
}
function renderToday() {
  const classes=state.tasks.filter(t=>t.date===state.selected&&t.category==='本科课');
  const actualToday=[...state.tasks,...state.archivedTasks].filter(t=>t.progressDate===state.selected);
  const list = tasksFor(state.selected), visible = list.filter(t => state.filter === 'all' || t.subject === state.filter);
  return heading(cnDate(state.selected) + '的学习安排', '完成状态、用时和问题可以一起提交；原任务反馈仍可展开填写。') +
    `<div class="stats-grid">${stat('今日任务', `${done(list)}/${list.length}`, '已完成 / 总任务')}${stat('完成率', `${percent(list)}%`, '部分完成不计为全部完成')}${stat('计划分钟', sum(list, 'plannedMinutes'))}${stat('实际分钟', sum(actualToday, 'actualMinutes'), '不重复叠加每日反馈总时长')}</div><div class="banner">已按实际周次加入本科课，并避让考研学习时段。草稿自动暂存，可自由切换页面；提交后计入学习记录。</div>${classes.length?`<section class="panel"><h2>今日本科课</h2><div class="today-classes">${classes.map(t=>`<div><b>${html(t.time)}</b><span>${html(t.detail)}</span><small>${html(t.location)}</small></div>`).join('')}</div><p class="footnote">本科课时已在每周课表保留；课堂问题可在“问题与错题”补充提交。</p></section>`:''}<section class="panel"><div class="panel-header"><h2>考研学习任务</h2><select id="subjectFilter" aria-label="筛选科目">${['all', ...new Set(state.tasks.filter(t=>t.category!=='本科课').map(t => t.subject))].map(s => `<option value="${html(s)}" ${state.filter === s ? 'selected' : ''}>${s === 'all' ? '全部科目' : html(s)}</option>`).join('')}</select></div>${visible.length ? visible.map(taskRow).join('') : '<div class="empty-state">这一天还没有安排任务，可在每日反馈中记录学习情况。</div>'}</section>`;
}
function renderCalendar() {
  return heading('学习日历', '点击日期查看对应的学习记录。') + `<section class="panel"><div class="calendar-grid">${dates().map(d => {const items = tasksFor(d); return `<button class="day-tile ${d === state.selected ? 'selected' : ''}" data-date="${d}"><small>${html(d)}</small><b>${html(cnDate(d))}</b><span>${done(items)}/${items.length} 项完成</span><div class="bar"><i style="width:${percent(items)}%"></i></div></button>`;}).join('')}</div></section>`;
}
function renderStats() {
  const studyTasks=state.tasks.filter(t=>t.category!=='本科课');
  return heading('学习进度统计', '任务实际分钟只计一次；未解决冲突的时长暂不计入。') + `<div class="stats-grid">${stat('考研任务数', studyTasks.length)}${stat('已完成', done(studyTasks))}${stat('实际总时长', (sum([...state.tasks,...state.archivedTasks], 'actualMinutes') / 60).toFixed(1) + 'h')}${stat('待处理冲突', state.conflicts.length)}</div><section class="panel"><div class="subject-progress">${[...new Set(studyTasks.map(t => t.subject))].map(s => {const items = studyTasks.filter(t => t.subject === s); return `<div><div class="progress-head"><b>${html(s)}</b><span>${done(items)}/${items.length} · ${sum(items, 'actualMinutes')}分钟</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent(items)}%"></div></div></div>`;}).join('')}</div></section>`;
}
function renderFeedback() {
  const n = state.notes[state.selected] || {}, locked = n.conflict;
  return heading('每日反馈', '填写后点击“保存本日反馈”；每日总时长用于对照，不重复计入任务统计。') + `<section class="panel"><div class="panel-header"><h2>${html(cnDate(state.selected))}</h2><span class="save-indicator">${localDesktop ? '保存到电脑数据库' : '保存到当前浏览器'}</span></div>${locked ? '<div class="banner">这一天的反馈有并发修改，请在同步与归档页处理。</div>' : ''}<form data-record="note:${state.selected}"><fieldset ${locked ? 'disabled' : ''} class="feedback-fields"><div class="field"><label for="dayMinutes">当天自报总分钟（选填）</label><input id="dayMinutes" type="number" min="0" max="1440" step="1" value="${n.actualTotal ?? ''}" /></div><div class="field"><label for="dayReflection">今日学习、困难与卡点</label><textarea id="dayReflection" maxlength="20000">${html(n.reflection)}</textarea></div><div class="field"><label for="dayAdjustment">临时安排、明天可用时间与调整需求</label><textarea id="dayAdjustment" maxlength="20000">${html(n.adjustment)}</textarea></div><button type="submit" class="button login-button">保存本日反馈</button></fieldset></form></section>`;
}
function conflictCard(c) {
  const version = r => {
    const p = r.payload;
    const fields = r.key.startsWith('plan:') ? [['日期',p.date],['开始时间',p.startTime],['结束时间',p.endTime],['科目',p.subject],['任务内容',p.detail],['地点',p.location],['备注',p.remarks]] : r.key.startsWith('issue:') ? [['题号或题目',p.question],['卡点',p.description],['出处',p.resource],['状态',p.status==='resolved'?'已解决':'待解决']] : r.key.startsWith('task:')
      ? [['科目', p.subject], ['状态', p.deleted ? '已删除' : labels[p.status]], ['实际分钟', p.actualMinutes ?? '未填写'], ['做题 / 答对', `${p.questionsAttempted ?? '未填'} / ${p.questionsCorrect ?? '未填'}`], ['视频进度（秒）', p.videoPositionSec ?? '未填写'], ['学习反馈', p.feedback || '未填写']]
      : [['自报总分钟', p.actualTotal ?? '未填写'], ['今日反馈', p.reflection || '未填写'], ['调整需求', p.adjustment || '未填写']];
    return `<div><p>${html(r.source)} · ${html(new Date(r.createdAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'}))}</p><dl>${fields.map(([label,value]) => `<dt>${html(label)}</dt><dd>${html(value)}</dd>`).join('')}</dl><button class="button" data-resolve="${html(r.id)}">采用此版本</button></div>`;
  };
  return `<section class="panel conflict-card"><h2>${html(c.heads[0].payload.detail || c.heads[0].payload.date + '每日反馈')} · 版本冲突</h2><p>请选择采用的版本。所有旧版本都会保留，选择后生成一次合并记录。</p><div class="conflict-options">${c.heads.map(version).join('')}</div></section>`;
}
function renderData() {
  return heading('数据管理', '下载完整数据，或上传更新后的课表。') +
    transferView(state.tablePreview,{html})+`<details class="panel storage-settings"><summary>同步与存储设置</summary><h2>当前保存位置</h2><p>${localDesktop ? '电脑数据目录：' + html(store.dataPath || '学习数据') : '当前设备的浏览器存储，请定期导出备份'}</p><p>档案：<strong>${html(store.owner === 'local' ? '未绑定账号的本机档案' : store.owner)}</strong></p><div class="task-extra"><label>打开本地档案 <select id="profileSelect">${profiles.map(owner => `<option value="${html(owner)}" ${owner === store.owner ? 'selected' : ''}>${html(owner === 'local' ? '本机档案（未绑定）' : owner)}</option>`).join('')}</select></label></div><p>${html(user ? '登录账号：' + user.email : '尚未登录；本地档案仍可离线使用')}</p><p>最近云端确认：${html(lastSync || '尚无')} · 待上传：${pending()}条 · 历史修订：${store.revisions.length}条</p><p>${html(cloudError || '电脑关闭时不接收云端数据，下次启动后补齐。')}</p><div class="actions-wrap"><button class="button" id="syncNow">立即同步</button><button class="button" id="copyLocal" ${!user ? 'disabled' : ''}>将本机档案合并到当前账号</button>${localDesktop ? '<button class="button" id="backupDb">创建数据库备份</button><button class="button" id="openFolder">打开数据目录</button>' : ''}</div><p class="footnote">JSON备份包含完整版本。CSV与日报用于整理，不用于替换数据库。导入JSON会先预览，合并记录并保留历史。</p></details>${state.conflicts.map(conflictCard).join('')}<details class="panel storage-settings"><summary>查看全部学习记录</summary><div class="panel-header"><h2>全部学习记录</h2><span>${state.tasks.length}项任务</span></div><div class="records-table"><table><thead><tr><th>日期</th><th>科目</th><th>任务</th><th>状态</th><th>实际分钟</th></tr></thead><tbody>${[...state.tasks,...state.archivedTasks].map(t => `<tr><td><button class="small-link" data-date="${t.date}">${html(t.date)}</button></td><td>${html(t.subject)}</td><td>${html(t.detail)}</td><td>${t.archived?'已归档 · ':''}${html(labels[t.status])}</td><td>${t.actualMinutes ?? '—'}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function render() {
  const previousWeek=app.querySelector('.week-scroll'),weekStart=previousWeek?.dataset.weekStart;
  const weekScroll=previousWeek?{top:previousWeek.scrollTop,left:previousWeek.scrollLeft,cards:new Map([...previousWeek.querySelectorAll('[data-course-id]')].map(el=>[el.dataset.courseId,el.scrollTop]))}:null;
  captureDrafts();
  renderedParents.clear();
  for (const t of [...state.tasks,...state.archivedTasks]) {
    renderedParents.set('task:' + t.id,store.parents('task:' + t.id));
    renderedParents.set('plan:' + t.id,store.parents('plan:' + t.id));
  }
  renderedParents.set('note:' + state.selected, store.parents('note:' + state.selected));
  document.getElementById('breadcrumb').textContent = pages[state.page];
  document.querySelector('.top-actions').classList.toggle('on-data-page',state.page==='data');
  document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === state.page));
  app.innerHTML = ({week:renderWeek, issues:renderIssues,today: renderToday, calendar: renderCalendar, stats: renderStats, feedback: renderFeedback, data: renderData})[state.page]();
  restoreDrafts();
  const nextWeek=app.querySelector('.week-scroll');
  if(weekScroll&&nextWeek&&nextWeek.dataset.weekStart===weekStart){
    nextWeek.scrollTop=weekScroll.top;nextWeek.scrollLeft=weekScroll.left;
    for(const card of nextWeek.querySelectorAll('[data-course-id]'))if(weekScroll.cards.has(card.dataset.courseId))card.scrollTop=weekScroll.cards.get(card.dataset.courseId);
  }
  syncLabel();
}

let courseDialog=null;
function editCourseTime(id){
  if(courseDialog?.isConnected)return;
  if(activeSaves||activeUploads||transferBusy){toast('正在保存，请稍后修改课程时间');return;}
  const current=store,task=state.tasks.find(t=>t.id===id);
  if(!task)return;
  if(task.planConflict){toast('这节课有同步冲突，请先在“同步与归档”中处理');return;}
  const key='plan:'+id,parents=[...(renderedParents.get(key)||current.parents(key))];
  courseDialog=showCourseTimeEditor({task,tasks:()=>state.tasks,onClose:()=>{courseDialog=null;app.querySelector('[data-course-id="'+id+'"]')?.focus({preventScroll:true});},onSave:async payload=>{
    if(current!==store)throw Error('账号档案已切换，请重新打开课程');
    await saved(()=>current.save(key,payload,parents));
    state.selected=payload.date;refresh(true);
    toast(store.view().conflicts.some(c=>c.key===key)?'时间已保存；另一个设备也有修改，请到“同步与归档”处理冲突。':'课程时间已修改，实际学习记录和问题已保留');
  }});
}
bindCourseGestures(document,editCourseTime);

async function saved(action, form = null) {
  activeSaves++; syncLabel();
  const fieldset = form?.querySelector('fieldset');
  if (fieldset) fieldset.disabled = true;
  try {
    const revision = await action();
    if (form) {
      localStorage.removeItem(draftPrefix()+form.dataset.draftKey);
      const entries=form.querySelector('.question-entries');if(entries){entries.innerHTML=questionEntry(html);paintImages();}
      draftForms.delete(form);
      if (revision?.id) renderedParents.set(form.dataset.record, [revision.id]);
    }
    dirty = draftForms.size > 0;
    toast(store.warning || localLabel());
    if(form && document.activeElement?.closest('form')===form) document.activeElement.blur();
    refresh(); void syncCloud();
  } finally {
    if (fieldset) fieldset.disabled = false;
    activeSaves--; syncLabel();
  }
}
async function saveForm(form) {
  if(activeUploads)throw Error('图片正在保存，请稍后提交');
  if (!form.reportValidity()) return;
  const key = form.dataset.record, current = store;
  let payload;
  if (key.startsWith('task:')) {
    const task = state.tasks.find(t => t.id === key.slice(5));
    if (task.status === 'conflict' || task.planConflict) throw Error('请先处理版本冲突');
    payload = {...task, date:task.progressDate || task.date, status: form.elements.status.value, feedback: form.elements.feedback.value};
    for (const name of ['actualMinutes', 'questionsAttempted', 'questionsCorrect', 'videoPositionSec']) {
      payload[name] = form.elements[name].value === '' ? null : Number(form.elements[name].value);
    }
  } else if (key === 'new-issue') {
    const batch=issueRevisions(form,{taskId:form.elements.taskId.value,date:form.elements.date.value,subject:form.elements.subject.value},current);
    if(!batch.length)throw Error('请至少填写一道题、问题说明或上传图片');
    await saved(()=>current.merge(batch),form);return;
  } else {
    payload = {date: key.slice(5), actualTotal: form.querySelector('#dayMinutes').value === '' ? null : Number(form.querySelector('#dayMinutes').value), reflection: form.querySelector('#dayReflection').value, adjustment: form.querySelector('#dayAdjustment').value};
  }
  const revision=current.revision(key,payload,renderedParents.get(key));
  const batch=[revision];
  if(key.startsWith('task:')) {
    batch.push(...issueRevisions(form,{taskId:payload.id,date:state.selected,subject:payload.subject},current));
  }
  await saved(async()=>{await current.merge(batch);return revision;}, form);
}
function issueRevisions(form,meta,current){
  return rowQuestions(form).filter(q=>q.question||q.description||q.resource||q.attachments.length).map((q,i)=>{
    if(!q.question&&!q.description&&!q.attachments.length)throw Error(`问题${i+1}仅填了出处，请添加题目、说明或图片`);
    const id=uuid();return current.revision('issue:'+id,{id,...meta,...q,status:'open'});
  });
}
function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], {type}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCsv() {
  download('CQU-PROGRESS-1-'+today()+'.csv',csvEncode(progressTables(store.view())['学习进度']),'text/csv;charset=utf-8');
}
function exportTables(kind) {
  if(dirty||activeSaves)throw Error('请先保存输入再下载表格');
  const view=store.view();
  if(view.conflicts.length)throw Error('请先处理同步冲突，或使用JSON下载全部版本');
  let tables, filename;
  if(kind==='blank') {tables={'课表':[formats['课表'].headers]};filename='CQU-PLAN-1-空白模板.xlsx';}
  else if(kind==='week') {const days=weekDates(state.selected);tables={'课表':planTable(view.tasks.filter(t=>days.includes(t.date)))};filename='CQU-PLAN-1-周课表-'+days[0]+'.xlsx';}
  else if(kind==='records') {tables=progressTables(view);filename='CQU-RECORDS-1-'+today()+'.xlsx';}
  else {tables={'课表':planTable(kind==='all'?[...view.tasks,...view.archivedTasks]:view.tasks),...(kind==='all'?progressTables(view):{})};filename='CQU-'+(kind==='all'?'TABLES-1':'PLAN-1')+'-'+today()+'.xlsx';}
  download(filename,writeXlsx(tables),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
async function readTableFile(file) {
  if(!file)return;
  if(activeSaves||activeUploads)throw Error('正在保存，请稍后上传');
  captureDrafts();
  if(file.size>8*1024*1024)throw Error('表格超过8MB，请分批上传');
  let tables;
  if(/\.xlsx$/i.test(file.name))tables=await readXlsx(await file.arrayBuffer());
  else if(/\.csv$/i.test(file.name)) {const rows=csvDecode(await file.text()),name=identifyTable(rows);if(!name)throw Error('表头不匹配，请下载固定模板后填写');tables={[name]:rows};}
  else throw Error('请上传.xlsx或UTF-8 CSV文件');
  if(activeSaves||activeUploads)throw Error('正在保存，请稍后重新上传');
  await store.tail; await store.load();
  const preview=await previewTables(tables,store);
  state.tablePreview={...preview,filename:file.name};state.page='data';window.scrollTo(0,0);refresh(true);
}
async function downloadData(full=false){
  if(transferBusy||activeSaves||activeUploads)throw Error('正在处理数据，请稍后再试');
  transferBusy=true;const current=store,currentImages=images;
  const buttons=[...document.querySelectorAll('[data-download-data]')];buttons.forEach(b=>{b.disabled=true;b.textContent='正在打包…';});
  try{
    await current.tail;await current.load();
    const checkpoint=await archiveCheckpoint(current.owner),pending=pendingArchive(current,checkpoint);
    if(!full&&!pending.revisions.length&&!pending.images.length){toast('没有新增或修改的数据，无需重复下载');return;}
    // Browser state is local, so these awaits finish within the click activation; no picker for an empty batch.
    const handle=!localDesktop&&window.showSaveFilePicker?await window.showSaveFilePicker({suggestedName:'CQU-'+(full?'完整数据':'增量归档')+'-'+today()+'.zip',types:[{description:'学习数据包',accept:{'application/zip':['.zip']}}]}):null;
    const contents=await createDataPackage(current,currentImages,full?{}:{mode:'incremental',checkpoint});
    if(localDesktop){const receipt=await api('/api/archive-download',{owner:current.owner,data:base64(contents)});toast('已校验保存到电脑：'+receipt.path);}
    else if(handle){
      const parsed=await readDataPackage(contents,currentImages),receipt=await archiveReceipt(parsed.backup,parsed.manifest.images,contents);
      await saveBrowserArchive(handle,contents,checkpoint,receipt);toast('已保存，下次只下载新增内容。云端清理仍需电脑归档确认。');
    }else{download('CQU-'+(full?'完整数据':'增量归档')+'-'+today()+'.zip',contents,'application/zip');toast('已发起下载；通过“上传数据”读回ZIP可确认保存并避免重复下载。云端清理仍需电脑归档。');}
  }catch(error){if(error.name!=='AbortError')throw error;}
  finally{transferBusy=false;buttons.forEach(b=>{b.disabled=false;b.textContent='↓ 下载数据';});}
}
async function readUploadFile(file){
  if(!file)return;
  if(transferBusy||activeSaves||activeUploads)throw Error('正在处理数据，请稍后再试');
  transferBusy=true;const current=store;
  try{
    if(file.size>128*1024*1024)throw Error('文件超过128MB，请分批归档');
    if(/\.(xlsx|csv)$/i.test(file.name)){await readTableFile(file);return;}
    let obj,attachments=[],fileReceipt=null;
    if(/\.zip$/i.test(file.name)){const buffer=new Uint8Array(await file.arrayBuffer()),parsed=await readDataPackage(buffer,images);obj=parsed.backup;attachments=parsed.attachments;if(!localDesktop)fileReceipt=await archiveReceipt({...obj,owner:current.owner},parsed.manifest.images,buffer);}
    else if(/\.json$/i.test(file.name))obj=JSON.parse(await file.text());
    else throw Error('请选择数据包 ZIP、课表 XLSX / CSV 或旧备份 JSON');
    if(current!==store)throw Error('档案已切换，请重新选择文件');
    await current.tail;await current.load();const p=current.previewImport(obj);
    state.tablePreview={kind:'backup',filename:file.name,backup:obj,attachments,fileReceipt,revisions:p.revisions,added:p.added,conflicts:p.conflicts,owner:current.owner,fingerprint:canonical(current.revisions),errors:[]};
    state.page='data';refresh(true);
  }catch(error){if(current===store){state.tablePreview={filename:file.name,errors:[error.message],changes:[],revisions:[]};state.page='data';refresh(true);}else throw error;}
  finally{transferBusy=false;}
}
async function applyTables() {
  const p=state.tablePreview;
  if(!p||p.errors.length||(!p.revisions.length&&!p.attachments?.length))return;
  if(dirty||activeSaves)throw Error('请先保存当前输入');
  await store.tail;await store.load();
  if(p.owner!==store.owner||p.fingerprint!==canonical(store.revisions))throw Error('数据在预览后发生变化，请重新上传以刷新预览');
  if(localDesktop)await api('/api/backup',{owner:store.owner});
  if(p.kind==='backup'){
    const current=store,currentImages=images;
    await saved(async()=>{
      if(p.attachments.length){for(const {meta,bytes} of p.attachments)await currentImages.put(meta,bytes);}
      else await importImageJson(p.backup,currentImages);
      await current.merge(p.revisions);
    });
    if(p.fileReceipt)await confirmBrowserFile(p.fileReceipt);
    state.tablePreview=null;refresh(true);toast('数据已合并，原有记录保留');return;
  }
  await saved(()=>store.merge(p.revisions));state.tablePreview=null;refresh(true);toast('表格已更新，原学习记录与问题已保留');
}
function renderWeek(){return weekView(state,{html,heading,stat,labels});}
function renderIssues(){return issuesView(state,{html,heading});}
function exportMd() {
  const items = tasksFor(state.selected), note = state.notes[state.selected];
  const text = `# ${state.selected} 学习记录\n\n` + items.map(t => `## ${t.subject} · ${t.detail}\n\n- 状态：${labels[t.status]}\n- 实际分钟：${t.actualMinutes ?? '未填'}\n- 做题/答对：${t.questionsAttempted ?? '未填'} / ${t.questionsCorrect ?? '未填'}\n\n${t.feedback}\n`).join('\n') + '\n## 每日反馈\n\n' + (note?.conflict ? '存在冲突，请查看完整JSON版本。' : (note?.reflection || '未填写') + '\n\n' + (note?.adjustment || ''));
  download(state.selected + '-学习记录.md', text, 'text/markdown;charset=utf-8');
}
async function loadProfiles() {
  profiles = localDesktop ? (await api('/api/profiles')).profiles : Object.keys(localStorage).filter(k => k.startsWith('cqu-planner-v2:')).map(k => k.slice('cqu-planner-v2:'.length));
  profiles = [...new Set(['local', ...profiles, store.owner])];
}
async function switchProfile(owner) {
  if (transferBusy || activeSaves || activeUploads) throw Error('正在保存或归档，请稍后切换档案');
  captureDrafts();draftForms.clear();dirty=false;images?.close();
  store = await new LocalStore(owner, state.seed).load();
  images = new AttachmentStore(owner);await installInitialPlans();
  lastSync = ''; acknowledged.clear(); await loadProfiles(); refresh(true);
}
async function copyLocal() {
  if (!user || store.owner !== user.uid) throw Error('请先登录并打开当前账号档案');
  const local = await new LocalStore('local', state.seed).load(), preview = store.previewImport(local.export());
  if (!confirm(`将本机未绑定档案中的${local.revisions.length}个历史修订复制到当前账号（${user.email}），新增${preview.added}个，合并后${preview.conflicts}项冲突。本机原件保留。是否继续？`)) return;
  const localImages=new AttachmentStore('local');
  try{for(const meta of referencedImages(preview.revisions))await images.put(meta,await localImages.get(meta));}
  finally{localImages.close();}
  await saved(() => store.merge(preview.revisions));
}
function imageCloud(account){return {read:async id=>{const doc=await deadline(sdk.getDocFromServer(sdk.doc(db,'users',account.uid,'attachments',id)));return doc.exists()?doc.data():null;},write:(id,data)=>deadline(sdk.setDoc(sdk.doc(db,'users',account.uid,'attachments',id),data))};}

async function syncCloud() {
  if (!user || !db || store.owner !== user.uid || (syncing && syncing.current === store && syncing.epoch === cloudEpoch)) return;
  const epoch = cloudEpoch, account = user, current = store, currentImages=images;
  const run = {current, epoch}; syncing = run; cloudError = ''; syncLabel();
  try {
    const collection = sdk.collection(db, 'users', account.uid, 'revisions');
    const snapshot = await deadline(sdk.getDocsFromServer(collection));
    if (epoch !== cloudEpoch || current !== store) return;
    const remote = snapshot.docs.map(d => d.data());
    await downloadCloudImages(remote,currentImages,imageCloud(account));
    await current.merge(remote);
    if (epoch !== cloudEpoch || current !== store) return;
    for (const r of remote) acknowledged.add(r.id);
    await uploadCloudImages(current.revisions.filter(r=>!acknowledged.has(r.id)),currentImages,imageCloud(account));
    for (const r of current.revisions) {
      if (epoch !== cloudEpoch || current !== store) return;
      if (!acknowledged.has(r.id)) {
        await deadline(sdk.setDoc(sdk.doc(collection, r.id), r));
        if (epoch === cloudEpoch && current === store) acknowledged.add(r.id);
      }
    }
    if (epoch === cloudEpoch && current === store) { lastSync = new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}); refresh(); }
  } catch (error) {
    if (epoch === cloudEpoch && current === store) { cloudError = '同步失败，本地记录保留：'+error.message; console.error(error); }
  } finally { if (syncing === run) syncing = false; syncLabel(); }
}
async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('云端请求超时')), 15000); })]); }
  finally { clearTimeout(timer); }
}
async function setupFirebase() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) return;
  try {
    const modules = await Promise.all(['app', 'auth', 'firestore'].map(name => import(`https://www.gstatic.com/firebasejs/11.6.0/firebase-${name}.js`)));
    sdk = Object.assign({}, ...modules); const firebaseApp = sdk.initializeApp(firebaseConfig);
    auth = sdk.getAuth(firebaseApp); db = sdk.getFirestore(firebaseApp);
    sdk.onAuthStateChanged(auth, async account => {
      const epoch = ++cloudEpoch; unsubscribe?.(); unsubscribe = null;
      user = null; acknowledged.clear(); lastSync = ''; cloudError = '';
      document.getElementById('loginBtn').textContent = 'Google 登录';
      if (!account) { syncLabel(); return; }
      if (!isAllowedAccount(account,{uid:allowedUid,email:allowedEmail})) {
        await sdk.signOut(auth); toast('这个账号不在允许名单中'); return;
      }
      try {
        if (activeSaves || activeUploads) throw Error('登录已完成，请等待本地保存完成后再打开账号档案');
        user = account; await switchProfile(account.uid);
        if (epoch !== cloudEpoch) return;
        document.getElementById('loginBtn').textContent = '退出登录';
        const collection = sdk.collection(db, 'users', account.uid, 'revisions');
        unsubscribe = sdk.onSnapshot(collection, {includeMetadataChanges: true}, async snapshot => {
          if (epoch !== cloudEpoch || store.owner !== account.uid || snapshot.metadata.fromCache) return;
          const current = store;
          try {
            if (snapshot.docs.some(d => d.metadata.hasPendingWrites)) return;
            const remote = snapshot.docs.map(d => d.data());
            const accountImages=images;await downloadCloudImages(remote,accountImages,imageCloud(account));
            if(epoch!==cloudEpoch||current!==store)return;
            await current.merge(remote);
            if (epoch !== cloudEpoch || current !== store) return;
            remote.forEach(r => acknowledged.add(r.id));
            lastSync = new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}); refresh();
          } catch (error) { cloudError = '下载记录失败：' + error.message; syncLabel(); }
        }, error => { if (epoch === cloudEpoch) { cloudError = '云端权限或网络异常'; syncLabel(); console.error(error); } });
        await syncCloud(); toast('已打开账号档案。本机进度可在“同步与归档”中预览合并。');
      } catch (error) { failure(error); }
    });
  } catch (error) { cloudError = '云端连接失败，可继续本地使用'; syncLabel(); console.error(error); }
}

document.addEventListener('submit', event => {
  if (!event.target.dataset.record) return;
  event.preventDefault(); void saveForm(event.target).catch(failure);
});
document.addEventListener('input', event => {
  const form = event.target.closest('form[data-record]');
  if (form) {
    if(event.target.type==='file')return;
    if (event.target.name === 'check') form.elements.status.value = event.target.checked ? 'done' : 'pending';
    if (event.target.name === 'status' && form.elements.check) form.elements.check.checked = event.target.value === 'done';
    rememberDraft(form);
  }
});
document.addEventListener('change', event => {
  const t = event.target;
  const action = async () => {
    if(t.matches('[data-question-images]')){
      const row=t.closest('.question-entry'),form=t.closest('form'),files=[...t.files],list=JSON.parse(row.dataset.attachments||'[]');
      if(files.length+list.length>6)throw Error('每题最多6张图片');
      activeUploads++;syncLabel();
      try{for(const file of files){const meta=await images.add(file);if(!list.some(a=>a.id===meta.id))list.push(meta);}row.dataset.attachments=JSON.stringify(list);rememberDraft(form);paintImages();}
      finally{activeUploads--;t.value='';syncLabel();}return;
    }
    if(t.id==='issueTask') {const item=[...state.tasks,...state.archivedTasks].find(item=>item.id===t.value);if(item)t.form.elements.subject.value=item.subject;}
    else if(t.id==='issueFilter') {state.issueFilter=t.value;render();}
    else if (t.id === 'selectedDate') {captureDrafts();state.selected = t.value || today();refresh(true);}
    else if (t.id === 'subjectFilter') {state.filter = t.value;render();}
    else if (t.id === 'profileSelect') { await switchProfile(t.value); void syncCloud(); }
  };
  void action().catch(failure);
});
document.addEventListener('click', event => {
  const t = event.target.closest('button'); if (!t) return;
  const action = async () => {
    if(t.hasAttribute('data-upload-data')){document.getElementById('uploadInput').click();return;}
    if(t.hasAttribute('data-download-data')){await downloadData();return;}
    if(t.id==='downloadSelected'){
      const kind=document.getElementById('downloadFormat').value;
      if(kind==='package')await downloadData(true);
      else if(['plan','blank','week','records','all'].includes(kind))exportTables(kind);
      else if(kind==='questions')download('CQU-ISSUES-1-'+today()+'.zip',await issueBundle(store.view(),images),'application/zip');
      else if(kind==='json')download('CQU-完整备份-'+today()+'.json',JSON.stringify(await exportImageJson(store,images),null,2),'application/json');
      else if(kind==='csv')exportCsv();else if(kind==='md')exportMd();return;
    }
    if(t.hasAttribute('data-add-question')){const form=t.closest('form');form.querySelector('.question-entries').insertAdjacentHTML('beforeend',questionEntry(html));rememberDraft(form);paintImages();return;}
    if(t.hasAttribute('data-remove-question')){const form=t.closest('form');t.closest('.question-entry').remove();if(!form.querySelector('.question-entry'))form.querySelector('.question-entries').innerHTML=questionEntry(html);rememberDraft(form);paintImages();return;}
    if(t.dataset.removeImage!==undefined){const row=t.closest('.question-entry'),form=t.closest('form'),list=JSON.parse(row.dataset.attachments);list.splice(Number(t.dataset.removeImage),1);row.dataset.attachments=JSON.stringify(list);rememberDraft(form);paintImages();return;}
    if(t.id==='exportIssues'){download('CQU-ISSUES-1-'+today()+'.zip',await issueBundle(store.view(),images),'application/zip');return;}
    if(t.dataset.weekMode){state.weekMode=t.dataset.weekMode;refresh(true);}
    else if(t.dataset.week) {state.selected=addDays(weekDates(state.selected)[0],7*Number(t.dataset.week));refresh(true);}
    else if(t.dataset.issueStatus) {const issue=state.issues.find(i=>i.id===t.dataset.issueStatus);const {conflict,...payload}=issue;if(conflict)throw Error('请先处理此问题的同步冲突');await saved(()=>store.save('issue:'+issue.id,{...payload,status:issue.status==='resolved'?'open':'resolved'}));refresh(true);}
    else if (t.dataset.page || t.dataset.date) {
      if (activeSaves || activeUploads) {toast('正在保存，请稍后切换');return;}
      captureDrafts();
      if (t.dataset.page) state.page = t.dataset.page;
      if (t.dataset.date) { state.selected = t.dataset.date; state.page = 'today'; state.filter='all'; }
      document.querySelector('.sidebar').classList.remove('open'); window.scrollTo(0,0); refresh(true);
    } else if (t.dataset.resolve) {
      const revision = store.revisions.find(r => r.id === t.dataset.resolve);
      if (confirm('采用这个版本并保留所有旧版本？')) await saved(() => store.save(revision.key, revision.payload));
    }
    else if (t.id === 'exportWeek') exportTables('week');
    else if (t.id === 'exportPlan') exportTables('plan');
    else if (t.id === 'exportBlankPlan') exportTables('blank');
    else if (t.id === 'exportRecords') exportTables('records');
    else if (t.id === 'exportAllTables') exportTables('all');
    else if (t.id === 'exportPlanCsv') {if(dirty||activeSaves)throw Error('请先保存输入');download('CQU-PLAN-1-'+today()+'.csv',csvEncode(planTable(store.view().tasks)),'text/csv;charset=utf-8');}
    else if (t.id === 'applyTables') await applyTables();
    else if (t.id === 'cancelTables') {state.tablePreview=null;refresh(true);}
    else if (t.id === 'exportCsv') exportCsv();
    else if (t.id === 'exportMd') exportMd();
    else if (t.id === 'openFolder') await api('/api/open-folder', {owner: store.owner});
    else if (t.id === 'backupDb') { const value = await api('/api/backup', {owner: store.owner}); toast('数据库备份已保存：' + value.path); }
    else if (t.id === 'syncNow') { if (!user) toast('配置云端并登录后，才能同步手机和平板的数据'); else await syncCloud(); }
    else if (t.id === 'copyLocal') await copyLocal();
    else if (t.id === 'mobileMenu') document.querySelector('.sidebar').classList.toggle('open');
    else if (t.id === 'loginBtn') {
      if (dirty || activeSaves) throw Error('请先保存当前输入');
      if (!auth) throw Error('尚未配置云端，请先使用本地程序；部署步骤见README');
      if (user) await sdk.signOut(auth);
      else await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    }
  };
  void action().catch(failure);
});
document.getElementById('uploadInput').addEventListener('change',event=>{void readUploadFile(event.target.files[0]).catch(failure);event.target.value='';});
window.addEventListener('beforeunload', event => {captureDrafts();if (draftError || transferBusy || activeSaves || activeUploads) {event.preventDefault();event.returnValue = '';}});
window.addEventListener('online', () => void syncCloud());
window.addEventListener('storage', () => { if (!localDesktop && !dirty && !activeSaves) void store.load().then(() => refresh()).catch(failure); });
setInterval(() => { if (store && !dirty && !activeSaves) void store.load().then(() => refresh()).catch(failure); }, 20000);
setInterval(() => void syncCloud(), 60000);

async function start() {
  const response = await fetch('./tasks.json'); if (!response.ok) throw Error('无法读取初始任务');
  state.seed = await response.json();
  const baseline=await fetch('./initial-plans.json');if(!baseline.ok)throw Error('无法读取本科课表');state.initialPlans=await baseline.json();
  const academic=await fetch('./academic-calendar.json');state.academic=await academic.json();
  store = await new LocalStore('local', state.seed).load();images=new AttachmentStore(store.owner);
  try {
    const legacy = JSON.parse(localStorage.getItem('cqu-planner-v1') || 'null');
    if (legacy && !store.revisions.length) {
      const revisions = legacyRevisions(legacy, state.seed);
      if (revisions.length && confirm(`发现旧版浏览器记录，是否复制${revisions.length}条到本机档案？原缓存保留。`)) await store.merge(revisions);
    }
  } catch (error) { toast('旧浏览器缓存未能读取，原缓存保留；可继续使用本地数据库。'); console.error(error); }
  await installInitialPlans();await loadProfiles();refresh(true);await setupFirebase();
}
start().catch(error => { failure(error); app.innerHTML = '<section class="panel"><h2>未能载入数据</h2><p>请用“启动本地程序.cmd”运行。已有数据库不会被自动覆盖。</p></section>'; });
