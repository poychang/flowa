# Flowa 開發狀態

更新日期：2026-10-01。main 已更新至 `1ebf113`（PR #10 已合併），包含效能基準與自動儲存序列化改善。本分支接續改善鍵盤／按鈕連續縮放：暫用物件 canvas 快取，停止後恢復清晰度；停止在新倍率時的重建成本仍存在。實際 iPad 驗收與雲端部署仍未完成。

工作副本位於 `C:/Users/Nova/Documents/Codex/2026-09-22/flowa`，規格來源為桌面 `code/flowa` 的文件。GitHub 為 https://github.com/poychang/flowa ，多人協作（PR #1）、PWA（PR #2）、跨瀏覽器回歸（PR #3）、房間重載／跨裝置模擬（PR #4）、HTTPS／WSS 工具（PR #5）及背景返回保護（PR #6）皆已合併。PR #6 包含 `ee77400` 修正：前景恢復失敗會斷開連線，避免其他協作者持續等待 ACK。

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
- `pnpm test:soak`：2 人／4 人各 30 分鐘、每組 5 次斷線重連與離線修改保留檢查；CI 使用 24 秒短測。
- `pnpm test:performance`：正式產物、500／2,000 物件各 5 分鐘，量測平移／縮放／移動物件、RAF 排程、long tasks 與 JS heap；同時驗證儲存／匯出／重載，CI 使用每組 6 秒短測。
- 自動儲存先偵測元素／持久化狀態／檔案變更，再於儲存批次序列化；連續編輯不重設首個 500 ms 計時截止，立即 flush 與失敗重試仍保留最新內容。`PERF_PROFILE=1` 可獨立輸出 CPU profile。
- Excalidraw 0.18.1 的版本鎖定 patch：鍵盤／按鈕縮放使用既有 300 ms 快取恢復機制，減少連續倍率變更的 canvas 重建。測試驗證文字／箭頭資料與停止後的逐像素一致性；正式量測包含停止後重繪。維護方式見 [patch 文件](patches/README.md)。

## 驗證結果

main `adbfae4` 的 [Check](https://github.com/poychang/flowa/actions/runs/36509605793) 已成功完成。以下數量取自該次 Ubuntu CI 紀錄，合計 100 項，不包含型別與建置步驟：

| 測試組合 | 通過數 | 覆蓋範圍 |
| --- | ---: | --- |
| 單元 | 20 | 格式、遷移、交易回滾、儲存競爭、房間隔離、元素比較與生命週期通知 |
| 真實 relay | 9 | 權限、容量、快照、ACK、逾時、緩衝限制與恢復狀態查詢 |
| HTTPS／WSS 伺服器 | 4 | 憑證、來源、靜態路徑與啟動錯誤 |
| Chromium | 34 | 單人畫布、同步 PoC、正式協作、背景恢復與失敗斷線保護 |
| Firefox | 10 | 跨瀏覽器核心回歸，包含健康連線與單人房間恢復 |
| WebKit | 10 | 同一組跨瀏覽器核心回歸 |
| 混合裝置 | 3 | Chromium／WebKit 同房間、斷線收斂與模擬平板觸控 |
| 正式 PWA | 7 | 離線重開、字型、更新與備份保護、快取失敗及保存權限 |
| 正式 HTTPS 啟動 | 3 | 建置設定、實際啟動與部分失敗後釋放連接埠 |

TypeScript、前端、relay 及 HTTPS 裝置建置均通過。前端仍有第三方 `use client` 與大於 500 kB chunk 的既有警告。各測試產物分為 `test-results/browser`、`pwa`、`devices`。

Windows 本機 Firefox 曾受並列設定錯誤阻擋；上述 Firefox 成功結果來自 Ubuntu CI。Playwright WebKit 與觸控模擬不代表實際 Safari／iPad／觸控筆已驗收。先前已檢視桌面、390px 與模擬平板畫面，但 PNG/SVG 未做逐像素比對。

目前 relay 的完整 30 分鐘斷線重連量測已於 `7188a68` 通過：2 人／4 人各 5 次重連，p95 分別為 12.28／13.52 ms，資料一致且錯誤與未確認增量皆為 0。[新版報告](docs/testing/reconnect-soak.md) 記錄方法、CPU／RSS、範圍限制及 [原始數據](docs/testing/relay-reconnect-soak.json)。較早的持續連線量測保留於 [歷史報告](docs/testing/local-collaboration.md) 與 [歷史數據](docs/testing/relay-soak.json)。

本分支 `1df93f5` 的 [CI](https://github.com/poychang/flowa/actions/runs/36520810962) 通過上述 100 項回歸，另通過 2 組重連短測及型別／建置。它也修正文件合併版 `5f7eef4` CI 發現的 PWA 測試競態：初次草稿尚未建立時繼續等待，保留資料數量與離線還原斷言；沒有改動產品程式或長測來源。

## 限制與下一階段

`6844ba0` 的 [CI](https://github.com/poychang/flowa/actions/runs/36786214684) 通過 114 項測試（新增鍵盤／按鈕縮放案例各於 Chromium、Firefox、WebKit 執行）、2 組重連短測及型別／全部建置。本機八組固定產物對照皆通過資料檢查；2,000 物件每輪約 2.24 → 1.58 秒，但停止後仍有 369～385 ms 的 long task。完整方法與原始數據見 [縮放快取報告](docs/testing/canvas-render-performance.md)。

`a9b6da8` 的 [CI](https://github.com/poychang/flowa/actions/runs/36664242120) 通過 102 項測試、2 組 relay 重連短測及型別／建置。本機 500／2,000 物件各完成 5 分鐘操作與資料檢查；RAF 間隔 p95 分別為 33.4／50 ms，主執行緒長任務最大值 1,017／1,491 ms。原始數據、場景與解讀見 [瀏覽器效能報告](docs/testing/browser-performance.md)。此為單次 headless Chromium 基準，不是效能驗收全面通過。

PR #10 已合併至 main `1ebf113`，PR #9 的效能工具與自動儲存改善已一起進入 main。PR #10 最後的 `43b3708` 修正 PR 基底說明及壓縮／未壓縮 CPU profile 雜湊標示，其 [CI](https://github.com/poychang/flowa/actions/runs/36722511577) 通過。本分支從最新 main 接續，PR #11 提供縮放快取改善。

`7f5b6f5` 本機通過 26 項單元測試、34 項 Chromium 回歸、型別與正式建置。2,000 物件獨立 CPU 取樣的場景序列化累計時間由 3,386 ms 降至 105 ms。初期順序量測部分數值變差，追加固定產物「前、後、後、前」短測後，每輪平均約 2,522 → 2,279 ms，但縮放尾端延遲及 long task 沒有一致改善；詳見 [自動儲存效能改善與全部原始數據](docs/testing/canvas-save-performance.md)。

該提交的 [CI](https://github.com/poychang/flowa/actions/runs/36689002128) 通過 108 項測試（既有 102 項加 6 項單元測試）、2 組 relay 重連短測，以及型別／全部建置。

協作僅支援文字與向量圖形。場景限制為 2,000 個物件（含刪除標記）及 10 MiB；全服務最多 4 條協作連線。畫布同步是整個物件版本合併，沒有字元級文字 CRDT；同物件同時修改仍可能只保留勝出版本。

分享連結不是永久文件網址，relay 不保存完整場景或雲端備份。資料在目前瀏覽器；重啟 relay 或全員離線後可能須持有副本的人重新開房。請定期匯出 JSON。

已完成 PWA 與離線字型／快取，詳見 [PWA 操作文件](docs/pwa.md)。尚未完成 Safari/iPad/觸控筆、真實鎖屏與 WAN 測試、實機／更長時間瀏覽器繪製測試、Azure F1 配額量測或雲端部署。500／2,000 物件測試驗證分片與資料完整性，不是跨裝置幀率保證；本機 soak 的 CPU/RSS 也不能當成 F1 容量結論。

後續事項依建議執行順序整理如下，均尚未完成：

| 順序 | 待辦 | 完成條件與前置需求 |
| --- | --- | --- |
| 1 | 效能驗收與停止後重建尖峰 | 已減少序列化及連續縮放的重建；停止在新倍率後仍有完整重繪成本。補更長的混合內容操作、實機量測與可接受延遲目標，再決定是否分攤重建工作 |
| 2 | iPad／Safari 實機驗收 | 先準備裝置、LAN 位址與受信任憑證，再依 [環境文件](docs/testing/device-environment.md) 及 [驗收清單](docs/testing/device-acceptance.md) 記錄安裝、離線、鎖屏、鍵盤、旋轉及觸控筆結果 |
| 3 | Beta 部署準備 | 在目標環境重新核對 Azure 免費方案、區域與配額，補部署／回滾流程、冷啟動驗證、安全檢查及第三方授權聲明 |

目前沒有建立雲端部署；不自動建立付費服務或擴容。完成上述驗證前，不將 MVP／Beta 標示為全面驗收完成。

## 設計紀錄

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)
- [本機多人協作 ADR](docs/adr/0003-local-collaboration.md)

Git 作者設定為 `Nova <poychang.nova@gmail.com>`。後續程式與文件更新使用獨立分支及可審查提交。
