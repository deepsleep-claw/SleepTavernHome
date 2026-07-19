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
  中声明固定脚本 ID、说明和输出路径。

## Tag 脚本附件

`.github/workflows/release_script.yaml` 会响应所有 Tag，但只处理与插件 `tagPrefix`
匹配的 Tag。当前唯一会生成酒馆助手脚本的前缀是 `modern-ui-v`；更新器 Tag 和未知前缀会直接跳过。

匹配成功时，工作流会校验 Tag 版本与 `release/versions.json`
的当前版本完全一致，将该精确 Tag 的引导器地址写入导入脚本，并同时上传为工作流产物和对应 GitHub
Release 的附件。由于引导器也是从同一 Tag 构建，它内置的 fallback 就是这次发布的当前版本。

首次发布时仓库尚无安装用户，可以让初始 Manifest 与产物一同落地。后续版本按以下顺序发布：

1. 合并源代码但暂不修改 Manifest，等待 `[bot] bundle` 提交生成正式 `dist`。
2. 在该提交创建对应插件的版本 Tag；Tag 推送后，脚本附件工作流会自动生成并上传酒馆助手导入文件。仅在更新器自身发布时创建新的
   `script-updater-v*`，它不会生成插件脚本。
3. 确认精确 Tag 的 jsDelivr 入口和 GitHub Release 中的酒馆助手脚本均可访问。
4. 单独更新 `manifest.json`，将 `stable` 指向已经验证的版本。
