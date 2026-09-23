import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Excalidraw, MainMenu, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { BoardRepository } from './storage';
import { Autosave } from './autosave';
import { parseDocument } from './document';
import { serializeScene, deserializeScene } from './scene';
import { CollaborationSession, type RoomLink, type SyncState } from './sync/session';
import { parseSnapshot } from '../../../packages/protocol/index';
import type { RoomCredentials, Member, Role } from '../../../packages/protocol/index';

const relayUrl = import.meta.env.VITE_RELAY_URL as string | undefined;
const labels: Record<SyncState, string> = { connecting: '連線中', waiting: '等待初始內容', syncing: '同步中', synced: '協作同步完成', offline: '離線，本機編輯', expired: '房間失效', error: '同步失敗' };
const errors: Record<string, string> = {
  'room-expired': '房間已關閉或失效，已保留本機副本，可匯出或重新開房。',
  'no-snapshot-source': '沒有在線編輯者可提供內容。請讓持有副本的人重新開房分享。',
  'capacity-exceeded': '協作連線已達上限，仍可保留本機內容與匯出。',
  'unauthorized': '分享憑證無效或沒有操作權限。',
  'conflicting-revision': '偵測到無法自動解決的版本衝突，已停止同步，請先匯出副本。',
  'scene-too-large': '畫布超過協作大小限制，請先匯出備份並縮減內容。',
};
function readLink(): RoomLink | undefined {
  const params = new URLSearchParams(location.hash.slice(1));
  return params.has('room') ? { roomId: params.get('room') ?? '', token: params.get('key') ?? '' } : undefined;
}
function shareLink(roomId: string, token: string) { return `${location.origin}${location.pathname}#${new URLSearchParams({ room: roomId, key: token })}`; }
function readCredentials(link?: RoomLink) {
  if (!link) return;
  try {
    const cached = JSON.parse(sessionStorage.getItem(`flowa-room:${link.roomId}`) || 'null') as RoomCredentials | null;
    return cached?.manager === link.token ? cached : undefined;
  } catch { return undefined; }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const jsonBlob = (scene: string) => new Blob([scene], { type: 'application/json' });

function Board({ link, navigate, beforeNavigate }: { link?: RoomLink; navigate: (link?: RoomLink) => void; beforeNavigate: MutableRefObject<(() => Promise<boolean>) | undefined> }) {
  const [repository] = useState(() => new BoardRepository('flowa', link ? `room:${link.roomId}` : 'draft'));
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [status, setStatus] = useState('讀取本機草稿…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [hasRoomCopy, setHasRoomCopy] = useState(!link);
  const copyAvailable = useRef(!link);
  const [syncState, setSyncState] = useState<SyncState>('connecting');
  const [role, setRole] = useState<Role>('viewer');
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(() => localStorage.getItem('flowa-name') || '訪客');
  const [credentials, setCredentials] = useState<RoomCredentials | undefined>(() => readCredentials(link));
  const [shownLink, setShownLink] = useState('');
  const session = useRef<CollaborationSession>();
  const savedName = useRef(name);
  const selfId = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  const blocked = useRef(false);
  const importing = useRef(false);
  const saver = useRef<Autosave>();
  const canManageRoom = Boolean(link && role === 'manager');
  const canShareRoom = Boolean(canManageRoom && credentials);
  if (!saver.current) saver.current = new Autosave(async scene => {
    if (blocked.current) throw new Error('已停止自動儲存，請匯出 JSON 保留目前內容。');
    parseDocument(scene);
    const saved = await repository.write(scene, revision.current);
    revision.current = saved.revision;
  }, (state, failure) => {
    setStatus({ saving: '儲存中…', saved: '已存於此裝置', failed: '儲存失敗' }[state]);
    if (failure) setError(failure instanceof Error ? failure.message : '儲存失敗，請匯出 JSON 備份。');
  });

  useEffect(() => {
    let mounted = true;
    beforeNavigate.current = async () => {
      try {
        if (blocked.current || importing.current) throw new Error('storage-unavailable');
        await saver.current!.flush(); return true;
      } catch { setError('切換前儲存失敗，已留在原畫布，請先匯出目前內容。'); return false; }
    };
    void (async () => {
      try {
        const draft = await repository.read();
        const restored = draft ? await deserializeScene(draft.scene) : { elements: [] };
        if (!mounted) return;
        revision.current = draft?.revision ?? 0;
        if (draft) { copyAvailable.current = true; setHasRoomCopy(true); }
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
    return () => { mounted = false; beforeNavigate.current = undefined; saver.current!.dispose(); window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', hide); };
  }, []);

  useEffect(() => {
    if (!api || !link || blocked.current) return;
    if (!relayUrl) { setSyncState('error'); setError('尚未設定協作服務，無法加入房間；已保留本機副本。'); return; }
    let currentMembers: Member[] = [];
    const pointers = new Map<string, { x: number; y: number; at: number }>();
    const updatePointers = () => {
      const collaborators = new Map();
      for (const member of currentMembers) {
        const pointer = pointers.get(member.id);
        if (member.id !== selfId.current && member.ready && pointer && Date.now() - pointer.at < 5000) collaborators.set(member.id, { username: member.name, color: { background: member.color, stroke: member.color }, pointer: { x: pointer.x, y: pointer.y, tool: 'pointer' }, button: 'up', selectedElementIds: {} });
      }
      api.updateScene({ collaborators });
    };
    const live = new CollaborationSession(api, relayUrl, link, savedName.current.trim().slice(0, 40) || '訪客', {
      beforeSync: async () => {
        if (blocked.current) throw new Error('本機儲存不可用，請匯出副本後再連線。');
        if (!copyAvailable.current) return;
        saver.current!.enqueue(serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles()));
        await saver.current!.flush();
        const scene = serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
        const saved = await repository.write(scene, revision.current, true); revision.current = saved.revision; setHasRecovery(true);
      },
      status: (state, message) => { setSyncState(state); if (message) setError(errors[message] ?? `協作暫時不可用（${message}），本機內容已保留。`); else if (state === 'synced') setError(''); },
      joined: (nextRole, id) => { setRole(nextRole); selfId.current = id; }, editable: value => {
        setReady(value);
        if (value && !copyAvailable.current) {
          copyAvailable.current = true; setHasRoomCopy(true);
          saver.current!.enqueue(serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles()));
        }
      },
      members: value => { currentMembers = value; setMembers(value); updatePointers(); },
      presence: (id, pointer) => { pointers.set(id, { ...pointer, at: Date.now() }); updatePointers(); },
    });
    session.current = live;
    const pointerTimer = setInterval(updatePointers, 1000);
    return () => { clearInterval(pointerTimer); live.close(); session.current = undefined; };
  }, [api]);

  async function createRoom() {
    if (!api || !relayUrl || busy) return;
    setBusy(true);
    try {
      try { parseSnapshot(JSON.stringify(api.getSceneElementsIncludingDeleted())); } catch { throw new Error('協作支援文字與向量圖形，最多 2,000 個物件／10 MiB；請先移除圖片、嵌入內容或超大物件。'); }
      saver.current!.enqueue(serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles()));
      await saver.current!.flush();
      const scene = serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
      const saved = await repository.write(scene, revision.current, true); revision.current = saved.revision;
      const response = await fetch(`${relayUrl}/rooms`, { method: 'POST' });
      const value = await response.json(); if (!response.ok) throw new Error(errors[value.error] ?? '目前無法建立房間。');
      const room = value as RoomCredentials;
      const target = new BoardRepository('flowa', `room:${room.roomId}`);
      await target.write(scene, 0); await target.close();
      sessionStorage.setItem(`flowa-room:${room.roomId}`, JSON.stringify(room));
      localStorage.setItem('flowa-name', name.trim().slice(0, 40) || '訪客');
      navigate({ roomId: room.roomId, token: room.manager });
    } catch (failure) { setError(failure instanceof Error ? failure.message : '無法建立房間'); }
    finally { setBusy(false); }
  }
  async function copyShare(type: 'editor' | 'viewer') {
    if (!credentials) return;
    const url = shareLink(credentials.roomId, credentials[type]); setShownLink(url);
    try { await navigator.clipboard.writeText(url); } catch { /* Selectable link remains available. */ }
  }
  async function leaveRoom() {
    try { await saver.current!.flush(); session.current?.close(); navigate(); }
    catch { setError('離開前儲存失敗，請先匯出目前副本。'); }
  }
  async function closeRoom() {
    if (!link || !relayUrl || !canManageRoom) return;
    try {
      await saver.current!.flush();
      const response = await fetch(`${relayUrl}/rooms/${link.roomId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + link.token } });
      if (!response.ok) throw new Error('關閉房間失敗');
      if (credentials?.roomId === link.roomId) {
        sessionStorage.removeItem(`flowa-room:${link.roomId}`);
        setCredentials(undefined);
      }
    } catch { setError('關閉房間失敗，請確認連線後重試。'); }
  }

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
    if (!file || !api || importing.current || link) return;
    importing.current = true; setBusy(true);
    try {
      if (blocked.current) throw new Error('原草稿讀取失敗，請先排除儲存問題後再匯入。');
      if (file.size > 10 * 1024 * 1024) throw new Error('檔案超過 10 MB 上限。');
      const restored = await deserializeScene(await file.text());
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
      <div className="state"><span className="dot"/><span role="status">{status}</span><span className="local">{link ? '多人房間' : '單人模式'}</span></div>
      <nav aria-label="檔案操作">
        {hasRecovery && <button onClick={() => void downloadRecovery()}>{link ? '匯出同步前副本' : '匯出匯入前副本'}</button>}
        <button disabled={busy || !api || Boolean(link)} onClick={() => input.current?.click()}>匯入 JSON</button>
        <button disabled={!api || !hasRoomCopy} onClick={() => void exportFile('svg')}>SVG</button>
        <button disabled={!api || !hasRoomCopy} onClick={() => void exportFile('png')}>PNG</button>
        <button disabled={!api || !hasRoomCopy} className="primary" onClick={() => void exportFile('json')}>備份 JSON ↗</button>
      </nav>
    </header>
    <div className="collaboration" aria-label="協作控制">
      {!link ? <><label>顯示名稱 <input aria-label="顯示名稱" maxLength={40} value={name} onChange={event => setName(event.target.value)}/></label><button disabled={!relayUrl || busy || !api} onClick={() => void createRoom()}>建立協作房間</button>{!relayUrl && <small>尚未設定協作服務，仍可單人編輯。</small>}</> : <>
        <span data-testid="sync-status">{labels[syncState]}</span><span>{role === 'viewer' ? '唯讀' : role === 'manager' ? '管理者' : '編輯者'}</span>
        <span aria-label="參與者">{members.map(member => `${member.name}${member.ready ? '' : '（連線中）'}`).join('、')}</span>
        {canShareRoom && <><button onClick={() => void copyShare('editor')}>複製編輯連結</button><button onClick={() => void copyShare('viewer')}>複製唯讀連結</button></>}
        {canManageRoom && <button onClick={() => void closeRoom()}>關閉房間</button>}
        {['error', 'offline'].includes(syncState) && <button onClick={() => session.current?.retry()}>重新連線</button>}
        {['expired', 'error'].includes(syncState) && <button disabled={busy || !api || !hasRoomCopy} onClick={() => void createRoom()}>以副本重新開房</button>}
        <button onClick={() => void leaveRoom()}>離開房間</button>
      </>}
      {shownLink && <label>分享連結 <input aria-label="分享連結" readOnly value={shownLink} onFocus={event => event.target.select()}/></label>}
    </div>
    <div className="notice">{link ? '即時房間不是永久文件網址。資料只存於此瀏覽器；全員離線後可能無法復原房間，請定期匯出 JSON。' : '本機草稿 · 資料僅儲存在目前瀏覽器，請定期匯出 JSON。匯入前會在此裝置保留恢復副本。'}</div>
    {error && <div className="error" role="alert"><span>{error}</span><div>
      {status === '儲存失敗' && <button onClick={() => { setError(''); void saver.current!.flush().catch(() => undefined); }}>重試儲存</button>}
      <button onClick={() => setError('')}>關閉</button>
    </div></div>}
    <input aria-label="匯入 JSON 檔案" hidden ref={input} type="file" accept=".json,.excalidraw,application/json" onChange={event => void importFile(event.target.files?.[0])}/>
    <section className="canvas" aria-label="Flowa 畫布" onDropCapture={event => {
      if (link && event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); setError('協作期間不支援檔案匯入；請離開房間後操作。'); }
    }}>
      {initial ? <Excalidraw key={canvasKey} excalidrawAPI={setApi} initialData={initial} langCode="zh-TW" isCollaborating={Boolean(link)} UIOptions={{ canvasActions: { loadScene: !link }, tools: { image: !link } }} onPaste={(data, event) => {
        if (link && (event?.clipboardData?.files.length || Object.keys(data.files ?? {}).length || data.elements?.some(element => ['image', 'embeddable', 'iframe', 'magicframe'].includes(element.type)) || data.mixedContent?.some(item => item.type === 'imageUrl'))) { setError('協作期間僅支援文字與向量圖形。'); return false; }
        return true;
      }} onPointerUpdate={({ pointer }) => session.current?.pointer(pointer)} viewModeEnabled={busy || Boolean(link && (role === 'viewer' || (!ready && !['offline', 'expired', 'error'].includes(syncState))))} onChange={(elements, appState, files) => {
        if (!blocked.current && !importing.current && copyAvailable.current) saver.current!.enqueue(serializeScene(elements, appState, files));
        session.current?.changed();
      }}><MainMenu><MainMenu.DefaultItems.ToggleTheme/><MainMenu.DefaultItems.ChangeCanvasBackground/><MainMenu.DefaultItems.Help/></MainMenu></Excalidraw> : <div className="loading">正在開啟你的畫布…</div>}
      {link && !hasRoomCopy && <div className="room-placeholder" role="status">{['error', 'expired'].includes(syncState) ? '無法取得房間內容。請向持有副本的人取得新的分享連結。' : '等待在線編輯者提供初始內容…'}</div>}
    </section>
  </main>;
}

export function App() {
  const [link, setLink] = useState(readLink);
  const beforeNavigate = useRef<() => Promise<boolean>>();
  const navigation = useRef(0);
  useEffect(() => {
    const changed = async () => {
      // Keep the current canvas mounted until its pending save succeeds.
      const next = readLink(), request = ++navigation.current;
      const allowed = await beforeNavigate.current?.() ?? true;
      if (request !== navigation.current) return;
      if (allowed) setLink(next);
      else history.replaceState(null, '', link ? shareLink(link.roomId, link.token) : location.pathname);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [link]);
  function navigate(next?: RoomLink) {
    navigation.current++;
    history.replaceState(null, '', next ? shareLink(next.roomId, next.token) : location.pathname);
    setLink(next);
  }
  return <Board key={link ? `${link.roomId}:${link.token}` : 'draft'} link={link} navigate={navigate} beforeNavigate={beforeNavigate}/>;
}
