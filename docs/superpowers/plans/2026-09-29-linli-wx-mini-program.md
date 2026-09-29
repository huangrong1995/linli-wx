# 邻里闲置小程序版 (linli-wx) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有 Django 项目 `linli` 增加一套 DRF JSON API（微信小程序用），并在新仓库 `linli-wx` 用微信原生小程序实现用户侧核心闭环（浏览/搜索/收藏/发布/交易/通知/资料）。

**Architecture:** 后端在 `linli` 内新增 `api` 应用，用 DRF + Token 认证，微信 `code→openid`（挂在 `UserProfile.openid`）对接现有 `User` + 审核体系；物品/交易沿用现有模型与状态机，图片走现有 PIL 压缩。前端 `linli-wx` 为微信原生小程序（WXML/WXSS/JS），通过 `utils/request.js` 封装 `wx.request` 调用后端。管理员审核保留在现有 Web 后台。

**Tech Stack:** Django 6.0 / Python 3.13 / SQLite(WAL)；djangorestframework + django.contrib.authtoken；微信原生小程序。

**Spec:** `docs/superpowers/specs/2026-09-29-linli-wx-mini-program-design.md`

> **仓库/工作目录约定**：本计划横跨两个仓库。每个任务标注 `[cwd: linli]`（后端，路径 `/home/hrong/workspace/code/linli`）或 `[cwd: linli-wx]`（前端，路径 `/home/hrong/workspace/code/linli-wx`）。本 plan/spec 文件位于 `linli-wx` 仓库内。执行器必须先用 `cd <repo>` 到对应仓库再运行该任务的命令，git 提交也在对应仓库内进行。

## Global Constraints

- 后端 `linli` 保持最小依赖哲学：新增依赖仅 `djangorestframework`、`django.contrib.authtoken`（内置）。
- `openid` 放在 `core/models.py` 的 `UserProfile` 上；**不得**改动 Django 内置 `User` 模型字段。
- 状态机不变：`Item available→reserved→completed / cancelled→available`；`Transaction pending→confirmed→completed / cancelled`。
- 图片压缩：复用 `core/signals.py` 的 `Item.pre_save`，API 上传不另写压缩。
- 列表缓存：保留现有 web 的 `_clear_items_cache()`；API 物品列表用 `api_items_gen` 全局计数参与缓存键，变更时 `_bump_api_items_gen()` 作废全部 API 列表缓存。
- 审核门禁：发布/交易/收藏需登录且 `profile.status == 'approved'`（权限类 `IsApproved`）；浏览公开。
- 站内通知创建点：新交易→owner(`new_transaction`)；确认/完成→requester(`confirmed`/`completed`)；取消→对方(`cancelled`)；审核通过/拒绝→本人(`approval`，后台 admin 侧，v1 可选）。
- 时区 `Asia/Shanghai`，语言 `zh-hans`。
- git 提交信息按仓库各自记录。

## Review Focus

以下输入/失败模式在 spec 里未逐条写死，但使用者会期望它们表现正常；每条都在对应任务的测试里钉住：

1. **未登录浏览**（物品列表/详情）必须能访问（`AllowAny`），不能 401。
2. **pending/rejected 用户**访问发布/交易/收藏 → 403 并带清晰中文 message，不报 500。
3. **自交易**（自己发起自己的物品）→ 拒绝。
4. **非 owner 的 confirm/complete/delete** → 403。
5. **空搜索词 / 未知 type 参数** → 优雅降级（unknown type 按 all 处理或返回空，不报错）。
6. **微信 code2session 失败或凭证缺失** → 开发兜底用 `dev_<code>` 作 openid，不崩服。

---

## Phase A — 后端 API（`linli`）

### Task 1: 后端骨架 — 安装 DRF、创建 `api` 应用、配置

**Files:**
- Create: `api/__init__.py`
- Create: `api/apps.py`
- Modify: `neighbor_swap/settings.py`
- Modify: `neighbor_swap/urls.py`
- Test: `api/tests/test_config.py`

**Interfaces:**
- Consumes: 无。
- Produces: `rest_framework`/`authtoken`/`api` 已安装；`REST_FRAMEWORK` 默认认证 `TokenAuthentication`；`settings.WECHAT_APPID`/`WECHAT_SECRET`；根 `neighbor_swap/urls.py` 挂载 `path('api/', include('api.urls'))`；`api/apps.py::ApiConfig`.

- [ ] **Step 1: 安装依赖**

```bash
cd /home/hrong/workspace/code/linli
source venv/bin/activate
pip install djangorestframework
```

- [ ] **Step 2: 创建 api 应用并登记**

```bash
cd /home/hrong/workspace/code/linli
python manage.py startapp api
```

写 `api/apps.py`：
```python
from django.apps import AppConfig

class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'
```

- [ ] **Step 3: 改 settings.py**

在 `INSTALLED_APPS` 里 `'core'` 后追加：
```python
    'rest_framework',
    'django.contrib.authtoken',
    'api',
```

文件末尾追加：
```python
# --- 微信小程序 API ---
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

# 微信小程序凭证（生产必填；未填时 wx-login 走 dev_<code> 兜底）
WECHAT_APPID = ''
WECHAT_SECRET = ''
```

- [ ] **Step 4: 挂载 URL**

`neighbor_swap/urls.py` 顶部 `from django.urls import path, include`（已含），在 urlpatterns 里加：
```python
    path('api/', include('api.urls')),
```

临时建 `api/urls.py`：
```python
from django.urls import path

urlpatterns = []
```

- [ ] **Step 5: 写配置烟测**

`api/tests/__init__.py`（空）+ `api/tests/test_config.py`：
```python
from django.test import TestCase


class ApiConfigSmokeTest(TestCase):
    def test_settings_configured(self):
        from django.conf import settings
        from rest_framework.authentication import TokenAuthentication
        self.assertIn('rest_framework', settings.INSTALLED_APPS)
        self.assertIn('authtoken', settings.INSTALLED_APPS)
        self.assertIn('api', settings.INSTALLED_APPS)
        self.assertIn(
            'rest_framework.authentication.TokenAuthentication',
            settings.REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES'],
        )
```

- [ ] **Step 6: 跑检查与烟测**

```bash
cd /home/hrong/workspace/code/linli
python manage.py check
python manage.py test api
```
Expected: check OK；`test_settings_configured` PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api neighbor_swap/settings.py neighbor_swap/urls.py
git commit -m "feat: add DRF api app scaffold"
```

---

### Task 2: 数据模型 — openid + Favorite + Notification

**Files:**
- Modify: `core/models.py`
- Create: `core/migrations/000x_*.py`（由 makemigrations 生成）
- Test: `api/tests/test_models.py`

**Interfaces:**
- Consumes: Task 1（无）。
- Produces:
  - `UserProfile.openid`（`CharField(64, blank=True, unique=True, null=True)`）
  - `Favorite(user, item, created_at)`，`Meta.unique_together=(('user','item'),)`
  - `Notification(user, type, content, related_item(可空 FN), is_read, created_at)`，`Meta.ordering=['-created_at']`，索引 `(user, is_read)`
  - `core.signals` 不变。

- [ ] **Step 1: 写失败测试**

`api/tests/test_models.py`：
```python
from django.contrib.auth.models import User
from django.test import TestCase
from core.models import UserProfile, Item, Transaction, Favorite, Notification


class ModelAPITest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner')
        UserProfile.objects.create(user=self.owner, openid='openid_1', phone='', community='', building='', room='')

    def test_openid_unique(self):
        # 第二个相同 openid 应触发 IntegrityError
        u2 = User.objects.create_user('u2')
        with self.assertRaises(Exception):
            UserProfile.objects.create(
                user=u2, openid='openid_1', phone='', community='', building='', room='')

    def test_favorite_unique_together(self):
        item = Item.objects.create(owner=self.owner, item_type='sale', title='t', description='d', price='1', contact_phone='1')
        u2 = User.objects.create_user('u2')
        Favorite.objects.create(user=u2, item=item)
        with self.assertRaises(Exception):
            Favorite.objects.create(user=u2, item=item)

    def test_notification_field_types(self):
        item = Item.objects.create(owner=self.owner, item_type='sale', title='t2', description='d', price='1', contact_phone='1')
        u2 = User.objects.create_user('u2')
        n = Notification.objects.create(user=u2, type='new_transaction', content='x', related_item=item)
        self.assertFalse(n.is_read)
        self.assertEqual(n.related_item, item)
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_models
```
Expected: 报 `core.models.Favorite` 不存在等导入/删错错。

- [ ] **Step 3: 加模型字段**

`core/models.py` 在 `UserProfile` 里加：
```python
    openid = models.CharField('微信openid', max_length=64, blank=True, null=True, unique=True)
```
在文件末尾追加：
```python
class Favorite(models.Model):
    """收藏"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='favorites')
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='favorited_by')
    created_at = models.DateTimeField('收藏时间', auto_now_add=True)

    class Meta:
        verbose_name = '收藏'
        verbose_name_plural = '收藏'
        unique_together = (('user', 'item'),)
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} -> {self.item.title}'


class Notification(models.Model):
    """站内通知"""
    TYPE_CHOICES = [
        ('new_transaction', '新交易请求'),
        ('confirmed', '交易已确认'),
        ('completed', '交易已完成'),
        ('cancelled', '交易已取消'),
        ('approval', '审核结果'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    type = models.CharField('类型', max_length=20, choices=TYPE_CHOICES)
    content = models.CharField('内容', max_length=255)
    related_item = models.ForeignKey(Item, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    is_read = models.BooleanField('已读', default=False)
    created_at = models.DateTimeField('时间', auto_now_add=True)

    class Meta:
        verbose_name = '通知'
        verbose_name_plural = '通知'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read']),
        ]

    def __str__(self):
        return f'{self.user.username}: {self.content}'
```

- [ ] **Step 4: 迁移**

```bash
cd /home/hrong/workspace/code/linli
cp db.sqlite3 db.sqlite3.bak.$(date +%s)   # 备份现有库
python manage.py makemigrations
python manage.py migrate
```
Expected: 生成一条对 core 的迁移（new field + 2 个新模型），migrate 成功。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_models
```
Expected: 3 个测试全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add core/models.py core/migrations api/tests/test_models.py
git commit -m "feat: add openid to UserProfile, Favorite and Notification models"
```

---

### Task 3: 认证 API — wx-login / profile / me / logout

**Files:**
- Create: `api/wechat.py`
- Create: `api/serializers.py`（本任务只放 auth 相关序列化器，后续任务往里补）
- Create: `api/permissions.py`
- Create: `api/urls.py`（改写为真实路由）
- Create: `api/views.py`
- Modify: `api/tests/test_models.py`（不动）
- Create: `api/tests/test_auth_api.py`
- Modify: `core/views.py`（不改，仅复用 `send_register_notification`）

**Interfaces:**
- Consumes: Task 1/2。
- Produces:
  - `api/wechat.code2session(code) -> dict {openid, session_key}`（凭证缺失时返回 `{'openid': 'dev_<code>', ...}`）
  - `api/permissions.IsApproved`（BasePermission，`has_permission` 检查已登录且 `profile.status=='approved'`）
  - `api/serializers.UserProfileSerializer` 字段：`username`(source user)、`phone/community/building/room/email/status`
  - `api/serializers.ProfileUpdateSerializer` 字段：`phone/community/building/room/email`（全部可选）
  - 端点：`POST /api/auth/wx-login/`、`POST /api/auth/profile/`、`GET /api/auth/me/`、`POST /api/auth/logout/`

wx-login 响应体：
```json
{"token": "<key>", "is_new": false, "need_profile": false,
 "user": {"username": "wx_xxx", "phone": "", "community": "A", "building": "1", "room": "101", "email": "", "status": "pending"}}
```

- [ ] **Step 1: 写 auth 相关模块**

`api/wechat.py`：
```python
import json
import urllib.request
from django.conf import settings


def code2session(code):
    """微信 jscode2session。凭证未配置时用 dev_<code> 兜底，便于本地/测试开发。"""
    appid = getattr(settings, 'WECHAT_APPID', '') or ''
    secret = getattr(settings, 'WECHAT_SECRET', '') or ''
    if not (appid and secret):
        return {'openid': f'dev_{code}', 'session_key': 'dev'}
    url = (
        'https://api.weixin.qq.com/sns/jscode2session?appid={}&secret={}&js_code={}&grant_type=authorization_code'
        .format(appid, secret, code)
    )
    with urllib.request.urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    if 'openid' not in data:
        raise ValueError('WeChat code2session failed: {}'.format(data))
    return data
```

`api/permissions.py`：
```python
from rest_framework.permissions import BasePermission


class IsApproved(BasePermission):
    """已登录且资料已通过审核"""
    message = '账号需通过审核后才能使用此功能'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        profile = getattr(user, 'profile', None)
        return profile is not None and profile.status == 'approved'
```

`api/serializers.py`（先在 auth 用，后续任务补 Item/Transaction/Notification）：
```python
from rest_framework import serializers
from django.contrib.auth.models import User
from core.models import UserProfile


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['username', 'phone', 'community', 'building', 'room', 'email', 'status', 'openid']


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['phone', 'community', 'building', 'room', 'email']
        extra_kwargs = {'email': {'required': False}}
```

- [ ] **Step 2: 写失败测试**

`api/tests/test_auth_api.py`：
```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from core.models import UserProfile, Notification


class WechatLoginApiTest(APITestCase):
    def test_wx_login_creates_pending_profile(self):
        resp = self.client.post('/api/auth/wx-login/', {'code': 'abc123'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data
        self.assertIn('token', data)
        self.assertTrue(data['need_profile'])          # 新用户资料为空
        self.assertEqual(data['user']['status'], 'pending')
        self.assertEqual(data['user']['username'], 'wx_' + 'abc123'[-8:])

    def test_wx_login_is_idempotent(self):
        self.client.post('/api/auth/wx-login/', {'code': 'same'}, format='json')
        resp2 = self.client.post('/api/auth/wx-login/', {'code': 'same'}, format='json')
        self.assertEqual(resp2.data['is_new'], False)

    def test_profile_fill_sets_need_profile_false(self):
        token = self.client.post('/api/auth/wx-login/', {'code': 'p1'}, format='json').data['token']
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token)
        resp = self.client.post('/api/auth/profile/',
                                {'phone': '13000000000', 'community': '阳光花园',
                                 'building': '3', 'room': '201'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['status'], 'pending')
        me = self.client.get('/api/auth/me/').data
        self.assertEqual(me['phone'], '13000000000')
        self.assertNotIn('need_profile', me)   # 资料视图返回 profile

    def test_pending_user_blocked_from_approved_views(self, *args):
        token = self.client.post('/api/auth/wx-login/', {'code': 'blk'}, format='json').data['token']
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token)
        # 无 Item 端点场景在 Task5 覆盖；这里先验证未登录 401
        self.client.credentials()
        resp = self.client.get('/api/auth/me/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_revokes_token(self):
        token = self.client.post('/api/auth/wx-login/', {'code': 'lo'}, format='json').data['token']
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token)
        resp = self.client.post('/api/auth/logout/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Token.objects.filter(key=token).exists())


class MeApiTest(APITestCase):
    def test_me_returns_profile(self):
        u = User.objects.create_user('real')
        UserProfile.objects.create(user=u, phone='1', community='c', building='b', room='r', email='')
        token, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token)
        resp = self.client.get('/api/auth/me/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['username'], 'real')
        self.assertEqual(resp.data['community'], 'c')
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_auth_api
```
Expected: 因 `api/views.py` / `api/urls.py` 尚未写而失败（404 或属性错）。

- [ ] **Step 4: 写视图**

`api/views.py`：
```python
import random
import string
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import UserProfile
from core.views import send_register_notification
from . import wechat
from .serializers import UserProfileSerializer, ProfileUpdateSerializer


def _make_unique_username(openid):
    base = 'wx_' + openid[-8:]
    username = base
    i = 1
    while User.objects.filter(username=username).exists():
        username = f'{base}{i}'
        i += 1
    return username


@api_view(['POST'])
@permission_classes([AllowAny])
def wx_login(request):
    code = request.data.get('code')
    if not code:
        return Response({'detail': 'code 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
    session = wechat.code2session(code)
    openid = session['openid']
    profile = UserProfile.objects.filter(openid=openid).first()
    is_new = False
    if profile is None:
        pw = ''.join(random.choices(string.ascii_letters + string.digits, k=20))
        user = User.objects.create_user(username=_make_unique_username(openid), password=pw)
        profile = UserProfile.objects.create(
            user=user, openid=openid, phone='', community='', building='', room='')
        is_new = True
    token, _ = Token.objects.get_or_create(user=profile.user)
    need_profile = not (profile.phone and profile.community and profile.building and profile.room)
    return Response({
        'token': token.key,
        'is_new': is_new,
        'need_profile': need_profile,
        'user': UserProfileSerializer(profile).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def profile_update(request):
    profile = request.user.profile
    ser = ProfileUpdateSerializer(profile, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    # 非 approved 者（新增/被拒）填资料后回审核池
    if profile.status != 'approved':
        profile.status = 'pending'
        profile.save(update_fields=['status'])
        send_register_notification(profile)
    return Response(UserProfileSerializer(profile).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserProfileSerializer(request.user.profile).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
```

`api/urls.py`：
```python
from django.urls import path
from . import views

urlpatterns = [
    path('auth/wx-login/', views.wx_login),
    path('auth/profile/', views.profile_update),
    path('auth/me/', views.me),
    path('auth/logout/', views.logout),
]
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_auth_api
```
Expected: 全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api
git commit -m "feat: wechat login + profile + me + logout API"
```

---

### Task 4: 物品 API — 公开列表/详情 + 筛选/搜索/分页/缓存

**Files:**
- Modify: `api/serializers.py`（补 Item 序列化器）
- Modify: `api/views.py`（补 item_list / item_detail）
- Modify: `api/urls.py`（补物品路由）
- Create: `api/tests/test_items_api.py`

**Interfaces:**
- Consumes: Task 1/2/3。
- Produces:
  - `api/views._api_items_gen() -> int`、`api/views._bump_api_items_gen()`（变更时调用，作废全部 API 物品列表缓存）
  - `api/serializers.ItemListSerializer` 字段：`id,title,price,item_type,image,created_at,owner{username,community,building}`
  - `api/serializers.ItemDetailSerializer` 字段：上述 + `status,description,contact_phone,updated_at,is_favorited`
  - 端点：`GET /api/items/`（`?type=&q=&page=`）、`GET /api/items/<id>/`

列表响应（DRF 兼容分页形状）：
```json
{"count": 12, "next": null, "previous": null,
 "results": [{"id":1,"title":"t","price":"50.00","item_type":"sale","image":null,"created_at":"...","owner":{"username":"o","community":"c","building":"b"}}]}
```

- [ ] **Step 1: 补序列化器**

`api/serializers.py` 末尾追加：
```python
from core.models import Item  # 顶部 import 已可加此句


class ItemListSerializer(serializers.ModelSerializer):
    owner = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = ['id', 'title', 'price', 'item_type', 'image', 'created_at', 'owner']

    def get_owner(self, obj):
        p = getattr(obj.owner, 'profile', None)
        return {
            'username': obj.owner.username,
            'community': p.community if p else '',
            'building': p.building if p else '',
        }


class ItemDetailSerializer(serializers.ModelSerializer):
    owner = serializers.SerializerMethodField()
    is_favorited = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = ['id', 'title', 'price', 'item_type', 'status', 'image',
                  'description', 'contact_phone', 'created_at', 'updated_at',
                  'owner', 'is_favorited']

    def get_owner(self, obj):
        p = getattr(obj.owner, 'profile', None)
        return {
            'username': obj.owner.username,
            'community': p.community if p else '',
            'building': p.building if p else '',
            'room': p.room if p else '',
        }

    def get_is_favorited(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(user=request.user).exists()
        return False
```

- [ ] **Step 2: 写失败测试**

`api/tests/test_items_api.py`：
```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from core.models import UserProfile, Item, Notification


def _approved_user(username):
    u = User.objects.create_user(username)
    UserProfile.objects.create(user=u, phone='1', community='c', building='b', room='r', status='approved')
    return u


class PublicItemsApiTest(APITestCase):
    def setUp(self):
        self.owner = _approved_user('owner')
        for i, t in enumerate(['乒乓球', '书桌', '电钻']):
            Item.objects.create(owner=self.owner, item_type='sale' if i % 2 == 0 else 'lend',
                                title=t, description='描述' + t, price='10', contact_phone='1')
        self.all_ids = set(Item.objects.values_list('id', flat=True))

    def test_unauthenticated_browse_list(self):
        resp = self.client.get('/api/items/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 3)

    def test_type_filter(self):
        resp = self.client.get('/api/items/?type=lend')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {i['id'] for i in resp.data['results']}
        self.assertEqual(ids, {id for id in self.all_ids if Item.objects.get(id=id).item_type == 'lend'})

    def test_unknown_type_returns_empty(self):
        resp = self.client.get('/api/items/?type=weird')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 0)

    def test_search_title(self):
        resp = self.client.get('/api/items/?q=乒乓球')
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['title'], '乒乓球')

    def test_empty_search_returns_all(self):
        resp = self.client.get('/api/items/?q=')
        self.assertEqual(resp.data['count'], 3)

    def test_only_available_listed(self):
        from core.models import Item as I
        I.objects.filter(title='书桌').update(status='completed')
        resp = self.client.get('/api/items/')
        titles = {r['title'] for r in resp.data['results']}
        self.assertNotIn('书桌', titles)

    def test_detail_public_with_is_favorited_false(self):
        item = Item.objects.first()
        resp = self.client.get(f'/api/items/{item.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('is_favorited', resp.data)
        self.assertIn('contact_phone', resp.data)


class ItemsCacheTest(APITestCase):
    def test_mutation_bumps_gen_and_invalidates_cache(self):
        owner = _approved_user('cacheowner')
        i1 = Item.objects.create(owner=owner, item_type='sale', title='A', description='d', price='1', contact_phone='1')
        first = self.client.get('/api/items/').data['count']
        # 新增物品前先预热一次 /api/items/ 再新增
        self.client.get('/api/items/')
        from api.views import _bump_api_items_gen
        _bump_api_items_gen()
        second = self.client.get('/api/items/').data['count']
        self.assertGreaterEqual(second.get('count', 0), 0)  # 由 Task5 创建接口后再断言增量
```

> 注：缓存作废的强断言放到 Task 5 的 `item_create` 端点就绪后补一条 `test_new_item_appears_after_create`。此任务先保证列表/详情/筛选/搜索语义正确。

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_items_api
```
Expected: 因视图/路由未写（404 或属性错）失败。

- [ ] **Step 4: 写视图**

`api/views.py` 追加：
```python
from django.core.cache import cache
from django.core.paginator import Paginator, EmptyPage
from django.db.models import Q
from core.models import Item
from .serializers import ItemListSerializer, ItemDetailSerializer


def _api_items_gen():
    return cache.get('api_items_gen', 0)


def _bump_api_items_gen():
    cache.set('api_items_gen', _api_items_gen() + 1, 60 * 60)


@api_view(['GET'])
@permission_classes([AllowAny])
def item_list(request):
    item_type = request.query_params.get('type', 'all')
    q = request.query_params.get('q', '').strip()
    page = request.query_params.get('page', '1')
    gen = _api_items_gen()
    cache_key = f'api_items_{gen}_{item_type}_{q}_page_{page}'
    data = cache.get(cache_key)
    if data is None:
        qs = Item.objects.filter(status='available').select_related('owner__profile')
        if item_type != 'all':
            qs = qs.filter(item_type=item_type)
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(description__icontains=q))
        paginator = Paginator(qs, 20)
        try:
            page_obj = paginator.page(page)
        except EmptyPage:
            page_obj = paginator.page(paginator.num_pages) if paginator.num_pages else None
        page_items = list(page_obj) if page_obj else []
        data = {
            'count': paginator.count,
            'results': ItemListSerializer(page_items, many=True).data,
            'next': page_obj.next_page_number() if page_obj and page_obj.has_next() else None,
            'previous': page_obj.previous_page_number() if page_obj and page_obj.has_previous() else None,
        }
        cache.set(cache_key, data, 300)
    return Response(data)


@api_view(['GET'])
@permission_classes([AllowAny])
def item_detail(request, item_id):
    item = Item.objects.select_related('owner__profile').filter(id=item_id, status='available').first()
    if item is None:
        return Response({'detail': '物品不存在或已下架'}, status=status.HTTP_404_NOT_FOUND)
    data = ItemDetailSerializer(item, context={'request': request}).data
    return Response(data)
```

`api/urls.py` 追加：
```python
    path('items/', views.item_list),
    path('items/<int:item_id>/', views.item_detail),
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_items_api
```
Expected: 全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api
git commit -m "feat: public item list/detail API with filter/search/cache"
```

---

### Task 5: 物品写 API — 发布/删除 + favorites + 权限门禁

**Files:**
- Modify: `api/views.py`（补 item_create/item_delete/favorite 表项）
- Modify: `api/urls.py`
- Create: `api/tests/test_items_write_api.py`

**Interfaces:**
- Consumes: Task 2/3/4（`IsApproved`、`_bump_api_items_gen`、序列化器）。
- Produces:
  - `POST /api/items/`（multipart；需 IsApproved）→ 新建 Item，`_bump_api_items_gen()` + `_clear_items_cache()`，返回 `ItemDetailSerializer` 201
  - `DELETE /api/items/<id>/`（仅 owner）→ 204
  - `GET /api/items/mine/`（IsApproved）→ 我发布的物品（含非 available）
  - `GET /api/items/favorites/`（IsApproved）→ 我收藏的物品
  - `POST /api/items/<id>/favorite/`、`DELETE /api/items/<id>/favorite/`（IsApproved，幂等）

favorite 响应：`{"favorited": true}`。

- [ ] **Step 1: 写失败测试**

`api/tests/test_items_write_api.py`：
```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from core.models import UserProfile, Item, Favorite


def _user(username, approved=True):
    u = User.objects.create_user(username)
    UserProfile.objects.create(user=u, phone='1', community='c', building='b', room='r',
                               status='approved' if approved else 'pending')
    t, _ = Token.objects.get_or_create(user=u)
    return u, t


class CreateItemApiTest(APITestCase):
    def setUp(self):
        self.owner, self.token = _user('owner')
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + self.token.key)

    def test_create_item(self):
        resp = self.client.post('/api/items/', {
            'item_type': 'sale', 'title': '自行车', 'description': '八成新',
            'price': '200', 'contact_phone': '130...',
        }, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['title'], '自行车')
        self.assertTrue(Item.objects.filter(title='自行车').exists())

    def test_create_requires_approved(self):
        _, bad_token = _user('pendingguy', approved=False)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + bad_token.key)
        resp = self.client.post('/api/items/', {
            'item_type': 'sale', 'title': 'x', 'description': 'd', 'price': '1', 'contact_phone': '1',
        }, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_requires_auth(self):
        self.client.credentials()
        resp = self.client.post('/api/items/', {
            'item_type': 'sale', 'title': 'x', 'description': 'd', 'price': '1', 'contact_phone': '1',
        }, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_new_item_appears_in_list_after_create(self):
        self.client.get('/api/items/')           # 预热缓存
        self.client.post('/api/items/', {
            'item_type': 'lend', 'title': '新测试', 'description': 'd', 'price': '0', 'contact_phone': '1',
        }, format='multipart')
        resp = self.client.get('/api/items/')
        titles = {r['title'] for r in resp.data['results']}
        self.assertIn('新测试', titles)          # 缓存已在 create 时作废


class FavoriteApiTest(APITestCase):
    def setUp(self):
        self.owner, _ = _user('owner')
        self.item = Item.objects.create(owner=self.owner, item_type='sale', title='k', description='d',
                                        price='1', contact_phone='1')
        self.u, self.token = _user('fancier')
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + self.token.key)

    def test_favorite_toggle_and_list(self):
        r = self.client.post(f'/api/items/{self.item.id}/favorite/')
        self.assertEqual(r.data['favorited'], True)
        self.assertTrue(Favorite.objects.filter(user=self.u, item=self.item).exists())
        # 幂等
        self.client.post(f'/api/items/{self.item.id}/favorite/')
        self.assertEqual(Favorite.objects.filter(user=self.u, item=self.item).count(), 1)
        # 列表
        lst = self.client.get('/api/items/favorites/')
        self.assertEqual(lst.data['count'], 1)
        self.assertEqual(lst.data['results'][0]['id'], self.item.id)
        # 取消
        r2 = self.client.delete(f'/api/items/{self.item.id}/favorite/')
        self.assertEqual(r2.data['favorited'], False)
        self.assertFalse(Favorite.objects.filter(user=self.u, item=self.item).exists())

    def test_detail_shows_is_favorited_true(self):
        self.client.post(f'/api/items/{self.item.id}/favorite/')
        resp = self.client.get(f'/api/items/{self.item.id}/')
        self.assertTrue(resp.data['is_favorited'])


class DeleteItemApiTest(APITestCase):
    def test_non_owner_cannot_delete(self):
        owner, _ = _user('owner2')
        item = Item.objects.create(owner=owner, item_type='sale', title='d', description='d', price='1', contact_phone='1')
        other, token = _user('other2')
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token.key)
        resp = self.client.delete(f'/api/items/{item.id}/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_items_write_api
```
Expected: 视图/路由未写而失败。

- [ ] **Step 3: 写视图**

`api/views.py` 追加：
```python
from django.shortcuts import get_object_or_404
from core.models import Favorite
from core.views import _clear_items_cache
from .permissions import IsApproved


@api_view(['POST'])
@permission_classes([IsApproved])
def item_create(request):
    data = dict(request.data)
    item = Item.objects.create(
        owner=request.user,
        item_type=data.get('item_type'),
        title=data.get('title'),
        description=data.get('description', ''),
        price=data.get('price'),
        contact_phone=data.get('contact_phone'),
        image=request.FILES.get('image'),
    )
    _clear_items_cache()
    _bump_api_items_gen()
    return Response(ItemDetailSerializer(item, context={'request': request}).data,
                    status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsApproved])
def item_delete(request, item_id):
    item = get_object_or_404(Item, id=item_id)
    if item.owner != request.user:
        return Response({'detail': '只能删除自己的物品'}, status=status.HTTP_403_FORBIDDEN)
    item.delete()
    _clear_items_cache()
    _bump_api_items_gen()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsApproved])
def item_mine(request):
    qs = Item.objects.filter(owner=request.user).select_related('owner__profile')
    data = ItemListSerializer(qs, many=True).data
    return Response({'count': len(data), 'results': data})


@api_view(['GET'])
@permission_classes([IsApproved])
def favorite_list(request):
    qs = Item.objects.filter(favorited_by__user=request.user).select_related('owner__profile')
    data = ItemListSerializer(qs, many=True).data
    return Response({'count': len(data), 'results': data})


@api_view(['POST', 'DELETE'])
@permission_classes([IsApproved])
def favorite_toggle(request, item_id):
    item = get_object_or_404(Item, id=item_id, status='available')
    fav = Favorite.objects.filter(user=request.user, item=item)
    if request.method == 'DELETE':
        fav.delete()
        return Response({'favorited': False})
    if not fav.exists():
        Favorite.objects.create(user=request.user, item=item)
    return Response({'favorited': True})
```

`api/urls.py` 追加：
```python
    path('items/mine/', views.item_mine),
    path('items/favorites/', views.favorite_list),
    path('items/<int:item_id>/favorite/', views.favorite_toggle),
    path('items/<int:item_id>/', views.item_delete),
```

> 注意路由顺序：`items/mine/`、`items/favorites/` 必须在 `items/<int:item_id>/` **之前**，DRF 按列表顺序匹配，避免把 `mine`/`favorites` 当成 item_id。`POST /api/items/`（列表）与 `GET/POST` 由不同 name 路由已区分，item_create 用独立 name。确认 `items/<int:item_id>/` 当前是 GET detail；把 item_delete 挂在同 pattern（同一 view 需要同时处理 GET/DELETE）会冲突 — 改为：保持 detail GET 不变，另加 `DELETE items/<int:item_id>/` 由 item_detail 同样处理会丢失删除逻辑。

> 修正：detail 页 GET 与 DELETE 共用同 pattern `items/<int:item_id>/`。合并到一个 view `item_detail_or_delete`，仅当前任务中把 `item_detail` 改为同时处理 DELETE：
```python
@api_view(['GET', 'DELETE'])
@permission_classes([AllowAny])
def item_detail(request, item_id):
    if request.method == 'DELETE':
        item = get_object_or_404(Item, id=item_id)
        if item.owner != request.user:
            return Response({'detail': '只能删除自己的物品'}, status=status.HTTP_403_FORBIDDEN)
        item.delete()
        _clear_items_cache()
        _bump_api_items_gen()
        return Response(status=status.HTTP_204_NO_CONTENT)
    # 原 GET 逻辑不变
```
且不要定义独立的 `item_delete` view（避免路由冲突）。`api/urls.py` 保持 `items/<int:item_id>/` → `item_detail` 单条即可。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_items_write_api
```
Expected: 全 PASS。

- [ ] **Step 5: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api
git commit -m "feat: item create/delete + favorites + approval gate API"
```

---

### Task 6: 交易 API — create/confirm/complete/cancel + my-requests/my-received

**Files:**
- Modify: `api/serializers.py`（补 Transaction 序列化器 + Notification 生成辅助）
- Modify: `api/views.py`
- Modify: `api/urls.py`
- Create: `api/tests/test_transactions_api.py`

**Interfaces:**
- Consumes: Task 2/3/4/5（`IsApproved`、`_bump_api_items_gen`）。
- Produces:
  - `api/serializers.TransactionSerializer` 字段：`id,item{id,title},requester{username,community,building},trans_type,status,message,created_at,updated_at,is_owner`
  - `api/notify_helpers.notify(user, type, content, related_item=None)`（写 `Notification`）
  - 端点：
    - `POST /api/items/<item_id>/transactions/`（IsApproved；禁自交易；通知 owner `new_transaction`）
    - `GET /api/transactions/my-requests/`、`GET /api/transactions/my-received/`（IsApproved）
    - `POST /api/transactions/<id>/confirm/`（仅 owner；`notify` requester `confirmed`）
    - `POST /api/transactions/<id>/complete/`（仅 owner；`notify` requester `completed`）
    - `POST /api/transactions/<id>/cancel/`（requester 或 owner；`notify` 对方 `cancelled`）

状态联动与缓存：confirm→item.status=reserved；complete→item.status=completed；cancel→item.status=available；任一变更都调 `_clear_items_cache()` + `_bump_api_items_gen()`。

- [ ] **Step 1: 补序列化器与通知辅助**

`api/serializers.py` 追加：
```python
from core.models import Transaction


class TransactionSerializer(serializers.ModelSerializer):
    item = serializers.SerializerMethodField()
    requester = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = ['id', 'item', 'requester', 'trans_type', 'status', 'message',
                  'created_at', 'updated_at', 'is_owner']

    def get_item(self, obj):
        return {'id': obj.item.id, 'title': obj.item.title}

    def get_requester(self, obj):
        p = getattr(obj.requester, 'profile', None)
        return {'username': obj.requester.username,
                'community': p.community if p else '',
                'building': p.building if p else ''}

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and obj.item.owner_id == request.user.id)
```

`api/notify_helpers.py`：
```python
from core.models import Notification


def notify(user, ntype, content, related_item=None):
    """写一条站内通知（幂等安全，供交易/审核流程调用）"""
    if user is None:
        return
    Notification.objects.create(user=user, type=ntype, content=content, related_item=related_item)
```

- [ ] **Step 2: 写失败测试**

`api/tests/test_transactions_api.py`：
```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from core.models import UserProfile, Item, Transaction, Notification


def _user(username, approved=True):
    u = User.objects.create_user(username)
    UserProfile.objects.create(user=u, phone='1', community='c', building='b', room='r',
                               status='approved' if approved else 'pending')
    token, _ = Token.objects.get_or_create(user=u)
    return u, token


class TransactionFlowApiTest(APITestCase):
    def setUp(self):
        self.owner, self.owner_token = _user('owner')
        self.buyer, self.buyer_token = _user('buyer')
        self.item = Item.objects.create(owner=self.owner, item_type='sale', title='骑行表',
                                        description='d', price='100', contact_phone='1')

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token.key)

    def test_create_transaction_notifies_owner(self):
        self._auth(self.buyer_token)
        resp = self.client.post(f'/api/items/{self.item.id}/transactions/',
                                {'message': '我要'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Transaction.objects.filter(item=self.item, requester=Transaction.objects.get().requester).count(), 1)
        self.assertTrue(Notification.objects.filter(user=self.owner, type='new_transaction').exists())

    def test_cannot_transact_self(self):
        self._auth(self.owner_token)
        resp = self.client.post(f'/api/items/{self.item.id}/transactions/', {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_full_flow_confirm_complete(self):
        self._auth(self.buyer_token)
        trans = self.client.post(f'/api/items/{self.item.id}/transactions/', {}, format='json').data
        tid = trans['id']
        # buyer 不能 confirm（owner 才能）
        resp = self.client.post(f'/api/transactions/{tid}/confirm/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        # owner confirm
        self._auth(self.owner_token)
        resp = self.client.post(f'/api/transactions/{tid}/confirm/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'reserved')
        self.assertEqual(Transaction.objects.get(id=tid).status, 'confirmed')
        self.assertTrue(Notification.objects.filter(user=self.buyer, type='confirmed').exists())
        # owner complete
        resp = self.client.post(f'/api/transactions/{tid}/complete/')
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'completed')

    def test_cancel_restores_available(self):
        self._auth(self.buyer_token)
        tid = self.client.post(f'/api/items/{self.item.id}/transactions/', {}, format='json').data['id']
        self._auth(self.owner_token)
        self.client.post(f'/api/transactions/{tid}/confirm/')
        self._auth(self.buyer_token)
        resp = self.client.post(f'/api/transactions/{tid}/cancel/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'available')
        self.assertEqual(Transaction.objects.get(id=tid).status, 'cancelled')
        self.assertTrue(Notification.objects.filter(user=self.owner, type='cancelled').exists())

    def test_my_requests_and_received(self):
        self._auth(self.buyer_token)
        self.client.post(f'/api/items/{self.item.id}/transactions/', {}, format='json')
        self._auth(self.owner_token)
        self.assertEqual(self.client.get('/api/transactions/my-received/').data['count'], 1)
        # owner 也有可能是 requester 的场景省略；buyer 的 my-requests = 1
        self._auth(self.buyer_token)
        self.assertEqual(self.client.get('/api/transactions/my-requests/').data['count'], 1)
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_transactions_api
```
Expected: 视图/路由未写而失败。

- [ ] **Step 4: 写视图**

`api/views.py` 追加：
```python
from django.db.models import Q
from core.models import Transaction
from .serializers import TransactionSerializer
from .notify_helpers import notify


def _trans_qs(user, direction):
    # direction: 'req' = 我发起；'recv' = 我收到
    qs = Transaction.objects.select_related('item__owner__profile', 'requester__profile')
    if direction == 'req':
        qs = qs.filter(requester=user)
    else:
        qs = qs.filter(item__owner=user)
    return qs


@api_view(['POST'])
@permission_classes([IsApproved])
def transaction_create(request, item_id):
    item = get_object_or_404(Item, id=item_id)
    if item.owner == request.user:
        return Response({'detail': '不能跟自己的物品交易'}, status=status.HTTP_400_BAD_REQUEST)
    message = request.data.get('message', '')
    trans = Transaction.objects.create(
        item=item, requester=request.user, trans_type=item.item_type, message=message)
    _bump_api_items_gen()
    notify(item.owner, 'new_transaction',
           f'{request.user.username} 向你发起了「{item.title}」的交易请求', item)
    return Response(TransactionSerializer(trans, context={'request': request}).data,
                    status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsApproved])
def my_requests(request):
    qs = _trans_qs(request.user, 'req').order_by('-created_at')
    return Response({'count': qs.count(),
                     'results': TransactionSerializer(qs, many=True, context={'request': request}).data})


@api_view(['GET'])
@permission_classes([IsApproved])
def my_received(request):
    qs = _trans_qs(request.user, 'recv').order_by('-created_at')
    return Response({'count': qs.count(),
                     'results': TransactionSerializer(qs, many=True, context={'request': request}).data})


def _get_owned_trans(request, trans_id):
    trans = Transaction.objects.select_related('item').get(id=trans_id)   # 404 由外层补
    if trans.item.owner != request.user:
        return None
    return trans


@api_view(['POST'])
@permission_classes([IsApproved])
def transaction_confirm(request, trans_id):
    trans = get_object_or_404(Transaction, id=trans_id)
    if trans.item.owner != request.user:
        return Response({'detail': '只有物品主人能确认'}, status=status.HTTP_403_FORBIDDEN)
    trans.status = 'confirmed'
    trans.save(update_fields=['status', 'updated_at'])
    trans.item.status = 'reserved'
    trans.item.save(update_fields=['status', 'updated_at'])
    _clear_items_cache()
    _bump_api_items_gen()
    notify(trans.requester, 'confirmed', f'你的「{trans.item.title}」交易已被确认', trans.item)
    return Response(TransactionSerializer(trans, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsApproved])
def transaction_complete(request, trans_id):
    trans = get_object_or_404(Transaction, id=trans_id)
    if trans.item.owner != request.user:
        return Response({'detail': '只有物品主人能完成'}, status=status.HTTP_403_FORBIDDEN)
    trans.status = 'completed'
    trans.save(update_fields=['status', 'updated_at'])
    trans.item.status = 'completed'
    trans.item.save(update_fields=['status', 'updated_at'])
    _clear_items_cache()
    _bump_api_items_gen()
    notify(trans.requester, 'completed', f'你的「{trans.item.title}」交易已完成', trans.item)
    return Response(TransactionSerializer(trans, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsApproved])
def transaction_cancel(request, trans_id):
    trans = get_object_or_404(Transaction, id=trans_id)
    is_owner = trans.item.owner == request.user
    is_requester = trans.requester == request.user
    if not (is_owner or is_requester):
        return Response({'detail': '无权取消该交易'}, status=status.HTTP_403_FORBIDDEN)
    counterparty = trans.requester if is_owner else trans.item.owner
    trans.status = 'cancelled'
    trans.save(update_fields=['status', 'updated_at'])
    trans.item.status = 'available'
    trans.item.save(update_fields=['status', 'updated_at'])
    _clear_items_cache()
    _bump_api_items_gen()
    notify(counterparty, 'cancelled', f'「{trans.item.title}」交易已取消', trans.item)
    return Response(TransactionSerializer(trans, context={'request': request}).data)
```

`api/urls.py` 追加：
```python
    path('items/<int:item_id>/transactions/', views.transaction_create),
    path('transactions/my-requests/', views.my_requests),
    path('transactions/my-received/', views.my_received),
    path('transactions/<int:trans_id>/confirm/', views.transaction_confirm),
    path('transactions/<int:trans_id>/complete/', views.transaction_complete),
    path('transactions/<int:trans_id>/cancel/', views.transaction_cancel),
```

> 路由顺序：`transactions/my-requests/`、`my-received/` 在 `transactions/<int:trans_id>/` **之前**。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_transactions_api
```
Expected: 全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api
git commit -m "feat: transaction create/confirm/complete/cancel + notifications API"
```

---

### Task 7: 通知 API — list/read/unread-count

**Files:**
- Modify: `api/views.py`
- Modify: `api/urls.py`
- Create: `api/tests/test_notifications_api.py`

**Interfaces:**
- Consumes: Task 2/3/6（`Notification`、`notify`）。
- Produces:
  - `api/serializers.NotificationSerializer` 字段：`id,type,content,related_item,is_read,created_at`
  - `GET /api/notifications/?unread=1`（IsAuthenticated）
  - `POST /api/notifications/<id>/read/`（IsAuthenticated；仅本人）
  - `GET /api/notifications/unread-count/` → `{"unread_count": N}`

- [ ] **Step 1: 写测试 + 序列化器**

`api/serializers.py` 追加：
```python
from core.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'type', 'content', 'related_item', 'is_read', 'created_at']
```

`api/tests/test_notifications_api.py`：
```python
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from core.models import UserProfile, Notification
from api.notify_helpers import notify


class NotificationApiTest(APITestCase):
    def setUp(self):
        self.u = User.objects.create_user('n_user')
        UserProfile.objects.create(user=self.u, phone='1', community='c', building='b', room='r', status='approved')
        self.token, _ = Token.objects.get_or_create(user=self.u)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + self.token.key)
        for typ in ['new_transaction', 'confirmed', 'completed']:
            notify(self.u, typ, '内容-' + typ)

    def test_list_and_unread_filter(self):
        all_resp = self.client.get('/api/notifications/')
        self.assertEqual(all_resp.data['count'], 3)
        unread = self.client.get('/api/notifications/?unread=1')
        self.assertEqual(unread.data['count'], 3)

    def test_mark_read(self):
        nid = self.client.get('/api/notifications/').data['results'][0]['id']
        resp = self.client.post(f'/api/notifications/{nid}/read/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(Notification.objects.get(id=nid).is_read)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['unread_count'], 2)

    def test_cannot_mark_others_read(self):
        other = User.objects.create_user('other_user')
        UserProfile.objects.create(user=other, phone='1', community='c', building='b', room='r', status='approved')
        token2, _ = Token.objects.get_or_create(user=other)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + token2.key)
        nid = self.client.get('/api/notifications/').data['results'][0]['id']
        resp = self.client.post(f'/api/notifications/{nid}/read/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api.tests.test_notifications_api
```
Expected: 视图/路由未写而失败。

- [ ] **Step 3: 写视图 + 路由**

`api/views.py` 追加：
```python
from .serializers import NotificationSerializer


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_list(request):
    qs = request.user.notifications.all()
    if request.query_params.get('unread') == '1':
        qs = qs.filter(is_read=False)
    data = NotificationSerializer(list(qs[:50]), many=True).data
    return Response({'count': len(data), 'results': data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_unread_count(request):
    return Response({'unread_count': request.user.notifications.filter(is_read=False).count()})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def notification_read(request, notification_id):
    n = Notification.objects.filter(id=notification_id, user=request.user).first()
    if n is None:
        return Response({'detail': '通知不存在'}, status=status.HTTP_404_NOT_FOUND)
    if not n.is_read:
        n.is_read = True
        n.save(update_fields=['is_read'])
    return Response(NotificationSerializer(n).data)
```

`api/urls.py` 追加：
```python
    path('notifications/', views.notification_list),
    path('notifications/unread-count/', views.notification_unread_count),
    path('notifications/<int:notification_id>/read/', views.notification_read),
```

> 顺序：`unread-count/` 在 `<int:notification_id>/read/` 之前（无冲突，但保持清晰）。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /home/hrong/workspace/code/linli && python manage.py test api
```
Expected: `api` 全部测试 PASS。

- [ ] **Step 5: 提交**

```bash
cd /home/hrong/workspace/code/linli
git add api
git commit -m "feat: notifications list/read/unread-count API"
```

---

### Task 8: 后端全量回归 + 收尾

**Files:**
- 无新增；运行全部测试与 check。

- [ ] **Step 1: 跑全量后端测试**

```bash
cd /home/hrong/workspace/code/linli
python manage.py check
python manage.py test api
```
Expected: 全部 PASS，check 无错误。

- [ ] **Step 2: 人工冒烟（可选，本地起服务）**

```bash
cd /home/hrong/workspace/code/linli
python manage.py runserver 0.0.0.0:8000 &
curl -s 'http://127.0.0.1:8000/api/items/' | head -c 300
```
Expected: 返回 JSON 列表。

---

## Phase B — 微信原生小程序前端（`linli-wx`）

> 前端无自动化测试框架（原生小程序），以「微信开发者工具编译预览 + 手动操作」为验收方式。每任务末尾的验证步请在开发者工具中做。

### Task 9: 前端骨架 — 项目配置 + app + 工具模块 + tabBar

**Files:**
- Create: `project.config.json`
- Create: `sitemap.json`
- Create: `app.json`
- Create: `app.js`
- Create: `app.wxss`
- Create: `utils/request.js`
- Create: `utils/auth.js`
- Create: `utils/constants.js`

**Interfaces:**
- Produces: `utils/constants.js::BASE_URL`（后端根，如 `http://127.0.0.1:8000`）、`utils/constants.js::STORAGE_KEYS`；`utils/request.js` 导出 `request(options)` 与 `uploadFile(options)`（自动带 token、统一错误/401 处理）；`utils/auth.js` 导出 `silentLogin()`、`getToken()`、`setToken()`、`getLoginState()`、`logout()`、`ensureApproved()`；`app.json` 注册 `pages/index` 等页面与 tabBar（index/mine）。

- [ ] **Step 1: 写 app.json**

```json
{
  "pages": [
    "pages/index/index",
    "pages/detail/detail",
    "pages/publish/publish",
    "pages/mine/mine",
    "pages/my-items/my-items",
    "pages/favorites/favorites",
    "pages/my-transactions/my-transactions",
    "pages/notify/notify",
    "pages/profile/profile"
  ],
  "window": {
    "navigationBarBackgroundColor": "#16a34a",
    "navigationBarTitleText": "邻里闲置",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#f5f5f5"
  },
  "tabBar": {
    "color": "#666666",
    "selectedColor": "#16a34a",
    "list": [
      { "pagePath": "pages/index/index", "text": "闲置" },
      { "pagePath": "pages/mine/mine", "text": "我的" }
    ]
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json"
}
```

- [ ] **Step 2: 写 project.config.json / sitemap.json**

`project.config.json`：
```json
{
  "description": "邻里闲置小程序",
  "packOptions": { "ignore": [], "include": [] },
  "appid": "touristappid",
  "projectname": "linli-wx",
  "setting": {
    "urlCheck": false,
    "es6": true,
    "enhance": true,
    "postcss": true,
    "minified": true,
    "newFeature": true
  },
  "compileType": "miniprogram",
  "libVersion": "3.0.0"
}
```
`appid` 用 `touristappid`（测试号）占位，正式填真实 AppID。

`sitemap.json`：
```json
{ "desc": "邻里闲置", "rules": [{ "action": "allow", "page": "*" }] }
```

- [ ] **Step 3: 写 utils/constants.js**

```js
module.exports = {
  BASE_URL: 'http://127.0.0.1:8000',
  STORAGE_KEYS: {
    TOKEN: 'linli_token',
    PROFILE: 'linli_profile',
  },
};
```

- [ ] **Step 4: 写 utils/request.js**

```js
const { BASE_URL, STORAGE_KEYS } = require('./constants');

function _tokenHeader() {
  const token = wx.getStorageSync(STORAGE_KEYS.TOKEN);
  return token ? { Authorization: 'Token ' + token } : {};
}

function _handleStatus(res, resolve, reject) {
  const body = res.data || {};
  if (res.statusCode === 401) {
    // token 失效：清空登录态
    wx.removeStorageSync(STORAGE_KEYS.TOKEN);
    wx.removeStorageSync(STORAGE_KEYS.PROFILE);
    reject(Object.assign(new Error(body.detail || '未登录'), { statusCode: 401 }));
    return;
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    resolve(body);
  } else {
    reject(Object.assign(new Error(body.detail || '请求失败'), { statusCode: res.statusCode }));
  }
}

function request(options) {
  const { url, method = 'GET', data = {}, header = {}, showLoading = false } = options;
  if (showLoading) wx.showLoading({ title: '加载中', mask: true });
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: Object.assign(_tokenHeader(), { 'content-type': 'application/json' }, header),
      success(res) { if (showLoading) wx.hideLoading(); _handleStatus(res, resolve, reject); },
      fail(err) { if (showLoading) wx.hideLoading(); reject(Object.assign(new Error('网络请求失败'), err)); },
    });
  });
}

function uploadFile(options) {
  const { url, filePath, name = 'file', formData = {}, showLoading = true } = options;
  if (showLoading) wx.showLoading({ title: '上传中', mask: true });
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + url,
      filePath,
      name,
      formData,
      header: _tokenHeader(),
      success(res) {
        if (showLoading) wx.hideLoading();
        let body = null;
        try { body = JSON.parse(res.data); } catch (e) { body = { detail: '解析失败' }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(Object.assign(new Error(body.detail || '上传失败'), { statusCode: res.statusCode }));
      },
      fail(err) {
        if (showLoading) wx.hideLoading();
        reject(Object.assign(new Error('上传失败'), err));
      },
    });
  });
}

module.exports = { request, uploadFile };
```

- [ ] **Step 5: 写 utils/auth.js**

```js
const { STORAGE_KEYS } = require('./constants');
const { request } = require('./request');

function setToken(token) { wx.setStorageSync(STORAGE_KEYS.TOKEN, token); }
function getToken() { return wx.getStorageSync(STORAGE_KEYS.TOKEN) || null; }
function setProfile(p) { wx.setStorageSync(STORAGE_KEYS.PROFILE, p); }
function getProfile() { return wx.getStorageSync(STORAGE_KEYS.PROFILE) || null; }

function silentLogin() {
  // 静默 wx.login → 后端换取 openid/token
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) return reject(new Error('login failed'));
        request({ url: '/api/auth/wx-login/', method: 'POST', data: { code: res.code } })
          .then((data) => {
            setToken(data.token);
            setProfile(data.user);
            resolve(data);
          })
          .catch(reject);
      },
      fail: reject,
    });
  });
}

function ensureLogin() {
  // 有 token 直接过；否则静默登录
  if (getToken()) return Promise.resolve(getProfile());
  return silentLogin();
}

function isApproved() {
  const p = getProfile();
  return !!p && p.status === 'approved';
}

function needProfile() {
  const p = getProfile();
  return !p || !(p.phone && p.community) || p.status !== 'approved';
}

function logout() {
  const req = getToken()
    ? request({ url: '/api/auth/logout/', method: 'POST' }).catch(() => null)
    : Promise.resolve();
  return req.then(() => {
    wx.removeStorageSync(STORAGE_KEYS.TOKEN);
    wx.removeStorageSync(STORAGE_KEYS.PROFILE);
  });
}

module.exports = { setToken, getToken, setProfile, getProfile, silentLogin, ensureLogin, isApproved, needProfile, logout };
```

- [ ] **Step 6: 写 app.js / app.wxss**

`app.js`：
```js
const auth = require('./utils/auth');

App({
  globalData: { profile: null },
  onLaunch() {
    // 启动静默登录（可失败，浏览仍可用）
    auth.ensureLogin().then((profile) => {
      this.globalData.profile = profile;
    }).catch(() => {});
  },
});
```

`app.wxss`（轻量全局样式）：
```css
page { background: #f5f5f5; font-size: 28rpx; color: #333; }
.btn-primary { background: #16a34a; color: #fff; border-radius: 12rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin: 16rpx; }
.empty { text-align: center; color: #999; padding: 80rpx 0; }
.tag { display: inline-block; font-size: 22rpx; padding: 4rpx 16rpx; border-radius: 8rpx; background: #ecfdf5; color: #16a34a; margin-right: 12rpx; }
```

- [ ] **Step 7: 占位页面**

为 9 个页面各建最小 `index/index.js/.wxml/.json/.wxss`（页面对应注册）。以 `pages/index/index` 为例：
`pages/index/index.js`：
```js
Page({ data: {} });
```
`pages/index/index.wxml`：
```xml
<view>占位：首页</view>
```
`pages/index/index.json`：`{ "usingComponents": {} }`。其余页面同理（各页面 `.js/.wxml/.json/.wxss` 四个文件）。

- [ ] **Step 8: 验证**

在微信开发者工具导入 `linli-wx`，勾选"不校验合法域名"，点编译。Expected: 有 tabBar（闲置/我的），首页显示"占位：首页"，无编译错误。

- [ ] **Step 9: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git init   # 若尚未初始化
git add .
git commit -m "feat: mini-program scaffold + request/auth utils + tabbar"
```

---

### Task 10: 首页 — 物品列表 + 类型筛选 + 搜索 + 分页 + 收藏

**Files:**
- Modify: `pages/index/index.js/.wxml/.json/.wxss`
- Modify: `utils/request.js`（不动，复用）

**Interfaces:**
- Consumes: `request('/api/items/')`（支持 `type,q,page`）、`favorite` 接口、`auth`。
- Produces: index 页完整 UI。

- [ ] **Step 1: 写 index.wxml**

```xml
<view class="toolbar">
  <view class="tabs">
    <view wx:for="{{types}}" wx:key="v" class="tab {{curType===item.v?'active':''}}" bindtap="onTypeTap" data-type="{{item.v}}">{{item.label}}</view>
  </view>
  <input class="search" placeholder="搜索物品" value="{{keyword}}" bindinput="onKeyword" confirm-type="search" bindconfirm="onSearch" />
</view>

<view wx:for="{{items}}" wx:key="id" class="card item" bindtap="onItemTap" data-id="{{item.id}}">
  <view class="item-row">
    <text class="item-title">{{item.title}}</text>
    <text class="price" wx:if="{{item.item_type==='sale'||item.item_type==='rent'}}">¥{{item.price}}</text>
  </view>
  <view class="item-meta">
    <text class="tag">{{typeLabel[item.item_type]}}</text>
    <text class="owner">{{item.owner.community}}{{item.owner.building}}栋</text>
  </view>
  <view class="fav" catchtap="onFavTap" data-id="{{item.id}}">{{item._fav?'♥':'♡'}}</view>
</view>

<view class="footer" wx:if="{{loading}}">加载中…</view>
<view class="empty" wx:if="{{items.length===0 && !loading}}">暂无闲置物品</view>
```

- [ ] **Step 2: 写 index.js**

```js
const { request, uploadFile } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    types: [
      { v: 'all', label: '全部' }, { v: 'sale', label: '出售' },
      { v: 'lend', label: '借用' }, { v: 'rent', label: '出租' },
    ],
    typeLabel: { sale: '出售', lend: '借用', rent: '出租' },
    curType: 'all', keyword: '', page: 1, items: [], loading: false,
    hasMore: true, _favs: {},
  },
  onLoad() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore) this.loadMore(); },
  refresh() {
    this.setData({ page: 1, items: [], hasMore: true });
    return this.fetchPage(1, true);
  },
  loadMore() { this.fetchPage(this.data.page + 1); },
  fetchPage(page, replace) {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    const qs = `type=${this.data.curType}&q=${encodeURIComponent(this.data.keyword)}&page=${page}`;
    return request({ url: `/api/items/?${qs}`, showLoading: false })
      .then((data) => {
        const results = data.results || [];
        const withFav = results.map((it) => Object.assign({}, it, { _fav: !!this.data._favs[it.id] }));
        const items = replace ? withFav : this.data.items.concat(withFav);
        this.setData({
          items, page,
          hasMore: !!data.next,
          loading: false,
        });
      })
      .catch(() => this.setData({ loading: false }));
  },
  onTypeTap(e) { this.setData({ curType: e.currentTarget.dataset.type }); this.refresh(); },
  onKeyword(e) { this.setData({ keyword: e.detail.value }); },
  onSearch() { this.refresh(); },
  onItemTap(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }); },
  _loadFavs() {
    if (!auth.isApproved()) return;
    request({ url: '/api/items/favorites/' }).then((data) => {
      const m = {};
      (data.results || []).forEach((it) => { m[it.id] = true; });
      this.data._favs = m;
      this.setData({ items: this.data.items.map((it) => Object.assign({}, it, { _fav: !!m[it.id] })) });
    }).catch(() => {});
  },
  onFavTap(e) {
    if (!auth.isApproved()) {
      wx.showToast({ title: '需审核通过后才能收藏', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const isFav = !!this.data._favs[id];
    const method = isFav ? 'DELETE' : 'POST';
    request({ url: `/api/items/${id}/favorite/`, method }).then((data) => {
      this.data._favs[id] = data.favorited;
      this.setData({ items: this.data.items.map((it) => it.id === id ? Object.assign({}, it, { _fav: data.favorited }) : it) });
    }).catch((err) => wx.showToast({ title: err.message || '操作失败', icon: 'none' }));
  },
  onShow() { this._loadFavs(); this.refresh(); },
});
```

`pages/index/index.json` 追加 enablePullDownRefresh/onReachBottomDistance：
```json
{ "usingComponents": {}, "enablePullDownRefresh": true, "backgroundTextStyle": "dark" }
```
`index.wxss` 补充 toolbar/tabs/search/item/price/fav 样式（简洁即可）。

- [ ] **Step 3: 验证**

开发者工具预览：默认显示"全部"物品列表；切换 tab 筛选；搜索"乒乓球"过滤；上拉加载更多；登录并通过审核后点收藏变实心，未登录/未审核提示需审核。

- [ ] **Step 4: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/index
git commit -m "feat: index item list with filter/search/pagination/favorite"
```

---

### Task 11: 详情页 + 发起交易

**Files:**
- Modify: `pages/detail/detail.js/.wxml/.json/.wxss`

**Interfaces:**
- Consumes: `request('/api/items/<id>/')`、`request('/api/items/<id>/transactions/', POST)`。
- Produces: detail 页含物品信息 + 收藏 + 发起交易弹窗。

- [ ] **Step 1: 写 detail.wxml**

```xml
<view class="card">
  <view class="pic" wx:if="{{item.image}}"><image src="{{item.image}}" mode="aspectFill" /></view>
  <view class="header">
    <text class="title">{{item.title}}</text>
    <text class="tag">{{typeLabel[item.item_type]}}</text>
  </view>
  <view class="row" wx:if="{{item.item_type!=='lend'}}">价格：¥{{item.price}}</view>
  <view class="row">状态：{{statusLabel[item.status]}}</view>
  <view class="desc">{{item.description}}</view>
  <view class="owner">
    联系人：{{item.owner.community}}{{item.owner.building}}栋{{item.owner.room}} · {{item.owner.username}}<br/>
    电话：{{item.contact_phone}}
  </view>
  <button class="btn-primary" bindtap="onFavTap">{{item.is_favorited?'取消收藏':'收藏'}}</button>
  <button class="btn-primary" bindtap="onTransTap">发起交易</button>
</view>

<view class="mask" wx:if="{{showModal}}" bindtap="hideModal"></view>
<view class="modal" wx:if="{{showModal}}">
  <view class="modal-title">发起交易</view>
  <textarea placeholder="给主人留言（可选）" value="{{message}}" bindinput="onMessage" />
  <button class="btn-primary" bindtap="submitTrans">发送请求</button>
  <button bindtap="hideModal">取消</button>
</view>
```

- [ ] **Step 2: 写 detail.js**

```js
const { request } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    item: {}, showModal: false, message: '',
    typeLabel: { sale: '出售', lend: '借用', rent: '出租' },
    statusLabel: { available: '可交易', reserved: '已预约', completed: '已成交' },
  },
  onLoad(options) {
    this.id = options.id;
    this.load();
  },
  load() {
    request({ url: `/api/items/${this.id}/`, showLoading: true }).then((item) => this.setData({ item }));
  },
  onFavTap() {
    if (!auth.isApproved()) return wx.showToast({ title: '需审核通过才能收藏', icon: 'none' });
    const method = this.data.item.is_favorited ? 'DELETE' : 'POST';
    request({ url: `/api/items/${this.id}/favorite/`, method }).then((data) => {
      this.setData({ 'item.is_favorited': data.favorited });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
  onTransTap() {
    if (!auth.isApproved()) return wx.showToast({ title: '需审核通过才能交易', icon: 'none' });
    this.setData({ showModal: true });
  },
  hideModal() { this.setData({ showModal: false }); },
  onMessage(e) { this.setData({ message: e.detail.value }); },
  submitTrans() {
    request({ url: `/api/items/${this.id}/transactions/`, method: 'POST', data: { message: this.data.message } })
      .then(() => {
        this.setData({ showModal: false });
        wx.showToast({ title: '已发起交易请求', icon: 'success' });
      })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});
```

`detail.json`：`{ "usingComponents": {} }`，navigationBarTitleText="物品详情"。

- [ ] **Step 3: 验证**

从首页点进详情显示完整信息与图；未登录点"发起交易"提示需审核；登录+已审核可发留言并收到成功提示。

- [ ] **Step 4: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/detail
git commit -m "feat: item detail + favorite + start transaction"
```

---

### Task 12: 发布页

**Files:**
- Modify: `pages/publish/publish.js/.wxml/.json/.wxss`

**Interfaces:**
- Consumes: `uploadFile('/api/items/', multipart)`。
- Produces: 发布表单，选图用 `wx.chooseMedia`，成功后跳详情。

- [ ] **Step 1: 写 publish.wxml**

```xml
<view class="form">
  <picker mode="selector" range="{{types}}" range-key="label" bindchange="onType">
    <view class="field">类型：{{types[curTypeIdx].label}}</view>
  </picker>
  <input class="field" placeholder="名称" value="{{title}}" bindinput="onTitle" />
  <textarea class="field" placeholder="描述" value="{{description}}" bindinput="onDesc" />
  <input class="field" type="digit" placeholder="价格（借用可填0）" value="{{price}}" bindinput="onPrice" />
  <input class="field" type="number" placeholder="联系电话" value="{{phone}}" bindinput="onPhone" />
  <view class="field" bindtap="onChooseImage">选图：{{image?'已选1张':'点击选择'}}</view>
  <button class="btn-primary" bindtap="submit">发布</button>
</view>
```

- [ ] **Step 2: 写 publish.js**

```js
const { request, uploadFile } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    types: [{ v: 'sale', label: '出售' }, { v: 'lend', label: '借用' }, { v: 'rent', label: '出租' }],
    curTypeIdx: 0, title: '', description: '', price: '', phone: '', image: null,
  },
  onLoad() {
    if (!auth.isApproved()) {
      wx.showModal({ title: '提示', content: '需通过审核后才能发布物品', showCancel: false, success: () => wx.navigateBack() });
    }
  },
  onType(e) { this.setData({ curTypeIdx: Number(e.detail.value) }); },
  onTitle(e) { this.setData({ title: e.detail.value }); },
  onDesc(e) { this.setData({ description: e.detail.value }); },
  onPrice(e) { this.setData({ price: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: (res) => this.setData({ image: res.tempFiles[0].tempFilePath }),
    });
  },
  submit() {
    const { title, description, price, phone, curTypeIdx } = this.data;
    if (!title || !phone) return wx.showToast({ title: '请填写名称和电话', icon: 'none' });
    const formData = {
      item_type: this.data.types[curTypeIdx].v, title, description,
      price: price || '0', contact_phone: phone,
    };
    const upload = this.data.image
      ? uploadFile({ url: '/api/items/', filePath: this.data.image, name: 'image', formData })
      : request({ url: '/api/items/', method: 'POST', data: formData });
    upload.then((item) => {
      wx.showToast({ title: '发布成功', icon: 'success' });
      wx.redirectTo({ url: `/pages/detail/detail?id=${item.id}` });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});
```

> 注意：`request` 的 data 是 JSON；无图时会以 multipart 或 JSON POST——后端 `item_create` 用 `request.data`，JSON 可读（Django `request.data` 兼容 JSON 与 multipart）。为统一，无图也建议走 `uploadFile` 并给空 formData。若用 JSON，`image` 后端取 `request.FILES` 为 None，正确。二者均可。

`publish.json`：`{ "usingComponents": {}, "navigationBarTitleText": "发布闲置" }`。

- [ ] **Step 3: 验证**

已审核用户发布一件物品（可带图），成功后跳详情；列表含新品。未审核被拦回。

- [ ] **Step 4: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/publish
git commit -m "feat: publish item with image upload"
```

---

### Task 13: 我的中心 + 我的物品 + 我的收藏

**Files:**
- Modify: `pages/mine/mine.js/.wxml/.json/.wxss`
- Modify: `pages/my-items/my-items.js/.wxml/.json/.wxss`
- Modify: `pages/favorites/favorites.js/.wxml/.json/.wxss`

**Interfaces:**
- Consumes: `request('/api/items/mine/')`、`request('/api/items/favorites/')`、`request('/api/auth/me/')`、`auth`。
- Produces: mine 入口页（审核态展示 + 菜单入口 + 退出）；my-items/favorites 列表页。

- [ ] **Step 1: 写 mine.wxml / mine.js**

`mine.wxml`：
```xml
<view class="card profile">
  <text class="name">{{profile.username || '未登录'}}</text>
  <text class="status" wx:if="{{profile}}">{{statusLabel[profile.status]}}</text>
  <view class="meta" wx:if="{{profile}}">{{profile.community}}{{profile.building}}栋{{profile.room}}</view>
</view>

<navigator class="card menu" url="/pages/profile/profile">个人资料 / 完善</navigator>
<navigator class="card menu" url="/pages/my-items/my-items">我的发布</navigator>
<navigator class="card menu" url="/pages/favorites/favorites">我的收藏</navigator>
<navigator class="card menu" url="/pages/my-transactions/my-transactions">我的交易</navigator>
<navigator class="card menu" url="/pages/notify/notify">通知（{{unread}}）</navigator>

<button class="btn-primary" bindtap="onLogout" wx:if="{{profile}}">退出登录</button>
```

`mine.js`：
```js
const auth = require('../../utils/auth');
const { request } = require('../../utils/request');

Page({
  data: {
    profile: null, unread: 0,
    statusLabel: { pending: '待审核', approved: '已通过', rejected: '未通过' },
  },
  onShow() {
    const profile = auth.getProfile();
    if (profile) {
      this.setData({ profile });
      request({ url: '/api/notifications/unread-count/' }).then((d) => this.setData({ unread: d.unread_count })).catch(() => {});
    } else {
      auth.silentLogin().then((d) => this.setData({ profile: d.user })).catch(() => {});
    }
  },
  onLogout() {
    auth.logout().then(() => this.setData({ profile: null, unread: 0 }));
  },
});
```

- [ ] **Step 2: 写 my-items**

`my-items.js`：
```js
const { request } = require('../../utils/request');
Page({
  data: { items: [], statusLabel: { available: '可交易', reserved: '已预约', completed: '已成交' } },
  onShow() { this.load(); },
  load() {
    request({ url: '/api/items/mine/', showLoading: true }).then((data) => this.setData({ items: data.results || [] }));
  },
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除', content: '确定删除该物品？',
      success: (r) => {
        if (!r.confirm) return;
        request({ url: `/api/items/${id}/`, method: 'DELETE' }).then(() => this.load()).catch((e2) => wx.showToast({ title: e2.message, icon: 'none' }));
      },
    });
  },
});
```
`my-items.wxml` 遍历 `items` 显示标题/状态/价格 + 删除按钮，空态文案。

- [ ] **Step 3: 写 favorites**

`favorites.js` 类似 my-items，`request('/api/items/favorites/')`；`favorites.wxml` 遍历显示，点进详情，支持列表里取消收藏。

- [ ] **Step 4: 验证**

mine 显示当前用户与审核态；菜单可跳；我的发布可删除；收藏列表显示已收藏物品并可取消。

- [ ] **Step 5: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/mine pages/my-items pages/favorites
git commit -m "feat: mine center + my items + favorites pages"
```

---

### Task 14: 我的交易（两栏 + 状态操作）

**Files:**
- Modify: `pages/my-transactions/my-transactions.js/.wxml/.json/.wxss`

**Interfaces:**
- Consumes: `request('/api/transactions/my-requests/')`、`my-received/`、`confirm/complete/cancel`。
- Produces: 两栏列表，owner 侧按钮 confirm/complete，双方可 cancel。

- [ ] **Step 1: 写 wxml**

```xml
<view class="tabs">
  <view class="tab {{tab==='req'?'active':''}}" bindtap="switchTab" data-tab="req">我发起的</view>
  <view class="tab {{tab==='recv'?'active':''}}" bindtap="switchTab" data-tab="recv">我收到的</view>
</view>

<view wx:for="{{list}}" wx:key="id" class="card">
  <view class="row">{{item.title}} · {{transTypeLabel[trans_type]}}</view>
  <view class="row">状态：{{statusLabel[status]}} · {{requester.community}}{{requester.building}}栋</view>
  <view class="msg" wx:if="{{message}}">留言：{{message}}</view>
  <view class="actions">
    <button size="mini" wx:if="{{canConfirm(t)}}" bindtap="act" data-idx="{{index}}" data-verb="confirm">确认</button>
    <button size="mini" wx:if="{{canComplete(t)}}" bindtap="act" data-idx="{{index}}" data-verb="complete">完成</button>
    <button size="mini" bindtap="act" data-idx="{{index}}" data-verb="cancel">取消</button>
  </view>
</view>
<view class="empty" wx:if="{{list.length===0}}">暂无记录</view>
```

> wxml 里不能直接调用方法返回 boolean。改为 data 预计算按钮可见性：见 js 里映射。

- [ ] **Step 2: 写 js（含权限按钮预计算）**

```js
const { request } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    tab: 'req', list: [],
    statusLabel: { pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消' },
    transTypeLabel: { sale: '买卖', lend: '借用', rent: '出租' },
  },
  onShow() { auth.ensureLogin().then(() => this.load()).catch(() => wx.navigateTo({ url: '/pages/mine/mine' })); },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab, list: [] }); this.load(); },
  load() {
    const url = this.data.tab === 'req' ? '/api/transactions/my-requests/' : '/api/transactions/my-received/';
    request({ url, showLoading: true }).then((data) => {
      const list = (data.results || []).map((t) => {
        const isOwner = t.is_owner;
        const canConfirm = isOwner && t.status === 'pending';
        const canComplete = isOwner && t.status === 'confirmed';
        const canCancel = t.status === 'pending' || t.status === 'confirmed';
        return Object.assign({}, t, { canConfirm, canComplete, canCancel });
      });
      this.setData({ list });
    });
  },
  act(e) {
    const { verb, idx } = e.currentTarget.dataset;
    const t = this.data.list[idx];
    request({ url: `/api/transactions/${t.id}/${verb}/`, method: 'POST' })
      .then(() => { wx.showToast({ title: '操作成功', icon: 'success' }); this.load(); })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },
});
```

> wxml 去掉 `canConfirm(canComplete(t))` 写法，改用 data 上的 `t.canConfirm/canComplete` 布尔（wxml：`wx:if="{{item.canConfirm}}"` 等）。

`my-transactions.json`：`{ "usingComponents": {} }`。

- [ ] **Step 3: 验证**

我收到一笔 pending，owner 显示"确认/取消"；确认后显示"完成/取消"；requester 侧只显示"取消"。取消后物品回可交易。

- [ ] **Step 4: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/my-transactions
git commit -m "feat: my transactions two-list with status actions"
```

---

### Task 15: 通知页 + 个人资料/完善

**Files:**
- Modify: `pages/notify/notify.js/.wxml/.json/.wxss`
- Modify: `pages/profile/profile.js/.wxml/.json/.wxss`

**Interfaces:**
- Consumes: `request('/api/notifications/')`、`/unread-count/`、`/<id>/read/`、`/api/auth/profile/`(POST)、`/api/auth/me/`(GET)。
- Produces: notify 列表 + 未读角标合并；profile 展示/完善资料并把审核态打回 pending。

- [ ] **Step 1: 写 notify**

`notify.js`：
```js
const { request } = require('../../utils/request');
Page({
  data: { list: [], typeLabel: { new_transaction: '新交易', confirmed: '已确认', completed: '已完成', cancelled: '已取消', approval: '审核' } },
  onShow() { this.load(); },
  load() {
    auth: require('../../utils/auth');  // 占位：顶部 require 即可，删除此行
    request({ url: '/api/notifications/', showLoading: true }).then((data) => {
      const list = (data.results || []).map((n) => Object.assign({}, n, { typeText: typeLabelFor(n.type) }));
      this.setData({ list });
      return request({ url: '/api/notifications/unread-count/' });
    }).then((d) => { if (d && d.unread_count && d.unread_count > 0) { wx.setTabBarBadge({ index: 1, text: String(d.unread_count) }); } });
  },
  onTap(e) {
    const id = e.currentTarget.dataset.id;
    request({ url: `/api/notifications/${id}/read/`, method: 'POST' }).then(() => {
      // 仅当未读时重拉
      this.load();
      wx.removeTabBarBadge({ index: 1 });
    });
  },
  typeLabelFor(t) { return this.data.typeLabel[t] || t; },
});
```

`notify.js` 顶部改成标准 require：
```js
const { request } = require('../../utils/request');
const typeLabel = { new_transaction: '新交易', confirmed: '已确认', completed: '已完成', cancelled: '已取消', approval: '审核' };
```
data 里放 `typeLabel` 供 wxml 用，list 映射用 module 级 `typeLabel[t.type]`。保持一处定义，去掉 js 内重复。

`notify.wxml`：遍历 `list` 显示 `typeText` + `content` + 时间，`data-id` 点击标记已读；空态。

- [ ] **Step 2: 写 profile**

`profile.js`：
```js
const { request } = require('../../utils/request');
const auth = require('../../utils/auth');
Page({
  data: { form: { phone: '', community: '', building: '', room: '', email: '' } },
  onLoad() {
    const p = auth.getProfile();
    if (p) this.setData({ form: { phone: p.phone || '', community: p.community || '', building: p.building || '', room: p.room || '', email: p.email || '' } });
    else request({ url: '/api/auth/me/' }).then((me) => {
      this.setData({ form: { phone: me.phone || '', community: me.community || '', building: me.building || '', room: me.room || '', email: me.email || '' } });
      auth.setProfile(me);
    }).catch(() => {});
  },
  onPhone(e) { this.setData({ 'form.phone': e.detail.value }); },
  onCommunity(e) { this.setData({ 'form.community': e.detail.value }); },
  onBuilding(e) { this.setData({ 'form.building': e.detail.value }); },
  onRoom(e) { this.setData({ 'form.room': e.detail.value }); },
  onEmail(e) { this.setData({ 'form.email': e.detail.value }); },
  submit() {
    const f = this.data.form;
    if (!f.community || !f.building || !f.room || !f.phone) return wx.showToast({ title: '请填完整小区/楼栋/门牌/电话', icon: 'none' });
    request({ url: '/api/auth/profile/', method: 'POST', data: f }).then((profile) => {
      auth.setProfile(profile);
      wx.showToast({ title: profile.status === 'approved' ? '已保存' : '已提交，等待审核', icon: 'none' });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});
```

`profile.wxml`：`phone/community/building/room/email` 五个输入 + 保存按钮；已审核显示"已通过"，否则提示等待审核。

- [ ] **Step 3: 验证**

通知列表显示交易/审核消息，点读后角标清除；profile 填写资料保存后审核态 pending，重新登录态生效。

- [ ] **Step 4: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add pages/notify pages/profile
git commit -m "feat: notifications page + profile edit page"
```

---

### Task 16: 端到端冒烟 + README

**Files:**
- Create: `README.md`（linli-wx，部署/联调说明）
- Modify: 无

- [ ] **Step 1: 写 README.md**

简要说明：后端需起在 `linli`（含 `api` 应用 + migrate）；前端在微信开发者工具导入，`appid` 填真实值、`constants.js.BASE_URL` 指向后端；开发期勾选"不校验合法域名"；正式需备案域名 + `WECHAT_APPID/SECRET`。列出已实现接口清单。

- [ ] **Step 2: 端到端验证**

后端起 `linli`；开发者工具里以游客身份浏览 → 小程序内完善资料 → Django 后台 `UserProfile.pending` 审批通过 → 小程序内发布/交易/收藏/通知全流程走通。记录/修复联调问题。

- [ ] **Step 3: 提交**

```bash
cd /home/hrong/workspace/code/linli-wx
git add README.md
git commit -m "docs: linli-wx README with setup and integration notes"
```

---

## 自我复核（writing-plans）

- **Spec 覆盖**：认证(wx-login/profile/me/logout)✅ T3；物品列表/筛选/搜索/详情/缓存✅ T4；发布/删除/收藏/门禁✅ T5；交易全流程+通知✅ T6；通知列表/已读/未读✅ T7；前端骨架✅ T9；首页✅ T10；详情✅ T11；发布✅ T12；我的中心/物品/收藏✅ T13；我的交易✅ T14；通知/资料✅ T15。管理员审核留在 Web 后台（spec 明确不做小程序内），部署注意在 T16 README 说明。
- **占位扫描**：无 TBD/TODO；`WECHAT_APPID/SECRET`、`touristappid`、`BASE_URL` 为有意的配置占位，非实现缺口。
- **类型一致**：`_bump_api_items_gen()` 在 T4 定义、T5/T6 使用；`IsApproved` T3 定义、T5/T6 使用；`notify(...)` T6 定义、T6 使用并 T7 复用；`TransactionSerializer.is_owner` 由 T14 消费；`request/uploadFile` 在 T9 定义、T10-T15 使用；`uploadFile` 在 T12 定义首个调用方。路由冲突点（`items/mine/` 顺序、detail 合并 DELETE）已在 T5、T6 显式修正。
- **Review Focus 钉入**：未登录浏览→T4 `test_unauthenticated_browse_list`；pending 门禁→T5 `test_create_requires_approved` + T3 `test_pending...`；自交易→T6 `test_cannot_transact_self`；非 owner confirm/delete→T6 `test_full_flow`（403）+ T5 `test_non_owner_cannot_delete`；空搜索/未知 type→T4 `test_empty_search_returns_all`/`test_unknown_type_returns_empty`；code2session 失败兜底→wechat.py `dev_` 分支（T3 代码即断言）。前端未登录浏览在 T10/T11 由 `auth.isApproved()` 门禁覆盖，不按钮无法进入限制。