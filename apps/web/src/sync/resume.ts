export type ResumeReason = 'visible' | 'restored' | 'online';
type VisibilityTarget = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** Lifecycle signals complement Socket.IO reconnects; short tab switches need no new snapshot. */
export function watchResume(resume: (reason: ResumeReason) => void, doc: VisibilityTarget = document, win: EventTarget = window, now = Date.now) {
  let hiddenAt: number | undefined = doc.visibilityState === 'hidden' ? now() : undefined;
  let pending: ResumeReason | undefined;
  let lastResume = -Infinity;
  let lastReason: ResumeReason | undefined;
  const notify = (reason: ResumeReason) => {
    if (doc.visibilityState !== 'visible') { if (pending !== 'restored') pending = reason; return; }
    if (now() - lastResume < 1000 && !(lastReason === 'online' && reason !== 'online')) return;
    lastResume = now(); lastReason = reason; resume(reason);
  };
  const visibility = () => {
    if (doc.visibilityState === 'hidden') { hiddenAt ??= now(); return; }
    const longPause = hiddenAt !== undefined && now() - hiddenAt >= 30000;
    hiddenAt = undefined;
    const reason = longPause ? 'visible' : pending;
    pending = undefined;
    if (reason) notify(reason);
  };
  const shown = (event: Event) => { if ((event as PageTransitionEvent).persisted) notify('restored'); };
  const online = () => notify('online');
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pageshow', shown);
  win.addEventListener('online', online);
  return () => {
    doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('pageshow', shown);
    win.removeEventListener('online', online);
  };
}
