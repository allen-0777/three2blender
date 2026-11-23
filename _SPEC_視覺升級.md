# 楓葉季視覺升級規格

日期：2026-11-23（Asia/Taipei）  
對象：MacBook 專案 `~/Desktop/Three2blender`  
建議分支：從 `feature/wish-wall` 開出 `feature/visual-upgrade`  
執行者：MacBook 上的 Claude Code（本規格寫給它實作；先不要部署、不要 push）

## 1. 目標與不變的核心

參考 Meng To 的 [Momiji Creek](https://threeui.com/momiji-creek)（實際可操作場景：[landing-pages/momiji-creek.html](https://threeui.com/landing-pages/momiji-creek.html)），讓楓葉季「看起來一樣精緻」，但 **核心功能與產品身份不變**：

- 仍是「楓葉季」楓林場景 + **楓葉許願牆**（表單、發光許願葉、點擊開卡片、既有 Node + Postgres API）。
- 維持現有主鏡頭語言：固定觀賞視角、輕微視差／緩漂，**不要**改成可自由行走的第一人稱遊覽。
- 許願葉必須清楚可辨、容易點到；後端、資料表、API 契約不要為了畫面去改。
- 行動裝置要跑得動（見第 8 節分級）。

這不是要把網站做成 Momiji Creek 的複製品。對方是寫實溪谷、房屋、隧道與完整攝影棚；我們是風格化楓林明信片加上許願牆。要學的是「光、大氣、材質、景深與近景細節」的完成度，不是對方的關卡內容。

## 2. 法律與素材界線（必讀）

- **MengTo/Skills**（https://github.com/MengTo/Skills）是 **MIT License**，Copyright (c) 2026 Meng To。可以把技能資料夾複製進本專案或 Claude 的 skills 目錄使用，但必須保留授權聲明（至少放一份 `LICENSE` 或在複製的技能目錄註明來源與 MIT）。
- **Momiji Creek 本身是 ThreeUI Pro 模板**（公開目錄標記 `access: "pro"`）。公開頁可以操作、可以做技術觀察，但 **禁止** 把對方的 `momiji-creek.html`、打包的 `.bin`、shader 字串、幾何或貼圖搬進本倉庫，也禁止「對照著解包原始碼重寫一份」。
- 實作請用：MIT 技能裡的做法與可重用輔助程式（例如 `control-camera-lenses/demo/assets/lens.js`）、自己寫的程式，以及可合法使用的貼圖（例如 Poly Haven 的 CC0：forest floor、樹皮、石頭等）。對方頁面註記用過的 CC0 來源可當「同類素材」參考，不要抓對方打包檔。
- 對方頁面註記場景是 Hiroshi’s Island（Chetan Ankola）的秋季再想像；不要把我們的作品說成 Momiji Creek 或該原作。

## 3. 對方實際用到的技術（只寫有在公開檔案裡看到的）

觀察來源：公開 HTML／內嵌的鏡頭與後期腳本、頁面 UI、以及公開包裝檔的目錄名稱與可解壓文字中的識別名稱。以下不是猜測。

### 3.1 產品能力（UI 上就有）

- 天氣：Clear / Rain / Thunderstorm / Windy。
- 光線：Golden（預設）／Afternoon／Sunset／Blue hour／Night。
- 機位：Creek level、Cascade、Stepping stones、Forest floor、Japanese wagtail、Maple canopy、Timber house、Tatami room、Tunnel 等二十來個預設。
- 「Play film」約 50 秒，鏡頭、光線、天氣會依分鏡切換。
- Camera 面板：Shallow focus、Lens glow（預設開）、焦距 18／24／35／50／85／110 mm、對焦距離 0.15–60 m（預設 43 m）、Adaptive Retina / Native Retina。
- 操作提示：「Drag to look. Scroll to move. Use WASD to walk.」
- 需要 WebGL 2。

### 3.2 攝影機與景深

- 註解寫明 **36 mm 寬、16:9 片門**，高度 **20.25 mm**。
- 公式（公開腳本）：`fov = (360/π) * atan(20.25 / (2 * mm))`，反算 `mm = 20.25 / (2 * tan(fov * π / 360))`。
- 預設「Creek level」：`fov: 34.62`、`focus: 43`，UI 顯示約 **Shot · 32 mm**。Wagtail 機位 `fov: 11.9`（長焦特寫）。
- 薄透鏡景深：近場 CoC 先做 quarter-size prepass，再以圓形光圈在全尺寸收集；前景 blur 會膨脹輪廓；有 `uFocus`、`uDOF`、`uAperture`、`uLens`、`uExposure`。
- Lens glow：從畫面抽高光再擴散，夜間稍強；預設開啟。
- 影像面盡量維持 **2× Retina**；依幀預算降低輔助 pass 解析度，主畫面解析度盡量穩定。Renderer 是 `antialias: false`，銳利度靠超採樣而不是 MSAA。

### 3.3 光、大氣、陰影

- `FogExp2`（初始色 `0xc7d8be`，密度 `0.022`），霧色會跟天氣／日照的 mist 一起變。
- 光線狀態可插值的量包含 `power`、`fill`、`water`、`glass`、`lamp`、`night`、`fog`、`exposure`，以及 `top`／`sky`／`mist`／`sun`／`hemi`／`ground` 等顏色。
- 溪上濕空氣有 mist volume（公開腳本把 80×196 的 mist 場送進後期）：樹冠陰影裡主要吃天空漫射，開闊處再加上陽光的前向散射。
- 陰影：`PCFSoftShadowMap`，`autoUpdate = false`；並以自訂 visibility 取代預設 PCF soft 區塊。
- `outputColorSpace = SRGBColorSpace`。曝光走 `lensExposure`／`uExposure`，在後期合成。**沒有**在 renderer 上看到 `THREE.ACESFilmicToneMapping`；不要宣稱對方用了 ACES，除非實作時另有依據。

### 3.4 材質與世界細節

- 包裝目錄可見：forest floor、boulder、樹皮／樹冠、建築材質、植物剖面圖集等掃描貼圖（AVIF／WebP 等）。頁面註記多件 Poly Haven CC0。
- Shader／原始碼識別名稱包含 `leafTransmission`、`leafPhotons`、grass／fern、雨水濕潤、反射／折射、caustic、噴霧等。
- 水：反射相機對齊畫面中的水面，折射看得到水底礫石；雨窪可走局部反射。目錄文案也寫「Creek reflections and refraction, canopy lighting, rain and shallow focus」。
- 有程序化 Motacilla（`advanceWagtail`）、魚、水黽等；另有環境聲與音樂（這次視覺升級不強制）。

## 4. 我們現況（`feature/wish-wall`，唯讀核對）

主要檔案：`src/{main,environment,trees,leaves,palette,wishLeaves,wishWall}.js`、`src/style.css`、`public/models/maple_trees.glb`。three `^0.187`。驗收截圖在 `_qa/`。

已有、而且要保留的優點：

- 逆光低角度太陽、三色天空球、線性霧 `Fog(0xf6c796, 16, 78)`、半球光 + 主光陰影 + 補光。
- 地面頂點色小徑、Blender 楓樹 `InstancedMesh`、葉片 `onBeforeCompile` 加了固定自發光（0.38）假裝透光。
- 飄落葉與地面落葉已是 instanced 楓葉輪廓；小螢幕／減少動態已有份量縮減。
- 許願葉：更大、描邊、永遠朝向鏡頭的光暈、穩定的放樣、raycaster 以葉心距離點選（滑鼠 16px／觸控 28px）。
- CSS 径向暗角、置中標題、底部許願列；canvas `touch-action: none`（點葉、不要捲動頁面）。
- 陰影 `PCFShadowMap` 2048、`autoUpdate = false`（樹與太陽是靜的）。

和精緻感差距最大的事實（對照 `_qa/01-desktop-scene.png`、`05-desktop-leaf-settled.png`）：

- **沒有後期**：`main.js` 最後是 `renderer.render(scene, camera)`。沒有景深、沒有鏡頭光暈、renderer 也沒設 tone mapping。暗角只靠 CSS。
- 抗鋸齒是 `antialias: true` + `pixelRatio` 上限 2／手機 1.5，不是「主畫面穩定 2× + 依預算降輔助 pass」。
- 陰影是普通 PCF，不是 soft；地面是平整的大平面加扁平落葉，沒有掃描森林地表、草、蕨、石頭。
- 樹幹是單色 `0x3a2317`、`roughness: 1`，沒有樹皮法線／粗糙度。
- 落葉是平坦 ShapeGeometry，沒有葉脈、正反面、厚度，也沒有跟陽光連動的透光（許願葉還有更強的固定自發光 0.55 + 光暈）。
- 鏡頭固定 `fov: 50`，只有 pointer 視差，沒有片門／焦距／對焦平面的概念。
- 沒有體積霧、沒有樹冠隙縫的光柱，遠景溶解比較「一片橘色霧」而不是空氣裡的光。

## 5. 原則

1. **先把同一張明信片拍得像電影，再考慮加世界內容。** 光、色調、霧氣、地面、樹皮、葉片、輕微景深，優先於溪流、行走、天氣 UI、房子與隧道。
2. 風格可以比現在更「有物質感」，但不要突然變成寫實寫生，以免許願葉的平面圖示語言完全格格不入。目標：同一個構圖，看起來貴一個等級。
3. 後期必須服務許願牆：預設對焦平面放在許願葉停留的深度，景深要克制；Lens glow 不可把普通落葉也照得跟許願葉一樣。
4. 所有新效果都要能關、能降級，並尊重 `prefers-reduced-motion`。
5. 不要為了畫面去改許願 API、資料庫或對話框流程。

## 6. 優先級

### P0／Must（建議這一支分支做完）

1. **色彩與曝光管線**  
   線性工作、`outputColorSpace = SRGBColorSpace`、在後期合成後做一次 tone mapping（可用 `ACESFilmic` 或 AgX，選一個並在報告寫明）、可調 exposure。讓太陽、霧、樹冠高光不再「直接爆掉或偏灰」。CSS 暗角可保留或改由後期輕微暗角，不要疊兩層過重。

2. **克制的電影鏡頭**（技能：`control-camera-lenses`、`3d-retina-resolution`）  
   - 沿用現在的 `CAMERA_BASE` / `LOOK_AT` 與視差，不要 WASD、不要滾輪前進、不要二十個機位。  
   - 用 36 mm、16:9 片門定義 fov；桌面預設可接近現在的觀感（約 35–50 mm 視角），不要擅自改成超廣角或長焦主畫面。  
   - 預設開 **很淺的景深**：焦點對準許願葉所在深度（約相機前方數公尺到十公尺，實作時量 `wishLeaves` 的 home.z），前景地面／近葉略柔、遠樹略柔，標題與許願葉保持可讀。  
   - 預設開輕微 lens glow，只吃太陽與強高光，權重低。  
   - 手機或低預算可關景深，只留 tone mapping + 降採樣。

3. **大氣**（技能：`3d-sky-background`，可選 `3d-sky-rays`）  
   讓霧色與天空、陽光同一套照明；考慮高度霧或 exp2，避免地平面一條死線。若加 crepuscular rays，必須被樹冠遮擋、不可洗白許願葉，手機預設關。

4. **陰影品質**  
   改 `PCFSoftShadowMap`（或等價的更柔接觸）。樹與太陽仍靜態時可維持 `autoUpdate = false`。注意偏差，避免樹葉陰影acne。

5. **地面與樹幹材質**（技能：`3d-high-resolution-textures`）  
   用合法 CC0 森林地表（albedo／normal／roughness，可加 AO、輕微高度）打破「一整片塑膠橘地」。中央小徑還在。樹幹加樹皮貼圖，不必重做 GLB 拓撲；UV 不夠就程式化或簡單投影，但近景不能再是平滑巧克力棒。保持 `receiveShadow`／`castShadow`。

6. **葉片與落葉**（技能：`3d-falling-leaves`）  
   飄落葉：正反面色差、可看到側緣、翻轉與側向漂移耦合、透光跟太陽走，不要無條件 emissive。地面落葉跟著地表法線／高度，不要懸空。既有數量級可先保留，再依效能調整。**許願葉的輪廓可以共用，但材質與光暈邏輯獨立**，以免許願葉變暗或普通葉變得一樣會發光。

7. **品質分級與減少動態**  
   見第 8 節。桌面要穩在可看的幀率，手機先求穩再求效果。

### P1／Nice-to-have（P0 穩定後再做，可同一分支或後續）

- 近景草、蕨、苔（`forest-floor-specimen` 當造型參考）。份量要少，不要擋住許願按鈕與點擊。
- 一隻遠景或路旁的程序化鳥（`animate-procedural-birds`）。不要做 wagtail 長焦特寫，不要搶許願葉的視線。
- 樹冠隙縫光柱（`3d-sky-rays`），僅高檔開啟。
- **可選、須另評構圖**：在小徑一側或遠景加淺溪（`3d-ultra-realistic-water` 的淺水部份；`3d-harbour-water` 是港灣，不太適用）。這會改變場景故事，不是「看起來更精緻」的必要條件。若做：不可取代許願牆主體、不可強迫改鏡頭為臨水特寫、手機可改成簡化水面或關掉反射。

### P2／明確不做（本分支）

- 複製對方的房子、隧道、榻榻米、燈籠遊行、雷雨、五十秒影片、聲音設計。
- 自由行走、滾輪進退、多機位選單、天氣／時段控制室（會跟點葉、表單搶操作；canvas 已是 `touch-action: none`）。
- 把主視覺改成韭菜公園或其他專案。
- 讀取 `.env.local`、commit 機密、push、部署、呼叫 RoamerHost。

## 7. 許願牆相容規則（必測）

- `wishLeaves` 的放樣、飄落、點擊、卡片、表單、輪詢、率限錯誤處理都要繼續可用。
- 後期加入後，raycaster 仍用世界座標，不該壞；但若改 pixel ratio／backing store，測試座標必須對。
- 景深焦點跟隨許願葉深度；選中某片時可把 focus 暫時拉近那片，但不要晃到頭暈。關卡片後回到預設焦點。
- 普通落葉與許願葉在後期之後仍要分得出來（描邊／光暈／尺寸）。
- 對話框打開時，後製與落葉不要搶效能到卡輸入；減少動態時許願葉仍可「appear」，不要只剩空白林子。
- 不要改 `window.__wishWall` 既有驗收介面（可新增欄位，不要刪）。
- `_qa/run-qa.mjs` 與 curl 驗收仍要過；視覺截圖另外輸出到 `_qa/visual/`。

## 8. 效能分級

建議三檔（可用螢幕寬、儲存的偏好，或開場前幾秒的幀時間自動降）：

| 檔次 | 對象 | 要開 | 可關 |
| --- | --- | --- | --- |
| high | 桌面寬螢幕、有餘裕 | tone map、輕微 DOF、lens glow、柔和陰影、地表／樹皮、完整落葉數、可選光柱 | 複雜水面、大量草、鳥可選 |
| mid | 一般筆電／平板 | tone map、陰影、地表、落葉略減 | DOF、光柱、水面反射、草 |
| low | 手機或掉幀 | tone map、較低 pixel ratio、葉量沿用現有小螢幕數字 | DOF、glow、光柱、高解析貼圖 MIP 即可、額外生物 |

對齊對方「主畫面解析度穩定、輔助 pass 先降」的做法，比一開始就把整張 canvas 砍成糊的更好。畫質切換時許願葉點擊熱區仍要正確。

既有預算先當下限：手機落葉 450、地面葉 1200、pixelRatio ≤ 1.5；減少動態時落葉 250、速度 0.4。不要不經測量就加倍。

## 9. 把 MengTo 技能裝進 Claude Code

授權允許。建議裝進 **專案內**，讓這次 Claude 工作階段穩定讀到，不必改使用者全域設定。

```bash
# 在臨時目錄克隆（不要把整個 Skills 倉庫提交進本專案）
git clone --depth 1 https://github.com/MengTo/Skills.git /tmp/MengTo-Skills

mkdir -p ~/Desktop/Three2blender/.claude/skills
# 本分支建議複製的技能（連同資料夾內 SKILL.md、references、需要的 demo/assets）
for s in \
  control-camera-lenses \
  3d-falling-leaves \
  3d-sky-background \
  3d-sky-rays \
  3d-retina-resolution \
  3d-high-resolution-textures \
  forest-floor-specimen \
  animate-procedural-birds \
  3d-ultra-realistic-water \
  3d-four-seasons
 do
  cp -R "/tmp/MengTo-Skills/agent-skills/3d/$s" ~/Desktop/Three2blender/.claude/skills/
 done

# 保留 MIT 授權聲明
cp /tmp/MengTo-Skills/LICENSE ~/Desktop/Three2blender/.claude/skills/MengTo-Skills-LICENSE

# 不要提交對方的大型 demo 執行檔（例如 three.min.js），若技能目錄裡有，請從版本庫排除或刪掉後再 commit
```

也可改用社群安裝器（skills.sh 文件寫過）：

```bash
npx skills add https://github.com/MengTo/Skills --skill control-camera-lenses
# 對其他技能重複；安裝位置依 CLI 版本可能是 ~/.agents/skills 或專案 skills
# 若 CLI 沒裝到 .claude/skills，請再手動複製，確保 Claude Code 讀得到
```

官方 README 對 Claude Code 的說法是：在 `CLAUDE.md` 指向技能、複製進 Claude skills，或直接打開 `SKILL.md` 當工作上下文。

請新增或更新專案 `CLAUDE.md`（短即可），例如：

- 視覺工作前先讀對應 `.claude/skills/*/SKILL.md`。
- 禁止讀取 `.env.local`、禁止 push／部署。
- 許願牆規則見本規格第 7 節。

P0 實作時至少要真正讀過並遵循：`control-camera-lenses`、`3d-falling-leaves`、`3d-sky-background`、`3d-retina-resolution`、`3d-high-resolution-textures`。  
`animate-procedural-birds`、`3d-ultra-realistic-water`、`forest-floor-specimen` 僅 P1 需要時再讀。

## 10. 建議動到的檔案

- `src/main.js`：renderer 色彩空間、陰影類型、resize／pixel ratio、後期合成、對焦與品質分級；迴圈改為先更新再 compose，不再直接 `render` 到螢幕（或只在低檔這樣）。
- 新增例如 `src/post.js` 或 `src/lens.js`：tone map、DOF、glow；桌面／手機可切。
- `src/environment.js`：霧、天空與陽光一致性、地表材質、必要時 mist／rays。
- `src/trees.js`：樹幹／葉片材質；葉片透光改與太陽相關，移除或大幅降低無條件 emissive。
- `src/leaves.js`：落葉運動與材質升級。
- `src/wishLeaves.js`：只做後期／對焦相容（例如提供代表深度、被選中葉位置）；不要重做許願機制。
- `src/style.css`：若後期已有暗角，調整 CSS vignette，避免雙重。
- `vite.config.js` 僅在需要靜態貼圖路徑或壓縮時再改。
- 貼圖放 `public/textures/`（記得授權與來源說明，可寫在 README 或 `public/textures/CREDITS.md`）。
- 測試：擴充或沿用 `_qa/run-qa.mjs`；新截圖只進 `_qa/visual/`。

不要動 `server/`、資料庫、`.env.local`，除非發現 API 被畫面改動意外打破（那時先修前端）。

## 11. QA

截圖輸出到 `_qa/visual/`，至少：

- `01-desktop-default.png` 桌面預設（有 DOF／glow 的高檔）
- `02-desktop-wish-settled.png` 新許願葉落地後仍明顯
- `03-desktop-card.png` 點葉開卡片
- `04-desktop-dof-off-or-mid.png` 中檔或關景深對照
- `05-mobile-default.png` 窄螢幕（建議 390×844）
- `06-mobile-form.png` 手機表單仍可用
- 若有自動降級：再補一張低檔

另外在 `_REPORT_visual_upgrade.md` 寫：幀時間或大約 fps（桌面與手機模擬）、做了哪些效果、哪一檔預設、許願牆回歸結果、用了哪些技能、貼圖來源與授權、已知限制。

回歸：`npm test`、既有 curl／瀏覽器許願驗收、手動確認 `prefers-reduced-motion`。

## 12. Git 與完成定義

```bash
git checkout feature/wish-wall
git checkout -b feature/visual-upgrade
```

- 要 commit 的：原始碼、合法貼圖與 CREDITS、`.claude/skills/`（含 MIT LICENSE，排除龐大 demo runtime）、本規格若尚未在分支上可一併加入、`_qa/visual/` 截圖、`_REPORT_visual_upgrade.md`。
- 不要 commit：`.env.local`、`node_modules`、`dist`、`.claude/launch.json` 若含本機狀態、任何 RoamerHost token。
- **不要 push、不要部署、不要開 PR 到遠端，除非 Allen 另指示。**
- 完成定義：P0 都在高檔桌面看得到、許願牆回歸通過、手機低／中檔可操作且不崩潰、報告寫完、本機已 commit。

## 13. 工作量與風險（給 PM）

- P0 預估：熟練的 Claude Code 約 **2–4 個工作時段**（含調參與手機降級）。不是幾個小時就能「跟對方一樣」。
- P1（草／鳥／光柱／可選淺溪）再加 **2–4 個時段**，風險主要在效能與構圖。
- 風險：景深或 glow 讓許願葉難點、難讀，或普通葉也被打亮；柔和陰影與貼圖讓手機掉幀；`shadowMap.autoUpdate` 與動態葉衝突；pixel ratio 改變點擊座標；過分寫實後與扁平許願葉、標題字不協調。
- 緩解：分級開關、焦點鎖在許願深度、許願材質獨立、先 P0 再 P1、用 `_qa/visual/` 對照，而不是憑感覺加效果。
