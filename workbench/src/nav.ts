import { BookOpenText, Boxes, ClipboardCheck, Gauge, LayoutDashboard, ListChecks, MonitorPlay, Settings2, Trophy } from 'lucide-react';
import type { View } from './lib/router';

// 视图按评测工作流排序：看全局 → 看结果 → 管模型 → 跑题 → 评审 → 看产物 → 查规范 → 任务 → 系统
export const NAV: { id: View; label: string; icon: typeof Gauge; key?: string; desc: string }[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, key: 'o', desc: '全局状态、待办与最近活动' },
  { id: 'board', label: '排行与对比', icon: Trophy, key: 'b', desc: '排行榜、雷达、热力矩阵、效率与题目分析' },
  { id: 'models', label: '模型', icon: Boxes, key: 'm', desc: '模型档案与工作区 model/<供应商>/<模型>' },
  { id: 'runs', label: '运行', icon: ListChecks, key: 'r', desc: '新建、计时、登记、评分与每次运行详情' },
  { id: 'review', label: '评审', icon: ClipboardCheck, key: 'v', desc: '人工 / Agent 检查项盲评打分' },
  { id: 'stage', label: '预览舞台', icon: MonitorPlay, key: 's', desc: 'HTML / 开发服务器 / 视频预览与控制台' },
  { id: 'spec', label: '题库规范', icon: BookOpenText, key: 'k', desc: '设计原则、维度、题目与评分细则' },
  { id: 'jobs', label: '任务', icon: Gauge, key: 'j', desc: '评分、导出等后台任务与输出' },
  { id: 'system', label: '系统', icon: Settings2, key: ',', desc: '设置、存储文件、依赖、CLI 与 Agent 接入' },
];
