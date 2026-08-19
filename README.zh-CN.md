<p align="center">
  <img src="assets/icons/icon-128.png" width="88" alt="X Likes Search 图标">
</p>

<h1 align="center">X Likes Search</h1>

<p align="center">
  在本地搜索和浏览你在 X / Twitter 点过赞的内容。<br>
  私密、快速，不依赖服务器。
</p>

<p align="center">
  <a href="https://github.com/liyincode/x-likes-search/releases/latest"><img src="https://img.shields.io/github/v/release/liyincode/x-likes-search?display_name=tag&style=flat-square" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/liyincode/x-likes-search?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
</p>

<p align="center">
  <a href="https://github.com/liyincode/x-likes-search/releases/latest"><strong>下载最新版本</strong></a>
  ·
  <a href="README.md">English</a>
</p>

![X Likes Search 的 Posts 和 Photos 视图](assets/readme-screenshot.png)

如果你经常把点赞当作收藏，后来想找回某条内容时，通常只能不断向下翻。X Likes Search 会在本地建立一份私密索引，让你几秒钟内找到它，并在同一个画廊里浏览所有点赞图片。

## 功能

- **快速本地搜索**：搜索推文内容、作者昵称和用户名。
- **图片画廊**：响应式浏览、大图预览、键盘切换，并可返回 X 查看原推文。
- **安全同步**：添加最新点赞；只有在确认到达时间线末尾后，才会移除已经取消点赞的记录。
- **本地优先**：没有服务器、遥测或数据上传。
- **JSON 导出**：备份保存在本地的点赞索引。

### 图片画廊实览

![X Likes Search 本地点赞图片画廊](assets/gallery-screenshot.webp)

## 安装

1. 打开[最新 Release](https://github.com/liyincode/x-likes-search/releases/latest) 并下载 zip 文件。
2. 解压下载好的 zip 文件。
3. 在 Chrome 中打开 `chrome://extensions/`。
4. 打开右上角的 **开发者模式**。
5. 点击 **加载已解压的扩展程序**。
6. 选择刚刚解压出来的 `x-likes-search` 文件夹。
7. 可以把扩展图标固定到浏览器工具栏，方便之后打开。

> Chrome 可能会提示“请只安装来自可信来源的扩展”。这个扩展是本地运行的，数据只保存在你的浏览器里。

如果你是 clone 这个仓库，也可以在点击 **加载已解压的扩展程序** 后，直接选择这个项目文件夹。

## 使用方法

### 第一次使用

1. 打开你的 X 点赞页面：`https://x.com/i/history/likes`。
2. 等待页面完成一次加载。这一步会让扩展捕获 X 加载点赞列表时的请求信息。
3. 点击浏览器工具栏里的 **X Likes Search** 扩展图标，打开搜索页面。
4. 点击搜索页面右上角的 **sync**，开始同步点赞内容。

同步完成后，你可以搜索以前点过赞的推文，也可以切换到 **Photos** 浏览点赞中的图片。

### 搜索点赞内容

- 在搜索框输入关键词，结果会即时过滤。
- 可以搜索推文内容、作者昵称、用户名。
- 支持按最新、最旧、作者排序。
- 双击推文卡片可以打开原推文。
- 后续再次点击 **sync** 会重新核对当前 Likes：添加最新点赞，并在安全到达末页后移除已经取消点赞的记录。

### 浏览点赞图片

- 从 **Posts** 切换到 **Photos**，可以查看当前筛选结果里的全部图片。
- 搜索和排序会先作用于原推文，再展示这些推文中的图片。
- 点击图片可以打开大图预览，并通过方向键或界面按钮在完整结果集中切换。
- 图片会保留原推文上下文，点击 **open on X** 可以回到对应推文。
- 如果从 `0.5.0` 之前的版本升级，需要执行一次完整同步，为已经保存在本地的点赞补齐图片元数据。

## 工作原理

1. 访问 X Likes 页面时，扩展会捕获浏览器本来就会发出的已认证 Likes 请求。
2. 扩展的 Service Worker 直接向 X 重放该请求，并根据时间线游标继续分页。
3. 解析出的推文和图片元数据保存在 Chrome 的本地扩展存储中，搜索页面直接从本地读取。

捕获的请求模板和点赞索引始终保留在扩展内部。只有在你主动开始同步时，扩展才会向 X 发送请求。

## 隐私与权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 在 Chrome 本地保存请求模板、点赞索引和同步状态。 |
| `unlimitedStorage` | 防止较大的本地索引触及 Chrome 默认的扩展存储容量限制。 |
| `tabs` | 打开或切换到扩展搜索页、原推文和 X Likes 设置页。 |
| 访问 `x.com` 和 `twitter.com` | 捕获 Likes 请求，并直接向 X 发送同步请求。 |

- 项目没有后端服务器，也没有遥测。
- 扩展不会读取或保存你的密码。
- 点赞索引不会上传到任何地方。
- 已认证请求模板只保存在 Chrome 扩展存储中，并且只用于和 X 通信。

## 常见问题

### 数据会上传吗？

不会。这个工具没有服务器，点赞内容保存在 Chrome 的本地扩展存储里。

### 为什么第一次要打开 X 的 likes 页面？

因为扩展需要捕获你浏览器自己向 X 请求点赞列表时的认证信息。捕获之后，同步可以在扩展页面里完成，不需要一直开着 X 页面。

### 如果同步失败怎么办？

如果遇到认证失败、HTTP 403 之类的问题，通常是捕获的信息过期了。重新打开 `History → Likes`，等待页面加载一次，然后回到扩展页面重新点击 **sync**。如果还没有捕获请求，点击 **sync** 会自动为你打开 Likes 页面。

## 注意事项

- X 的点赞列表是分页加载的，特别久以前的点赞不一定每次都能完整返回。
- 如果同步中途被 X 限流，可以等几分钟后再继续同步。同步进度会按页保存。
- 只有在成功识别 Likes 时间线并安全到达真正末页后，同步才会删除已经取消点赞的本地记录；中断或不完整的同步绝不会删除本地数据。
- 如果 X 改了内部接口返回格式，扩展可能需要更新后才能继续使用。

## 开发

这个项目是一个 Manifest V3 Chrome 扩展，没有构建步骤，可以直接作为未打包扩展加载。

```bash
npm install
npm run typecheck
npm run test:unit
npm run test:visual
npm run test:perf
npm test
```

扩展源码仍然是普通 HTML、CSS 和原生 ES Module。TypeScript 通过 JSDoc 检查全部运行时 JavaScript 模块，不生成构建产物；Chrome 仍直接加载源码，不需要 bundler 或生成 `dist/` 目录。

如果需要报告安全问题，请遵循 [SECURITY.md](SECURITY.md) 中的私下披露流程。

## License

[MIT](LICENSE) © Young
