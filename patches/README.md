# Excalidraw 0.18.1：離散縮放快取

`@excalidraw__excalidraw@0.18.1.patch` 只修改 `zoomIn`／`zoomOut` action 的開發與正式 bundle：

- 呼叫現有的 `resetShouldCacheIgnoreZoomDebounced()`。
- 在 action 回傳的 app state 設定 `shouldCacheIgnoreZoom: true`。

這讓鍵盤與工具列按鈕跟現有 Ctrl／Cmd＋滾輪路徑使用相同的暫時快取策略。最近一次縮放後 300 ms，原有 debounce 會恢復 `false`，在目前縮放倍率重建清晰的物件 canvas。既有 debounce 也檢查元件是否已卸載。沒有新增永久快取、改變縮放步幅／中心點／上限，或跳過停止後的重繪。

修補透過 `pnpm-workspace.yaml` 的 `patchedDependencies` 與鎖檔套用；`pnpm install --frozen-lockfile` 必須成功，不能略過 patch 錯誤。沒有升級套件版本。正式 bundle 的原始碼為 minified，因此該部分 diff 行較長；語意變更與可讀的 dev bundle 相同。

此修補依賴 0.18.1 的內部 action 與 debounce 方法，不是公開 API 保證。升級 Excalidraw 時先檢查上游是否已有同等修正，再移除或重做 patch，並執行：

```sh
pnpm typecheck
pnpm test:e2e
pnpm test:cross-browser
pnpm build
pnpm test:performance
pnpm test:pwa
```

`tests/browser/zoom.spec.ts` 使用虛擬時鐘驗證鍵盤／按鈕連續縮放、最新計時截止、停止後狀態恢復、文字／箭頭資料不變，以及恢復畫面與新建快取的逐像素一致性。正式產物量測另外包含停在新倍率與返回後的等待，避免把延後重建的成本漏掉。
