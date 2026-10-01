# Beta relay 啟動、部署與回滾準備

更新日期：2026-10-01。這份流程準備 Linux／Node.js 24 的單一 relay 行程；尚未建立 Azure 資源或驗證目標區域、配額與實際冷啟動。Windows IISNode 的 named pipe PORT 不在目前支援範圍。

## 建置與啟動

從同一個已通過 CI 的提交取得原始碼，使用 Node.js 24 與 pnpm 11.19.0：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:relay
pnpm build:relay
pnpm test:relay-launcher
```

正式執行 `node scripts/start-relay.mjs`（或 `pnpm start:relay`），只載入 `dist-relay/` 的 JavaScript，不在啟動時編譯或執行 TypeScript。命令強制 production 模式，設定不符即以非零狀態退出。開發仍使用 `pnpm dev:relay` 與原有本機預設。

| 環境變數 | 正式模式要求 |
| --- | --- |
| `PORT` | 必填，1～65535 的整數；使用平台提供值，不能硬編碼取代 |
| `HOST` | 預設 `0.0.0.0`，可指定 IPv4／IPv6 監聽位址；本機檢查用 `127.0.0.1` |
| `ALLOWED_ORIGINS` | 必填，逗號分隔的完整 HTTPS 前端 origin；會去除空白、正規化及去重；拒絕 HTTP、萬用字元、帳密、路徑、query、fragment 或空項目 |

PowerShell 本機啟動範例（origin 是測試用識別，不會連往該網域）：

```powershell
$env:PORT = '3001'
$env:HOST = '127.0.0.1'
$env:ALLOWED_ORIGINS = 'https://flowa.example'
pnpm start:relay
```

公開端點由平台終止 HTTPS／WSS，relay 在平台內部監聽 HTTP。不要直接將本機 HTTP listener 當作公開正式端點。Origin 驗證只是瀏覽器來源限制，不能取代房間憑證或公開服務安全稽核。

## 健康檢查及重啟

另開終端執行：

```powershell
$env:RELAY_HEALTH_ORIGIN = 'http://127.0.0.1:3001'
pnpm check:relay
```

目標環境改填 `https://<relay-host>`。工具請求 `/healthz`，15 秒逾時，拒絕 redirect、非 JSON、非 200、`ok` 不為 true 及與本次編譯協定不同的回應。HTTP 僅允許 loopback；正常只輸出健康狀態、協定及請求耗時，不記錄憑證或文件。這是單次可達性／協定檢查，不是容量或端到端同步驗收；一次逾時也不能區分冷啟動與平台停用。

`pnpm test:relay-launcher` 啟動真正的編譯產物，檢查 HTTP health、錯誤 Origin、WebSocket 握手、重啟後舊房間失效與重新開房，以及啟動設定錯誤／連接埠占用。Linux CI 另確認 SIGTERM 能正常退出；Windows 的 process termination 不代表 POSIX graceful shutdown 已驗證。正常關閉最多等待 5 秒，逾時以非零狀態退出。

房間及權杖驗證資訊僅在記憶體。部署、回滾、平台休眠／重啟後舊連結可能失效；使用者應保留本機副本，必要時由持有副本的人重新開房及分享新連結。不得向使用者承諾伺服器可恢復原房間。

## Azure 目標環境核對

本輪核對官方文件的結果如下，仍需在實際訂閱及區域重新確認：

- Linux App Service 內建 Node runtime 透過 `PORT` 轉送請求；可指定啟動命令。本專案候選啟動命令為 `node scripts/start-relay.mjs`，單行程，不使用 PM2 cluster 或多執行個體，避免記憶體房間被分散。[Node.js 設定](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
- Linux Free 支援 WebSocket，官方目前列最多 5 條同時連線；Flowa 仍維持全服務 4 條協作連線上限。可將 warmup path 設為 `/healthz`、成功狀態設為 `200`，避免將錯誤頁誤認為準備完成。[Linux FAQ](https://learn.microsoft.com/en-us/troubleshoot/azure/app-service/faqs-app-service-linux-new)
- Free／Shared 可啟用 Health check，但沒有自動替換不健康執行個體的完整能力；不能以此推論具有高可用性，也不因此升級方案。[Health check 限制](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check)
- CPU／記憶體／流量配額可能使服務受限或停止；部署時記錄實際 Portal 配額與重設時間，不能使用本機量測取代。[配額與監看](https://learn.microsoft.com/en-us/azure/app-service/web-sites-monitor)

只核對 Static Web Apps Free 與 App Service F1。目標 SKU／區域／Node runtime 不可用時，停止該部署步驟並記錄原因；不自動建立付費方案、資料庫、監控儲存或 deployment slot。

## 部署與回滾順序

1. 記錄目標來源、提交 SHA、Node／pnpm 版本、協定版本及上一版可回復的來源／產物。正式前端以該 relay 的 HTTPS origin 設定 `VITE_RELAY_URL` 後完整建置；PWA 仍只支援網站根路徑。
2. 從已合併 main 的成功 CI 取得 [Linux relay 發布包](relay-release.md)，核對 archive checksum 及 manifest 後解包。包內已有編譯程式、正式依賴與授權原文；目標主機提供 Node.js 24 即可，不重新安裝或編譯，也不使用 Windows node_modules 取代 Linux 產物。
3. 設定精確的 `ALLOWED_ORIGINS`、平台 PORT、HTTPS 與單執行個體。選定的部署機制不得以未受控的 npm 安裝或重新建置取代已驗證的鎖檔／patch。CI 已提供可核對雜湊的 relay 壓縮包；實際 Azure 上傳與自動發布尚未提供。
4. 在變更窗口先完成 relay，再執行 `check:relay` 與兩名瀏覽器使用者的建房、分享、編輯、離線返回及 JSON 備份測試；記錄第一次與暖機後 health 耗時。此時房間重建屬預期行為。
5. 一次發布同一版完整 `dist/`，不要混用舊 HTML、新 assets 或不同 `sw.js`。驗證現有 PWA 的同意更新與更新前副本保護；不能強制清除瀏覽器儲存來掩蓋更新問題。舊分頁可能繼續使用舊程式，若協定不相容須先安排相容過渡與使用者更新。
6. 發現協定、Origin、PWA 或資料保護問題時，停止新分享並保留使用者 JSON／本機副本；恢復上一版完整前端產物、relay 產物與對應設定，再做健康及兩人編輯檢查。回滾不會恢復記憶體中的房間，也不可任意回退成無法讀取新本機資料格式的版本。

公開 Beta 前仍須完成：Linux 產物的目標環境部署／回滾演練、目標區域與免費配額、真正冷啟動／WAN、實機 iPad／Safari 及安全檢查。[前端／字型第三方授權](frontend-licenses.md) 已納入正式建置。本文件與自動化測試完成啟動及封裝準備，不能標示為已部署。
