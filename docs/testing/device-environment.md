# HTTPS／WSS 實機驗收環境

此工具在一部電腦提供正式 PWA 與 TLS relay，供同一受信任區域網路的桌面／iPad 驗收。不是 Azure 部署，也不代表實機已通過。使用 Node.js 24、pnpm 11，沒有新增反向代理或套件依賴。

## 準備位址與憑證

1. 選擇裝置能連到的固定 LAN IP 或內部 DNS 名稱；範例 `flowa.test` 必須由你自己的 DNS 解析，並非專案提供的公開網址。所有裝置使用同一名稱。
2. 取得涵蓋該 DNS 名稱／IP SAN 的有效 PEM 伺服器憑證與對應私鑰；憑證須由每台驗收裝置信任的 CA 簽發。可使用自己的開發 CA，或既有受信任憑證。不要用瀏覽器略過憑證錯誤作為驗收依據。
3. 將伺服器憑證及私鑰放在未追蹤的 `.certs/`，不可放進公開 `dist/`。只將需要的 CA **公開憑證**交給測試裝置，私鑰留在伺服器。`tests/device-server/fixtures` 的公開測試私鑰不可用於實機環境。
4. iPad 手動安裝 CA 描述檔後，還須在「設定 → 一般 → 關於本機 → 憑證信任設定」明確開啟該 CA 的完整信任；只對自己管理的測試 CA 操作，驗收結束後移除不再需要的描述檔。[Apple 官方說明](https://support.apple.com/en-ie/102390)

工具不會自動安裝 CA、修改 DNS／防火牆，或建立雲端資源。

## 建置與啟動

將 `.env.device.example` 複製成 `.env.device.local`，填入實際設定，例如：

```dotenv
DEVICE_ORIGIN=https://flowa.test:8443
DEVICE_RELAY_ORIGIN=https://flowa.test:8444
DEVICE_HOST=0.0.0.0
DEVICE_TLS_CERT=.certs/flowa.pem
DEVICE_TLS_KEY=.certs/flowa-key.pem
```

兩個 origin 必須是同一 hostname 的不同連接埠，且不含路徑、帳密或 fragment。`DEVICE_HOST` 未設定時只綁定 `127.0.0.1`；上例的 `0.0.0.0` 明確開啟 IPv4 LAN 存取。防火牆只需允許測試裝置到兩個選定的 TCP 埠，不要把整個開發目錄或 Vite 開發服務暴露到網路。

```sh
pnpm install --frozen-lockfile
pnpm build:devices
pnpm serve:devices
```

`build:devices` 會完成型別檢查、正式前端、PWA 資源與 relay 建置，並把 `DEVICE_RELAY_ORIGIN` 作為 `VITE_RELAY_URL` 編入前端。`serve:devices` 使用 `dist/` 與 `dist-relay/`，只允許指定前端 origin 建房及 WebSocket 連線；Socket.IO 將 HTTPS 連線轉為 WSS。TLS 至少 1.2。按 Ctrl+C 停止，relay 房間狀態不會永久保存。

改動位址／埠後必須重新 `build:devices`。工具會檢查建置記錄、憑證有效期／hostname、私鑰位置及埠占用，錯誤時不會默默退回 HTTP。建置記錄不公開提供，也不加入 PWA 快取。一般 `pnpm build` 會取代 `dist/` 並移除驗收記錄，之後要重新執行 `build:devices`。

## 連線驗收

1. 在 iPad Safari 開啟 `https://flowa.test:8444/healthz`，確認憑證正常且回應 `{"ok":true,"protocol":2}`。
2. 開啟 `https://flowa.test:8443`，等待「離線可用」，建立房間並分享給另一台裝置。應看到雙方參與者與「協作同步完成」。
3. 確認唯讀訪客不能編輯、雙向繪圖會收斂；匯出 JSON 保存基準。
4. 按 [跨裝置清單](device-acceptance.md) 完成安裝、離線、觸控筆、軟鍵盤、旋轉與鎖屏項目，記錄提交 SHA、裝置與結果。

HTTPS、HTTP、不同名稱或不同埠是不同 origin，IndexedDB 與 PWA 快取各自隔離。原本 `http://127.0.0.1:5173` 的草稿不會自動出現在新的 HTTPS 位址；先匯出 JSON，再到新 origin 匯入。不要為排錯直接清除原站資料。

| 問題 | 檢查 |
| --- | --- |
| 找不到網頁 | LAN IP／DNS、兩個埠的防火牆、`DEVICE_HOST`；裝置上的 localhost 是裝置自己 |
| 憑證錯誤 | CA 信任、SAN 名稱／IP、有效期、伺服器完整憑證鏈、裝置時間 |
| 有畫布但不能協作 | relay healthz、建置內的 relay origin、Origin 是否完全相同；修改設定後重建 |
| 啟動報 EADDRINUSE | 停止占用程式或更改兩個 origin 的埠後重建；工具不會自動換埠 |
| 更新後仍是舊版 | 依 PWA 提示先保存再更新；不要強制重載未保存畫布 |

## 自動化邊界

`pnpm test:device-server` 驗證 HTTPS 檔案隔離、憑證驗證、WSS 認證／Origin 與埠錯誤。`pnpm test:device-launcher` 在 **localhost 專用驗收建置**上驗證實際啟動、PWA／healthz、設定不符拒絕與部分啟動失敗清理。CI 會用 localhost:8443／8444 建置再執行；不使用實際 LAN 憑證、不修改系統信任、不關閉 TLS 驗證。

這些 Node 用戶端測試不等於 Safari 的 CA 信任或真實硬體驗收。PWA 瀏覽器回歸仍由既有 `test:pwa` 執行。HTTPS 實作使用 [Node.js HTTPS API](https://nodejs.org/docs/latest-v24.x/api/https.html)。
