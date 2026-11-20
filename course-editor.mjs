import {updatedCourseTime,courseTimeOverlaps} from './course-time.mjs?v=2.7';
import {planFromTask,canonical} from './model.mjs?v=2.7';
import {minuteOfDay} from './schedule.mjs?v=2.7';

export function showCourseTimeEditor({task,tasks,onSave,onClose}){
  const dialog=document.createElement('dialog');dialog.className='course-time-dialog';dialog.setAttribute('aria-labelledby','courseTimeTitle');
  dialog.innerHTML=`<form class="course-time-form"><h2 id="courseTimeTitle" tabindex="-1" autofocus>修改课程时间</h2><p data-course-title></p><label>日期<input name="date" type="date" required /></label><div class="course-time-fields"><label>开始时间<input name="startTime" type="time" required /></label><label>结束时间<input name="endTime" type="time" required /></label></div><label class="course-midnight"><input name="midnight" type="checkbox" />结束于当天24:00</label><p class="course-time-summary" data-time-summary></p><p class="course-time-warning" data-time-warning role="status" aria-live="polite"></p><p class="course-time-error" data-time-error role="alert"></p><p class="course-time-note">只修改这一次安排，已填写的学习进度和问题会保留。时段长度改变时会更新计划分钟。</p><div class="course-time-actions"><button type="button" class="button" data-course-cancel>取消</button><button type="submit" class="button login-button">保存时间</button></div></form>`;
  const form=dialog.querySelector('form'),fields=form.elements,submit=form.querySelector('[type=submit]'),cancel=form.querySelector('[data-course-cancel]');
  const before={...planFromTask(task),deleted:false};let busy=false;
  dialog.querySelector('[data-course-title]').textContent=(task.detail||task.subject)+(task.location?' · '+task.location:'');
  fields.date.value=before.date;fields.startTime.value=before.startTime;fields.endTime.value=before.endTime==='24:00'?'23:59':before.endTime;fields.midnight.checked=before.endTime==='24:00';
  const read=()=>updatedCourseTime(task,{date:fields.date.value,startTime:fields.startTime.value,endTime:fields.midnight.checked?'24:00':fields.endTime.value});
  function preview(){
    fields.endTime.disabled=busy||fields.midnight.checked;
    try{
      const plan=read(),conflicts=courseTimeOverlaps(plan,tasks());
      dialog.querySelector('[data-time-summary]').textContent=`时段 ${minuteOfDay(plan.endTime)-minuteOfDay(plan.startTime)} 分钟 · 计划 ${plan.plannedMinutes} 分钟`;
      dialog.querySelector('[data-time-warning]').textContent=conflicts.length?'与 '+conflicts.map(c=>(c.first.id===plan.id?c.second:c.first).subject).slice(0,3).join('、')+' 的安排重叠；保存后会在课表标记。':'';
      dialog.querySelector('[data-time-error]').textContent='';submit.disabled=busy||canonical(plan)===canonical(before);
    }catch(error){dialog.querySelector('[data-time-error]').textContent=error.message;submit.disabled=true;}
  }
  form.addEventListener('input',preview);form.addEventListener('change',preview);
  cancel.addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();onClose?.();},{once:true});
  form.addEventListener('submit',event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    let plan;try{plan=read();}catch(error){dialog.querySelector('[data-time-error]').textContent=error.message;return;}
    if(canonical(plan)===canonical(before)){dialog.close();return;}
    busy=true;cancel.disabled=true;for(const field of [fields.date,fields.startTime,fields.endTime,fields.midnight,submit])field.disabled=true;
    void Promise.resolve().then(()=>onSave(plan)).then(()=>dialog.close()).catch(error=>{
      busy=false;cancel.disabled=false;for(const field of [fields.date,fields.startTime,fields.midnight])field.disabled=false;preview();dialog.querySelector('[data-time-error]').textContent=error.message;
    });
  });
  document.body.append(dialog);preview();dialog.showModal();dialog.querySelector('h2').focus({preventScroll:true});
  return dialog;
}
