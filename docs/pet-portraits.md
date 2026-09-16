# 宠物头像资源

正式运行时头像统一放在 `public/pet-portraits/<宠物ID>.webp`。
生成、评审过程与原始大图留在 `assets/` 的美术目录，业务代码不得直接引用这些临时目录。

- 咕嘎：`public/pet-portraits/gugugaga.webp`，512×512，WebP quality 90，约 39 KiB。
- 来源：`assets/gugugaga/avatar-yellow-review-2026-09-15/v2-wink.png`。原图不覆盖。
- 统一组件：`src/ui/PetPortrait.tsx`，状态面板、探险配队和宠物图鉴共用。设置中的尺寸预览使用 `public/pet-sprites/standing.png` 静止帧，不使用头像。
- 图鉴未解锁时继续使用旧轮廓剪影，不泄露头像；桌宠本体、动画、菜单栏和应用 logo 不变。
- 新宠物沿用 ID 命名规则，优先正方形 512×512；保留构图，不拉伸。
- Vite 构建将此目录复制到 `dist/pet-portraits`，现有安装包白名单 `dist/**/*` 自动包含。
