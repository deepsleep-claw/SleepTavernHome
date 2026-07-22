# 酒馆助手前端界面或脚本编写

@.cursor/rules/项目基本概念.mdc
@.cursor/rules/mcp.mdc
@.cursor/rules/酒馆变量.mdc
@.cursor/rules/酒馆助手接口.mdc
@.cursor/rules/前端界面.mdc
@.cursor/rules/脚本.mdc
<<<<<<< HEAD
@.cursor/rules/正则界面.mdc
@.cursor/rules/mvu变量框架.mdc
@.cursor/rules/mvu角色卡.mdc

编译时，使用 pnpm run build，而非 build:dev，除非用户明确说明。

## 正式发版流程

1. 先确认要发布的插件及其 `release/versions.json` 配置。Tag 必须使用该插件的 `tagPrefix`；现代化界面使用
   `modern-ui-v<version>`，例如 `modern-ui-v0.1.2`，不得使用裸 `v0.1.2`。
2. 将目标插件版本写入 `release/versions.json`，但此时不要提前修改 `manifest.json` 的 `stable` 版本。
3. 执行 `pnpm run build` 生成已嵌入目标版本的正式 `dist`。刚升级版本时，第一次构建可能只在最后的
   `validate:updates` 因导入文件仍是旧版本而失败；必须确认此前的检查和 webpack 构建均成功，再继续下一步。
4. 生成对应的酒馆助手导入文件。现代化界面使用：
   `node util/build_tagged_script.mjs --tag modern-ui-v<version> --repository deepsleep-claw/SleepTavernHome`。
5. 再次执行完整的 `pnpm run build`，这一次包括 `validate:updates` 在内必须全部成功。Tag 必须指向已经包含正式
   `dist` 产物、版本清单和导入文件的提交。
6. 检查 `git status` 与差异，只提交本次源代码、版本配置、导入文件及正式构建产物，不混入无关的监听构建或用户改动。
7. 提交并先推送分支，再在同一提交创建带说明的 Tag，例如：
   `git tag -a modern-ui-v0.1.2 -m "现代化界面 v0.1.2"`，随后单独推送该 Tag。Tag 创建后不得移动或覆盖。
8. 本仓库只允许使用已经配置好的 `origin` SSH 地址执行 `git push`；不得切换 GitHub 账号、改写 Git 身份，或使用本地
   `gh`/GitHub App 代替该 SSH 远端写入。
9. 确认 Tag 已到达远端，并确认 `.github/workflows/release_script.yaml` 成功生成 GitHub Release 与附件。精确 Tag 的
   jsDelivr 入口和 Release 附件可访问后，再单独更新 `manifest.json`，将 `stable` 推进到新版本并另行提交、推送。
=======
@.cursor/rules/mvu变量框架.mdc
@.cursor/rules/mvu角色卡.mdc
>>>>>>> f24091c9a91d583dafdb4867d858268ebc487545
