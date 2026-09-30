# 連續縮放：重用物件 canvas 快取

日期：2026-10-01。基底為 main `1ebf113`（已合併 PR #10），本次程式提交為 `6844ba0`。

## 原因與修改

[前一輪 CPU profile](canvas-save-performance.md) 顯示 canvas 繪製與建立仍占用大量時間。檢查鎖定的 Excalidraw 0.18.1：`generateElementWithCanvas` 在倍率不同且 `shouldCacheIgnoreZoom` 為 false 時重建快取；Ctrl／Cmd＋滾輪會暫時設為 true，並在最近一次操作後 300 ms 恢復 false，但鍵盤／按鈕的 `zoomIn`、`zoomOut` 沒有這個處理。

本次以 [pnpm patch](../../patches/README.md) 讓上述兩個 action 共用原有旗標與 debounce。連續縮放期間暫時縮放舊點陣，停止後按目前倍率重建清晰畫面。修補同時套用 dev／prod bundle，依賴版本維持 0.18.1；patch 以 LF 儲存以穩定跨平台雜湊。

這項改善減少連續操作的重建次數，**停止在新倍率後的重建仍有成本**。因此量測不能只反覆放大再縮回原倍率，也必須包含停在新倍率後的重繪。

## 驗證方法

`tests/browser/zoom.spec.ts` 分別用鍵盤及工具列按鈕操作含文字、節點與箭頭的場景。虛擬時鐘驗證最近一次操作才是 300 ms 的起點，停止後旗標必須恢復 false；場景資料不變，而且恢復後的 canvas 必須與相同倍率下重新建立冷快取的畫面逐像素相同。鍵盤案例先將焦點放在畫布。

正式產物用 `pnpm test:performance`：每組 500／2,000 物件，20 秒持續平移、縮放、移動物件；兩份固定產物按「前、後、後、前」順序執行。測試沒有同時執行其他本機回歸，也不在測試之間重新建置。Windows、Intel i7-8650U、Chromium 140.0.7339.186、1440×1000、DPR 1；一般工作站的小樣本，沒有控制溫度或排除所有背景程序，不能推論到所有裝置。

本次工具追加以下觀察：

- `interactionSeconds`：持續互動階段，除以 `cycles` 得每輪平均時間。命令包含 Playwright 往返與刻意的兩次 RAF 等待。
- `canvasCreations.interaction`：互動期間 `document.createElement('canvas')` 次數。這是建立呼叫數，不是存活 canvas 數量、記憶體用量或 GPU 工作量；相同計數方式套用兩版本。
- `settledZoomProbe`：互動後放大一次，等待 400 ms 與兩次 RAF，再縮回並做相同等待。`zoomInCommandMilliseconds` 為放大命令與 RAF 等待；`zoomInAndSettleMilliseconds` 和 round trip 另包含明確的 idle 等待，不能當成純輸入延遲。
- `measuredSeconds`、RAF、long tasks 與最後 heap 取樣包含停止後的 probe，避免把延後重建排除在結果之外。`includingSettledProbe` 記錄含此階段的 canvas 建立數。

各案例最後驗證儲存、未修改物件、JSON 匯出與重載後再匯出的場景一致，並要求沒有 page error／crash。GPU 呈現、實際 Safari／iPad 與觸控筆仍未由這些測試驗收。

## 重現與來源

分別在兩版本完成 `pnpm install --frozen-lockfile`、`pnpm build`，將完整 dist 保存為 `test-results/performance-before`／`test-results/performance-after`。再用本次工具執行：

```powershell
$env:PERF_SECONDS = '20'
$env:PERF_PROFILE = '0'
$index = 0
foreach ($variant in @('before', 'after', 'after', 'before')) {
  $env:PERF_ARTIFACT = $variant
  pnpm test:performance --output "test-results/render-comparison-$index-$variant"
  if ($LASTEXITCODE -ne 0) { throw 'comparison failed' }
  $index++
}
```

原始 JSON 的 `sourceCommit` 是執行測試的 checkout；固定產物的產品來源分別是 `1ebf113` 與 `6844ba0`，須同時核對產物雜湊。先前報告沒有停止後 probe，不能直接將其總量測時間或 long task 分位數與本次當成相同測試比較。

## 本次結果

八個案例全部通過資料、匯出與重載驗證，page error／crash 均為 0，測試相關來源乾淨。每個物件數／版本各兩次，下表列兩次結果範圍；每次只有 9～18 輪，縮放命令 p95 接近該次最大值，並非大量試驗的統計結論。

| 物件／版本 | 每輪平均 | 縮放來回命令 p95 | 互動期間 canvas 建立次數 |
| --- | ---: | ---: | ---: |
| 500／前 | 1,367.14～1,399.68 ms | 305.25～320.43 ms | 30,000 |
| 500／後 | 1,170.88～1,239.32 ms | 148.89～149.80 ms | 0 |
| 2,000／前 | 2,237.94～2,238.97 ms | 892.82～1,026.36 ms | 72,000～80,000 |
| 2,000／後 | 1,573.19～1,586.67 ms | 232.67～233.74 ms | 0 |

在此來回縮放場景，修補避免互動階段反覆建立點陣快取，但仍須繪製既有快取。以下停止後結果沒有省略；「放大＋停止」包含 400 ms 的明確等待，long task 最大值包含整段互動與停止後 probe。

| 物件／版本 | 放大＋停止量測 | Probe 額外 canvas 建立次數 | 全樣本 long task 最大 |
| --- | ---: | ---: | ---: |
| 500／前 | 564.85～571.89 ms | 2,000 | 115～118 ms |
| 500／後 | 521.03～529.94 ms | 2,000 | 127 ms |
| 2,000／前 | 883.00～932.80 ms | 8,000 | 361～416 ms |
| 2,000／後 | 715.84～731.70 ms | 8,000 | 369～385 ms |

結果支持連續縮放期間的重複工作減少；**不能宣稱停止後的長任務已解決**，也不能將計數換算為記憶體節省。500 物件的 long task 最大值反而略高，需保留這個限制。已檢視新版 2,000 物件最後畫面，文字／箭頭清晰度則由前述跨瀏覽器冷快取像素比對驗證。

完整原始數據：[canvas-render-performance.json](canvas-render-performance.json)。產物雜湊（SHA-256，計算方式為工具的 `buildHash`）：

- 前版：`5cf0590e40d5d9784e417305e834314a0f784249a443d13703a5fe146db3f1f8`
- 後版：`9746e61ffbc15af3b085a682ae63ab635213679b584438b842161e7dc63deec0`

## 驗證與後續

本機型別、正式建置、兩項正式短測與全部 36 項 Chromium 回歸通過。`6844ba0` 的 [GitHub Actions](https://github.com/poychang/flowa/actions/runs/36786214684) 通過 114 項測試（26 單元、9 relay、4 HTTPS 工具、36 Chromium、24 Firefox／WebKit、3 混合裝置、2 效能短測、7 PWA、3 正式啟動），另有 2 組重連短測；凍結鎖檔安裝、型別及全部建置均成功。

接下來補更長的混合內容與實機量測，確認可接受的停止後延遲，再評估是否需要分攤新倍率的快取重建。iPad／Safari／觸控筆與 Beta 部署仍是獨立待辦。升級 Excalidraw 前必須重新檢查這份內部 API patch，不可假設可直接沿用。
