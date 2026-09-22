# Flowa 開發狀態

更新日期：2026-09-23。本階段已將多人協作接到正式畫布，提供可在本機執行的 Node / Socket.IO relay；尚未完成完整 MVP、PWA 或雲端部署。

工作副本位於 `C:/Users/Nova/Documents/Codex/2026-09-22/flowa`，規格來源為桌面 `code/flowa` 的文件。GitHub 為 https://github.com/poychang/flowa ，本階段使用 `feat/local-collaboration` 分支與 PR，不直接合併 main。

## 啟動與驗證

本次使用 Node.js 24.19.0、pnpm 11.19.0。測試使用 Node 的 TypeScript transform 功能。

```sh
pnpm install --frozen-lockfile
pnpm dev:all
pnpm typecheck
pnpm test
pnpm test:relay
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm build:relay
```

`pnpm dev` 可只啟動單人前端。協作 URL、Origin、建置產物與重啟恢復操作見 [協作操作文件](docs/collaboration.md)。

## 已實作

- React / TypeScript / Excalidraw 繁體中文畫布，單人功能不依賴 relay。
- IndexedDB v2、舊草稿相容、序列化儲存、失敗重試與多分頁版本衝突保護。
- JSON 匯入驗證、交易式恢復副本、JSON / PNG / SVG 匯出，保留刪除標記。
- Socket.IO WebSocket 房間、管理／編輯／唯讀角色、分享權杖、參與者及節流游標。
- 協定 v2 的 schema、來源驗證、房間到期、全服務容量、速率與封包限制。
- 分片快照、sequence 追趕、增量合併、套用後確認、重送去重與重連前 checkpoint。
- 房間副本與單人草稿隔離；失效房間可從已有副本重開，不把載入失敗當成空白文件。
- GitHub Actions 驗證工作流程；30 分鐘量測另由手動命令執行。

## 驗證結果

- 13 項單元測試通過：格式、遷移、儲存競爭／重試、交易回滾、恢復資料上限與房間隔離。
- 7 項真實 relay 測試通過：角色、錯誤憑證／來源、容量競爭、分片與物件限制、ACK 重送、來源離線、逾時與緩衝上限。
- 27 項 Chromium 測試通過：6 項原有單人、8 項同步 PoC、13 項正式畫布搭配真實 relay，包括唯讀、斷線編輯、重連備份失敗、服務重啟、500／2,000 物件、快照交錯、節點與綁定箭頭實際拖曳、窄螢幕與失效連結保護。
- TypeScript、前端建置與 relay 建置通過。前端仍有第三方 `use client` 與大於 500 kB chunk 的既有警告。
- 已檢視桌面及 390px 畫面。PNG/SVG 未做逐像素比對。
- 2 人與 4 人各 30 分鐘量測：結果與測試方法見 [驗證報告](docs/testing/local-collaboration.md)，原始數據見 [relay-soak.json](docs/testing/relay-soak.json)。

## 限制與下一階段

協作僅支援文字與向量圖形。場景限制為 2,000 個物件（含刪除標記）及 10 MiB；全服務最多 4 條協作連線。畫布同步是整個物件版本合併，沒有字元級文字 CRDT；同物件同時修改仍可能只保留勝出版本。

分享連結不是永久文件網址，relay 不保存完整場景或雲端備份。資料在目前瀏覽器；重啟 relay 或全員離線後可能須持有副本的人重新開房。請定期匯出 JSON。

尚未完成 PWA、離線字型／快取、Safari/iPad/觸控筆、真實鎖屏與 WAN 測試、長時間瀏覽器繪製測試、Azure F1 配額量測或雲端部署。500／2,000 物件測試驗證分片與資料完整性，不是跨裝置幀率保證；本機 soak 的 CPU/RSS 也不能當成 F1 容量結論。

下一階段應先決定 PWA 與跨裝置驗收，再以實際目標環境檢查 F1 配額與連線；不自動建立付費服務或擴容。

## 設計紀錄

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)
- [本機多人協作 ADR](docs/adr/0003-local-collaboration.md)

Git 作者設定為 `Nova <poychang.nova@gmail.com>`。本階段以 relay／協定、同步狀態機、介面整合、驗證文件分成可審查提交。
