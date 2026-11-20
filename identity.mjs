// UI guard only. Firestore Rules independently enforce the same UID on the server.
export function isAllowedAccount(account,policy){
  if(!account||!policy?.uid||account.uid!==policy.uid)return false;
  return !policy.email||(typeof account.email==='string'&&account.email.toLowerCase()===policy.email.toLowerCase());
}
