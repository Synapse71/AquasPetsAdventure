# 榆湾旧镇底图生成记录

状态：两版底图已生成并保存，推荐 B。用户已明确授权上传三张参考图。沿用此前莉刻管线和 `gpt-image-2.5-sunburst` 模型，任务 ID：`2104799b-f3f8-4847-b5f7-52d7df486087`。

## 管线与参数

`atlas-skillhub gateway` → 上传参考 JPG → 莉刻图生图 → 生成两版 → 对照参考图进行美术检查 → 保存原始 PNG 与项目内 WebP 预览。

- 画风参考一：`src/ui/art/kegna-selected.png`。
- 画风参考二：`src/ui/art/foothills-selected.webp`。
- 布局参考：`docs/maps/yuwan-town-map.png`，来自原始矢量图。
- 模型：`gpt-image-2.5-sunburst`，质量 high，2K，n=2，目标比例 75:73。
- 实际生成尺寸：2080×2016。
- 完整最终提示词：`docs/maps/yuwan-art-prompt.txt`。
- 原始请求、上传副本、任务回执、生成原图和 SHA-256 清单：`assets/maps/map3-yuwan-2026-10-22/`。

## 交付物

- A 版：`docs/maps/yuwan-town-background-a.webp`。
- B 版：`docs/maps/yuwan-town-background-b.webp`，推荐版本。
- 与前两图对照：`docs/maps/yuwan-art-comparison.jpg`。
- 原始矢量布局：`docs/maps/yuwan-town-map.svg`，保持不变。

## 检查结论

两版都延续参考图的高位斜俯视、细线稿、圆润树冠、暖灰岩石、黄绿草地、红棕瓦顶、蓝绿色河水与柔和日光。未出现标题、节点框、路线箭头或图例。现代功能通过公交候车棚、邮筒、维修铺与观星设施表达，同时维持原系列建筑的手绘材质。

B 版的中心广场接应棚、藤蔓庭院、店屋和公共建筑更容易区分；学校、宅邸和东坡住宅具有较清楚的层次。A 版的小镇氛围也完整，但中央部分建筑与接应空间的界限相对模糊。

两版都具有19处目标地点对应的地物类型，但生成图并未严格逐点复现矢量坐标：例如 B 版宅邸和南侧步行桥比草图位置更靠北。此轮交付为底图候选，不声称已与游戏交互节点精确配准；没有修改游戏锚点、节点数或联通关系，也没有替换游戏内地图素材引用。选定底图后，接入前需要完成地物入口锚点校准；若必须保持原矢量坐标完全不变，则应先定点重绘偏移地物。


## B 版接入（2026-10-22）

用户已选定 B。游戏与策划配置后台共用 `src/ui/art/yuwan-selected.webp`，按实际尺寸 2080×2016 显示，不额外缩放裁边。19 个地物入口锚点已写入 `catalog.bundled.json` 的 map-3.nodePositions，可在配置后台继续拖动调整。原矢量图保留，历史坐标单独存入 `src/domain/yuwan-layout.positions.json`，用于旧配置迁移。

旧草稿和已发布配置只将尚未手调的原始锚点一次性迁移到 B 版；手调坐标、节点名称、连接与池子配置保留。19 个节点、26 条单向路径、32 条完整路线不变，内置战利品池与事件池继续留空。
