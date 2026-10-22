# v0.2.0

扩展可控性修复 + 工具链与文档补齐。

## 扩展修复

### 新增 `tabs.close` 命令

之前无法关闭标签页 —— 只能让用户手动关。现在支持：

```
{ "cmd": "tabs", "method": "close", "tabId": 12345 }
```

双路降级：

1. `chrome.tabs.remove`（优先）
2. content script 的 `window.close()`（前者不可用时回退）

### 新增 Service Worker 唤醒钩子

**症状**：桥接服务重启后，扩展无法自行重连。表现是 `tools/list` 正常返回 17 个工具，但实际调用报：

```
No browser tabs connected. Make sure the CDP Bridge extension is installed
and the bridge server is running.
```

**根因**：MV3 的 Service Worker 空闲时会被冻结，`chrome.alarms` 定时器随之停摆 —— 重连探针不再执行。

**修复**：用浏览器事件作为唤醒源，任何用户活动都会唤醒 Service Worker 并重试连接。

```js
function ensureConnected() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState <= 1) return;   // 正在连接中
  connectWS();
}

chrome.tabs.onActivated.addListener(() => ensureConnected());
chrome.tabs.onUpdated.addListener(() => ensureConnected());
chrome.tabs.onCreated.addListener(() => ensureConnected());
chrome.tabs.onRemoved.addListener(() => ensureConnected());
chrome.windows.onFocusChanged.addListener(() => ensureConnected());
```

---

## 新增工具

| 文件 | 用途 |
|---|---|
| `scripts/oh-browser.js` | 命令行客户端，便于脚本化与调试 |
| `scripts/verify-mcp.js` | 端到端自检：握手 / 工具清单 / 桥接在线 / 扩展连接 / 标签页可读 |
| `scripts/update-to-v0.2.0.sh` | 增量更新脚本（POSIX sh，Alpine 可直接运行） |
| `examples/minimal-agent.js` | 零依赖 MCP 客户端示例，展示完整调用流程 |
| `docs/integration-guide.md` | 完整接入文档（部署、协议、排障速查表） |
| `README_EN.md` | 英文文档 |
| `CHANGELOG.md` | 变更记录 |

### 自检输出示例

```
  PASS  initialize 握手  ->  cdp-bridge-ohos v1.0.0
  PASS  tools/list 返回工具  ->  17 个
  PASS  关键工具齐全  ->  全部 17 个就位
  PASS  桥接服务在线  ->  ok=true
  PASS  扩展已连接  ->  connections=1
  PASS  可操控标签页  ->  1 个: Example Domain

全部通过 ✓
```

---

## 兼容性

- `src/mcp-stdio.js` —— 与 v0.1.23 **完全一致**（零 diff）
- `src/extension/content.js` —— 与 v0.1.23 **完全一致**（零 diff）
- `src/bridge-server.js` —— 仅注释文案差异
- `README.md` —— 未改动
- `src/cdp_bridge/`（Python 实现）、`reports/`、`doc/`、`images/` —— 全部保留

本次为**增量发布**，不破坏既有目录结构与 API。

---

## 环境要求

| 项 | 要求 |
|---|---|
| 操作系统 | HarmonyOS 6+ / OpenHarmony，或 Linux（Alpine 需 musl 版 Node）|
| 浏览器 | 支持 Chrome MV3 扩展的国产内核浏览器 |
| Node.js | 18+（Alpine 用 `apk add nodejs`）|
| 端口 | `18765`（WS）、`18766`（控制面）|

**零第三方依赖** —— 无需 `npm install`。

---

## 安装

### 1. 加载扩展

浏览器扩展管理页开启开发者模式，加载 `src/extension/` 目录。

### 2. 接入 MCP 客户端

```json
{
  "mcpServers": {
    "cdp-bridge-ohos": {
      "command": "node",
      "args": ["/绝对路径/src/mcp-stdio.js"],
      "env": {
        "CDP_BRIDGE_WS_PORT": "18765",
        "CDP_BRIDGE_CTRL_PORT": "18766"
      }
    }
  }
}
```

### 3. 验证

```sh
node scripts/verify-mcp.js
```

> 扩展代码改动后，需在 `chrome://extensions` 点「刷新」才生效 —— 内容脚本有资源缓存，仅刷新网页无效。

---

## 已知限制

| 能力 | 状态 | 说明 |
|---|---|---|
| `chrome.debugger`（CDP） | 不可用 | 国产内核上 `debugger.attach` 永久挂起 |
| `chrome.scripting` | 不稳定 | 部分内核挂起，扩展已内置降级 |
| 严格 CSP 页面的 `browser_execute_js` | 不可用 | MV3 禁 `unsafe-eval`，改用 `browser_dom` |
| 可靠截图 | 受限 | 目标标签页非前台时会失败 |

详见 `docs/integration-guide.md` 的排障速查表。

---

## 致谢

- [**CDP Bridge MCP**](https://github.com/Unagi-cq/cdp-bridge-mcp)（作者 cq_huang，MIT License）—— 本项目是针对 OpenHarmony 环境的适配与 Node 零依赖重写
