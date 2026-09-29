# 邻里闲置小程序版设计 — linli-wx

日期：2026-09-29
状态：已获用户批准（2026-09-29）

## 概述

基于现有 Django 项目 `linli`（邻里闲置物品流转系统）开发微信原生小程序版。后端在原 `linli` 项目内新增 DRF JSON API；前端为微信原生小程序，放在新仓库 `linli-wx`。复用现有数据模型、审核治理、图片压缩与缓存机制。

## 目标与范围

用户侧核心闭环 + 通知/搜索/收藏等增强功能：

- 浏览 / 类型筛选 / 搜索物品
- 物品详情、发起交易
- 发布物品（传图，走现有 PIL 压缩）
- 交易流程：请求 → 确认 → 完成 / 取消
- 我的物品、我的交易（两栏：我发起的 / 我收到的）、我的收藏
- 个人资料 + 审核中提示
- 站内通知（新交易 / 状态变更 / 审核结果）
- 管理员审核保留在现有 Web 后台（`/admin/`），不在小程序内重建

非目标：管理员功能、支付、物流、微信订阅消息（v1 用站内通知，订阅消息列为后续）。

## 技术栈与依赖

- 后端沿用 `linli`：Django 6.0 / Python 3.13 / SQLite(WAL)
- 新增后端依赖：`djangorestframework` + `django.contrib.authtoken`
- 前端：微信原生小程序（WXML / WXSS / JS）

## 仓库划分

| 仓库 | 内容 |
|------|------|
| `linli` | 后端全部改动：`api` 新应用、`core` 模型增量迁移、DRF 配置 |
| `linli-wx` | 小程序前端全部代码（本仓库） |

## 数据模型变更（`linli`，增量迁移）

- **`UserProfile`**：新增 `openid` 字段（`CharField(max_length=64, blank=True, db_index=True)`）。把微信 openid 挂在项目已有的用户扩展上，避免改动 Django 内置 `User`。
- **`Item`**：不变。
- **`Transaction`**：不变。
- **新增 `Favorite`**：
  - `user` FK → User，`item` FK → Item，`created_at`
  - `unique_together = (user, item)`
- **新增 `Notification`**：
  - `user` FK → User，`type`（`new_transaction` / `confirmed` / `completed` / `cancelled` / `approval`），`content`，`related_item` FK→Item(可空)，`is_read`，`created_at`
  - `db_index` on `user` 与 `is_read`

状态机沿用原项目：
- `Item`: `available → reserved → completed`；可 `cancelled` 回 `available`
- `Transaction`: `pending → confirmed → completed`；任意可 `cancelled`

## API 端点（DRF，全部 `/api/`，JSON）

认证方式：`django.contrib.authtoken` 的 Token 认证；登录后客户端存 token 到本地，请求带 `Authorization: Token <token>`。

### 认证
- `POST /api/auth/wx-login/` — body `{code}`。后端用 AppID+Secret 调微信 `jscode2session` 换 `openid`；find-or-create `UserProfile`（`user.username = wx_<openid 前8>`，密码随机不可用）；发 Token。返回 `{token, user:{username, status}, need_profile, status}`。`need_profile=true` 当 openid 已存在但资料字段（phone/community/building/room）未填。
- `POST /api/auth/profile/` — 需登录。body `{phone, community, building, room, email?}`。已审核用户更新资料保持 approved；新用户/未填资料用户写入后置 `status=pending` 待审核（若此前为 rejected 需管理员重新通过）。发审核通知邮件（复用现有 `send_register_notification`）。
- `GET /api/auth/me/` — 需登录。返回当前用户 + 审核状态。
- `POST /api/auth/logout/` — 需登录。吊销当前 token。

### 物品
- `GET /api/items/` — 公开。`?type=sale|lend|rent|all`（默认 all）、`?q=` 搜索 title/description、`?page=`。仅返回 `status=available`。DRF 分页（20/页）。沿用原 5 分钟列表缓存（键含 type/页；关键词搜索不缓存或独立键）。
- `GET /api/items/<id>/` — 公开。详情 + owner 信息（username/community/building/room）+ 当前登录用户是否已收藏 `is_favorited`。
- `POST /api/items/` — 需登录+已审核。multipart：`item_type/title/description/price/contact_phone/image`。走 `signals.py` PIL 压缩。创建后清物品列表缓存。
- `DELETE /api/items/<id>/` — 仅 owner。清缓存。
- `GET /api/items/mine/` — 需登录。我发布的物品（含非 available 状态）。
- `GET /api/items/favorites/` — 需登录。我的收藏列表。
- `POST /api/items/<id>/favorite/` / `DELETE /api/items/<id>/favorite/` — 需登录。收藏 / 取消收藏（幂等）。

### 交易（需登录+已审核）
- `POST /api/items/<id>/transactions/` — body `{message?}`。禁止与自己的物品交易。创建 pending 交易，写入 `new_transaction` 通知给 item owner。
- `GET /api/transactions/my-requests/` — 我发起的交易（含物品与对方信息）。
- `GET /api/transactions/my-received/` — 我收到的交易（我物品上的交易）。
- `POST /api/transactions/<id>/confirm/` — 仅 owner。trans→confirmed，item→reserved，清缓存，通知 requester（confirmed）。
- `POST /api/transactions/<id>/complete/` — 仅 owner。trans→completed，item→completed，清缓存，通知 requester（completed）。
- `POST /api/transactions/<id>/cancel/` — requester 或 owner。trans→cancelled，item→available，清缓存，通知对方（cancelled）。

### 通知
- `GET /api/notifications/?unread=1` — 我的通知列表（可分页）。
- `POST /api/notifications/<id>/read/` — 标记已读。
- `GET /api/notifications/unread-count/` — 未读数（角标）。
- 写入时机：新交易请求→owner；确认/完成→requester；取消→对方；管理员审核通过/拒绝→本人（approval）。

## 权限

- 浏览（物品列表/详情）：公开，无需登录。
- 发布、交易、收藏：自定义 `IsApproved` 权限类，要求 `request.user` 已登录且 `profile.status == approved`。
- 通知、个人资料、我的物品/交易：需登录即可（不要求 approved，审核中用户可查看自己的资料与待审核提示）。

## 图片

复用现有 `core/signals.py` 的 `Item.pre_save` PIL 压缩（>1200×1200 或非 JPEG/PNG 压缩，RGBA 转 RGB）。小程序 `wx.chooseMedia` 选图后 multipart 上传。

## 小程序前端结构（`linli-wx`）

```
linli-wx/
├── app.js / app.json / app.wxss / sitemap.json
├── project.config.json           # AppID 占位
├── utils/
│   ├── request.js                # 封装 wx.request：拼 baseURL、带 token、统一错误/401 处理、上传
│   └── auth.js                   # token 存储、登录态判断
└── pages/
    ├── index/                    # 物品列表：类型 tab + 搜索 + 上拉分页 + 收藏心形
    ├── detail/                   # 详情 + 发起交易留言弹窗
    ├── publish/                  # 发布物品（chooseMedia 传图）
    ├── mine/                     # 我的（入口：我的物品/我的收藏/我的交易/通知/资料）
    ├── my-items/                 # 我的发布列表 + 删除
    ├── favorites/                # 我的收藏列表
    ├── my-transactions/          # 两栏：我发起的 / 我收到的 + 状态操作按钮
    ├── notify/                   # 通知列表 + 未读角标
    └── profile/                  # 个人资料 / 完善资料（pending 引导）
```

关键交互：
- 启动静默 `wx.login()` → 拿 code → `wx-login`；`need_profile` → 跳 profile 完善资料。
- 审核中（pending）用户仅可浏览，不能发布/交易；approved 后全功能。
- 交易列表按角色分两栏，owner 侧可 confirm/complete，双方可 cancel。

## 配置变更（`linli/neighbor_swap/settings.py`）

- `INSTALLED_APPS` += `rest_framework`, `django.contrib.authtoken`, `api`
- `REST_FRAMEWORK` 默认：`TokenAuthentication` + `IsAuthenticated`（视图级覆盖为公开的用 `AllowAny`）
- 新增 `WECHAT_APPID` / `WECHAT_SECRET`（生产必填，开发可占位）
- `ALLOWED_HOSTS` 视需要加入小程序域名

## 部署注意

微信小程序正式版要求请求域名 **ICP 备案** 且在小程序后台配置 request 合法域名。现有免费 Cloudflare tunnel 域名 `my.huangrong95.dpdns.org` 未备案，正式版会被拦截。开发期在微信开发者工具勾选"不校验合法域名"即可跑通。上正式需备案域名 + 填 `WECHAT_APPID`/`WECHAT_SECRET`。此项不阻塞开发。

## 测试

用 DRF `APITestCase` 覆盖（原 `core/tests.py` 为空占位，本次为 API 补测试）：
- wx-login（含 openid find-or-create、need_profile 分支）
- 审核门禁（未 approved 不能发布/交易）
- 物品列表/筛选/搜索/详情
- 收藏增删与幂等
- 交易状态机（确认/完成/取消 + 状态联动 + 缓存清理）
- 通知生成与已读

## 后续（非 v1）

微信订阅消息推送、搜索高亮/联想、图片多张、管理端小程序化、支付。

## 设计复核

自审已做（见下）；无占位、无矛盾、范围聚焦单个实现计划。
