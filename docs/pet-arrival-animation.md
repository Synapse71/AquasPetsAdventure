# 到站动画 A / B

2026-09-10：用户选定 A「轻快收步」和 B「小碎步刹车」，两版均保留。

## 播放约定

- 每次观察到行进结束，各 50% 概率选择一版；只抽一次，允许连续两次相同。
- 收完当前行走循环，明确显示 walk 第 114 帧，再从 arrive-a / arrive-b 第 0 帧播放到第 121 帧，然后站立待机。到站动作约 5.08 秒；等待当前行走循环结束最长约 4.8 秒，仅影响表现，不延迟引擎抵达和事件处理。
- 到站动画不循环，点击宠物、灯泡或打开面板不会打断。若玩家很快选择下一条路线，先完成到站动画，再完整播放出发动画。
- 恢复已抵达的存档不补播；恢复行进中的存档直接进入行走，随后正常抵达时播放。
- 行进不计入睡眠等待时间，仍从抵达后开始计算。未处理事项只影响灯泡。
- 若 RAF 跳过行走末帧，会将第 114 帧保持至少一个动画帧周期，避免从任意步态硬切。

实现：`src/ui/petAnimation.ts` 状态调度与帧选择；`PetDesktop.tsx` 预加载和 Canvas 绘制。随机动画不使用游戏战利品 / 事件的随机状态。

## 素材与坐标

原片、完整提示词、模型参数和 task_id 保存在 Git 忽略目录
`assets/gugugaga/arrival-review-2026-09-10/`。A/B 原片均为 1440×1440、24fps、122 帧。

首帧取现用 walk 母版第 114 帧，并应用游戏管线的 +83px 横移；尾帧取现用清晰 standing 对应的 idle-magnifier 第 0 帧。两者原为 960×902，各上下补白 29px 构成生成参考图。

因此这次必须等比缩至 960×960 后固定裁去上下 29px，不能再次按脚底重新定位。首帧本来在迈步，脚底比站姿低约 4 个母版像素，不应把整段上移来强制两者相同。没有使用逐帧包围盒居中、缩放或交叉淡入。

```sh
/Users/lilithgames/.venvs/idle-art/bin/python tools/video2frames.py assets/gugugaga/arrival-review-2026-09-10/A-arrival.mp4 arrive-a --crop-top 29
/Users/lilithgames/.venvs/idle-art/bin/python tools/video2frames.py assets/gugugaga/arrival-review-2026-09-10/B-arrival.mp4 arrive-b --crop-top 29
/Users/lilithgames/.venvs/idle-art/bin/python tools/anim_qa.py arrive-a arrive-b --sheet
npm run assets:pet
npm run test:arrival
```

沿用四角抠白底、去脚下阴影、v2 发梢窄缝和反白底混色清理。运行时仅增加 `public/pet-sprites/arrive-a.webp`、`arrive-b.webp` 及 manifest 项，300×282 / 24fps。原有 13 段和清晰站立帧不改构图。

## 验证

两段 244 帧通过 `anim_qa` 的非循环跳变检查；该检查只检测明显跳变，不代表所有轻微形变都不存在。
单元测试覆盖随机边界、每次只抽一次、末帧保持、完整播放、点击不中断、快速续程排队、恢复存档以及睡眠计时。
`test:arrival` 使用独立临时存档，分别强制抽到 A/B，记录实际 Canvas 的 walk 尾帧 → 到站首帧 → 到站尾帧 → standing，核对锚点、透明背景与窗口坐标，结果在 `artifacts/arrival-smoke/`。

本轮执行结果：197 项项目测试、12 项边缘清理测试、3 项静止帧测试和生产构建通过。A/B 的实际 Electron 到站测试均通过：行走末帧和到站首帧躯干中心均为 x=150.5、脚底 y=267；到站末帧和 standing 均为 x=149.5、脚底 y=266（300×282 Canvas），窗口位置不变。原有 13 张 WebP 与 standing.png 重建后和修改前逐文件一致。

原有 `test:departure` 同样通过，包括初次 / 后续路线完整出发、恢复行进存档、进度条路径名、到站后保持清醒和三分钟睡眠计时。旧脚本的「选路线立即处于出发姿态」断言已调整为允许正在播放的到站动画先完成，与上述续程排队规则一致。

此变更更新源码和运行时素材；旧 `release/` 安装包不会自动更新，需另行重新打包。

## 2026-09-14：到站动画封闭白底修补

四角 flood fill 无法进入发梢、手臂、兜帽围出的封闭背景；通用窄缝规则又会保护大块白色，导致 A/B 部分帧保留白底。
构建的 `--clean-edges` 流程现在先对 arrive-a / arrive-b 调用 `tools/pet_arrival_matte.py`，按原始 960×902 画布中的已评审侧边区域清除中性白色连通块，再执行通用边缘反混色，处理新暴露的空隙边沿。
这是这两段动画专用的空间规则，不适用于其他动作或重新生成的素材。眼睛、肚皮、帽子与工具高光避开处理区域；不平移、不裁切、不改变帧数和播放时序。源视频和源 PNG 保留原样，之后完整重建素材也会应用修补。

验证命令：`/Users/lilithgames/.venvs/idle-art/bin/python -m unittest discover -s tools -p 'test_pet*matte.py'`。
其中真实素材回归用第 10 帧验证旧规则保留白块、新规则透明化，并检查肚皮未变；另覆盖 B 段第 28～30 帧低头时向左下移动的空隙（编号从 0 开始）。没有本地源素材时跳过此项，其余合成保护用例继续运行。
15 项抠图测试通过；检查两段全帧拼图和重点帧放大图后，仅覆盖两张到站 WebP，逐文件校验其余运行时素材与 manifest 均未变化。候选、旧版备份和检查图位于不入库的 `artifacts/arrival-matte-final/`。未重新打包发布安装包。
