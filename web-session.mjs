import {isAllowedAccount} from './identity.mjs?v=2.7';

// Public page must not import the application or open cached records before owner authentication.
export function createWebSession({policy,loadApp,lock,unlock,signOut,reload,report}){
  let started=false,epoch=0;
  return async account=>{
    if(started&&isAllowedAccount(account,policy))return;
    const current=++epoch;
    if(!isAllowedAccount(account,policy)){
      lock(account?'这个账号不在允许名单中，请使用你的个人账号。':'请登录后查看课表和学习记录。');
      if(started){reload();return;}
      if(account)await signOut();
      return;
    }
    started=true;
    try{await loadApp();if(current===epoch)unlock();}
    catch(error){if(current===epoch){started=false;report('页面未能载入，请刷新后重试。');}}
  };
}
