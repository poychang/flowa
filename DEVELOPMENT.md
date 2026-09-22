# 開發狀態

2026-09-22：建立單人畫布原型。規格來源為桌面 code/flowa 的 README.md 與 plan.md；本工作副本位於 Documents/Codex/2026-09-22/flowa。

## 執行

需要 Node.js 22.12 以上與 pnpm。

```sh
pnpm install
pnpm dev
pnpm build
pnpm preview
```

目前入口位於根目錄 index.html，前端原始碼在 apps/web/src。

## 已實作

- Excalidraw 繁體中文編輯器：繪圖、文字、圖形、顏色與連接線。
- IndexedDB 單一草稿、自動儲存、重新開啟還原、交易完成狀態及失敗提示。
- JSON / PNG / SVG 匯出，JSON 匯入的格式、版本、大小與物件數上限。
- 匯入前下載既有画布 JSON；本機讀取失敗時停止覆寫原記錄。
- 獨立單人模式，不需要後端。

## 尚未完成

本版本不是完整 MVP，也未通過 Phase 0 全部驗收。尚未實作多人協作、房間、安全憑證、PWA 安裝與離線資源快取、恢復副本管理、多分頁衝突處理及 Azure 部署。字型仍採套件預設來源，離線使用尚不保證。JSON 使用 Excalidraw v2 格式，Flowa 自有版本化格式與 migration 待後續加入。尚未驗證 iPad、觸控筆或跨瀏覽器行為。

下一階段先建立 element reconciliation 與 Undo 的 PoC、收斂測試，再接入 relay。不可將整張快照的最後寫入覆蓋作為協作協定。

## 本次驗證

- TypeScript 靜態檢查通過。
- Vite 正式建置成功（有第三方 use client 與超過 500 kB chunk 警告）。
- 本機開發伺服器 http://127.0.0.1:5173/ 回應 HTTP 200。
- 瀏覽器自動化初始化失敗（沙箱 ACL 錯誤），因此尚未完成視覺 QA、繪圖操作、本機儲存重開及匯入匯出實測。

## 第二階段：資料保存強化（2026-09-22）

- IndexedDB 升級為 v2，保留原始 v1 草稿，寫入記錄含 schemaVersion 與 revision。
- 寫入採交易內版本比對，多分頁衝突拒絕覆寫並提示匯出。
- 匯入前以同一筆交易保留舊稿，最多 3 份（每份最高 10 MB），可下載最近副本。
- 自動儲存序列化，失敗維持未儲存狀態並提供重試。
- 本機與 JSON 備份保留刪除標記，為重連合併準備。
- 單元測試 10 項、Chromium 瀏覽器測試 4 項通過；實測繪圖、重開草稿、JSON 還原、PNG/SVG 檔案輸出、恢復副本、錯誤匯入、多分頁與損毀草稿保護。已查看畫布截圖。
- 原先瀏覽器工具 ACL 限制已透過專案 Playwright 測試環境完成替代驗證；iPad／Safari 與離線 PWA 仍待驗收。

測試指令：`pnpm test`、`pnpm typecheck`、`pnpm test:e2e`。首次執行瀏覽器測試先 `pnpm exec playwright install chromium`。
