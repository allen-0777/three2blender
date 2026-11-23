# 楓葉季 Maple Season｜楓葉許願牆

Three.js 楓葉季場景，加上後端與資料庫的「楓葉許願牆」：訪客留下一則願望，就會化成一片發光的楓葉飄在楓林裡，所有人都看得到。

單一 Node.js 服務同時提供前端靜態檔（`dist/`）與 API。

## 本機啟動

需要 Node.js 22 以上。

```bash
npm install
npm run build   # 建置前端到 dist/
npm start       # 啟動服務，預設 http://localhost:3000
```

本機沒有設定 `DATABASE_URL` 時，服務會自動 fallback 到本機 JSON 檔（`data/wishes.json`，已列入 .gitignore），啟動 log 會標明 `FALLBACK`。

開發前端時可另開一個終端機跑 `npm run dev`（Vite，`/api` 會轉給 3000 埠的後端）。

```bash
npm test        # 驗證規則、速率限制與 API 的自動化測試
```

## 環境變數

| 變數 | 說明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 連線字串。設定後使用 PostgreSQL，啟動時自動建立 `wishes` 資料表；未設定則使用本機 JSON 檔。 |
| `PORT` | 監聽的埠號，預設 `3000`。 |

連線字串請由部署平台的環境變數／Secret 注入，不要寫進程式或 commit。TLS 行為依連線字串的 `sslmode` 參數決定。

## 部署（Node.js + PostgreSQL）

- Build：`npm install && npm run build`
- Start：`npm start`
- 健康檢查：`GET /healthz` 回 200
- 環境變數：`DATABASE_URL`（必要）、`PORT`（平台通常會自動提供）

## API

| 方法與路徑 | 說明 |
| --- | --- |
| `GET /healthz` | 健康檢查，回 `{"status":"ok","store":"postgres"\|"file"}` |
| `GET /api/wishes?limit=100&after=<id>` | 最新留言（新的在前，`limit` 上限 100）；`after` 只回傳 id 更大的留言，供輪詢使用。回 `{ wishes, count }` |
| `POST /api/wishes` | 新增留言，body：`{"nickname":"選填，最多 20 字","message":"必填，最多 80 字"}`。成功回 201 `{ wish, count }` |
| `GET /api/wishes/count` | 回 `{ count }` |

`POST` 的規則：去除前後空白、拒絕空白內容與超長內容、拒絕含網址（`http`、`www` 等）或不當字詞的留言（400）；每個 IP 每分鐘最多 3 則（429，附 `Retry-After`）。

## 畫面與畫質分級

場景先畫進線性 HDR render target，再經後期合成（景深、lens glow、光柱、暗角），最後做一次 ACES Filmic tone mapping 輸出 sRGB。
依裝置自動選 `high`／`mid`／`low` 三檔，幀時間過長時會自動往下降；也可用網址參數指定：

| 參數 | 說明 |
| --- | --- |
| `?quality=high\|mid\|low` | 強制使用某一檔（不自動降級） |
| `?dof=0` | 關閉景深 |
| `?mm=28` | 指定鏡頭焦距（mm，36 mm 寬 16:9 片門） |

地表與樹皮貼圖來自 Poly Haven（CC0），來源見 `public/textures/CREDITS.md`。視覺驗收腳本與截圖在 `_qa/visual/`。

## 楓樹模型

`npm run models` 會用 Blender 重新產生 `public/models/maple_trees.glb`（需要本機安裝 Blender）。
