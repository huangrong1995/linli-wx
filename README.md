# 邻里闲置小程序版 (linli-wx)

基于现有 Django 项目 `linli` 的微信原生小程序前端。复用其后端模型与管理员审核体系，通过新增的 DRF JSON API 交互。

## 架构

- 后端：`linli` 新增 `api` 应用（DRF + Token 认证 + `UserProfile.openid`），沿用现有 `Item/Transaction/Favorite/Notification` 模型、状态机与 PIL 图片压缩。
- 前端：本仓库（微信原生小程序，WXML/WXSS/JS），`utils/request.js` 封装 `wx.request`，`utils/auth.js` 管理登录态。
- 管理员审核保留在 Django 后台（`UserProfile.status` 审批），小程序内不重复实现。

## 本地联调

1. **起后端**（`linli` 仓库，feat/wx-api 分支）：

   ```bash
   cd /home/hrong/workspace/code/linli
   source venv/bin/activate
   python manage.py migrate
   python manage.py runserver 0.0.0.0:8000
   ```

2. **导入小程序**：微信开发者工具导入本仓库目录 `linli-wx`，AppID 用 `touristappid`（测试号）或真实值。

3. **改后端地址**：`utils/constants.js` 的 `BASE_URL` 指向后端根（本地默认 `http://127.0.0.1:8000`）。

4. **开发期**：开发者工具「详情 → 本地设置 → 勾选『不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书』」。

5. **登录流程**：启动后小程序静默 `wx.login` → 后端 `/api/auth/wx-login/` 换 token 建/绑定用户 → 小程序内填资料（`/api/auth/profile/`）→ 后台审批 `UserProfile.status=approved` → 之后可发布/交易/收藏。

## 上线注意

- `BASE_URL` 改为已备案 HTTPS 域名，并在小程序后台配置 request/uploadFile 合法域名。
- 后端填真实 `WECHAT_APPID` / `WECHAT_SECRET`（`linli/neighbor_swap/settings.py`），否则 `code2session` 走 `dev_<code>` 开发兜底。
- AppID 改为正式值。

## 已实现 API（后端 `linli/api/`）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | `/api/auth/wx-login/` | 微信 code 换 token + 用户 | 公开 |
| GET | `/api/auth/me/` | 当前用户资料 | 登录 |
| POST | `/api/auth/profile/` | 完善/更新资料 | 登录 |
| POST | `/api/auth/logout/` | 登出（删 token） | 登录 |
| GET/POST | `/api/items/` | 列表(筛选/搜索/分页) / 发布 | 列表公开，发布需审核 |
| GET/DELETE | `/api/items/<id>/` | 详情 / 删除(仅 owner) | 详情公开 |
| GET | `/api/items/mine/` | 我的发布 | 登录 |
| GET | `/api/items/favorites/` | 我的收藏 | 登录 |
| POST/DELETE | `/api/items/<id>/favorite/` | 收藏/取消收藏 | 审核 |
| POST | `/api/items/<id>/transactions/` | 发起交易 | 审核 |
| GET | `/api/transactions/my-requests/` | 我发起的交易 | 登录 |
| GET | `/api/transactions/my-received/` | 我收到的交易 | 登录 |
| POST | `/api/transactions/<id>/confirm\|complete\|cancel/` | 交易状态操作 | 登录+角色 |
| GET | `/api/notifications/` | 通知列表 | 登录 |
| GET | `/api/notifications/unread-count/` | 未读数 | 登录 |
| POST | `/api/notifications/<id>/read/` | 标记已读 | 登录 |
