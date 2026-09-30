# StudySpot 自习室预约服务 v0.9

纯 Python 标准库实现（http.server + sqlite3），无第三方依赖。

## 运行
```bash
PORT=8080 DB_PATH=studyspot.db python app.py
```

## 测试
```bash
BENCH_MODE=1 PORT=8080 DB_PATH=/tmp/t.db python app.py &
BASE_URL=http://127.0.0.1:8080 python -m pytest -q tests
```

- `X-Bench-Now` 请求头可覆盖“当前时间”（测试用）。
- `BENCH_MODE=1` 时开放 `POST /api/__bench/reset` 清空数据（测试用）。

## 业务规则
- 座位 A01–A20，A01–A08 有电源，A20 维修中。
- 每天 08–22 点按整点预约，只能预约今天和明天（北京时间）。
- 每人每天有效预约不超过 4 小时；同一座位同一时段只能一人；同一用户同一时间只能占一个座位。
- 开始前可取消自己的预约；开始前 10 分钟到开始后 15 分钟可签到；逾期未签到记爽约；30 天内爽约 2 次封禁 7 天。

## 接口
见 `app.py` 中 `route()`。错误统一为 `{"error": {"code", "message"}}`。
