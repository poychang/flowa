# Flowa 開發狀態

更新日期：2026-09-29。PWA、離線保護、跨瀏覽器／跨裝置模擬及 HTTPS／WSS 實機工具已合併。本階段補上背景返回時的協作狀態驗證與副本保護；實際 iPad 驗收與雲端部署仍未完成。

工作副本位於 `C:/Users/Nova/Documents/Codex/2026-09-22/flowa`，規格來源為桌面 `code/flowa` 的文件。GitHub 為 https://github.com/poychang/flowa ，多人協作（PR #1）、PWA（PR #2）、跨瀏覽器回歸（PR #3）、房間重載／跨裝置模擬（PR #4）與 HTTPS／WSS 工具（PR #5）已合併至 main（2295e9b）。

## 啟動與驗證

本次使用 Node.js 24.19.0、pnpm 11.19.0。測試使用 Node 的 TypeScript transform 功能。

```sh
pnpm install --frozen-lockfile
pnpm dev:all
pnpm typecheck
pnpm test
pnpm test:relay
pnpm test:device-server
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm test:cross-browser
pnpm test:devices
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
- Firefox／WebKit 核心回歸各 10 項（使用既有案例標籤），納入 GitHub Actions；平台結果見跨瀏覽器驗證文件。
- Chromium／WebKit 混合房間、重新載入、離線收斂與恢復副本；觸控平板繪圖、橫直向尺寸切換與 JSON 匯出。
- 元素空綁定 null／[] 比較相容，避免 Excalidraw 初始化誤報同版本衝突。
- `build:devices`／`serve:devices`：HTTPS 正式 PWA 與 WSS relay、精確 Origin、憑證／建置設定檢查、部分啟動失敗清理；預設只監聽本機。
- 背景超過 30 秒返回／頁面恢復時先保存副本，再驗證房間與序號；健康的單人連線不重建，漏收更新才重連。備份失敗與失效房間不被生命週期通知自動重試，詳見 [背景返回驗證](docs/testing/foreground-recovery.md)。
- GitHub Actions 驗證工作流程；30 分鐘量測另由手動命令執行。

## 驗證結果

已合併基準 `2295e9b` 通過 [main Check](https://github.com/poychang/flowa/actions/runs/36501588835) 全部 85 項及型別／前後端建置，包含 4 項 HTTPS／WSS 伺服器及 3 項正式啟動測試。本階段測試組合擴充至 99 項：20 單元、9 relay、4 HTTPS 伺服器、33 Chromium、10 Firefox、10 WebKit、3 混合裝置、7 PWA、3 正式啟動；完成結果以本分支 Check 為準。

以下是前階段已驗證的回歸基線（78 項版本），保留測試方法與限制：

- 15 項單元測試通過：格式、遷移、儲存競爭／重試、交易回滾、恢復資料上限、房間隔離與空綁定等價比較。
- 8 項真實 relay 測試通過：角色、錯誤憑證／來源、容量競爭、分片與物件限制、ACK 重送、來源離線、逾時與緩衝上限。
- 29 項 Chromium 測試通過：6 項原有單人、8 項同步 PoC、15 項正式畫布搭配真實 relay，包括唯讀、斷線編輯、重連備份失敗、服務重啟、500／2,000 物件、快照交錯、節點與綁定箭頭實際拖曳、窄螢幕與失效連結保護。
- WebKit 核心 8 項及混合瀏覽器／觸控 3 項通過。WebKit 繪圖另外連續 5 次、觸控流程連續 3 次通過。Windows Firefox 啟動受並列設定錯誤阻擋，交由 Ubuntu CI 驗證，不列為本機通過。
- 7 項正式版 PWA 測試通過：離線重開／修改／匯出／字型、多分頁、更新備份、快取安裝失敗、重試及持續保存被拒。
- TypeScript、前端建置與 relay 建置通過。前端仍有第三方 `use client` 與大於 500 kB chunk 的既有警告。
- 本機共 70 項通過；CI 另包含 Firefox 8 項，合計 78 項。各套件產物分為 `test-results/browser`、`pwa`、`devices`，避免互相清理追蹤檔。
- 已檢視桌面、390px 與模擬平板橫直向畫面。PNG/SVG 未做逐像素比對。
- 歷史版本的 2 人與 4 人各 30 分鐘量測（早於最新 relay 修正，非最新版長測）：結果與測試方法見 [驗證報告](docs/testing/local-collaboration.md)，原始數據見 [relay-soak.json](docs/testing/relay-soak.json)。

## 限制與下一階段

協作僅支援文字與向量圖形。場景限制為 2,000 個物件（含刪除標記）及 10 MiB；全服務最多 4 條協作連線。畫布同步是整個物件版本合併，沒有字元級文字 CRDT；同物件同時修改仍可能只保留勝出版本。

分享連結不是永久文件網址，relay 不保存完整場景或雲端備份。資料在目前瀏覽器；重啟 relay 或全員離線後可能須持有副本的人重新開房。請定期匯出 JSON。

已完成 PWA 與離線字型／快取，詳見 [PWA 操作文件](docs/pwa.md)。尚未完成 Safari/iPad/觸控筆、真實鎖屏與 WAN 測試、長時間瀏覽器繪製測試、Azure F1 配額量測或雲端部署。500／2,000 物件測試驗證分片與資料完整性，不是跨裝置幀率保證；本機 soak 的 CPU/RSS 也不能當成 F1 容量結論。

下一階段依 [HTTPS／WSS 啟動文件](docs/testing/device-environment.md) 設定 LAN 位址及受信任憑證，再按 [跨裝置驗收清單](docs/testing/device-acceptance.md) 進行 Safari/iPad 實測，再以實際目標環境檢查 F1 配額與連線；不自動建立付費服務或擴容。

## 設計紀錄

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)
- [本機多人協作 ADR](docs/adr/0003-local-collaboration.md)

Git 作者設定為 `Nova <poychang.nova@gmail.com>`。本階段以 relay／協定、同步狀態機、介面整合、驗證文件分成可審查提交。
