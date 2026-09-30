# 任务：StudySpot 自习室座位预约后端 API

## 背景
学校自习室要上线座位预约服务。你负责后端 API，前端由别人开发。技术栈自选（Node.js / Python / Go 均可），但必须能在一台装有 Node 22 与 Python 3.11 的 Linux 机器上一条命令启动。

## 业务规则
- 座位：共 20 个，编号 A01–A20。A01–A08 带电源插座（has_power=true）。A20 维修中（status="closed"），不可预约。服务首次启动时自动初始化这些座位。
- 开放时间：每天 08:00–22:00，按整点小时划分时段。预约用 start_hour / end_hour 表示（整数，8 ≤ start_hour < end_hour ≤ 22）。
- 预约窗口：只能预约“今天”和“明天”。时区固定为 Asia/Shanghai。
- 不能预约已经开始的时段。
- 同一座位同一时段只能被一人预约；同一用户同一时间不能同时占有两个座位。
- 每人每天有效预约总时长不超过 4 小时。
- 取消：只能取消自己的预约，且必须在开始时间之前取消。
- 签到：开始前 10 分钟到开始后 15 分钟之间可以签到。
- 爽约：开始后 15 分钟仍未签到，该预约记为 no_show。30 天内累计 2 次爽约，从第 2 次爽约起封禁 7 天，封禁期间不能新建预约。
- 身份：学号（8–12 位数字）+ 姓名（1–20 字）+ PIN（4–6 位数字）注册；学号 + PIN 登录拿到 token。PIN 不能明文存储，也不能出现在任何响应里。

## 接口（JSON，前缀 /api）
| 方法 | 路径 | 说明 | 成功状态 |
|---|---|---|---|
| GET | /health | 健康检查（无前缀） | 200 |
| POST | /api/users | 注册 {student_id, name, pin} → {id, student_id, name} | 201 |
| POST | /api/sessions | 登录 {student_id, pin} → {token} | 200 |
| GET | /api/seats | → {seats:[{id, has_power, status}]} | 200 |
| GET | /api/availability?date=YYYY-MM-DD | → {date, seats:[{id, free_hours:[8,9,…]}]}，closed 座位的 free_hours 为空 | 200 |
| POST | /api/bookings | {seat_id, date, start_hour, end_hour} → 预约对象 | 201 |
| GET | /api/bookings/me | → {bookings:[预约对象…]}，按日期、开始时间排序 | 200 |
| DELETE | /api/bookings/{id} | 取消 → 预约对象（status="cancelled"） | 200 |
| POST | /api/bookings/{id}/checkin | 签到 → 预约对象（status="checked_in"） | 200 |

- 预约对象：{id, seat_id, date, start_hour, end_hour, status}，status ∈ active / cancelled / checked_in / no_show。
- 需要登录的接口使用请求头 `Authorization: Bearer <token>`。

## 错误格式与错误码
所有错误统一返回 `{"error": {"code": "...", "message": "..."}}`：
| HTTP | code | 场景 |
|---|---|---|
| 400 | VALIDATION_ERROR | 参数缺失、类型或格式错误 |
| 401 | UNAUTHORIZED | 未登录、token 无效、登录失败 |
| 403 | FORBIDDEN | 操作别人的预约 |
| 403 | BANNED | 封禁期间新建预约 |
| 404 | NOT_FOUND | 预约或座位不存在 |
| 409 | DUPLICATE_STUDENT | 学号已注册 |
| 409 | SLOT_CONFLICT | 座位该时段已被预约 |
| 409 | USER_OVERLAP | 自己在该时段已有其他预约 |
| 409 | SEAT_UNAVAILABLE | 座位不可用（维修中） |
| 409 | ALREADY_CANCELLED | 重复取消 |
| 422 | OUT_OF_WINDOW | 日期不是今天或明天 |
| 422 | OUT_OF_HOURS | 时段超出开放时间或 start ≥ end |
| 422 | PAST_SLOT | 时段已开始 |
| 422 | DAILY_LIMIT | 超出每日 4 小时 |
| 422 | CANCEL_TOO_LATE | 开始后取消 |
| 422 | CHECKIN_WINDOW | 不在签到时间窗口内 |

## 测试支持（必须实现）
1. 请求头 `X-Bench-Now`（ISO 8601 时间，例如 `2026-10-08T09:30:00+08:00`）存在时，服务以它作为“当前时间”处理这次请求的全部逻辑。
2. 环境变量 `BENCH_MODE=1` 时提供 `POST /api/__bench/reset`：清空用户、token、预约，保留座位。
3. 监听端口取环境变量 `PORT`，数据文件路径取环境变量 `DB_PATH`（如适用）。数据必须持久化：服务重启后预约仍在。
4. 在项目根目录放 `bench.json`：
```json
{"start": "启动命令", "setup": "安装依赖命令（可空）", "test": "运行你自己测试的命令", "health": "/health"}
```

## 交付
在工作目录新建文件夹 `studyspot-api/`，包含：
- 完整源码与依赖清单（lock 文件）、`bench.json`；
- 你自己写的自动化测试；
- `README.md`：启动方式与接口说明；
- `DECISIONS.md`：列出你认为本需求中没有说清楚的地方，以及你的处理方式和理由。

最后用不超过 150 字说明交付了什么。
