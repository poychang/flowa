import { useEffect, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToBlob, exportToSvg, loadFromBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { repository } from './storage';
import { Autosave } from './autosave';
import { parseDocument } from './document';
import { serializeScene } from './scene';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const jsonBlob = (scene: string) => new Blob([scene], { type: 'application/json' });

export function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [status, setStatus] = useState('讀取本機草稿…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const blocked = useRef(false);
  const importing = useRef(false);
  const saver = useRef<Autosave>();
  if (!saver.current) saver.current = new Autosave(async scene => {
    if (blocked.current) throw new Error('已停止自動儲存，請匯出 JSON 保留目前內容。');
    const saved = await repository.write(scene, revision.current);
    revision.current = saved.revision;
  }, (state, failure) => {
    setStatus({ saving: '儲存中…', saved: '已存於此裝置', failed: '儲存失敗' }[state]);
    if (failure) setError(failure instanceof Error ? failure.message : '儲存失敗，請匯出 JSON 備份。');
  });

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const draft = await repository.read();
        const restored = draft ? await loadFromBlob(jsonBlob(JSON.stringify(parseDocument(draft.scene))), null, null) : { elements: [] };
        if (!mounted) return;
        revision.current = draft?.revision ?? 0;
        if (draft) saver.current!.seed(draft.scene);
        setInitial(restored); setStatus(draft ? '已存於此裝置' : '尚未儲存');
        setHasRecovery(Boolean(await repository.latestRecovery()));
      } catch {
        if (!mounted) return;
        blocked.current = true;
        setError('本機草稿讀取失敗。已暫停自動儲存以保留原資料，仍可繪圖及匯出。');
        setStatus('讀取失敗'); setInitial({ elements: [] });
      }
    })();
    const leave = (event: BeforeUnloadEvent) => {
      if (saver.current!.dirty || blocked.current || importing.current) { event.preventDefault(); event.returnValue = ''; }
    };
    const hide = () => { if (document.hidden) void saver.current!.flush().catch(() => undefined); };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', hide);
    return () => { mounted = false; saver.current!.dispose(); window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', hide); };
  }, []);

  async function exportFile(kind: 'json' | 'png' | 'svg') {
    if (!api) return;
    try {
      const options = { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() };
      const blob = kind === 'json' ? jsonBlob(serializeScene(api.getSceneElementsIncludingDeleted(), options.appState, options.files))
        : kind === 'png' ? await exportToBlob({ ...options, mimeType: 'image/png' })
        : new Blob([(await exportToSvg(options)).outerHTML], { type: 'image/svg+xml' });
      download(blob, `flowa-${new Date().toISOString().slice(0, 10)}.${kind}`);
    } catch { setError('匯出失敗，請確認畫布包含內容後重試。'); }
  }

  async function importFile(file?: File) {
    if (!file || !api || importing.current) return;
    importing.current = true; setBusy(true);
    try {
      if (blocked.current) throw new Error('原草稿讀取失敗，請先排除儲存問題後再匯入。');
      if (file.size > 10 * 1024 * 1024) throw new Error('檔案超過 10 MB 上限。');
      const raw = parseDocument(await file.text());
      const restored = await loadFromBlob(jsonBlob(JSON.stringify(raw)), null, null);
      await saver.current!.flush();
      const scene = serializeScene(restored.elements ?? [], restored.appState ?? {}, restored.files ?? {});
      // Backup and replacement succeed atomically before the editor is remounted.
      const saved = await repository.write(scene, revision.current, true);
      revision.current = saved.revision;
      saver.current!.seed(scene);
      setApi(undefined); setInitial(restored); setCanvasKey(key => key + 1);
      setStatus('已存於此裝置'); setError(''); setHasRecovery(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '匯入失敗，原畫布已保留。');
    } finally {
      importing.current = false; setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function downloadRecovery() {
    try {
      const scene = await repository.latestRecovery();
      if (scene) download(jsonBlob(scene), 'flowa-recovery.json');
    } catch { setError('無法讀取恢復副本。'); }
  }

  return <main>
    <header>
      <div className="brand"><span className="mark">f</span><div><strong>Flowa</strong><small>讓想法自然成形</small></div></div>
      <div className="state"><span className="dot"/><span role="status">{status}</span><span className="local">單人模式</span></div>
      <nav aria-label="檔案操作">
        {hasRecovery && <button onClick={() => void downloadRecovery()}>匯出匯入前副本</button>}
        <button disabled={busy || !api} onClick={() => input.current?.click()}>匯入 JSON</button>
        <button disabled={!api} onClick={() => void exportFile('svg')}>SVG</button>
        <button disabled={!api} onClick={() => void exportFile('png')}>PNG</button>
        <button disabled={!api} className="primary" onClick={() => void exportFile('json')}>備份 JSON ↗</button>
      </nav>
    </header>
    <div className="notice">本機草稿 · 資料僅儲存在目前瀏覽器，請定期匯出 JSON。匯入前會在此裝置保留恢復副本。</div>
    {error && <div className="error" role="alert"><span>{error}</span><div>
      {status === '儲存失敗' && <button onClick={() => { setError(''); void saver.current!.flush().catch(() => undefined); }}>重試儲存</button>}
      <button onClick={() => setError('')}>關閉</button>
    </div></div>}
    <input aria-label="匯入 JSON 檔案" hidden ref={input} type="file" accept=".json,.excalidraw,application/json" onChange={event => void importFile(event.target.files?.[0])}/>
    <section className="canvas" aria-label="Flowa 畫布">
      {initial ? <Excalidraw key={canvasKey} excalidrawAPI={setApi} initialData={initial} langCode="zh-TW" viewModeEnabled={busy} onChange={(elements, appState, files) => {
        if (!blocked.current && !importing.current) saver.current!.enqueue(serializeScene(elements, appState, files));
      }}><MainMenu><MainMenu.DefaultItems.ToggleTheme/><MainMenu.DefaultItems.ChangeCanvasBackground/><MainMenu.DefaultItems.Help/></MainMenu></Excalidraw> : <div className="loading">正在開啟你的畫布…</div>}
    </section>
  </main>;
}
