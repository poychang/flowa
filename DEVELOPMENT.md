# Flowa 開發狀態

更新日期：2026-09-25。PWA 與離線保護已合併，本階段補齊跨瀏覽器核心回歸測試；完整 MVP 的跨裝置驗收與雲端部署仍未完成。

工作副本位於 `C:/Users/Nova/Documents/Codex/2026-09-22/flowa`，規格來源為桌面 `code/flowa` 的文件。GitHub 為 https://github.com/poychang/flowa ，多人協作（PR #1）及 PWA（PR #2）已合併至 main（7a47827）；包括字型初始化順序與 PWA 儲存測試的後續修正。

## 啟動與驗證

本次使用 Node.js 24.19.0、pnpm 11.19.0。測試使用 Node 的 TypeScript transform 功能。

```sh
pnpm install --frozen-lockfile
pnpm dev:all
pnpm typecheck
pnpm test
pnpm test:relay
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm test:cross-browser
pnpm build
pnpm test:pwa
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
- Manifest、靜態資源及字型離線快取；明確同意更新、更新前交易式副本、多分頁阻擋與持續保存請求。
- Firefox／WebKit 核心回歸各 8 項（使用既有案例標籤），納入 GitHub Actions；平台結果見跨瀏覽器驗證文件。
- GitHub Actions 驗證工作流程；30 分鐘量測另由手動命令執行。

## 驗證結果

已合併基準 `7a47827` 通過 [GitHub Actions Check](https://github.com/poychang/flowa/actions/runs/36106598633)，涵蓋以下 57 項測試與建置。跨瀏覽器擴充範圍與結果另見 [跨瀏覽器驗證](docs/testing/cross-browser.md)。

- 13 項單元測試通過：格式、遷移、儲存競爭／重試、交易回滾、恢復資料上限與房間隔離。
- 8 項真實 relay 測試通過：角色、錯誤憑證／來源、容量競爭、分片與物件限制、ACK 重送、來源離線、逾時與緩衝上限。
- 29 項 Chromium 測試通過：6 項原有單人、8 項同步 PoC、15 項正式畫布搭配真實 relay，包括唯讀、斷線編輯、重連備份失敗、服務重啟、500／2,000 物件、快照交錯、節點與綁定箭頭實際拖曳、窄螢幕與失效連結保護。
- 7 項正式版 PWA 測試通過：離線重開／修改／匯出／字型、多分頁、更新備份、快取安裝失敗、重試及持續保存被拒。
- TypeScript、前端建置與 relay 建置通過。前端仍有第三方 `use client` 與大於 500 kB chunk 的既有警告。
- 已檢視桌面及 390px 畫面。PNG/SVG 未做逐像素比對。
- 歷史版本的 2 人與 4 人各 30 分鐘量測（早於最新 relay 修正，非最新版長測）：結果與測試方法見 [驗證報告](docs/testing/local-collaboration.md)，原始數據見 [relay-soak.json](docs/testing/relay-soak.json)。

## 限制與下一階段

協作僅支援文字與向量圖形。場景限制為 2,000 個物件（含刪除標記）及 10 MiB；全服務最多 4 條協作連線。畫布同步是整個物件版本合併，沒有字元級文字 CRDT；同物件同時修改仍可能只保留勝出版本。

分享連結不是永久文件網址，relay 不保存完整場景或雲端備份。資料在目前瀏覽器；重啟 relay 或全員離線後可能須持有副本的人重新開房。請定期匯出 JSON。

已完成 PWA 與離線字型／快取，詳見 [PWA 操作文件](docs/pwa.md)。尚未完成 Safari/iPad/觸控筆、真實鎖屏與 WAN 測試、長時間瀏覽器繪製測試、Azure F1 配額量測或雲端部署。500／2,000 物件測試驗證分片與資料完整性，不是跨裝置幀率保證；本機 soak 的 CPU/RSS 也不能當成 F1 容量結論。

下一階段應進行 Safari/iPad 與跨裝置驗收，再以實際目標環境檢查 F1 配額與連線；不自動建立付費服務或擴容。

## 設計紀錄

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)
- [本機多人協作 ADR](docs/adr/0003-local-collaboration.md)

Git 作者設定為 `Nova <poychang.nova@gmail.com>`。本階段以 relay／協定、同步狀態機、介面整合、驗證文件分成可審查提交。
