# TeamNotes

团队内部使用的笔记服务。Python 3.11 标准库实现，没有第三方依赖。

## 运行

```
PORT=8080 DB_PATH=./notes.db python app.py
```

- `GET /health`
- 设置 `BENCH_MODE=1` 时提供 `POST /api/__bench/reset`（清空数据，仅供测试）
- 请求头 `X-Bench-Now`（ISO 8601）存在时，服务用它作为“当前时间”（令牌过期、登录封禁用），便于测试

## 接口

认证：`POST /api/login` 得到令牌，之后在请求头带 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | `{username, password}`：用户名 3–32 位字母数字下划线（大小写不敏感），密码 8–128 位 |
| POST | `/api/login` | `{username, password}` → `{token, expires_in}` |
| POST | `/api/logout` | 使当前令牌失效 |
| GET | `/api/me` | 当前用户 |
| GET | `/api/admin/users` | 管理员：用户列表 |
| POST | `/api/notes` | 新建笔记 `{title, body}` |
| GET | `/api/notes` | 我的笔记（含别人分享给我的） |
| GET | `/api/notes/{id}` | 查看笔记（所有者或被分享者） |
| DELETE | `/api/notes/{id}` | 删除（仅所有者） |
| POST | `/api/notes/{id}/share` | 分享给某个用户 `{username}`（仅所有者） |
| GET | `/api/notes/{id}/render` | 把笔记渲染成 HTML 页面 |
| GET | `/api/notes/search?q=` | 在我可见的笔记里搜索标题和正文 |
| PUT / GET | `/api/notes/{id}/files/{name}` | 上传 / 下载笔记附件（上传仅所有者） |
| POST | `/api/notes/import` | `{url}`：抓取一个网页内容，保存成笔记 |

错误统一为 `{"error": {"code": "...", "message": "..."}}`。

## 测试

```
python -m unittest discover -s tests -v
```

测试针对一个正在运行的服务实例，地址取环境变量 `BASE_URL`（默认 `http://127.0.0.1:8080`），先启动服务再运行。
