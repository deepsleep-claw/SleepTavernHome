# 发布约定

- 通用更新器使用 `script-updater-v<version>` Tag。
- 现代化界面使用 `modern-ui-v<version>` Tag。
- Tag 必须指向已经包含对应 `dist` 产物的提交，创建后不得移动、覆盖或删除。
- `manifest.json` 只在对应 Tag 和入口文件已经可访问后更新。
- 第一版仅发布 `stable` 通道。
- 所有版本号、Tag 前缀和入口路径统一维护在 `release/versions.json`，`pnpm run validate:updates`
  会检查 Manifest、安装脚本和构建产物是否一致。
- 构建新版本期间，Manifest 的稳定版可以暂时落后于
  `release/versions.json`，但不能领先；这样才能先验证精确 Tag 的 CDN 产物，再安全推进稳定版指针。
- 酒馆助手导入文件以 `release/模板/酒馆助手脚本-脚本模板.json` 为基础生成。插件在 `release/versions.json` 的 `installer`
  中声明固定脚本 ID、说明、仓库内输出路径和 ASCII Release 附件名。

## 安装与启动链路

酒馆助手导入文件不再引用任何插件专用引导器。它只包含当前发布版本的配置，并直接导入精确 Tag
下的通用更新器锚点：

1. 导入脚本加载 `script-updater-v*` 对应的通用更新器。
2. 通用更新器读取 `manifest.json`，需要时切换到同一 API 主版本下更新的稳定版更新器。
3. 通用更新器读取酒馆助手脚本变量中的已启用版本；首次启动没有状态时使用导入文件内置的当前正式版本。
4. 通用更新器导入正式插件入口，并将更新控制器和面板组件交给插件。

这样，安装包只承担锚定和配置职责；检测更新、选择正式脚本以及更新器自身升级都由通用模块负责。

## Tag 脚本附件

`.github/workflows/release_script.yaml` 会响应所有 Tag，但只处理与插件 `tagPrefix`
匹配的 Tag。当前唯一会生成酒馆助手脚本的前缀是 `modern-ui-v`；更新器 Tag 和未知前缀会直接跳过。

匹配成功时，工作流会校验 Tag 版本与 `release/versions.json`
的当前版本完全一致，把通用更新器锚点和该精确 Tag 的正式脚本 fallback 写入导入文件，并同时上传为工作流产物和对应 GitHub
Release 的附件。Release 使用 `installer.releaseAsset` 声明的 ASCII 文件名，避免中文附件名被 GitHub CLI 清洗。

后续版本按以下顺序发布：

1. 合并源代码但暂不修改 Manifest，等待 `[bot] bundle` 提交生成正式 `dist`。
2. 若更新器版本发生变化，先在同一个正式构建提交创建 `script-updater-v*`，确认其精确 Tag 的 jsDelivr 入口可访问。
3. 在该提交创建插件版本 Tag。Tag 推送后，脚本附件工作流会自动生成并上传酒馆助手导入文件。
4. 确认插件精确 Tag 的 jsDelivr 入口和 GitHub Release 附件均可访问。
5. 单独更新 `manifest.json`，将 `stable` 指向已经验证的版本。
