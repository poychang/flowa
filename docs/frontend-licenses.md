# 前端與字型授權

`pnpm build` 與 `pnpm build:devices` 在產生 Service Worker 之前，執行 `scripts/frontend-notices.mjs`，輸出：

- `dist/THIRD-PARTY-NOTICES.txt`：套件原始 LICENSE／NOTICE／COPYING、Excalidraw 預先打包程式的法律聲明註解，以及字型聲明與授權原文。
- `dist/dependency-licenses.json`：套件名稱、版本、宣告授權、原文來源與 SHA-256，以及字型檔清單、雜湊和內嵌授權中繼資料。

兩個檔案都納入 PWA 預先快取與版本雜湊。正式版資料保存提示旁提供「第三方授權」連結，另開分頁，不離開畫布。Vite 開發模式不顯示此連結。

## 套件範圍與來源

保守遍歷根目錄全部正式 dependencies、遞迴 dependencies 及已安裝 peers；包含部分 relay 專用、型別或未被 tree-shaking 保留的套件，因此清單不是瀏覽器實際執行模組的精確 SBOM。目前是 276 個不同名稱／版本。未安裝的 optional peer 不納入。

優先使用安裝包中的原始授權文字。npm 漏附的 39 個套件使用 `licenses/packages/sources.json` 中精確名稱／版本對應的補充檔。Radix 新版來源對應 npm gitHead；部分舊版沒有 gitHead，react-remove-scroll-bar 的 gitHead 已無法取得，這些項目明確記錄採用的上游 MIT 聲明來源與限制，沒有假稱是當次發布附帶的檔案。Fastdom、Strictdom 的授權原文來自套件 README。Excalidraw 使用 v0.18.1 的授權。khroma 等套件省略 SPDX 欄位時保留原始 LICENSE，不自行推定 metadata。

新套件缺少授權原文、補充檔缺失或內容空白會使建置失敗。更新缺檔套件版本時，舊版補充檔不會自動套用到新版。

## 字型

Flowa 原樣複製 Excalidraw 0.18.1 的 8 組、233 個 woff2 檔案：Assistant、Cascadia、ComicShanns、Excalifont、Lilita、Nunito、Virgil、Xiaolai。Liberation 是上游伺服器用字型，不發布。CSS 另輸出的 Assistant 字型也是相同套件來源。

`licenses/fonts/manifest.json` 保存每個實際檔案的 SHA-256，以及 name table 的 copyright（0）、version（5）、license（13）、license URL（14）。抽取時使用 fontTools 4.66.1／Brotli 1.2.0；正式建置只需 Node，無須 Python 或網路。

ComicShanns 保留完整 MIT；Cascadia 保留字型內嵌的 Microsoft 聲明與完整條款，不將它改寫成 Excalidraw MIT。Virgil 內含完整 OFL 1.1；其他 OFL 字型附各自 copyright 與同一份 OFL 1.1 全文。Excalifont／Xiaolai 子集字型移除了 license name entry，另保留 Excalidraw v0.18.1 官方原始碼中的原始 font name table 註解與 URL。這些來源文件位於 `licenses/fonts/`。

## 升級與檢查

1. 更新鎖定套件後執行 `pnpm build`。缺失的原文需從官方來源取得，保存 URL、適用名稱／版本及例外原因，不能只填 MIT／OFL 名稱。
2. Excalidraw 版本、字型檔集合或任一字型內容改變，都必須重新核對授權及 copyright，更新 manifest 與必要原文。不要僅為通過建置改寫雜湊。
3. 執行 `pnpm test:licenses`、`pnpm build`、`pnpm test:pwa`。CI 包含授權檢查及正式離線授權讀取測試。
4. 連同授權檔發布整個 `dist`，避免部署時篩掉 `.txt`／`.json`。字型授權原文保留原來的空白與換行，不重新排版。

此工作完成發佈聲明與升級檢查；仍需另外完成目標環境部署／回滾、安全檢查及實機驗收。
