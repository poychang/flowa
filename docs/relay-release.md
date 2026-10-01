# Linux relay 發布包與第三方授權

使用 Node.js 24、pnpm 11.19.0 與 Linux。`pnpm package:relay <名稱>` 需要乾淨的 Git checkout，並拒絕覆寫既有輸出；Windows 請使用 Linux CI 產物。這個命令只建置及封裝，不會部署雲端。

```sh
pnpm install --frozen-lockfile
pnpm package:relay ci-relay
pnpm test:release
```

發布程式先編譯到全新的暫存目錄，再由 `release/relay` 工作區以 [pnpm deploy](https://pnpm.io/cli/deploy) 安裝只有 Socket.IO 與 Zod 的正式依賴。工作區啟用 `injectWorkspacePackages` 以使用目前鎖定的 pnpm 11 部署行為；升級 pnpm 時須重跑解包測試。根鎖檔保留既有精確版本，本次沒有升級第三方套件。

## 產物

輸出位於 `release-artifacts/<名稱>/`，另有 `<名稱>.tar.gz` 與 `.tar.gz.sha256`。未指定名稱時包含提交縮寫及 Linux 架構。包內包含：

- `dist-relay/`、正式啟動／health scripts、完整獨立 `node_modules/`。
- `LICENSE`：Flowa 原始碼授權。
- `THIRD-PARTY-NOTICES.txt`：實際部署依賴的授權與 NOTICE 原文。
- `dependency-licenses.json`：名稱、版本、套件宣告授權、包內相對位置、授權檔 SHA-256。
- `release-manifest.json`：來源提交、Node／OS／架構、來源鎖檔雜湊，以及每個檔案的大小、權限、SHA-256 和相對 symlink 目標。
- `provenance/pnpm-lock.yaml`：pnpm 產生的獨立解析紀錄。未使用的工作區 patch 設定不作為執行環境的安裝設定；包內不需要重新執行套件安裝。

使用目前鎖檔時收集 24 個套件版本，宣告均為 MIT；兩個 debug 版本分別記錄。保留套件原檔與原本內嵌聲明，沒有以單一 MIT 範本文字取代各作者授權。缺少授權 metadata、原文或存在包外連結時封裝失敗，需先處理該依賴。此清單涵蓋 **relay 包內依賴**，不包含未打包的前端程式／字型或另外安裝的 Node.js runtime；前端授權彙整仍待完成。

CI 在完整 Check 通過後上傳 `relay-linux-<GitHub SHA>` artifact，保留 14 天。外層 GitHub ZIP 內是 tar.gz 與 checksum；tar 保留 pnpm 的 symlink、隱藏目錄與權限，不能只下載可見的 JS 檔。PR workflow 可能使用測試合併提交，正式部署應選用已合併 main 的成功 CI 產物，並核對 manifest。

## 解包及驗證

下載後，在 Linux 及空白目錄操作，先核對來自可信 CI 的 checksum：

```sh
sha256sum -c ci-relay.tar.gz.sha256
mkdir relay-unpacked
tar --same-permissions -xzf ci-relay.tar.gz -C relay-unpacked
# 以下命令在可信 Flowa checkout 執行，路徑可改成剛才解包的絕對路徑。
pnpm verify:relay /absolute/path/relay-unpacked
```

檔案多出、遺失、雜湊／權限改變，或連結為絕對路徑、指向包外，驗證皆失敗。Manifest 本身不自我雜湊，由整個 archive checksum 涵蓋；checksum 與 manifest 是完整性紀錄，不是簽章或發布者身分證明。tar metadata 固定，但不承諾不同機器的封裝位元完全相同。

在解包目錄設定 `PORT`、HTTPS `ALLOWED_ORIGINS` 後執行 `node scripts/start-relay.mjs`；Node.js 24 由目標環境提供，不需安裝 pnpm、TypeScript 或重新下載依賴。完整健康檢查、部署及回滾流程見 [部署文件](deployment.md)。

Linux CI 會將 archive 解至系統暫存目錄，清空 NODE_PATH／NODE_OPTIONS，驗證所有檔案與連結，使用包內程式做 health、建房、WebSocket 握手及 SIGTERM 正常退出。Windows 執行 `pnpm test:release` 只測一般雜湊／授權處理，跳過 Linux symlink／整包測試；不可據此宣稱 Linux 已通過。
