# 報告：楓葉許願牆（Maple Wish Wall）

分支：`feature/wish-wall`（未 push、未部署、未連線 RoamerHost、未讀取 `.env.local`）。

## 結論

規格的功能、後端與驗收項目都已完成並實測通過。有兩件事需要知道：

1. **PostgreSQL 路徑沒有對真正的 PostgreSQL 跑過。** 這台機器沒有 Postgres，Docker daemon 也沒開。SQL 只用記憶體模擬器 pg-mem 走過一遍（通過），第一次接上 RoamerHost 的資料庫時請留意啟動 log。
2. **手機只在 headless Chrome 的手機模擬（390×844、觸控）驗過**，沒有在實體 iPhone／Android 上測。

## 做了什麼

**後端（新增 `server/`）**
- Express 5 單一服務：提供 `dist/` 靜態檔與 API，監聽 `PORT`（預設 3000）。
- `GET /healthz`、`GET /api/wishes?limit=100`（另支援 `after=<id>` 供輪詢只拿新留言）、`POST /api/wishes`、`GET /api/wishes/count`。
- 儲存層：有 `DATABASE_URL` 用 `pg` 連 PostgreSQL，啟動時 `CREATE TABLE IF NOT EXISTS wishes (id, nickname, message, created_at)`；沒有就 fallback 到 `data/wishes.json`，log 標明 `FALLBACK`。SQL 全部參數化。
- 驗證：去前後空白、移除控制字元、拒絕空白、暱稱 ≤ 20 字、內容 ≤ 80 字（以字計算，中文與 emoji 都算 1 字）、拒絕網址（`http`、`www`、`://`、常見網域結尾，含全形寫法）、基本中英文髒話清單。
- 速率限制：每 IP 每分鐘 3 則成功留言，超過回 429 與 `Retry-After`。被驗證擋下的請求不佔額度。額度是同步佔用的，並發請求不會超過上限。
- 其他：請求 body 上限 4 KB、資料庫連不上時啟動失敗並以 exit 1 結束（log 不輸出連線字串）、SIGTERM 正常關閉。

**前端**
- 「留下你的楓葉」按鈕、表單（暱稱選填、願望必填、即時字數）、「已有 N 片楓葉」計數、留言卡片（暱稱、內容、時間）。配色沿用現有楓紅／米白／琥珀。
- 特別楓葉：比一般落葉大約兩倍，有米白描邊、自發光與會呼吸的光暈。三個 InstancedMesh 共 3 個 draw call，現有場景的樹、落葉、環境、配色都沒有改寫。
- 載入時抓最新 100 則，每則一片；之後每 15 秒輪詢，新楓葉從上方飄落到定位後緩慢飄動。分頁在背景時暫停輪詢。
- 自己送出的那片會落在鏡頭前方中央。
- 點擊用 `THREE.Raycaster` 的射線，量測射線到葉心的距離，並保證最小點擊範圍（滑鼠 16px、觸控 28px），所以遠處的小葉子與側向的薄葉片也點得到。
- 使用者內容一律用 `textContent` 顯示。
- 手機：葉子位置依畫面比例排進可視範圍，直式畫面葉子自動縮小；輸入框 16px（iOS 不會自動放大）；按鈕高度 ≥ 46px；支援 safe-area。
- 尊重 `prefers-reduced-motion`。

## 檔案結構

```
server/
  index.js        入口（npm start）：選擇儲存層、啟動、關閉
  app.js          Express app：API 路由、靜態檔、錯誤處理
  store.js        PostgreSQL 與 JSON 檔 fallback 兩種儲存實作
  validate.js     留言驗證（長度、空白、網址、髒話）
  rateLimit.js    每 IP 滑動視窗速率限制
src/
  wishLeaves.js   （新）特別楓葉的 3D 繪製、飄落動畫、點擊偵測
  wishWall.js     （新）表單、卡片、計數、輪詢、API 串接
  main.js         （改）接上許願楓葉與 UI，共 4 處小改動
  leaves.js       （改）只多 export 葉片輪廓給許願楓葉共用
  style.css       （改）在檔尾新增許願牆樣式，原有樣式未動
index.html        （改）按鈕、計數、表單與卡片的 <dialog>、favicon
vite.config.js    （新）npm run dev 時把 /api 轉給 3000 埠
test/api.test.js  （新）16 個自動化測試（node --test）
README.md         （新）本機啟動、環境變數、部署、API
package.json      （改）start / test script、engines node>=22、express、pg
.gitignore        （改）加上 data
_qa/              驗收截圖、驗收輸出、驗收腳本
```

新增的相依套件：`express@^5.3.0`、`pg@^8.23.1`（都是安裝時 npm registry 上的最新版，`npm install` 回報 0 個已知漏洞）。

## 如何本機測試

```bash
npm install
npm run build
npm start            # http://localhost:3000，未設定 DATABASE_URL 會用 data/wishes.json
npm test             # 16 個自動化測試
```

瀏覽器驗收腳本（需要服務已啟動；`playwright-core` 不是專案相依套件，要傳入路徑）：

```bash
node _qa/run-qa.mjs <playwright-core 的路徑>
```

腳本會送出 2 則留言，所以同一分鐘內只能跑一次；想清空本機資料就刪掉 `data/wishes.json`。

## 驗收結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| `npm run build` | 通過 | Vite 建置成功（有一個 chunk > 500 kB 的警告，是 three.js 本身的大小，改動前就有） |
| `npm start` 本機啟動 | 通過 | log 顯示 FALLBACK 與監聽 3000 |
| `/healthz` 回 200 | 通過 | `_qa/curl-acceptance.txt` |
| POST 一則、GET 拿得到、count 正確 | 通過 | 同上（count 0 → 1，前後空白已去除） |
| 超長（81 字）、暱稱超長、空白、含網址、髒話被拒 | 通過，皆 400 | 同上 |
| 速率限制 | 通過，第 4 則回 429 與 `Retry-After: 60` | 同上 |
| 自動化測試 | 16/16 通過 | `npm test` |
| 瀏覽器驗收（headless Chrome，桌機 1280×800 與手機 390×844） | 27/27 通過 | `_qa/browser-acceptance.txt` |
| 場景正常 | 通過 | `01-desktop-scene.png`、`09-mobile-scene.png` |
| 按鈕與表單正常 | 通過 | `02`、`03`、`10-mobile-form.png` |
| 送出後出現特別楓葉 | 通過 | `04-desktop-leaf-falling.png`、`05-desktop-leaf-settled.png` |
| 點擊能看到卡片 | 通過 | `06`、`07b`、`11-mobile-card.png` |
| 輪詢 | 通過，外部送出的留言不重新整理就出現 | `08-desktop-poll-new-leaf.png` |
| XSS | 通過，`<b>願世界和平</b>` 以純文字顯示 | `07-desktop-card-html-as-text.png` |
| PostgreSQL SQL | 只在模擬器通過 | `_qa/postgres-sql-check-pgmem.txt` |

瀏覽器驗收輸出裡列出的一個 HTTP 400 是刻意測試「含網址的留言被拒」造成的，頁面沒有其他錯誤。headless 桌機約 60 fps（66 片許願楓葉，Apple M3）。

驗收途中發現並修掉的問題：
- **點楓葉後卡片立刻關掉。** 原本在 `pointerup` 開卡片，隨後的 `click` 落在對話框背景上把它關了；點擊位置剛好在卡片範圍內時不會發生，所以第一輪沒測到。已改成在 `click` 開啟，並在驗收腳本加上「點卡片範圍外的楓葉」的檢查（桌機與手機）。
- **手機畫面太擠。** 60 多片大葉子與光暈疊在窄畫面上一片過曝，已改為直式畫面縮小葉子、調淡光暈。
- **速率限制的並發競態。** 原本「檢查額度」與「記錄」之間隔著資料庫寫入，同時送出多個請求可以一起通過檢查。已改成同步佔用額度、失敗再歸還，並加了「同時送 12 則只成功 3 則」的測試。這是 commit 後的安全檢查指出的，修正在第二個 commit。
- **靜態檔路徑穿越回 500。** `/assets/%2e%2e/...` 原本就被擋下，但回的是 500，已改回 403。

## 已知限制

- **PostgreSQL 未對真實資料庫驗證**（見結論）。TLS 依 `DATABASE_URL` 的 `sslmode` 決定，程式沒有關閉憑證驗證；若 RoamerHost 的資料庫用自簽憑證，需要確認連線字串的寫法。
- **速率限制在記憶體內**：服務重啟就歸零，多個實例時各算各的。程式設定信任一層反向代理（`trust proxy = 1`）來取得用戶端 IP；如果 RoamerHost 前面不只一層代理，所有人會被當成同一個 IP，變成全站每分鐘 3 則，部署後要實測一次。反過來，如果服務直接對外、前面沒有代理，用戶端可以偽造 `X-Forwarded-For` 繞過每 IP 限制。規格限定環境變數只有 `DATABASE_URL` 與 `PORT`，所以沒有把代理層數做成可設定；需要的話可以加一個 `TRUST_PROXY`。
- **過濾很基本**：髒話是固定清單，容易繞過也可能誤擋；網址規則偏嚴，內容裡出現 `http` 這個字或像 `xxx.com` 的寫法都會被拒。沒有審核或刪除留言的後台，要刪只能直接進資料庫。
- **畫面最多同時顯示 140 片**，超過會移除最舊的；計數顯示的是資料庫總數，所以數字可能大於畫面上的片數。
- **許願楓葉只能用滑鼠或觸控點開**，鍵盤與螢幕閱讀器使用者讀不到別人的願望（表單本身可以用鍵盤操作）。
- **JSON 檔 fallback 僅供本機**：整份資料放在記憶體，每次寫入重寫整個檔案。
- 為了自動化驗收，頁面上掛了一個 `window.__wishWall` 除錯物件，不含機敏資料。
- 沒有加 Content-Security-Policy 標頭。

## 沒有動的東西

- `main` 分支、遠端（沒有 push）、部署、RoamerHost、`.env.local`。
- 工作目錄裡原本就有的 `.claude/launch.json` 修改、`_SPEC_楓葉許願牆.md`、`_claude_wish_wall.log` 都沒有放進 commit。

## 補充

原本要用 Playwright MCP 做瀏覽器驗收，但這個工作階段只允許開頁面，其餘操作沒有權限，所以改用本機 Chrome 加上 npx 快取裡現成的 `playwright-core` 跑 `_qa/run-qa.mjs`，沒有替專案或系統安裝新套件。pg-mem 則是裝在專案外的暫存目錄，用完已刪除。
