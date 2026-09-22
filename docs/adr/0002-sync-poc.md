# ADR 0002：Excalidraw 0.18.1 公開合併 API 的同步 PoC

狀態：PoC 通過目前測試，尚未核准正式多人功能；2026-09-22。

## 決策與衝突規則

固定 Excalidraw 0.18.1。使用套件公開匯出的 `reconcileElements`；不複製私有演算法，不引入另一套 CRDT 權威狀態。

- 以 element id 合併，version 較大者勝。
- version 相同時，versionNonce 較小者勝。刪除也是帶版本的物件，不能丟掉 tombstone。
- 相同 version 與 nonce 但內容不同時，adapter 拒絕封包並回報 `conflicting-revision`；不讓兩端各自採用對方內容造成分歧。正式客戶端須停止同步、備份並重新協調。
- 同一物件競爭採整個物件勝出，並非文字字元合併；可能無法保留兩人的同時輸入。
- 物件順序使用 Excalidraw fractional index。並行新增相同 index 時，官方函式會修復 index、提高 version 並產生新 nonce。修復必須再傳一輪增量，直到兩端收斂。測試檢查最後無新封包。

官方函式會修改傳入物件；adapter 對本機與遠端輸入都複製一份。遠端原封包維持不變，才能辨識排序修復是尚未送出的新版本。

遠端場景透過 `updateScene({ captureUpdate: CaptureUpdateAction.NEVER })` 套用。本機操作仍進入正常 Undo/Redo 歷史。正在拖曳、縮放物件、繪製或編輯文字時先暫存遠端封包，結束操作後呼叫 `flushDeferred()`。

## 封包與限制

`{ protocol: 1, session, sender, id, elements }`；此 session 是 PoC 隔離標記，**不是安全憑證**。

- 只送改變的物件；Presence 與暫時 appState 不混入文件。
- 待確認封包最多 16 筆，確認 id 才推進已送達版本；相同未確認內容可重送同一 id。
- 最近 256 個已套用訊息 id 去重。超出窗口的舊訊息仍由物件版本規則處理。
- 每包最多 256 KiB，場景最多 2,000 個物件；操作期間暫存最多 4 包，溢位回報需重同步。
- 本次只驗證文字與向量圖形；圖片、嵌入內容與二進位檔案尚未納入協作。
- JSON 傳輸把 `-0` 正規化為 `0`、移除 undefined。測試比對正規化文件內容。

## 可重現測試

`pnpm test:e2e tests/browser/sync.spec.ts`。測試使用兩個獨立 Chromium Browser Context，由測試程式傳遞封包；不是 Socket.IO 或跨網路效能驗收。`tests/browser/harness.html` 只作開發測試入口，不包含在正式 Vite 產物。

涵蓋並行顏色／刪除、舊版本重送、未送出的本機修改、重複封包、綁定文字與連接線資料、共用物件 Undo 保留後續遠端顏色、Undo/Redo 保留其他物件、排序衝突及重排、拖曳暫存、遺失 ACK、緩衝上限、錯 session／協定／過大封包與相同版本碰撞。

## 下一個 gate

正式接入前仍需：Socket.IO 房間與角色驗證、初始快照與增量交錯的狀態機、重連前 IndexedDB 副本與 ACK 復原、節流與重送排程、檔案處理、完整 schema、安全測試、節點實際拖曳後綁定、文字同時輸入、背景鎖屏恢復、Safari/iPad、500/2,000 物件效能、2/4 人各 30 分鐘，以及 Azure F1 配額驗證。此階段未部署或建立雲端資源。

依據：[Excalidraw 公開 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)、已安裝 0.18.1 的公開型別與編譯後 reconciliation 實作。
