import {firebaseConfig,allowedEmail,allowedUid} from './firebase-config.js?v=2.7';
import {createWebSession} from './web-session.mjs?v=2.7';

let sdk,auth,opening=false,appLoaded=false;
const loginMarkup=`<section class="panel web-login" aria-labelledby="webLoginTitle"><p class="eyebrow">CQU STUDY PLANNER</p><h1 id="webLoginTitle">你的学习空间</h1><p>登录后查看课表、记录学习进度和提交题目。</p><button type="button" class="button login-button web-login-button" data-web-login disabled>使用 Google 登录</button><p id="webLoginStatus" role="status" aria-live="polite">正在连接登录服务…</p></section>`;
function message(text){const el=document.getElementById('webLoginStatus');if(el)el.textContent=text;}
function lock(text){
  document.body.classList.add('auth-locked');
  document.getElementById('app').innerHTML=loginMarkup;
  document.querySelector('[data-web-login]').disabled=!auth;message(text);
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-web-retry]')){window.location.reload();return;}
  const button=event.target.closest('[data-web-login]');
  if(!button||!auth||opening||appLoaded)return;
  opening=true;button.disabled=true;message('请在登录窗口中选择你的账号。');
  const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({...(allowedEmail?{login_hint:allowedEmail}:{}),prompt:'select_account'});
  void sdk.signInWithPopup(auth,provider).catch(error=>{
    const hint=error.code==='auth/unauthorized-domain'?'请先在Firebase授权域名中加入当前网站域名。':
      error.code==='auth/popup-blocked'?'登录窗口被浏览器阻止，请允许弹出窗口后重试。':
      ['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(error.code)?'已取消登录，可以重新选择账号。':'登录未成功，请检查网络后重试。';
    message(hint);
  }).finally(()=>{opening=false;const current=document.querySelector('[data-web-login]');if(current)current.disabled=false;});
});
async function start(){
  lock('正在连接登录服务…');
  try{
    const modules=await Promise.all(['app','auth'].map(name=>import(`https://www.gstatic.com/firebasejs/11.6.0/firebase-${name}.js`)));
    sdk=Object.assign({},...modules);auth=sdk.getAuth(sdk.initializeApp(firebaseConfig));
    const session=createWebSession({policy:{uid:allowedUid,email:allowedEmail},
      lock,signOut:()=>sdk.signOut(auth),reload:()=>window.location.reload(),report:text=>{
        lock(text);const retry=document.createElement('button');retry.className='button';retry.dataset.webRetry='';retry.textContent='刷新重试';document.querySelector('.web-login').append(retry);
      },loadApp:async()=>{message('登录成功，正在读取你的学习记录…');appLoaded=true;await import('./main.js?v=2.7');},
      unlock:()=>document.body.classList.remove('auth-locked')});
    sdk.onAuthStateChanged(auth,account=>{void session(account).catch(()=>message('登录状态未能确认，请刷新重试。'));});
  }catch(error){
    lock('无法连接登录服务，请检查网络后重试。');
    const retry=document.createElement('button');retry.className='button';retry.dataset.webRetry='';retry.textContent='刷新重试';document.querySelector('.web-login').append(retry);
  }
}
void start();
