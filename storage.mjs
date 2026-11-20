import {desktop} from './desktop-config.js';
import {canonical, mergeRevisions, materialize, headsFor} from './model.mjs';

const prefix = 'cqu-planner-v2:';
export const localDesktop = Boolean(desktop);
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
export const uuid = () => crypto.randomUUID();

export async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'X-CQU-Token': desktop.token, 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    cache: 'no-store',
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '本地保存失败');
  return value;
}

export function legacyRevisions(obj, seed) {
  if (obj.version !== 1 || !Array.isArray(obj.tasks) || (obj.notes != null && (typeof obj.notes !== 'object' || Array.isArray(obj.notes)))) throw Error('不支持的旧备份格式');
  const baseline = new Map(seed.map(t => [t.id, {...t, status: 'pending', actualMinutes: null, feedback: ''}]));
  const revisions = [];
  const taskIds = new Set();
  for (const task of obj.tasks) {
    if (!task || typeof task.id !== 'string' || taskIds.has(task.id)) throw Error('重复或无效的任务ID');
    taskIds.add(task.id);
    const original = baseline.get(task.id);
    const payload = {...original, ...task, status: task.status || 'pending', actualMinutes: task.actualMinutes ?? null, feedback: task.feedback || ''};
    if (!original || canonical(payload) !== canonical(original)) revisions.push({id: uuid(), key: 'task:' + task.id, parents: [], payload, source: 'v1备份导入', createdAt: new Date().toISOString()});
  }
  for (const [date, note] of Object.entries(obj.notes || {})) {
    const payload = {date, reflection: note.reflection || '', adjustment: note.adjustment || '', actualTotal: note.actualTotal ?? null};
    if (payload.reflection || payload.adjustment || payload.actualTotal != null) revisions.push({id: uuid(), key: 'note:' + date, parents: [], payload, source: 'v1备份导入', createdAt: new Date().toISOString()});
  }
  return mergeRevisions([], revisions);
}

export class LocalStore {
  constructor(owner, seed) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw Error('账号标识不受支持');
    this.owner = owner;
    this.seed = seed;
    this.revisions = [];
    this.tail = Promise.resolve();
    this.warning = '';
  }

  async load() {
    let revisions;
    if (localDesktop) {
      const saved = await api('/api/store?owner=' + encodeURIComponent(this.owner));
      revisions = saved.revisions;
      this.seed = saved.tasks;
      this.dataPath = saved.dataPath;
    }
    else revisions = JSON.parse(localStorage.getItem(prefix + this.owner) || '{"revisions":[]}').revisions;
    this.revisions = mergeRevisions([], revisions);
    return this;
  }

  view() { return materialize(this.seed, this.revisions); }
  parents(key) { return (headsFor(this.revisions).get(key) || []).map(r => r.id); }

  merge(incoming) {
    const work = async () => {
      if (localDesktop) {
        mergeRevisions(this.revisions, incoming);
        const response = await api('/api/revisions', {owner: this.owner, revisions: incoming});
        this.warning = response.warning || '';
        await this.load();
      } else {
        const save = async () => {
          const disk = JSON.parse(localStorage.getItem(prefix + this.owner) || '{"revisions":[]}').revisions;
          const next = mergeRevisions(mergeRevisions(disk, this.revisions), incoming);
          localStorage.setItem(prefix + this.owner, JSON.stringify({version: 2, revisions: next}));
          this.revisions = next;
        };
        if (navigator.locks) await navigator.locks.request(prefix + this.owner, save);
        else await save();
      }
      return this;
    };
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }

  async save(key, payload, parents = this.parents(key)) {
    const revision = this.revision(key, payload, parents);
    await this.merge([revision]);
    return revision;
  }

  revision(key, payload, parents = this.parents(key)) {
    return {id: uuid(), key, payload, parents, source: localDesktop ? '电脑本地程序' : '网页设备', createdAt: new Date().toISOString()};
  }

  export() { return {version: 2, owner: this.owner, exportedAt: new Date().toISOString(), tasks: this.seed, revisions: this.revisions}; }

  previewImport(obj) {
    const revisions = obj.version === 1 ? legacyRevisions(obj, this.seed) : obj.version === 2 && Array.isArray(obj.revisions) ? obj.revisions : null;
    if (!revisions) throw Error('不支持的备份格式');
    const next = mergeRevisions(this.revisions, revisions);
    return {revisions, added: next.length - this.revisions.length, conflicts: materialize(this.seed, next).conflicts.length};
  }
}
