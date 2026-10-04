# 前端發布包與回滾驗證

前端與 relay 分開發布。`pnpm package:web <名稱>` 在乾淨的 Linux checkout 建立完整靜態網站，不連線 Azure、不建立資源，也不發布網站。Windows 使用 Linux CI 產物。

## 固定部署設定

```sh
export RELEASE_WEB_ORIGIN=https://your-frontend.example
export RELEASE_RELAY_ORIGIN=https://your-relay.example
pnpm package:web candidate-web
pnpm verify:web release-artifacts/candidate-web
```

兩個值必須是完整 HTTPS origin，不含帳密、路徑、query 或 fragment。網站只能放在 `/`。relay 網址編譯進前端，改變網址必須重新建置；`webOrigin` 記錄預期部署位置，並非存取限制。relay 的 `ALLOWED_ORIGINS` 要包含這個前端 origin。

封裝忽略本機 `.env*`、Vite 設定檔及環境中的 `VITE_*`，只使用明確的 `RELEASE_RELAY_ORIGIN`。它在新的 `release-artifacts/<名稱>/site/` 直接建置並產生 PWA，不複製既有 `dist`。不覆寫既有發布目錄／archive；失敗時保留目錄供診斷，重試用新名稱。

## 產物與完整性

輸出包括 `release-artifacts/<名稱>.tar.gz` 與 `.tar.gz.sha256`。解包內容：

- `site/`：整套 HTML、JS、CSS、字型、圖示、PWA 與第三方授權。只有這個目錄要發布到網站根目錄。
- `release-manifest.json`：Git SHA、鎖檔 SHA-256、建置平台／Node 版本、兩個 origin、PWA 版本與所有檔案的雜湊、權限及大小。
- `LICENSE`、`README.txt`：專案授權與發布注意事項；與 manifest 一起保存在站外。

先核對可信 CI 的 checksum，再解包到全新目錄，避免舊檔殘留：

```sh
sha256sum -c candidate-web.tar.gz.sha256
mkdir candidate-web-unpacked
tar --same-permissions -xzf candidate-web.tar.gz -C candidate-web-unpacked
# 在可信 Flowa checkout 執行；verify 工具不在公開 site/ 內。
pnpm verify:web /absolute/path/candidate-web-unpacked
```

驗證拒絕增刪檔案、內容或權限變更。Checksum 是完整性紀錄，不是發布者簽章；必須從可信 workflow 取得。不要把根目錄 manifest 發布到網站，也不要重建或選擇性複製 JS 取代已驗證的完整 site。

## CI 及實際目標建置

一般 push／PR 的 Check 使用 `https://flowa.example` 與 `https://relay.example`，產生 **演練用途** `web-linux-<SHA>` artifact，保留 14 天，不能直接部署成可用協作服務。所有測試成功後才上傳前端與 relay 產物。

此 workflow 合併 main 後，可從 GitHub Actions 手動執行 Check（workflow_dispatch），選 main 並填真實 `web_origin`／`relay_origin`。它會執行完整測試、依目標網址建置並上傳產物；仍不自動上傳到 Azure。記錄所選 main SHA 與 manifest，核對同次成功 workflow 的前端及 relay 包。執行前要另外確認目標免費方案、區域、Node runtime 與權限，見 [部署文件](deployment.md)。

`pnpm test:web-release` 在 Linux 驗證 CI archive checksum、解包後完整性、目標 relay 設定、PWA allowlist 與授權檔，並確認故意設定的環境 VITE_RELAY_URL 不會混入產物。Windows 只執行設定測試，不能據此宣稱 archive 已驗證。

## 版本切換與回滾

1. 保留目前與候選版本的完整前端、relay archive、checksum、manifest 與 relay 設定；先確認本機資料格式及協定相容。回滾沒有自動轉換資料格式的能力。
2. 驗證候選產物、發布 relay 並確認 health，再以目標平台的完整網站部署機制發布候選 `site/`。禁止逐檔混合版本、刪除使用者 IndexedDB 或強制跳過 PWA 更新同意。
3. 現有瀏覽器點「檢查更新」，確認提示後「儲存副本並更新」。檢查更新前內容、恢復副本、JSON 備份與離線重開。
4. 回滾時以同樣的完整網站部署機制恢復舊 `site/` 與對應 relay／設定，再次確認 health、分享與兩人編輯。舊版 Service Worker 仍走更新同意與保存副本流程，不能強制 reload。
5. relay 的記憶體房間不會隨 archive 復原；持有副本的人須重新開房。保留新舊產物及操作記錄，直到實機與 WAN 檢查完成。

新增 PWA 回歸以相同資料格式、不同 worker 版本模擬 A → B → A：確認回復 A 前需同意，B 新增的草稿仍可保存、回復後離線重開仍存在。這只驗證瀏覽器更新／回滾保護，**不代表不同版本資料格式相容，也不是 Azure 部署、冷啟動或完整雲端回滾演練**。
