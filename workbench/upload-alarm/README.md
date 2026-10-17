# 上传提醒

一个只做文件上传提醒的小桌面窗口。复用 Workbench 已安装的 Electron，不安装新的桌面程序。

- 新上传任务到来时，置顶显示题号、ZIP 名称及完整路径。
- 循环播放“需要传文件了，需要传文件了”，直到点击“停止提醒”或关闭窗口。
- “复制路径”和“打开文件夹”便于手动上传；停止声音不会将文件标记为已上传。
- 同一通知停止后不会自动重新响；新的通知会重新提醒。“重新提醒”可以手动再次开始。
- 原状态保存在 `runtime/alarm-state.json`，关闭后再次启动仍记住已停止的通知。

双击仓库根目录 `Start-Upload-Alarm.cmd` 可以打开窗口。

测评流程中发出新提醒：

```powershell
python reports/2026-10-08-haiku-5.5-web/notify_upload.py --task T02 --file reports/2026-10-08-haiku-5.5-web/uploads/T02-materials.zip
```

窗口只读取本机项目里的交接文件，不访问 Chrome 配置，不上传任何文件。
