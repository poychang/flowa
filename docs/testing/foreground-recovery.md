# 背景返回與資料保護

2026-09-29，本階段基於 main `2295e9b`（PR #5 已合併，CI 85 項通過）。

## 行為

- 隱藏至少 30 秒後返回前景，或收到 `pageshow.persisted`，會檢查目前協作狀態。短暫切換分頁不額外建立副本；相近的生命週期通知會合併。
- 先等待目前繪圖操作與正在套用的更新完成，將本機內容保存為恢復副本，再向 relay 發送 `resume-check`。此查詢驗證房間仍有效並回傳 ready／sequence，不會清除編輯者的快照提供資格。
- 若連線與序號正常，維持原連線，包含房間只剩一位編輯者的情況。若發現漏收序號、服務端尚未就緒或查詢逾時，才重連並走既有「備份、取得快照、合併」流程。重連會解除舊連線欠下的 ACK，避免快照來源一直等待。
- `online` 只對離線狀態提示重連；隱藏頁面延後處理。備份失敗顯示「同步失敗」並保留可匯出的本機內容，生命週期通知不會自行清除錯誤或重試；已失效房間也不會自動重開。
- 舊連線的非同步作業以 generation 檢查隔離，避免完成時改寫新連線的同步狀態；離開房間時移除監聽。

`resume-check` 是協定 v2 的附加唯讀查詢。更新環境時先更新 relay，再發布前端。舊 relay 不支援查詢時會逾時並重連，無法提供健康連線保留的效果。relay 仍不保存完整文件；實際斷線後若沒有在線編輯者提供副本，仍須從本機副本重新開房。

## 自動化覆蓋

`pnpm test` 驗證長短背景間隔、重複通知、隱藏頁面延後、online 與恢復通知優先順序及移除監聽。`pnpm test:relay` 驗證查詢序號、唯讀權限、房間到期與保留快照來源資格。

`pnpm test:e2e` 使用真實 relay 驗證：

1. 已恢復頁面保存正確 JSON 副本、保留健康連線，關房後通知不會重啟房間。
2. 單一編輯者恢復後可繼續繪圖與同步。
3. WebSocket 仍連線但更新被測試路由丟棄時，序號檢查觸發重連並補齊內容。
4. 恢復副本寫入失敗時停止同步，online 通知不繞過錯誤，JSON 仍可匯出。

前兩項另以 `@cross-browser` 在 Firefox／WebKit 執行。測試手動發出生命週期事件，並不代表實際 OS 暫停、BFCache 收納或 iPad 鎖屏已驗收。實機項目仍依 [跨裝置清單](device-acceptance.md) 執行。

生命週期語意參考 MDN 的 [pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event) 與 [visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)。
