# PWA 與離線資料保護

更新日期：2026-09-25。適用於正式建置；開發伺服器不註冊 Service Worker。

## 使用與安裝

```sh
pnpm build
pnpm preview
```

連線開啟預覽網址，等待「離線可用」。首次會下載約 20 MiB 未壓縮的程式與字型資源，包括中文字型分片。首次造訪必須連線，未完成快取前不保證離線啟動。安裝不是使用離線功能的必要條件。

瀏覽器提供安裝提示時可按「安裝 Flowa」，否則從瀏覽器選單安裝；iPhone/iPad 的操作提示為 Safari 分享選單「加入主畫面」。原生安裝、Safari/iPad 及觸控筆尚未實機驗收。

快取完成後，可離線重開單人畫布、修改並儲存、匯出 JSON/PNG/SVG。既有房間副本可離線查看及匯出；已驗證編輯者在連線中斷後可繼續編輯，重新載入房間則須重新驗證角色，驗證前保持唯讀。全新房間連結仍需要 relay 與在線資料來源。

## 安全更新

新版在背景下載完成後只顯示「儲存副本並更新」，不自行重載畫布。使用者結束文字編輯或拖曳並按下更新後：

1. 暫停畫布輸入及協作接收，排空目前畫布的儲存佇列。
2. 檢查 IndexedDB 的版本是否仍與本分頁一致，交易式保存目前畫布的恢復副本。
3. 確認同來源只剩目前視窗，再啟用新版並重新載入。

儲存、備份或啟用失敗會停止更新並恢復操作；請先匯出 JSON。其他 Flowa 分頁或已安裝視窗仍開啟時，須先關閉它們再重試。檢查與啟用間仍可能新開視窗，因此新版也保留前一套靜態資源，且其他分頁不會被程式自動重載。

「匯出恢復副本」匯出最新的匯入、同步或更新前副本。更新只為目前畫布建立副本，既有上限為每畫布 3 份、全庫 12 份／30 MiB；達上限時依既有保留政策汰除舊副本。本次不變更 IndexedDB v2 或資料 schema，Service Worker 不開啟、遷移或刪除文件資料庫。

## 快取及儲存邊界

- Service Worker 只預先快取建置產物清單，不做動態回應快取。API、帶查詢字串或 Authorization 標頭的請求、房間憑證與畫布資料不會寫入 CacheStorage。
- 安裝資源失敗會刪除該次不完整快取，既有版本與 IndexedDB 保留，可連線後按「檢查更新」重試。
- 每次啟用只清理 Flowa 的舊靜態快取，保留目前及前一版。文件仍放在目前瀏覽器的 IndexedDB。
- 「保護本機儲存」向瀏覽器請求持續保存；拒絕時仍可編輯與匯出，介面不宣稱已獲保護。即使允許，使用者清除網站資料仍會刪除內容。

PWA 不是雲端備份。瀏覽器儲存空間不足、私人模式限制、未寫入完成就被作業系統終止或使用者清除資料，仍可能失去內容。請等待「已存於此裝置」並定期另存 JSON。

## 託管要求

目前 manifest、字型及 Worker 使用網站根路徑 `/`，不支援部署至子路徑。使用專用來源，正式環境須 HTTPS；本機 localhost/127.0.0.1 可供開發驗證。一次完整部署 `dist/`，避免混用不同建置版本。

主機應讓 `/sw.js`、`/index.html`、manifest 每次重新驗證（例如 `Cache-Control: no-cache`）；帶內容雜湊的 `/assets/` 可長期快取。`sw.js` 須回傳 JavaScript MIME，遺失的靜態檔案不得由 SPA fallback 偽裝成 HTML。更新檢查使用 `updateViaCache: none`。`scripts/serve-pwa-test.mjs` 僅供測試，含故障注入端點，不是正式伺服器，也不進入 `dist/`。

## 驗證

先執行 `pnpm build`，再執行 `pnpm test:pwa`。7 項 Chromium 測試使用真正的正式產物、Service Worker 與 IndexedDB，涵蓋離線重開／修改／JSON、PNG、SVG 匯出、本機 Excalifont 與 Xiaolai 字型、390px 版面、更新前備份、備份失敗、多分頁阻擋、安裝失敗保留舊版、首次失敗重試與持續保存被拒。測試不等於原生安裝或真實斷電驗證。

既有 13 項單元、8 項 relay、29 項畫布瀏覽器測試另行保留；歷史 30 分鐘協作量測見 [原報告](testing/local-collaboration.md)，不是此次 PWA 的長時間驗收。

設計依據：[Service Worker 生命週期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[Excalidraw 自託管字型](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)。字型原始聲明隨建置提供於 `/font-notices.txt`。
