# Flowa 開發狀態

更新日期：2026-09-22。目前完成單人原型的資料保存強化與雙端元素同步 PoC；尚未完成 Phase 0 全部驗收，也不是完整多人 MVP。

工作副本位於 `C:/Users/Nova/Documents/Codex/2026-09-22/flowa`，規格來源為桌面 `code/flowa` 的文件。

## 啟動與驗證

本次使用 Node.js 24.19.0、pnpm 11.19.0。測試使用 Node 的 TypeScript transform 功能。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm preview
```

## 已實作

- React / TypeScript / Excalidraw 繁體中文單人畫布，不依賴後端。
- IndexedDB v2、舊字串草稿遷移、交易完成狀態、序列化自動儲存與失敗重試。
- 版本比對防止多分頁靜默覆寫；衝突保留記憶體內容供匯出。
- JSON 驗證與匯入，匯入前交易式恢復副本（最多 3 份）；可下載最近一份。
- JSON / PNG / SVG 匯出。本機資料與 JSON 備份保留刪除標記，重新載入時也保留。
- 純元素同步 adapter：版本合併、增量、ACK、去重、排序修復、互動期間暫存與有界緩衝。僅接於開發測試 harness，未接到正式畫布。

## 本次驗證

- 11 項單元測試通過：自動儲存競爭與重試、格式限制、舊稿遷移、多分頁交易、恢復副本上限、交易回滾、未知格式保護。
- 6 項單人 Chromium 操作測試通過：實際繪圖與重開、JSON 還原、PNG/SVG 檔案輸出、恢復副本、錯誤匯入、多分頁、損毀草稿、配額錯誤重試，以及刪除標記完整往返。
- 8 項同步 Chromium 測試通過：兩個獨立 Browser Context 的並行修改／刪除、舊版重送、增量、Undo/Redo、共用物件保留遠端顏色、綁定資料、排序衝突、ACK、暫存上限與無效封包拒絕。
- TypeScript 檢查涵蓋應用與測試碼。正式建置有第三方 use client 及大於 500 kB chunk 的既有警告。
- 已查看實際畫布截圖；尚未對 PNG/SVG 進行逐像素比對。

## 下一階段與限制

同步測試由測試程式在瀏覽器之間傳遞封包，沒有 Socket.IO、真正房間、角色憑證、遠端游標或跨網路效能量測。

後續優先實作初始快照／增量交錯與重連狀態機、重連前本機備份，再接入 Socket.IO relay 與房間權限。測試 harness 不會包含於正式 Vite 產物。

尚未完成 PWA、離線字型與快取、Safari/iPad/觸控筆、500/2,000 物件效能、2/4 人各 30 分鐘測試、F1 配額驗證或 Azure 部署。同步 PoC 不支援圖片及嵌入內容；JSON 仍使用 Excalidraw v2，Flowa 的記錄 schemaVersion 與其分開。

設計決策與已知限制：

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)

## Git 里程碑

- `41880b3`：單人畫布原型。
- `4aef3ae`：資料保存保護與第一批操作測試。
- 本階段後續提交：同步 PoC、刪除標記還原修正及本階段驗證文件。

本地 main 分支持續提交，尚未設定遠端或推送。
