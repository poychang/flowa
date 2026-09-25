import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let registration: Promise<ServiceWorkerRegistration> | undefined;
function register() {
  return registration ??= navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(error => { registration = undefined; throw error; });
}
export function workerRequest(worker: ServiceWorker, type: string): Promise<{ ready?: boolean; ok?: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('更新服務沒有回應，請稍後重試。')); }, 10000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
export function PwaControls({ prepareUpdate }: { prepareUpdate: () => Promise<() => void> }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const [prompt, setPrompt] = useState<InstallPrompt>();
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const supported = import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext;

  useEffect(() => {
    let disposed = false;
    const connectivity = () => setOnline(navigator.onLine);
    const install = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installed = () => { setPrompt(undefined); setMessage('已安裝 Flowa。'); };
    let reg: ServiceWorkerRegistration | undefined;
    const inspect = async () => {
      if (disposed || !reg) return;
      setWaiting(reg.waiting ?? undefined);
      if (reg.active?.state === 'activated') {
        try { const result = await workerRequest(reg.active, 'STATUS'); if (!disposed) setReady(Boolean(result.ready)); }
        catch { if (!disposed) setReady(false); }
      }
    };
    const found = () => {
      const worker = reg?.installing;
      worker?.addEventListener('statechange', () => {
        void inspect();
        if (!disposed && worker.state === 'redundant') {
          if (!reg?.active) registration = undefined;
          setMessage('離線資源準備失敗，原有草稿與版本已保留，請連線後重試。');
        }
      });
      void inspect();
    };
    const check = () => { if (navigator.onLine) void reg?.update().catch(() => undefined); void inspect(); };
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('appinstalled', installed);
    window.addEventListener('focus', check);
    if (supported) {
      void register().then(value => { if (disposed) return; reg = value; reg.addEventListener('updatefound', found); found(); }).catch(() => { if (!disposed) setMessage('無法準備離線資源，請確認網路與瀏覽器儲存空間。'); });
      navigator.serviceWorker.addEventListener('controllerchange', inspect);
    }
    void navigator.storage?.persisted?.().then(value => { if (!disposed) setPersisted(value); }).catch(() => undefined);
    return () => {
      disposed = true; reg?.removeEventListener('updatefound', found);
      window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('appinstalled', installed);
      window.removeEventListener('focus', check);
      navigator.serviceWorker?.removeEventListener('controllerchange', inspect);
    };
  }, [supported, attempt]);

  async function update() {
    if (!waiting || working) return;
    setWorking(true); setMessage('正在保存更新前副本…');
    let resume: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activated = () => {};
    try {
      resume = await prepareUpdate();
      const changed = new Promise<void>((resolve, reject) => {
        activated = () => { if (navigator.serviceWorker.controller === waiting) resolve(); };
        navigator.serviceWorker.addEventListener('controllerchange', activated);
        timer = setTimeout(() => reject(new Error('新版啟用逾時，副本已保存，請稍後重試。')), 30000);
      });
      const result = await workerRequest(waiting, 'ACTIVATE');
      if (!result.ok) throw new Error(result.error === 'other-tabs' ? '請先關閉其他 Flowa 分頁或視窗，再更新。' : '目前無法更新。');
      activated(); await changed; location.reload();
    } catch (error) {
      resume?.(); setWorking(false);
      setMessage(error instanceof Error ? error.message : '更新前儲存失敗，已保留目前畫布。');
    } finally {
      clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', activated);
    }
  }
  return <aside className="pwa-controls" aria-label="離線與安裝">
    <span data-testid="offline-status">{online ? (ready ? '離線可用' : supported ? '正在準備離線資源…' : '離線快取僅在正式版提供') : '目前離線 · 內容儲存在此裝置'}</span>
    {prompt && <button disabled={working} onClick={() => { void prompt.prompt().then(() => prompt.userChoice).then(() => setPrompt(undefined)).catch(() => setMessage('可從瀏覽器選單安裝 Flowa。')); }}>安裝 Flowa</button>}
    {supported && !prompt && <details><summary>安裝方式</summary><span>使用瀏覽器的「安裝應用程式」；iPhone／iPad 使用 Safari 分享選單的「加入主畫面」。</span></details>}
    {supported && <button disabled={working || !online} onClick={() => { setAttempt(value => value + 1); void register().then(reg => reg.update()).then(() => setMessage('已檢查更新，若有新版將顯示更新按鈕。')).catch(() => setMessage('更新檢查失敗，請稍後重試。')); }}>檢查更新</button>}
    {waiting && <button disabled={working} onClick={() => void update()}>儲存副本並更新</button>}
    {navigator.storage?.persist && <button disabled={working || persisted} onClick={() => {
      void navigator.storage.persist().then(value => { setPersisted(value); setMessage(value ? '瀏覽器已允許持續保存；清除網站資料仍會刪除內容，請定期匯出 JSON。' : '瀏覽器未允許持續保存；仍可儲存，但請定期匯出 JSON。'); }).catch(() => setMessage('無法取得持續保存權限，請定期匯出 JSON。'));
    }}>{persisted ? '已允許持續保存' : '保護本機儲存'}</button>}
    {message && <span data-testid="pwa-message">{message}</span>}
  </aside>;
}
