# 开机自启动（UE-12）

设置面板提供「开机自启」开关；实际含义是用户登录电脑后启动桌宠。
已接入 macOS 安装版及 Windows portable 便携版。开发 Electron、网页和其他系统显示不可用，绝不把开发进程注册为登录项。

## 实现

- `desktop/login-item.cjs` 封装 Electron `getLoginItemSettings` / `setLoginItemSettings`。不保存伪造的本地布尔值，不在启动、读档或清档时调用设置接口。
- `pet:login-item` IPC 沿用主窗口与来源检查，只接受布尔值写入；省略值为查询。渲染端不得提供程序路径或启动参数。
- 点击后重新读取 OS 状态；注册需要授权时提示到系统设置的登录项允许，静默失败或异常时不假报成功。
- 打开设置面板和回到应用时刷新状态，以反映用户在系统设置中的修改。提交时暂时禁用开关，避免连点。
- 构建白名单包含新增主进程模块；不改变游戏存档版本。
- Windows 从 electron-builder 启动器注入的 `PORTABLE_EXECUTABLE_FILE` 读取原始 EXE，验证绝对路径、扩展名和文件存在后才开放开关，绝不回退到临时解压的 `process.execPath`。读写使用相同 path 和空 args，注册名固定为 `AquasPetsAdventure`；开启时同时设置 StartupApproved 的 enabled。系统回读结合 openAtLogin 与 executableWillLaunchAtLogin，避免任务管理器禁用后仍显示开启。[启动器来源](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/portable.nsi)。
- 玩家需把便携 EXE 放在固定位置；移动或删除会使旧路径失效，从新位置启动后重新开启会更新同名登录项。不请求管理员权限、不另建计划任务。

## 验证与发布限制

控制器测试覆盖开关双向切换、回读、外部修改、开发/不支持平台保护、非法参数、授权等待、读写异常和静默失败。Electron 设置专项只测试开发模式禁用及 IPC 拒绝注册，不改测试机器的真实登录项。

本轮 228 项单测、生产构建及 `node tools/simple-panels-smoke.mjs --settings-only` 通过；含真实 preload / IPC 调用的开发模式注册拒绝检查，无渲染异常。

补充 Windows 后 232 项单测与生产构建通过。新增覆盖中文/空格路径、读写路径一致、关闭、无效/不存在路径拒绝、开发环境拒绝及任务管理器禁用状态。Windows 系统 API 使用模拟测试；尚未在 Windows 实机验证。

目前打包配置为 ad-hoc 签名、无公证。[Electron 官方文档](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows) 提醒，可靠的 macOS 登录项注册需要打包、签名并公证。本轮没有变更签名配置、访问签名凭据或代用户开启登录项。

发布验收仍需在正式安装包上执行：

1. 把应用安装到固定位置（推荐 Applications）后手动开启，核对系统登录项和 UI 状态。
2. 退出应用再打开，状态仍与系统一致；注销并登录，确认桌宠自动出现。
3. 手动关闭后重新登录，不再自动启动。
4. 在系统设置中禁用，再回游戏设置，界面应反映实际状态或授权提示。
5. Windows：将便携 EXE 放入含中文和空格的固定路径，开启后核对 HKCU Run 项指向原始 EXE 而非临时目录；注销/登录验证。任务管理器禁用后回到面板应关闭，重新开启后恢复；关闭后不再启动。
6. Windows：移动 EXE 后从新位置启动并重新开启，核对同名登录项更新为新路径，没有重复项。

实际注销/登录验收尚未执行，因此清单保留未完成标记。
