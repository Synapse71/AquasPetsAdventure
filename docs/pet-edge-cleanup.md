# 桌宠透明边缘优化 · v2

日期：2026-09-09。状态：**用户已确认 v2 完整切图包，已覆盖游戏运行时资源**。

## 当前部署状态

`artifacts/pet-sprites-v2/` 的 13 张图集及完整清单已核对并同步到 `public/pet-sprites/`。实际发生变化的是四段硬边动画，其余九段与现用文件一致。覆盖前备份位于 `artifacts/pet-sprites-backup-before-v2-zpUlAQ/`（含 13 张旧图集及清单），可用于恢复。未覆盖母版 PNG、原视频、原型内嵌资源或存档。

`npm run assets:pet` 现在默认开启 v2 清理并输出游戏目录，使用现有 `$HOME/.venvs/idle-art/bin/python`，可用 `IDLE_ART_PYTHON` 指定其他已装 Pillow / NumPy / SciPy 的解释器，避免普通重新打包恢复旧白边。

部署后验证：`npm run build`、119 项游戏测试、独立临时存档的 Electron 冒烟测试全部通过；原生画布保留透明像素、菜单与冒险交互正常、无 renderer 异常。`dist/pet-sprites/` 的 13 张图集与用户确认包逐文件哈希一致。正在运行的旧窗口需刷新或重启以重新加载图片。

以下候选制作与验收段落保留为历史记录，其中「尚未覆盖」描述的是当时状态，以本节部署状态为准。

遵循项目 `guga-idle-animation` 管线约束：不重新生成动作，不改变 960×902 画布、脚底基线、首尾帧顺序或动画落点。原始 `frames/`、原有 `clip-*.webp` 和 `public/pet-sprites/` 保持不变。

## 问题定位

现有素材有两条不同的抠图来源：

- `blink-plain`、`blink-breath`、`blink-tilt`、`bulb-hint`：四角 floodfill 后直接写入二值 Alpha（0 / 255），边缘仍保留与白底混合的浅色 RGB。原始 PNG 合成到深色底就有明显白线，不是 Electron 或本次 WebP 编码才产生的问题。
- 其余九段：旧 rembg 输出，已有大量半透明像素，不能套用同样的修复强度。初次试验发现睡眠枕头下缘可能变得不均匀，所以默认处理明确跳过这类软 Alpha，保留其像素原样。

## 算法与保护范围

实现位于 `tools/pet_matte.py`。

1. 默认只处理二值 Alpha 输入；检测到原有半透明像素就返回原样副本。
2. 外轮廓仍使用 6 个母版像素宽的处理带。v2 另识别距轮廓不超过 32px 的小型中性亮色窄缝：完整亮色连通块不超过 300px、距离变换半径不超过 4px，再向周边扩 3px 处理抗锯齿混色。因此不再承诺「6px 以内以外全部不动」。先清理再缩放，不能对缩小后的图片重复套固定像素参数。
3. 从**同一个连通区域**的内部取邻近不透明参考色，避免拿角色的颜色去修改附近独立的睡眠符号、细线或其他小图形。
4. 用白底混色关系 `C = tF + (1−t)B` 估算边缘覆盖率，恢复边缘颜色及半透明过渡。参考色过浅、距离过远、颜色不符合白底混合关系时保留原像素。
5. 不膨胀前景，也不整圈裁掉轮廓；不把已知 Alpha 与估算覆盖率相乘，避免重复削薄。
6. 窄缝使用 8px 内、同一前景连通块的深色参考像素；广阔白色区域、深处高光、独立白色小符号不满足这一规则。整块识别后才扩展，避免将大面积真实浅色部位的边缘误当成小白块。此启发式针对当前角色，不是可无条件套用的通用抠图模型。

很细的发梢或缺少可信内部参考色的位置会保守保留，因此本版不保证每一个亮点都消失。图像中的真实浅色高光也不能仅凭“很亮”判断成白边。

`include_soft=True` 仅保留为算法实验入口，不暴露给打包命令，**不作为当前推荐方案**。不能把早期软 Alpha 实验结果用于游戏。

## 已接入的可选命令

使用 `/Users/lilithgames/.venvs/idle-art/bin/python`，依赖 Pillow、NumPy、SciPy。

```sh
# 测试已知真值的合成样本
/Users/lilithgames/.venvs/idle-art/bin/python tools/test_pet_matte.py

# 生成静态三背景对照 + 全帧 24fps 同步动画，不改原图
/Users/lilithgames/.venvs/idle-art/bin/python tools/pet_matte_review.py blink-plain --animate

# 新视频抠图时可选：另存 frames-clean/，不覆盖 frames/
/Users/lilithgames/.venvs/idle-art/bin/python tools/video2frames.py 输入.mp4 新段名 --clean-edges

# 已有 PNG 打包时可选：另存 clip-240-clean.webp
/Users/lilithgames/.venvs/idle-art/bin/python tools/pet_clip.py blink-plain --clean-edges

# 生成候选运行时资源，默认到 artifacts/pet-sprites-clean/，不会被 Vite 打入游戏
/Users/lilithgames/.venvs/idle-art/bin/python tools/build-pet-sprites.py --clean-edges
```

三个原有管线脚本不带 `--clean-edges` 时保留旧行为。`video2frames` 的新步骤在脚底对齐和去阴影之后执行，不让新边缘影响画布裁切。

运行时探针只构建了 `blink-plain`，v1 在 `artifacts/edge-cleanup-runtime-probe/`，v2 在 `artifacts/edge-cleanup-runtime-probe-v2/`，**它们不是可替换整套资源的完整包**。完整替换需在用户确认后重建全部清单并再次检查，不能用单段 manifest 覆盖游戏的 manifest。

编码后首帧对照可复现：

```sh
/Users/lilithgames/.venvs/idle-art/bin/python tools/pet_matte_review.py blink-plain \
  --frames 0 --output assets/gugugaga/_reviews/edge-cleanup-v2/summary \
  --runtime-before public/pet-sprites/blink-plain.webp \
  --runtime-after artifacts/edge-cleanup-runtime-probe-v2/blink-plain.webp
```

## v1 验收记录（历史数据，不能当作 v2 指标）

- 13 段共抽查 52 帧，在深色、灰色、品红背景下生成对照；四段硬边动画改善明显，九段旧软边动画的候选图与输入逐像素相同。
- 对四段硬边动画的全部 488 帧进行了逐帧指标检查并生成同步对照动画。距离轮廓 6px 以上的内部像素修改数为 0。
- “轮廓亮像素”指标下降范围约 90.8%–96.5%；这只是辅助指标，**不是白边修复率或视觉质量评分**。
- 四段中，可见轮廓面积减少最多约 0.57%，重心变化最多约 0.203 母版像素；清理幅度的相邻帧变化最多约 0.082 个百分点。
- 重新编码的 WebP 探针首帧仍保持改善，说明效果没有在运行时压缩步骤中丢失。
- 9 项 Python 合成图测试覆盖去白边、软 Alpha 保护、白色内部保护、独立细线保护、原始输入不变等；119 项现有游戏测试通过。
- 指标不能代替全片肉眼验收；正式覆盖前仍需用户确认候选效果。还没有全面修复旧睡眠枕头残边，也没有修改道具图标或原型内嵌素材。

候选与对照统一位于 `assets/gugugaga/_reviews/edge-cleanup-v1/`：

- `summary/runtime-webp-comparison.png`：实际编码的左旧右新简版对照。
- `*-comparison.jpg`：三个背景、多个采样帧的对照。
- `*-edge-detail.png`：边缘局部等比例放大。
- `motion/*-motion.webp`：同帧同步、原速的左旧右新动画。
- `report.json`、`motion/*-temporal.json`：样本与逐帧指标，供后续管线回归参考。

## v2 发梢窄缝修正

用户指出 v1 右侧发梢仍有白点。放大原图证实：部分白底残留被二值抠图保留成了前景内部的窄三角，距外轮廓可达约 28px，v1 的 6px 外轮廓规则无法触及。另有弯曲细发梢缺少原规则要求的深处参考色。

v2 增加上述窄缝识别与近邻深色参考，采用反混色恢复透明度，不是涂黑或裁掉整束头发。审核材料单独存于 `assets/gugugaga/_reviews/edge-cleanup-v2/`，v1 对照保留。`*-hair-detail.png` 包括深色和品红背景的发梢局部放大；`deep_interior_changed_pixels` 记录距原轮廓超过 35px 的变化，而 `interior_changed_pixels` 仍保留旧的 >6px 统计口径，非零不再直接代表误伤。

12 项合成测试通过，新增斜向封闭窄缝恢复透明、深处细高光不变、独立浅色符号不变。正式素材仍未覆盖。

v2 检查结果：四段硬边动画全部 488 帧完成指标检查，>35px 深处像素变化为 0；最大可见面积减少 0.6214%，最大重心位移 0.1837 母版像素，相邻帧修正幅度差最大约 0.0823 个百分点。九段旧动画抽样 36 帧逐像素不变；全部 52 张抽样原图的 SHA-256 校验一致。完成源图深色/品红局部目检和实际编码 WebP 首帧目检，尚未逐帧肉眼审核全片。

`hair-gap-comparison.png` 为左 v1、右 v2 的右侧发梢等比例 2× 放大；`summary/runtime-webp-comparison.png` 亦为左 v1、右 v2 的已编码运行时首帧。它们与 `motion/*-comparison.jpg` 的「原始源图 / v2」对照口径不同，查看时注意标签。

## v2 完整切图包

用户认可窄缝样片后，按相同参数重建整套候选，不重新生成动作、不覆盖当前游戏。复现命令：

```sh
/Users/lilithgames/.venvs/idle-art/bin/python tools/build-pet-sprites.py \
  --clean-edges --review-package --output artifacts/pet-sprites-v2
```

包内包含全部 13 段的运行时 WebP 图集和完整 `manifest.json`；`frames-960/<clip>/` 为 960×902 母版尺寸透明切图（尚未做运行时的 walk 横移）；`animated/` 为从实际编码图集无损重组的 24fps 透明动画；`before/` 为当前游戏图集副本；`provenance.json` 记录每张输入和输出的 SHA-256 及像素是否变化。

`preview.html` 可直接用浏览器打开，无需后端、网络或游戏存档。左右同帧播放当前游戏版和新版，支持 13 段切换、暂停、逐帧、进度拖动、缩放与五种背景。为方便验收，预览页将所有片段循环播放，不改变游戏清单里的实际循环标记。

四段二值 Alpha 动画应用 v2 修复；九段旧软 Alpha 动画将原始 PNG 直接复制到候选输出，未承诺对其做新的抠图优化。运行时仍仅对独立原地播放的 walk 做原有对位。此完整包不是自动部署：`public/pet-sprites/` 及原始素材仍保持原样。

完整包验收：13 段共 1560 张 PNG，均为 RGBA / 960×902；488 帧应用修复，1072 帧原样保留。逐帧输入和输出哈希校验通过，完整 manifest 与当前游戏的帧数、尺寸、帧率及循环配置一致。13 个透明动画的总时长均等于原帧数 / 24fps（取整毫秒）；现用版副本与游戏文件一致。浏览器实测动画切换、暂停/逐帧、背景和放大控制，未发现页面运行时错误。原始图集和母版没有覆盖。
