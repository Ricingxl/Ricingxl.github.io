export function createLongPress({onLongPress,delay=550,tolerance=10,schedule=setTimeout,unschedule=clearTimeout}){
  let active=null,timer=null;
  function cancel(){if(timer!==null)unschedule(timer);timer=null;active=null;}
  return {
    start(point){
      cancel();if(point.primary===false||point.button>0)return;
      active=point;timer=schedule(()=>{const value=active;timer=null;active=null;if(value)onLongPress(value.target);},delay);
    },
    move(point){if(active&&(point.pointerId!==active.pointerId||(point.x-active.x)**2+(point.y-active.y)**2>tolerance**2))cancel();},
    end(point){if(!active||point.pointerId===active.pointerId)cancel();},cancel,
  };
}

export function bindCourseGestures(root,onEdit){
  const press=createLongPress({onLongPress:card=>{if(card.isConnected)onEdit(card.dataset.courseId);}});
  // Passive pointer/scroll listeners leave native text scrolling and pinch zoom to the browser.
  root.addEventListener('pointerdown',event=>{
    const card=event.target.closest?.('[data-course-id]');
    if(!card){press.cancel();return;}
    press.start({pointerId:event.pointerId,x:event.clientX,y:event.clientY,primary:event.isPrimary,button:event.button,target:card});
  },{passive:true});
  root.addEventListener('pointermove',event=>press.move({pointerId:event.pointerId,x:event.clientX,y:event.clientY}),{passive:true});
  root.addEventListener('pointerup',event=>press.end({pointerId:event.pointerId}),{passive:true});
  root.addEventListener('pointercancel',()=>press.cancel(),{passive:true});
  root.addEventListener('scroll',()=>press.cancel(),{passive:true,capture:true});
  root.addEventListener('contextmenu',event=>{const card=event.target.closest?.('[data-course-id]');if(card){event.preventDefault();press.cancel();onEdit(card.dataset.courseId);}});
  root.addEventListener('keydown',event=>{
    const card=event.target.closest?.('[data-course-id]');
    if(card&&['Enter',' '].includes(event.key)){event.preventDefault();press.cancel();onEdit(card.dataset.courseId);}
  });
  // Assistive technology activates controls through a click without a pointer gesture.
  root.addEventListener('click',event=>{const card=event.target.closest?.('[data-course-id]');if(card&&event.detail===0){press.cancel();onEdit(card.dataset.courseId);}});
  globalThis.addEventListener?.('blur',()=>press.cancel());
}
