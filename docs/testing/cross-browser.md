# 跨瀏覽器核心回歸

基準：main `7a47827`（PWA PR #2 合併版），Playwright 固定為 1.55.1。

## 範圍與命令

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm test:cross-browser
```

Linux CI 安裝瀏覽器時加上 `--with-deps`。`test:e2e` 保留 Chromium 完整 29 項；`test:cross-browser` 執行 Firefox、WebKit 各 8 項，共 16 項。也可使用 `pnpm exec playwright test --project webkit` 或 `--project firefox` 單獨驗證。

使用既有案例的 `@cross-browser` 標籤選取測試，避免複製另一套斷言。所有專案使用單一 worker，避免測試 relay 的固定連接埠互相干擾。

| 核心案例 | 驗證內容 |
| --- | --- |
| 繪圖、自動儲存與匯出 | 滑鼠實際繪製、重新載入、JSON 還原及恢復副本、PNG/SVG 檔案格式 |
| 無效匯入 | 拒絕重複物件 ID，保留原草稿 |
| 多分頁衝突 | 舊分頁不可覆寫新版草稿 |
| 損壞資料 | 保留原始資料，不以空白場景取代 |
| 儲存失敗 | 顯示失敗，重試成功後才顯示已儲存 |
| JSON 備份 | 全新瀏覽器環境匯入及重新載入後仍保留刪除標記 |
| 多人與唯讀 | 真實 relay、兩位編輯者與唯讀訪客、雙向繪圖與關房後保留副本 |
| 斷線重連 | 離線修改與在線修改合併、兩端資料收斂、產生恢復副本 |

## 驗證結果與界線

Windows 本機 WebKit 8 項通過。Firefox 在進入測試前出現 Windows 並列設定錯誤（`browserType.launch: spawn UNKNOWN`），因此本機 Firefox 不列為通過；由 GitHub Actions Ubuntu 執行同一組 Firefox/WebKit 驗證。

本輪核心測試使用開發伺服器。正式產物的 7 項 Service Worker／PWA 測試仍由 Chromium 單獨執行（`pnpm build` 後 `pnpm test:pwa`），不宣稱 Firefox/WebKit 的 PWA 已驗收。

Playwright WebKit 不是實際 Safari/iPad；本輪不涵蓋原生安裝、觸控筆、手勢、裝置鎖屏或硬體壓感，也未新增混合瀏覽器同房間測試。既有 30 分鐘 relay 長測不是瀏覽器渲染長測。這些仍是後續獨立驗收項目。
