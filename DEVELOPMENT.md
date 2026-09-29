# Flowa 開發狀態

更新日期：2026-09-29。PWA、離線保護、跨瀏覽器／跨裝置模擬、HTTPS／WSS 實機工具及背景返回保護已合併。程式驗證基準為 main `adbfae4`，100 項 CI 測試通過；實際 iPad 驗收與雲端部署仍未完成。

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

歷史版本的 2 人與 4 人各 30 分鐘量測早於最新 relay 修正，不是 `adbfae4` 的長測結果。方法與結果保留於 [驗證報告](docs/testing/local-collaboration.md) 及 [原始數據](docs/testing/relay-soak.json)，待新版重新量測。

## 限制與下一階段

協作僅支援文字與向量圖形。場景限制為 2,000 個物件（含刪除標記）及 10 MiB；全服務最多 4 條協作連線。畫布同步是整個物件版本合併，沒有字元級文字 CRDT；同物件同時修改仍可能只保留勝出版本。

分享連結不是永久文件網址，relay 不保存完整場景或雲端備份。資料在目前瀏覽器；重啟 relay 或全員離線後可能須持有副本的人重新開房。請定期匯出 JSON。

已完成 PWA 與離線字型／快取，詳見 [PWA 操作文件](docs/pwa.md)。尚未完成 Safari/iPad/觸控筆、真實鎖屏與 WAN 測試、長時間瀏覽器繪製測試、Azure F1 配額量測或雲端部署。500／2,000 物件測試驗證分片與資料完整性，不是跨裝置幀率保證；本機 soak 的 CPU/RSS 也不能當成 F1 容量結論。

後續事項依建議執行順序整理如下，均尚未完成：

| 順序 | 待辦 | 完成條件與前置需求 |
| --- | --- | --- |
| 1 | 最新版協作長測 | 2 人／4 人各 30 分鐘，加入斷線重連，記錄提交、延遲、流量、CPU、記憶體與最終資料一致性 |
| 2 | 瀏覽器效能驗證 | 500／2,000 物件的繪圖、平移、縮放及長時間操作；將渲染表現與傳輸完整性分開報告 |
| 3 | iPad／Safari 實機驗收 | 先準備裝置、LAN 位址與受信任憑證，再依 [環境文件](docs/testing/device-environment.md) 及 [驗收清單](docs/testing/device-acceptance.md) 記錄安裝、離線、鎖屏、鍵盤、旋轉及觸控筆結果 |
| 4 | Beta 部署準備 | 在目標環境重新核對 Azure 免費方案、區域與配額，補部署／回滾流程、冷啟動驗證、安全檢查及第三方授權聲明 |

目前沒有建立雲端部署；不自動建立付費服務或擴容。完成上述驗證前，不將 MVP／Beta 標示為全面驗收完成。

## 設計紀錄

- [本機儲存 ADR](docs/adr/0001-local-storage.md)
- [同步 PoC ADR](docs/adr/0002-sync-poc.md)
- [本機多人協作 ADR](docs/adr/0003-local-collaboration.md)

Git 作者設定為 `Nova <poychang.nova@gmail.com>`。後續程式與文件更新使用獨立分支及可審查提交。
