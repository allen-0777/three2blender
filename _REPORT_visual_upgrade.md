# 楓葉季視覺升級報告（P0）

日期：2026-11-23　分支：`feature/visual-upgrade`（由 `feature/wish-wall` 開出）　資料夾：`~/Desktop/Three2blender-visual`
規格：`_SPEC_視覺升級.md`。未 push、未部署、未讀 `.env*`、未呼叫 RoamerHost、未動 `~/Desktop/Three2blender` 與 `server/`。

## 結論

P0 七項都已實作，高檔桌面全部看得到；許願牆回歸全數通過；手機（低檔）可操作。

| 驗收 | 結果 |
| --- | --- |
| `npm test` | 16/16 通過 |
| `_qa/run-qa.mjs`（既有許願牆瀏覽器回歸） | 27/27 通過（唯一的 HTTP 400 是腳本刻意送出含網址留言的預期拒絕） |
| `_qa/visual/run-visual.mjs`（新增的視覺驗收） | 20/20 通過，頁面無 console error／warning |
| curl 驗收 | `_qa/visual/curl-acceptance.txt`：healthz、列表、計數、貼圖、GLB 皆 200；未知 API 404；空白／含網址留言 400 |

## 幀時間（headless Chrome，ANGLE Metal／Apple M3）

| 情境 | 實際 backing store | 平均幀時間 | 約略 fps |
| --- | --- | --- | --- |
| 桌面 high（1440×900 @2×，DOF＋glow＋光柱，MSAA 2） | 2880×1800 | 23.3 ms（p95 33.4） | 43 |
| 桌面 mid（@1.5×，glow，MSAA 4） | 2160×1350 | 18.6 ms（p95 33.3） | 54 |
| 桌面 low（@1.5×，只有 tone mapping） | 2160×1350 | 17.6 ms（p95 33.3） | 57 |
| 手機模擬 390×844 @3×（自動選 low，pixel ratio 1.5，CPU 4× 降速） | 585×1266 | 16.6 ms（p95 16.7） | 60 |

這些是這台 Mac 的 headless 數字，上限被 60 Hz 鎖住。**沒有在實體手機上量過**；手機那一列的 GPU 仍是 M3，只能當相對參考。
高檔在 2880×1800 沒有到 60 fps（43 fps）；自動降級的門檻是連續兩個 2.5 秒視窗平均超過 30 ms，所以這台機器會停在高檔。

## 做了什麼（對應規格第 6 節 P0）

1. **色彩與曝光管線**（`src/post.js`、`src/main.js`）
   場景畫進線性 HalfFloat render target，後期合成後只做一次 **ACES Filmic** tone mapping（`renderer.toneMapping`，three 只在畫到螢幕的最後一個 pass 套用），`outputColorSpace = SRGBColorSpace`。曝光可調：`window.__visual.setExposure(n)`（預設 1.0）。後期有輕微暗角（0.3），CSS 暗角在後期啟用時由 0.45 降到 0.22，不疊兩層重的。
2. **電影鏡頭**（`src/lens.js`、`src/post.js`）
   沿用 `CAMERA_BASE`／`LOOK_AT` 與視差，沒有加任何行走或機位。36 mm 寬 16:9 片門：橫式 **35 mm（垂直視角 32.3°）**；直式畫面逐步換成 22 mm（49.4°），兩側的樹才留在畫面裡。
   景深用薄透鏡公式（f/1.4），半解析度算模糊圈再做圓形光圈收集，模糊圈上限為畫面高度的 0.9%。預設焦點 11.06 m：取許願葉最近與最遠距離的倒數中點，整面許願牆的模糊圈都小於約 1 px。點開某片時焦點在約 1 秒內拉到那一片（實測 11.06 → 8.40 m），關卡片後回到 11.05 m。
   Lens glow 只吃亮度超過 1.6 的 HDR 高光（太陽、太陽旁的天空、許願葉描邊），權重 0.28；一般落葉的亮度到不了門檻。
3. **大氣**（`src/atmosphere.js`、`src/environment.js`）
   覆寫 three 的霧 chunk，改成指數高度霧，霧色隨視線與太陽夾角變化；天空 shader 在地平線用同一個函式，遠景溶進它背後那塊天空的顏色，地平面沒有色差線。太陽圓盤、平行光、霧的受光方向、光柱共用 `palette.js` 的同一個方向。
   另加了螢幕空間光柱（高檔限定，1/4 解析度、32 取樣）：來源是同一份高光，被樹冠擋住的地方就沒有光；9 m 內的表面只吃 30%，不洗白許願葉。
4. **陰影**
   **three r187 已移除 `PCFSoftShadowMap`**（設了會警告並退回 PCF），所以用 `PCFShadowMap`：r187 的 PCF 本身是 5 點 Vogel disk × 硬體線性比較的柔邊，`shadow.radius = 4`。`autoUpdate = false` 維持。bias −0.0012、normalBias 0.1。
5. **地面與樹幹**
   地表：Poly Haven「Forest Leaves 02」albedo／法線／ARM（AO＋roughness），頂點色染成暖色並保留中央較深的小徑；遠處混入放大的同一張貼圖打散重複感；地形加了緩坡（小徑保持平坦），樹、地面葉、飄落葉的落點都用同一個高度函式。
   樹幹：GLB 沒有 UV，用世界座標三向投影貼「Bark Brown 02」（albedo＋法線＋AO／roughness），直向裂紋沿樹幹走。
6. **葉片與落葉**（`src/leaves.js`、`src/leafShading.js`）
   一般落葉改用沿中肋對折、葉尖微捲的立體葉片；正反面色差、程序化葉脈；翻轉角與側向滑移耦合（直立時滑得快、掉得快），40% 整圈翻滾、其餘擺盪；共用陣風。
   透光改成跟著每一盞直射光與其陰影走，**一般葉與樹冠已沒有無條件 emissive**。地面葉貼地表高度與法線，約三成翻面。
   許願葉材質完全獨立（仍有自發光、描邊、光暈）。
7. **品質分級與減少動態**（`src/quality.js`）

   | 檔次 | 自動選到的條件 | pixel ratio 上限 | 後期 | 貼圖 | 飄落葉／地面葉 |
   | --- | --- | --- | --- | --- | --- |
   | high | 桌面、> 4 核心且記憶體 > 4 GB | 2 | tone map＋DOF＋glow＋光柱 | 地表 2k | 850／2600 |
   | mid | 核心 ≤ 4 或記憶體 ≤ 4 GB | 1.5 | tone map＋glow | 地表 2k | 650／2000 |
   | low | 寬 ≤ 768 px 或觸控裝置 | 1.5 | 只有 tone map | 地表 1k、樹皮無法線 | 450／1200 |

   **預設檔次**：桌面 high、手機 low。幀時間過長時依序：輔助 pass 解析度減半 → 降一檔 → 主畫面降到 1×（只降不升）。實測把 CPU 降速 20×，26 秒內 high → low，換檔後點許願葉仍正確開卡片。
   `prefers-reduced-motion`：飄落葉 250 片、速度 0.4、鏡頭不漂移不視差，許願葉照樣浮現（實測 67 片）。這項是用瀏覽器的 reduced-motion 模擬自動檢查的，沒有另外人工目視。

## 許願牆相容

- `window.__wishWall` 欄位未刪；新增的除錯介面放在另一個 `window.__visual`。
- 2× backing store 與換檔後，hover 游標、點擊、觸控開卡片都通過；raycaster 仍用 CSS 座標。
- 表單開著時畫面減半更新，把資源讓給輸入。
- `wishLeaves.js` 的改動只限相容：新增 `focusDepth()`；視角改由 `layout()` 重新讀取；葉片大小依視角縮回接近原本的畫面佔比；光暈關掉 fog 並把不透明度由 0.4 調到 0.22（線性空間疊加比原本強）；描邊與自發光補償 ACES。
- `_qa/run-qa.mjs` 只加了 `QA_OUT` 環境變數，回歸時不覆蓋 `_qa/` 既有截圖；既有截圖沒有動。

## 截圖（`_qa/visual/`）

`01-desktop-default`（high）、`02-desktop-wish-settled`、`03-desktop-card`、`04-desktop-dof-off-or-mid`（mid）、`05-mobile-default`、`06-mobile-form`、`07-desktop-low`、`08-desktop-auto-degraded`（自動降到 low 後點開卡片）、`09-desktop-reduced-motion`。
桌面截圖以 2× 擷取後縮到 1440 px 寬再 commit（原檔共約 39 MB）。

## 使用的技能（MengTo/Skills，MIT）

已複製到 `.claude/skills/`，授權在 `.claude/skills/MengTo-Skills-LICENSE`。實作時讀過並遵循：
`control-camera-lenses`（片門／焦距、帶正負號的模糊圈、前景不被後景滲入、最後才 tone map；`src/lens.js` 的兩個函式改寫自其 `lens.js` 並註明出處）、`3d-falling-leaves`、`3d-sky-background`、`3d-retina-resolution`、`3d-high-resolution-textures`、`3d-sky-rays`。
`forest-floor-specimen`、`animate-procedural-birds`、`3d-ultra-realistic-water`、`3d-four-seasons` 只複製、未使用（P1）。
未提交的部分：各 demo 的 `three.min.js`，以及 `3d-ultra-realistic-water/demo/index.html`（820 KB）。
沒有使用 Momiji Creek 的任何原始碼、shader、幾何或貼圖。

## 貼圖來源與授權

Poly Haven，CC0：Forest Leaves 02、Bark Brown 02（作者 Rob Tuytel）。明細在 `public/textures/CREDITS.md`。共 6.9 MB；高檔開場實際下載約 6.2 MB（地表 2k albedo＋法線、ARM 1k、樹皮三張 1k）。

## 與規格不同或需要 Allen 知道的地方

- **構圖變緊了**：原本垂直視角 50°（換算約 21.7 mm），規格要求 35–50 mm，所以橫式改為 35 mm。同一個機位，但畫面比原本窄約四成。想更接近舊構圖可用 `?mm=28` 比較後再決定。
- **太陽方向改了**：原本在左前方 34°，35 mm 下會落在畫面外。改到左前方 5°、仰角 12.5°，落在樹廊開口上方；影子因此朝鏡頭方向。
- **陰影類型**不是規格寫的 `PCFSoftShadowMap`（r187 已移除），原因見上。

## 已知限制

- 沒有實機手機數據；float render target 不支援時的退路（直接畫到螢幕）沒有裝置可測。
- 樹冠在 2× 近看有 PCF 取樣的細網點（葉片自我陰影）；已把樹冠接收陰影的比例降到 45% 減輕，沒有完全消除。
- GLB 樹冠裡的大塊低面數體積在逆光下偏亮，像紅色燈籠；要改善得重出樹模型。
- 卡片對話框本身有 CSS 背景模糊，開卡片時的拉焦在畫面上幾乎看不出來（數值有確認）。
- 沒有做「儲存偏好」；每次載入重新判斷檔次。降級後不會自動升回來。
- 貼圖是原始 JPG，沒有轉 WebP／KTX2。
- 飄落葉最近離鏡頭 2.5 m，偶爾會有一片很大的葉子飄過畫面上緣（見 `04` 截圖）。
- `_claude_visual.log` 是原本就在的空檔案，沒有 commit。

---

# 修正 1（2026-11-23）：樹冠「紅燈籠」與許願葉描邊

Commit `63e13fd`。只動前端：`src/trees.js`、`src/wishLeaves.js`、`src/leaves.js`（多匯出輪廓座標）、`_qa/visual/run-visual.mjs`（加 `QA_OUT`）。
`server/`、API、GLB 模型、`blender/generate_trees.py` 都沒有動。

## 1. 樹冠裡的紅燈籠

- **原因**：GLB 樹冠每個葉叢中心有一顆 12 頂點的二十面體實心團塊（產生器用來擋葉片空隙），和葉片在同一個網格、同一個材質。
  P0 加的透光把每個面都當成薄葉片：逆光時團塊朝鏡頭的那一面背對太陽，整面被算成「光穿過來」而發亮。
  已驗證：只關掉團塊的透光，燈籠就變成暗色；問題不在模型的顏色。
- **做法**：載入 GLB 時用連通元件找出這些團塊（固定 12 頂點／20 三角形，和 13 頂點／12 三角形的葉片不相連），從索引裡拿掉。
  五個變體共拿掉 202 顆。試過「保留但不透光」和「縮到 60%」，近處的樹仍看得到深色的低面數球，所以選擇不畫。
- **不需要重出 Blender 模型**，`public/models/maple_trees.glb` 原檔未改，因此沒有另存備份。
  之後若重出模型，可以直接在 `generate_trees.py` 拿掉團塊；前端這段找不到團塊時不會做任何事。
- 樹冠少了填充後，葉片之間偶爾看得到後面的枝幹或天空，目視仍是滿的。每個變體少畫 560–920 個三角形。

## 2. 許願葉的發光

- 拿掉原本「同輪廓放大 1.16 倍的白色實心描邊」。
- 改成三層暖色、沒有硬邊的光（仍是 3 個 draw call，和原本一樣）：
  1. **內部光**：葉身自發光不再是平塗，葉心最亮、往葉尖漸弱，葉脈是透光的細亮線（葉子很小時細線自動淡出）。
  2. **邊緣光**：沿輪廓往外長一圈裙邊幾何，疊加混合、由葉緣往外淡出到 0（寬度約葉片的 19%）。
  3. **光暈**：原本面向鏡頭的圓形柔光保留，顏色略偏暖、不透明度 0.22 → 0.20。
- 和一般落葉的區別：比較大、葉脈發亮、有一圈暖光；一般落葉沒有自發光。low 檔（沒有 lens glow）與手機也分得出來，見 `after-desktop-low.png`、`after-mobile.png`。
- **沒有動**：`pick()` 的點擊半徑、放樣、飄落、`focusDepth()`、`window.__wishWall` 的欄位。許願葉材質仍獨立於一般落葉。
- 限制：許願葉疊在很亮的背景（太陽、遠處霧）前面時，疊加的邊緣光幾乎看不到，這時靠葉脈與顏色辨識。

## 驗收

- `npm test`：16/16 通過。
- `_qa/run-qa.mjs`（許願牆回歸，截圖寫到暫存目錄）：27/27 通過。腳本列出的 HTTP 400 是它刻意送出含網址的留言。
- `_qa/visual/run-visual.mjs`（`QA_OUT=_qa/visual/fix1`）：20/20 通過，頁面沒有 console error／warning。
  hover 游標、點擊開卡片、觸控開卡片、換檔後的點擊熱區、拉焦與回焦都在裡面。
- **效能**：同一台機器、同一時間交替量修改前（`0a3c733`）與修改後，各兩輪的平均幀時間：

  | 檔次（1440×900 @2×，headless） | 修改前 | 修改後 |
  | --- | --- | --- |
  | high | 38.2／36.3 ms | 37.9／35.8 ms |
  | mid | 22.8／22.2 ms | 23.0／22.2 ms |
  | low | 18.7／19.5 ms | 18.9／19.0 ms |

  沒有可量到的差異。這次機器整體比 P0 報告時慢（當時 high 是 23.3 ms），所以 `run-visual` 印出的 high 44.8 ms 不能和 P0 的表直接比。
  手機模擬（low、CPU 4× 降速）16.6 ms，約 60 fps，和 P0 相同。仍然沒有實機手機數據。

## 截圖（`_qa/visual/fix1/`）

- 對照：`before-*` 與 `after-*` 各五張，`desktop-high`、`desktop-topleft`（左上樹冠 2× 裁切）、`desktop-wish-closeup`（許願葉 2× 裁切）、`desktop-low`、`mobile`。
  先看 `before-desktop-topleft.png` 對 `after-desktop-topleft.png`，以及兩張 `desktop-wish-closeup`。
- `01`–`09`：修改後重跑 `run-visual.mjs` 的整套截圖。`_qa/visual/` 原本的 P0 截圖沒有覆蓋。
- `capture.mjs`：拍對照圖的腳本，不送留言。
- 桌面全幅截圖同樣縮到 1440 px 寬。

## 其他

- 本機驗收用 JSON fallback 儲存（啟動時取消 `DATABASE_URL`），`data/wishes.json` 多了驗收腳本送出的 3 則留言（67 → 70）（該檔在 `.gitignore`）。
- 沒有 push、部署、讀 `.env*`、呼叫 RoamerHost，也沒有動 `~/Desktop/Three2blender`。

---

# 第二輪（feature/visual-r2，規格：`_SPEC_視覺第二輪.md`）

參考 `~/Desktop/_ref/abyssal-garden`（MIT，WebGPU）**只學做法、沒有搬程式碼**。學到的做法：用太陽陰影貼圖做體積光柱的 ray march、
沿太陽方向不變的光束圖樣、低解析度算完再做深度感知的模糊與放大、只在光照到的地方才看得見的灰塵、慢慢閃爍的光點、
以 18% 灰為中心的對比調色，以及「固定鏡位＋只看截圖的盲審」這套驗收流程。沒有新增貼圖或模型，`public/textures/CREDITS.md` 不用改。

## 改了什麼

| 規格項目 | 做法（檔案） |
| --- | --- |
| 1 逆光與對比 | 霧密度 0.0105 → 0.0038，另外讓 70–116 m 外淡進霧色，藏住地表邊界（`palette.js`、`atmosphere.js`）。背光霧色調暗，半球光 1.15 → 0.5，補光 0.75 → 0.18，太陽 3.8 → 5.2，曝光 0.92；合成時以 18% 灰為中心拉開對比，暗部略偏冷（`post.js`）。太陽移到左前方樹冠邊緣後面（方位 −12°、仰角 15°），圓盤縮小、亮度壓低（`environment.js`）。 |
| 2 光柱＋灰塵 | 改用體積光：每個像素沿視線查太陽陰影貼圖，被樹冠擋住的地方沒有散射光，再乘上沿太陽方向不變的光束圖樣，形成一條條光柱（只在樹冠高度以下、15 m 內）。HG 前向相位。high 32 步、mid 14 步，都在 1/4 解析度算，之後做深度感知的模糊與 4-tap 放大（`post.js`）。灰塵在 vertex shader 查陰影貼圖，只有站在光裡才看得見（`sparkles.js`）。 |
| 3 樹冠 | 載入時重建 GLB 的樹冠：去掉葉叢中心的實心團塊，原有葉片縮成 0.6 倍、逐片換色相（紅／橘為主，少量金黃與帶綠，`palette.js` 的 `LEAF_HUES`），每個葉叢另外補 22 片小葉（仍是每種樹一個 InstancedMesh）。每片葉子帶 AO（在樹冠裡的深度、在葉叢裡朝內或朝外、高度）與樹冠方位；背光那一側更暗。透光加上「穿過多層葉片」的項與側面散射，陰影幾乎全保留；粗糙度 0.95（`trees.js`、`leafShading.js`）。 |
| 4 粒子 | 金色光點 260 顆慢慢明暗閃爍（`sparkles.js`）。裝飾落葉 850 → 380（high）、尺寸 0.06–0.21 且多數是小葉，不用金黃與黃綠、略暗、透光較弱，與鏡頭保持 4.5 m 以上（`leaves.js`）。許願葉：遠近分級的邊緣光／光暈、光暈中心有一點光核（一般落葉沒有）、自己剛留下的那片放在標題正下方，邊緣光 2.6 倍並脈動（`wishLeaves.js`）。 |
| 5 地面 | 樹下 AO、落葉堆積量、「抬頭看得到樹冠」的範圍，預先算成 384² 的小貼圖（`environment.js`）。木漏れ日：只作用在太陽光上，在陰影外把光打散，在樹冠陰影裡從葉縫漏出沿光線拉長的小光斑，隨風輕晃（`komorebi.js`）。地面落葉約八成堆在樹根周圍與小徑邊緣（`leaves.js` 的 `createLitterSpots`）。 |
| 6 前景框景 | 右上角一根近距離楓枝，放在獨立的前景層（`FOREGROUND_LAYER`）：以不受光的剪影畫進 1/2 解析度、4× MSAA 的透明 buffer，高斯模糊後疊在最上層，隨風輕晃，滑鼠移動時略有視差（`framing.js`、`post.js`）。許願葉的停留位置會避開右上角與標題的實際 DOM 範圍。 |
| 7 環境音（加分） | Web Audio 即時合成：粉紅雜訊做風聲（陣風）、高頻帶通雜訊做葉子沙沙、留下楓葉時一聲鐘聲加回聲（`ambience.js`）。預設靜音；右下角開關按下才建立 AudioContext，關掉時淡出並 suspend。`wishWall.js` 送出成功後只多發一個 `wish:planted` 事件，不帶留言內容。 |

其他：

- 修正 r187 PCF 陰影的逐像素旋轉在小葉片上造成的網點（`atmosphere.js` 改成固定角度）。葉片材質查陰影時沿太陽方向外推 0.12 m，避免自我遮蔽格紋。
- 對話框的 `::backdrop` 拿掉 `backdrop-filter`：疊在 WebGL canvas 上會被粗略取樣成方塊，背景改由景深糊掉。標題在卡片開啟時淡出。
- 畫質檔：high＝完整光柱＋景深＋glow；mid＝簡化光柱（14 步）＋glow；low＝簡化光柱，強度減半，陰影圖改 2048（只在載入時畫一次）。`?quality=`、`?dof=0`、`?mm=` 照舊。
  `run-visual.mjs` 原本檢查 mid／low「光柱關閉」，已改成檢查 `'lite'`，因為規格要求 mid 也要有簡化版。
- 驗收用的 hook：`window.__visual.setPose({ position, target, focus })`、`configure()`、`scene`。`window.__wishWall` 的既有欄位都沒有刪。
- `server/`、資料表、API 契約都沒有動。

## 驗收

- `npm test`：16/16 通過。`npm run build`：成功。
- `_qa/run-qa.mjs`（許願牆回歸，`QA_OUT` 指到暫存目錄）：**27/27 通過**。HTTP 400 是腳本刻意送出含網址的留言。
- `_qa/visual/run-visual.mjs`（`QA_OUT=_qa/visual/r2/regression`）：**20/20 通過**，沒有 console error／warning。
- 環境音（headless）：按下開關後 `enabled` 變 true、`aria-pressed` 變 true，送出 `wish:planted` 沒有錯誤，再按一次就關閉。**實際聲音沒有人耳試聽過。**

### 固定鏡位、盲審、前後對比

- 6 個固定鏡位（`_qa/visual/r2/capture.mjs`，不送留言）：首頁、許願葉飄落停好後、卡片打開、低角度仰望樹冠、地面近景、手機直式（自動選 low）。
- 盲審：另外開的 `claude -p`，只給截圖路徑與目標畫面描述（`critic-prompt.txt`），在 repo 外執行。共跑 12 輪，每輪原文都在 `_qa/visual/r2/critic.md`，截圖在 `round1/`–`round12/`。
- **評審最後結論：最高嚴重度仍是 major，沒有達到「沒有高於 minor」的目標。** 剩下的 major 主要是：許願葉的平面造型與群聚（既定設計）、
  近景樹冠的低面數葉卡、樹形只有 5 種、樹根沒有隆起（要重做 Blender 模型），以及幾項評審自己前後矛盾的意見。詳見 `critic.md` 末尾的結論。
- 前後對比：`_qa/visual/r2/compare-01.png`–`compare-06.png`。左邊是 `2d4f9d4`（解出到暫存目錄、只補上同一個 `setPose` hook），右邊是最終版，鏡位相同。原始截圖在 `before/` 與 `round12/`。

### 效能（headless Chrome、Apple M3、1440×900 @2×，`?quality=` 強制、不降級）

新舊兩版同時在跑，交替量測；背景負載會干擾，每格是兩次量測：

| 檔次 | 2d4f9d4 | 第二輪 |
| --- | --- | --- |
| high（2880×1800） | 38.4／35.4 ms | 51.0／51.9 ms；最後的優化後 39.9／45.2／47.4 ms |
| mid（2160×1350） | 18.6／18.2 ms | 29.2／26.3 ms |
| low（2160×1350） | 16.6／16.6 ms | 22.8／22.9 ms |
| 手機模擬 low（585×1266，CPU 4× 降速） | 16.6 ms | 16.6 ms（約 60 fps） |

- 拆解 high（關掉後期時約 30–36 ms）：樹冠約 7 ms、地面約 6 ms、體積光柱與景深各約 4–8 ms。
- **high 在 headless 下沒有達到流暢（約 20–25 fps），比上一版慢約 1.3–1.4 倍。** 沒有強制檔次時，幀時間監看會自動降級：high → 輔助 pass 減半 → mid。
  `run-visual` 的自動降級測試通過（high → mid，點擊熱區仍正確）。上一輪報告已提過 headless 數字比實際視窗慢；**這輪沒有用實際的 Chrome 視窗量過**，所以「high 在這台 MacBook 是否流暢」還沒有實測確認。
- GPU timer query 在 ANGLE／Metal 上回傳的是接近 wall-clock 的值，不能用，所以上面都是 rAF 幀時間。

## 已知限制

- 盲審沒有收斂到 minor 以下（見上）。
- high 的效能比上一版差，靠自動降級兜底；要讓 high 在 2× 下穩定 60 fps，下一步可以：high 改成 1.75× 或動態解析度（像 abyssal-garden 那樣先降解析度）、樹冠做距離 LOD、地面光斑改成預算好的貼圖。
- 前景楓枝固定在鏡頭右上角。驗收用的非首頁固定鏡位（仰望、地面）會把它隱藏，因為它只屬於首頁的構圖。
- 光柱與灰塵靠陰影貼圖，陰影只在載入（與樹木載入完成）時畫一次。太陽與樹都是靜止的，所以沒問題；如果之後要讓太陽移動，必須每幀更新陰影。
- 許願葉在 `placeHome` 裡會避開標題與右上角樹枝，所以和上一版比，部分許願葉的停留位置不一樣（同一則留言每次載入的位置仍然固定）。點擊熱區的測試全部通過。
- 本機用 JSON fallback 儲存；兩支驗收腳本在 `data/wishes.json` 共新增 3 則留言（70 → 73，該檔在 `.gitignore`）。
- 沒有 push、部署、讀 `.env*`、呼叫 RoamerHost，也沒有動 `~/Desktop/Three2blender` 主資料夾。舊版對照是用 `git archive 2d4f9d4` 解到 `/tmp/t2b-old`，在 port 3101 跑。
