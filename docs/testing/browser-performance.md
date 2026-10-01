# 瀏覽器畫布效能基準

日期：2026-09-30。本階段建立正式產物的桌面 Chromium 基準；既有 500／2,000 物件協作測試驗證傳輸完整性，不能代替畫面操作量測。

## 重現方式

```sh
pnpm build
pnpm exec playwright install chromium
pnpm test:performance
```

預設逐一執行 500、2,000 物件，各持續操作至少 300 秒。`PERF_SECONDS` 可設為 5～1,800 的整數秒；CI 使用 6 秒短測，只檢查工具及資料保護，不作為效能驗收。PowerShell 範例：

```powershell
$env:PERF_SECONDS = '300'
pnpm test:performance --output test-results/performance-full
```

`PERF_WORKLOAD` 預設為 `rectangles`，保留原有長方形場景；設為 `mixed` 則循環排列長方形、繁體中文文字、未綁定箭頭、橢圓及 PNG 圖片。圖片重複引用同一個 32×32 檔案，不代表大量不同圖片的解碼壓力。混合場景在第 1 輪及每 5 輪加入放大／縮回各停止 400 ms 的操作；`stoppedZoomSamples` 記錄每次命令時間與 canvas 建立數，時間包含刻意等待。`interactionSeconds` 包含這些週期性停止，不能與純長方形場景的每輪時間直接比較。兩種場景結尾均保留最後的停止 probe。

```powershell
$env:PERF_WORKLOAD = 'mixed'
$env:PERF_SECONDS = '300'
pnpm test:performance --output test-results/performance-mixed-full
```

混合場景會比對原始匯入的文字、箭頭座標及圖片引用，並在 IndexedDB、匯出、重載後再匯出逐一比對圖片 ID／MIME type／data URL。Excalidraw 可補入檔案存取時間，因此不將這類 metadata 納入圖片內容比較。CI 另外執行混合場景短測；短測只驗證資料完整性與工具可執行，沒有設定硬體相依的效能門檻。

2026-10-01 的 500／2,000 物件各五分鐘結果與原始數據見 [混合內容報告](mixed-canvas-performance.md)。

工具在 `127.0.0.1:5183` 啟動 Vite 正式預覽，固定 1440×1000 viewport、單一 worker、無重試，關閉 trace 以減少量測干擾。Service Worker 被測試環境阻擋，PWA 殼層可能顯示離線準備失敗；PWA 行為由既有獨立測試驗證。這裡不使用 relay，也不量測網路協作。

定位瓶頸時可另設 `$env:PERF_PROFILE='1'`，每組會輸出 Chromium `.cpuprofile`。用 `node scripts/summarize-cpu-profile.mjs <檔案路徑>` 產生函式自身／含子呼叫的取樣時間；含子呼叫時間不可相加，函式名稱與位置須對照同一份正式 bundle。一般時間對照應移除此環境變數或設為 `0`，避免把 profiler 額外成本混入結果。JSON 的 `profiling` 欄位記錄此模式。

交錯比較時，可將兩份完整 `dist` 分別複製為 `test-results/performance-before` 與 `test-results/performance-after`，設定 `PERF_ARTIFACT=before` 或 `after` 選擇固定產物。預設 `current` 使用 `dist`；其他值會拒絕啟動。報告記錄 `artifactDirectory`，內容雜湊使用一致的 `dist/` 相對前綴，因此同一份產物移到比較目錄不會改變雜湊。`sourceCommit` 仍指測試 checkout，固定產物的來源須另外記錄，不能把它當成建置來源證明。

報告與最後畫面放在每個案例的輸出目錄；測試失敗保留 screenshot。每次量測前必須重新建置，避免使用舊的 `dist`。JSON 記錄來源提交、相關來源是否未提交、正式產物目錄的內容雜湊、瀏覽器／Node／OS／CPU、記憶體容量、viewport 與 devicePixelRatio。

2026-10-01 起工具另計數互動期間的 canvas 建立呼叫，並在持續操作後追加「放大、停止、縮回、停止」probe。每個停止階段明確等待 400 ms 與兩次 RAF，RAF／long task 採樣涵蓋此階段；`interactionSeconds` 則只記錄持續操作迴圈。新版與以下歷史五分鐘基準的方法有差異，不能直接以總時間或分位數比較；詳見 [縮放快取報告](canvas-render-performance.md)。

## 場景與操作

1. 匯入 499／1,999 個密集排列的填色長方形，等待 IndexedDB 寫入與編輯器準備完成。
2. 暖機一秒，用真實滑鼠輸入畫一個長方形，達到總數 500／2,000；等待最終寬度保存。保留一個繪圖位置，避免超過 2,000 物件上限。
3. 實際移動該物件，確認儲存座標變更；以 canvas 圖像差異驗證平移有效，並確認縮放百分比改變後能復原。
4. 開始持續量測：空白鍵拖曳平移後返回、放大後縮小、以方向鍵移動已選取物件。每輪都必須產生對應的物件版本更新。
5. 結束時檢查總數、所有未修改物件、JSON 匯出及重新載入後的場景雜湊，並要求沒有 page error 或 crash。截圖、JSON 匯出與 reload 不包含在持續操作採樣期間。

繪圖只量一次；持續負載是平移、縮放及移動現有物件，不是持續新增物件或自由筆壓力測試。物件集中於畫布可見區域附近，部分被工具面板遮住；場景不含文字、箭頭、圖片或大量群組，因此不是所有內容的代表樣本。

## 指標如何解讀

| 指標 | 定義與限制 |
| --- | --- |
| 匯入與保存時間 | 從設定匯入檔案到儲存並可操作，包含 Playwright 與 polling 等待 |
| 繪圖命令時間 | 包含滑鼠命令往返、刻意逐影格輸入，不是純粹的輸入延遲 |
| 繪圖後保存等待 | 從繪圖命令完成到讀到最終幾何；不是整個儲存交易的精確時間 |
| 平移／縮放命令時間 | 每輪來回操作的 wall time，包含測試驅動及兩次 RAF 等待 |
| RAF 間隔 | requestAnimationFrame callback 的排程間隔；不是 GPU FPS、實際呈現時間或流暢度保證 |
| Long tasks | 主執行緒超過 50 ms 的工作，報告數量、分位數與最大值；僅在 API 支援時記錄 |
| JS heap | CDP 的 JSHeapUsedSize，每 30 秒及首尾取樣；不含完整 renderer／GPU 記憶體，沒有強制 GC，增加不等同記憶體洩漏 |

持續時長是下限，最後一輪操作可能略超過設定秒數。測試判定資料與操作正確，不設跨機器共用的毫秒門檻。效能退化應在同一環境、同一產物模式、相同場景與操作下重測，不能以 CI 短測數字直接比較桌面結果。

## 本次結果

來源提交 `a9b6da8`，相關來源無未提交變更，兩組產物雜湊相同（`f843c3b14106b7c254be1910d6a0d419b6d580d83ca9b405ff23edc568a910f8`）。Windows、Intel Core i7-8650U、Chromium 140.0.7339.186；一般工作站順序執行一次，未進行隔離環境、多次試驗或統計顯著性比較。測試驅動、量測程式與其他工作站負載都可能影響數值。

| 項目 | 500 物件 | 2,000 物件 |
| --- | ---: | ---: |
| 持續操作時間 | 300.26 秒 | 300.04 秒 |
| 完整操作輪數 | 129 | 75 |
| RAF 間隔 p50／p95 | 16.70／33.40 ms | 16.70／50.00 ms |
| RAF 最大間隔 | 1,066.60 ms | 1,549.90 ms |
| RAF 間隔 > 50 ms | 407／12,604（3.23%） | 370／8,596（4.30%） |
| Long task 數量 | 333 | 290 |
| Long task p95／最大 | 625／1,017 ms | 883／1,491 ms |
| 平移來回命令 p50／p95 | 1,292.08／2,852.02 ms | 1,785.41／2,308.43 ms |
| 縮放來回命令 p50／p95 | 631.83／2,216.55 ms | 1,938.31／2,587.73 ms |
| JS heap 首／末取樣 | 13.94／13.23 MiB | 33.77／37.89 MiB |
| 資料一致性、匯出、重載 | 通過 | 通過 |
| Page error／crash | 0 | 0 |

原始數據：[500 物件](browser-performance-500.json)、[2,000 物件](browser-performance-2000.json)。匯入與繪圖相關的單次命令時間、完整 heap 取樣及環境欄位都保留在 JSON。已檢視兩組最後畫面：[500 物件](browser-performance-500.png)、[2,000 物件](browser-performance-2000.png)。

**資料保護檢查通過，但此結果不能判定操作流暢。** 兩組皆觀察到超過一秒的主執行緒長任務，2,000 物件的長任務 p95 達 883 ms，需優先調查。不同組的命令時間不呈一致比例，不能把所有差異歸因於物件數，也不從 RAF 數字換算或宣稱 GPU FPS。Heap 中途有回落，僅憑本次取樣無法判定記憶體洩漏。

下一步使用獨立 CPU profile 定位繪製、場景序列化及儲存排程的成本，確認瓶頸後再做修改，並在相同硬體與負載下比較。正式 Safari／iPad、觸控筆、文字／箭頭等其他內容、GPU 呈現及更長時間操作仍待驗證；2,000 是資料數量上限，不是流暢度保證。

後續已針對序列化成本實作儲存批次及純檢視通知過濾，方法、對照與剩餘瓶頸見 [自動儲存效能改善](canvas-save-performance.md)。以上數據保留為修改前的歷史基準。

程式提交的 [CI](https://github.com/poychang/flowa/actions/runs/36664242120) 通過 102 項測試（既有 100 項＋2 項效能短測）、2 組 relay 重連短測，以及型別／全部建置。CI 成功表示操作與資料斷言通過，不表示解決上述停頓。
