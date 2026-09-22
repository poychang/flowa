# 本機多人協作驗證

日期：2026-09-23。Windows、本機 loopback、Node.js 24.19.0、pnpm 11.19.0、Playwright Chromium。功能分支為 `feat/local-collaboration`。

功能及導航修正提交 `79271c2` 亦通過 GitHub Actions Ubuntu 的完整檢查：[Check #2](https://github.com/poychang/flowa/actions/runs/35793809409)。CI 包含型別、13 項單元、7 項 relay、27 項 Chromium 與前後端建置，不執行 30 分鐘量測。

## 自動化與操作檢查

| 檢查 | 結果／涵蓋內容 |
| --- | --- |
| `pnpm typecheck` | 通過，包含前端、relay、協定與測試 TypeScript |
| `pnpm test` | 13 項通過：格式限制、草稿遷移、競爭、重試、交易回滾、房間隔離及恢復資料數量／總位元組上限 |
| `pnpm test:relay` | 7 項通過：權限、房間憑證隔離、Origin、容量競爭、來源中斷、快照／物件限制、ACK 與緩衝／期限 |
| `pnpm test:e2e` | 27 項通過：6 項單人、8 項 PoC、13 項真實 relay 整合 |
| `pnpm build` | 通過；仍有第三方 `use client` 與大型 chunk 警告 |
| `pnpm build:relay` | 通過；輸出的 JavaScript 可啟動，`/healthz` 回應 protocol 2 |
| `pnpm dev:all` | 前端 5173、relay 3001 實際啟動並回應 HTTP 200；中止後服務結束 |
| 畫面檢查 | 已查看桌面及 390 × 844 截圖；分享／離開／匯出按鈕可見，窄螢幕無水平溢出 |
| `git diff --check` | 通過 |

真實 relay 瀏覽器測試涵蓋建立／加入／關閉、編輯與唯讀、離線修改後合併、快照與變更交錯、房間不覆蓋單人草稿、relay 重啟後以副本重開、備份失敗停止遠端套用、流程節點實際拖曳保持文字及箭頭綁定，以及失效連結不建立空白記錄。另驗證直接切換房間 fragment 前會完成儲存，儲存失敗時留在原畫布並可匯出。

500 與 2,000 個物件都透過分片快照加入新 Browser Context，檢查 IndexedDB 完整物件數與最終同步狀態；不是跨裝置幀率測試。原有 PoC 測試另外驗證並行物件競爭、刪除、重送、排序修復與 Undo/Redo。

## 30 分鐘量測方法

執行 `node --experimental-transform-types tests/relay/soak.ts`，2 人及 4 人兩個場景同時進行，各有獨立真實 Socket.IO relay，使用 500 個物件。每位參與者每秒修改一個物件一次、每秒傳送 4 次 Presence，接收者實際套用到測試場景後回覆 ACK。這輪測量持續連線；斷線與恢復另由 Chromium 整合測試驗證，尚未量測長時間混合重連負載。

延遲從來源送出增量計算至收到「所有當時已就緒參與者已套用」的 `sync-ack`，驗收 p95 < 500ms。結束時比較所有場景內容完全相同、沒有未確認增量或錯誤。原始輸出包含實際時間、ACK 數、來源 SHA-256 與環境，見 [relay-soak.json](relay-soak.json)。

出站 payload 計入更新、ACK、成員、游標與快照的 Engine.IO message data；不含 HTTP/WebSocket framing、握手部分或 TLS 開銷，不能視為帳單頻寬。CPU/RSS 是同一個 Node 行程內兩個 relay 加所有測試用戶端的合計，兩列取樣時間稍有不同，不能加總或當成單一 relay 成本。沒有瀏覽器繪製、WAN 或 Azure F1。

## 30 分鐘量測結果

| 參與者 | 實際時長 | 已確認增量 | p95 | 出站 payload | 錯誤 |
| --- | --- | --- | --- | --- | --- |
| 2 人 | 1,801 秒 | 3,573 | 28.17 ms | 5,868,875 bytes（5.60 MiB） | 0 |
| 4 人 | 1,801 秒 | 7,144 | 27.44 ms | 23,002,236 bytes（21.94 MiB） | 0 |

兩組最終內容完全一致、待確認集合為空，p95 均低於 500ms。共用行程 CPU 約 84.47 秒、最高 RSS 約 193.60 MiB；這些包含兩組測試用戶端與 relay，不能分攤或外推成 Azure 配額結論。測試期間工作站也執行前端回歸與建置，並非隔離的效能基準環境。

已逐一核對原始 JSON 中 relay、共享協定及量測腳本的 SHA-256，與提交工作副本相符。此數字來自完整 30 分鐘實測，未以短時間結果外推。

## 後續驗收

尚未驗證 PWA、Safari/iPad/觸控筆、裝置鎖屏、WAN 故障、長時間瀏覽器渲染，以及 Azure F1 配額／冷啟動。同步傳輸未端對端加密，這些測試不等同公開服務安全稽核。此階段沒有建立任何 Azure 或付費資源。
