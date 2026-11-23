# 楓葉季（Three2blender）專案指引

- **視覺工作前先讀對應技能**：`.claude/skills/<技能>/SKILL.md`（MengTo/Skills，MIT，授權見 `.claude/skills/MengTo-Skills-LICENSE`）。
  鏡頭／景深 `control-camera-lenses`、落葉 `3d-falling-leaves`、天空 `3d-sky-background`、光柱 `3d-sky-rays`、
  解析度 `3d-retina-resolution`、貼圖 `3d-high-resolution-textures`。P1 才需要：`forest-floor-specimen`、`animate-procedural-birds`、`3d-ultra-realistic-water`。
- **禁止**：讀取 `.env*`、commit 機密、push、部署、呼叫 RoamerHost（除非 Allen 另外指示）。
- **不要動** `server/`、資料表與 API 契約；畫面的需求一律在前端解決。
- **許願牆相容規則**見 `_SPEC_視覺升級.md` 第 7 節：不刪 `window.__wishWall` 的既有欄位、點擊熱區要對、
  許願葉材質與光暈獨立於一般落葉、對焦跟著許願葉深度。
- 素材界線見規格第 2 節：不可把 Momiji Creek（ThreeUI Pro 模板）的原始碼、shader、幾何或貼圖搬進來。
  新貼圖只用 CC0 等可合法使用的來源，並更新 `public/textures/CREDITS.md`。
- 驗收：`npm test`；`npm run build && PORT=3100 npm start` 後跑
  `QA_OUT=<暫存目錄> node _qa/run-qa.mjs <playwright-core 路徑> http://localhost:3100`（許願牆回歸）與
  `node _qa/visual/run-visual.mjs <playwright-core 路徑> http://localhost:3100`（視覺，截圖寫進 `_qa/visual/`）。
  兩支腳本會送出留言，受每 IP 每分鐘 3 則的限制，中間隔一分鐘。
- 畫質檔次可用網址參數強制：`?quality=high|mid|low`，另有 `?dof=0`、`?mm=<焦距>`。
