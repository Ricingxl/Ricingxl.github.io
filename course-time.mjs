import {planFromTask,validateRevision} from './model.mjs?v=2.7';
import {minuteOfDay} from './schedule.mjs?v=2.7';

export function updatedCourseTime(task,{date,startTime,endTime}){
  const before=planFromTask(task),payload={...before,date,startTime,endTime,deleted:false};
  validateRevision({id:'course-time-preview',key:'plan:'+before.id,parents:[],payload,source:'课程时间预览',createdAt:new Date().toISOString()});
  const duration=minuteOfDay(endTime)-minuteOfDay(startTime);
  if(duration!==minuteOfDay(before.endTime)-minuteOfDay(before.startTime))payload.plannedMinutes=duration;
  return payload;
}
export function courseTimeOverlaps(plan,tasks){
  return tasks.filter(t=>t.id!==plan.id&&t.date===plan.date&&!t.deleted&&t.startTime&&t.endTime&&t.startTime<plan.endTime&&plan.startTime<t.endTime)
    .map(t=>({date:plan.date,first:plan,second:t}));
}
