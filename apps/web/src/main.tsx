import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, exportToBlob, exportToSvg, serializeAsJSON, loadFromBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { readBoard, saveBoard } from './storage';
import '@excalidraw/excalidraw/index.css';
import './style.css';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [status, setStatus] = useState('讀取本機草稿…');
  const [error, setError] = useState('');
  const last = useRef('');
  const pending = useRef('');
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const blocked = useRef(false);
  async function flush() {
    if (saving.current || !pending.current || blocked.current) return;
    saving.current = true;
    const data = pending.current;
    try {
      await saveBoard(data);
      if (pending.current === data) { pending.current = ''; setStatus('已存於此裝置'); }
    } catch { setStatus('儲存失敗'); setError('無法儲存至此瀏覽器，請立即匯出 JSON 保留副本。'); }
    finally { saving.current = false; }
    if (pending.current && pending.current !== data) void flush();
  }
  useEffect(() => {
    readBoard().then(async data => {
      if (data) {
        const restored = await loadFromBlob(new Blob([data]), null, null);
        setInitial(restored); setStatus('已存於此裝置');
      } else { setInitial({ elements: [] }); setStatus('尚未儲存'); }
    }).catch(() => { blocked.current = true; setError('本機草稿讀取失敗。已暫停自動儲存以保留原資料，仍可繪圖及匯出。'); setStatus('讀取失敗'); setInitial({ elements: [] }); });
    const leave = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ''; } };
    const hide = () => { if (document.hidden) void flush(); };
    window.addEventListener('beforeunload', leave); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', hide); clearTimeout(timer.current); };
  }, []);
  async function exportFile(kind: 'json' | 'png' | 'svg') {
    if (!api) return false;
    try {
      const options = { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() };
      const blob = kind === 'json' ? new Blob([serializeAsJSON(api.getSceneElementsIncludingDeleted(), options.appState, options.files, 'local')], { type: 'application/json' })
        : kind === 'png' ? await exportToBlob({ ...options, mimeType: 'image/png' })
        : new Blob([(await exportToSvg(options)).outerHTML], { type: 'image/svg+xml' });
      download(blob, `flowa-${new Date().toISOString().slice(0, 10)}.${kind}`); return true;
    } catch { setError('匯出失敗，請確認畫布包含內容後重試。'); return false; }
  }
  async function importFile(file?: File) {
    if (!file || !api) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('檔案超過 10 MB 上限。');
      const raw = JSON.parse(await file.text());
      if (raw.type !== 'excalidraw' || raw.version !== 2 || !Array.isArray(raw.elements) || raw.elements.length > 2000) throw new Error('請選擇有效的 Excalidraw JSON（版本 2，最多 2,000 個物件）。');
      const restored = await loadFromBlob(file, null, null);
      if (api.getSceneElementsIncludingDeleted().length && !await exportFile('json')) throw new Error('原畫布備份失敗，已取消匯入。');
      api.resetScene();
      if (restored.files) api.addFiles(Object.values(restored.files));
      api.updateScene(restored); api.scrollToContent(); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '匯入失敗'); }
    finally { if (input.current) input.current.value = ''; }
  }
  return <main>
    <header><div className="brand"><span className="mark">f</span><div><strong>Flowa</strong><small>讓想法自然成形</small></div></div>
      <div className="state"><span className="dot"/><span role="status">{status}</span><span className="local">單人模式</span></div>
      <nav aria-label="檔案操作"><button onClick={() => input.current?.click()}>匯入 JSON</button><button onClick={() => void exportFile('svg')}>SVG</button><button onClick={() => void exportFile('png')}>PNG</button><button className="primary" onClick={() => void exportFile('json')}>備份 JSON ↗</button></nav>
    </header>
    <div className="notice">本機草稿 · 資料僅儲存在目前瀏覽器，請定期匯出 JSON 備份。匯入前會下載目前畫布副本。</div>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>關閉</button></div>}
    <input hidden ref={input} type="file" accept=".json,.excalidraw,application/json" onChange={e => void importFile(e.target.files?.[0])}/>
    <section className="canvas" aria-label="Flowa 畫布">{initial ? <Excalidraw excalidrawAPI={setApi} initialData={initial} langCode="zh-TW" onChange={(elements, appState, files) => {
      const data = serializeAsJSON(elements, appState, files, 'local');
      if (data === last.current || blocked.current) return;
      last.current = data; pending.current = data; setStatus('儲存中…');
      clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 500);
    }}><MainMenu><MainMenu.DefaultItems.ToggleTheme/><MainMenu.DefaultItems.ChangeCanvasBackground/><MainMenu.DefaultItems.Help/></MainMenu></Excalidraw> : <div className="loading">正在開啟你的畫布…</div>}</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
