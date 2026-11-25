# 森林密度與神木樹冠驗收

分支：`feature/forest-density`，基準：`bda1a17`。未 commit、push、部署或操作其他 worktree；未修改 server、API、資料庫、標題／許願葉／後期程式。

## 實作範圍

- `blender/generate_trees.py`、`public/models/maple_trees.glb`：habit 參數、10 個樹形、座標 SHA-1。
- `src/forestLayout.js`、`src/farForest.js`、`src/trees.js`：原始配置與亂數序列保留；中遠景放置、LOD1、變體快取、每變體合併樹幹、實例數降級、legacy 對照。
- `src/main.js`：獨立中景落葉種子、開場 tier 地面烘焙、降級、跨 post pass 計數及 60 幀中位數、`__visual.info()`。
- `src/scene2/canopyTips.js`、`src/scene2/giantTree.js`、`src/scene2/index.js`、`src/quality.js`：保留原枝幹亂數，枝上疊葉、投影補洞、月亮與太陽保護、面積加權與排序葉片、30,000／20,000／11,000 預算及 drawRange 降級；其他場景二樹木只載入原變體 0–4。
- `test/forest-layout.test.mjs`、`test/canopy-tips.test.mjs`、`_qa/visual/run-visual.mjs`：配置／模型不變性、投影補洞、預算、A/B 畫面及功能驗收。

## 模型與配置

GLB：**7,314,524 bytes（7.315 MB；6.976 MiB）**，低於 7,500,000 bytes。新變體每叢維持 30 片，沒有降到 26，也未加入壓縮或相依套件。

`blender-old.log` 與 `blender.log` 中，變體 0–4 的 Trunk／Foliage 共 10 組五位小數座標 SHA-1 完全相同。此外，`legacy-glb-hashes.json` 直接取自修改前的 GLB，測試逐網格驗證匯出後 POSITION 雜湊也相同。

`legacy-layout.json` 與 `legacy-rng.json` 在改寫前產生，驗證原有 58 棵的位置、大小、旋轉、傾斜以及後續 116 次亂數值均不變。

| tier | near | mid 實際／上限 | far 實際／上限 |
|---|---:|---:|---:|
| high | 58 | 21／30 | 228／240 |
| mid | 58 | 21／22 | 180／180 |
| low | 58 | 10／10 | 90／90 |

候選經走廊、許願葉帶、太陽錐、間距與景框規則過濾後未必填滿上限。未放寬任何規則，也未更改 LAYER_BUDGET。各 tier 使用同一優先序前綴。

地面 AO 只依開場 tier 的 near + mid 烘焙；降級後不重烘焙，依已核定的取捨保留淡 AO。far 不進地面與落葉配置。

## 計畫中的實際問題與修正

補洞的 1.2° 覆蓋半徑小於 1.5° 格距；若永遠只填棋盤格的一半，測試的 15 格內部洞會只減到 8 格，無法達到 ≥60% 改善。因此仍先隔格填補，再在未達 70% 時取另一半候選，達標即停。1–2 格小洞、maxFill 與兩種保護窗口均保留；此為唯一演算法偏離。

原有 `frameWatch.average` 在 `?quality=` 強制畫質時不更新，會回報 0。量測介面改以最近 60 幀實際 rAF 間隔回報 frameMs，不改自動降級判斷。原始初次截圖與量測保留；另在 `/tmp` 從 `bda1a17` 的指定前端檔案建置原版並補測相同尺寸、畫質與本機葉片資料，沒有建立或修改其他 git worktree。

## 驗收結果

- `npm test`：34／34 通過，含原有標題、API 測試，以及真實 GLB 實例矩陣／幾何不重建、神木 drawRange 降級測試（`tests.log`）。
- `npm run build`：成功；保留 Vite 既有 >500 kB chunk 提示（`build.log`）。
- 桌機 1280×800／手機 390×844、high／low、legacy／layered、神木午後／黃昏／夜晚及兩場景 id 3 點擊：40／40 通過，無 console error／warning 或失敗請求（`visual-qa.log`、`measurements.json`）。
- 視覺檢查：兩側林帶連續、中央消失點開闊；神木下緣更豐厚；午後光柱及地面光斑仍存在，桌機右上月亮可見。手機原視角較窄，月亮方向在畫面右側之外，未調整鏡頭。
- 固定種子下，大枝／小枝疊葉後的投影格已無符合條件的大洞，因此實景 fillerTips 為 0；補洞功能以有洞 fixture 驗證 ≥60% 改善，另驗證 1 格天光不填、窗口保護與 maxFill。
- 原 `_qa/run-qa.mjs`：27／28，唯一失敗為開場 600 ms 點到尚未浮現的最新葉片。此 fixture 有 26 片，既有 `wishWall.js` 逐片延遲 `0.4 + i*0.03` 秒，最新葉片需約 1.15 秒才開始浮現；腳本僅看螢幕座標，未驗證葉片已可點擊。
- 同一腳本的 `/tmp/forest-wish-qa.mjs` 副本只將該等待 600 ms 改為 1500 ms（仍在 3500 ms 標題淡出前）：**28／28 通過**（`wish-qa-settled.log`）。未修改原 QA、wishLeaves 或 titleIntro。日誌中的 HTTP 400 是腳本刻意送出含網址留言的預期驗證。
- 最終完整視覺回歸：**74／74 通過**，無 console error／warning、未捕捉例外或失敗請求（`regression.log`、`regression/measurements.json`）。涵蓋標題淡出、capture 固定、reduced-motion、鍵盤／對話框、手機觸控、雙場景三時段、legacy A/B 與實際 drawRange 降級。
- CPU 6× 加每幀 35 ms 的強制 QA 負載，透過真實 frame watcher 自動 high → low：near=58、mid=10、far=90；giantLeavesBuilt=30,000、giantLeavesDrawn=11,000。未直接呼叫降級函式，且降級後點擊熱區仍正確。最終實景 high／mid 324 tips、low 261 tips。

## 效能對照

同機 Chrome headless、deviceScaleFactor=1；左側為 bda1a17 原版，右側為分層版本。數字為完整 post 管線的穩定幀中位數，不是只有主場景 pass。首次矩陣為 3 片許願葉、補測原版為 5 片；完整回歸為 29 片，故整幀三角形包含少量 fixture 差異。原始快照 `baseline-initial.json`；補測原版 `baseline.json`；改版 `measurements.json`。

| 尺寸／檔次／場景 | draw calls | triangles | ms／幀 |
|---|---:|---:|---:|
| 桌機 high／場景 1 | 44 → 65 | 2,084,699 → 2,290,545（9.9%） | 16.67 → 16.65 |
| 桌機 high／場景 2 | 77 → 77 | 3,095,071 → 3,186,921（3.0%） | 16.67 → 16.66 |
| 桌機 low／場景 1 | 33 → 53 | 1,935,188 → 1,931,410（-0.2%） | 16.67 → 16.65 |
| 桌機 low／場景 2 | 66 → 66 | 2,701,210 → 2,754,110（2.0%） | 16.66 → 16.67 |
| 手機 high／場景 1 | 44 → 65 | 2,084,699 → 2,290,545（9.9%） | 16.67 → 16.62 |
| 手機 high／場景 2 | 71 → 71 | 2,955,179 → 3,047,029（3.1%） | 16.67 → 16.67 |
| 手機 low／場景 1 | 33 → 53 | 1,935,188 → 1,931,410（-0.2%） | 16.66 → 16.64 |
| 手機 low／場景 2 | 60 → 60 | 2,561,318 → 2,614,218（2.1%） | 16.66 → 16.67 |

場景一 high／low draw call 增量為 +21／+20，低於 +25；森林本身 ≤33。神木場景 draw call 不變。low 三角形略減是因新變體與小樹重新分配抵銷了補葉成本，並非移除原有樹。

`createForest` 載入時間：桌機 high 320.1 → 389.3 ms，手機 high 270.8 → 358.2 ms，手機 low 189.9 → 269.1 ms（1.42×，低於 2.2×）。保留各次原始值供核對；載入時間受瀏覽器快取與機器負載影響。

手機 low 幀時間 16.66 → 16.64 ms，未超過 +10%，所以 low far 預算維持 90。這是本機 GPU 的手機尺寸模擬，60 Hz 上限下的相對結果，不能視為實機 FPS 保證。


最終工作目錄確認：仍在 `feature/forest-density`，HEAD 仍為 `bda1a17`；`git diff --check` 通過。兩份原有未追蹤計畫文件未修改。本次本機驗收服務與原版暫存預覽服務均已停止。
