# Demo 打包与分发

## 产物与运行

- macOS：`release/AquasPetsAdventure-0.1.1-mac-universal.dmg`。同时包含 Apple Silicon（arm64）和 Intel（x64）。打开 DMG，将 `AquasPetsAdventure.app` 拖入「应用程序」后运行。
- Windows：`release/AquasPetsAdventure-0.1.1-win-x64.exe`。x64 免安装程序，直接双击运行；首次启动需要解压内置运行时，可能比后续稍慢。不要仅分发 `win-unpacked/` 中的内部 EXE，它离不开同目录的其他文件。
- 平常只有桌宠主体，点击宠物展开菜单；通过系统托盘/菜单栏或「设置」退出。隐藏宠物不等于退出。

打包不包含开发者的游戏存档。应用使用用户配置目录保存游戏，升级前可在设置中导出备份。当前没有自动更新或线上发布功能。

## 签名与测试范围

这是供 Demo 测试使用的构建，不是已认证的商店发行版：

- macOS 使用 ad-hoc 签名，无 Apple Developer ID 和公证。保留 hardened runtime，并配置 Electron JIT / ad-hoc 加载框架所需的 entitlement；不访问开发者证书或钥匙串。
- Windows 保留应用图标和版本信息，但没有 Authenticode 签名。系统可能显示未知发布者/安全提示。
- 不要为了运行游戏全局关闭 Gatekeeper、SmartScreen 或杀毒软件。仅对自己确认来源的包使用系统允许的单应用放行流程；正式公开分发前应补齐签名、公证和平台验收。
- 当前宿主是 Apple Silicon Mac：macOS 包可进行本机启动测试；Intel 架构只验证二进制包含性，Windows 包只完成构建、PE 架构和资源验证，仍需对应真机测试。透明窗口、鼠标穿透、拖拽、托盘、缩放与屏幕切换尤其需要 Windows 验收。

参考：[electron-builder macOS 签名说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)、[Windows 打包配置](https://www.electron.build/v26/docs/win/)。

## 可复现构建

```bash
npm ci
npm test
npm run package:all
```

单平台命令为 `npm run package:mac`、`npm run package:win`。macOS 包须在 Mac 上生成；首次构建需联网下载各平台 Electron、NSIS 和打包工具。无需重新运行美术管线。

`tools/package-desktop.mjs` 明确禁用自动发布，清除签名/发布凭据环境变量，并关闭证书自动发现。打包配置是 `electron-builder.json`，仅允许编译后的 `dist/`、三个桌面运行脚本、两个原生窗口备用图标和运行包清单进入 ASAR。AI 工具配置、原始美术、原型、源码、测试文件和玩家存档均不应进入游戏包。

## 验证

```bash
node tools/verify-package.mjs \
  release/mac-universal/AquasPetsAdventure.app/Contents/Resources/app.asar \
  release/win-unpacked/resources/app.asar
codesign --verify --deep --strict release/mac-universal/AquasPetsAdventure.app
node tools/simple-panels-smoke.mjs --app \
  release/mac-universal/AquasPetsAdventure.app/Contents/MacOS/AquasPetsAdventure
```

界面测试使用临时存档，不修改玩家存档。ASAR 验证检查包内白名单、必要动画和基础凭据特征；最终包只包含最终素材。交付时可生成 SHA-256 校验值，供接收方核对文件完整性。

本轮首次打包测试曾在关闭置顶后的页面重载等待动画帧时超时；随后完整回归与设置重载专项均通过，未复现稳定产品故障，因此未据此修改游戏逻辑。后续若复现，应优先记录原生窗口遮挡状态与渲染器可见性。
