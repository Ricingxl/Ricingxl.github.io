export function questionEntry(html,q={}){
  return `<section class="question-entry" data-attachments="${html(JSON.stringify(q.attachments||[]))}"><div class="question-entry-head"><b>问题 <span class="question-number"></span></b><button type="button" class="small-link" data-remove-question>移除此题</button></div><label>题号或题目（有图片可不填）<textarea name="question" maxlength="20000" placeholder="一题一条，便于单独解答归档">${html(q.question||'')}</textarea></label><label>卡在哪里 / 需要什么帮助<textarea name="description" maxlength="20000" placeholder="可描述已经尝试的方法">${html(q.description||'')}</textarea></label><label>出处 / 页码 / 题号<input name="resource" maxlength="2000" value="${html(q.resource||'')}" /></label><label class="image-upload">上传本题图片（可多选）<input type="file" data-question-images accept="image/jpeg,image/png,image/webp,image/gif" multiple /></label><div class="question-images"></div></section>`;
}
export function questionEditor(html){return `<div class="question-editor"><div class="question-entries">${questionEntry(html)}</div><button type="button" class="button add-question" data-add-question>＋ 添加一个问题</button><p class="footnote">每题可单独配图和说明，最多6张原图，每张6MB。图片保存在本机，提交后才进入问题记录。</p></div>`;}
export function rowQuestions(form){return [...form.querySelectorAll('.question-entry')].map(row=>({question:row.querySelector('[name=question]').value.trim(),description:row.querySelector('[name=description]').value.trim(),resource:row.querySelector('[name=resource]').value.trim(),attachments:JSON.parse(row.dataset.attachments||'[]')}));}
export function formSnapshot(form,parents){
  const fields=[...form.querySelectorAll('input,textarea,select')].filter(e=>e.type!=='file'&&!e.closest('.question-entry')).map(e=>({name:e.name||e.id,value:e.value,...(e.type==='checkbox'?{checked:e.checked}:{})}));
  return {fields,questions:rowQuestions(form),parents,details:[...form.querySelectorAll('details')].map(d=>d.open)};
}
export function restoreForm(form,draft,html){
  for(const f of draft.fields||[]){const e=[...form.querySelectorAll('input,textarea,select')].find(e=>(e.name||e.id)===f.name&&!e.closest('.question-entry'));if(e){e.value=f.value;if(f.checked!==undefined)e.checked=f.checked;}}
  const list=form.querySelector('.question-entries');if(list&&draft.questions?.length)list.innerHTML=draft.questions.map(q=>questionEntry(html,q)).join('');
  form.querySelectorAll('details').forEach((d,i)=>d.open=Boolean(draft.details?.[i]));
}
