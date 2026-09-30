import { BookOpen, Boxes, Download, GitCompareArrows, LayoutGrid, ListChecks, MonitorPlay, Settings2, SquareTerminal, Trophy } from 'lucide-react';
import type { View } from './lib/router';

export interface NavItem { id: View; label: string; icon: typeof Boxes; key?: string; desc: string; hidden?: boolean }
export interface NavGroup { id: string; label: string; items: NavItem[] }

// 按评测工作流分组：准备（选模型选题复制）→ 执行（交付、预览、评分）→ 结果（出榜、对比、导出）→ 文档（方法论，给访客）
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'eval', label: '评测', items: [
      { id: 'overview', label: '总览', icon: LayoutGrid, key: 'o', desc: '当前测评进度、待办与最近动态' },
      { id: 'models', label: '模型', icon: Boxes, key: 'm', desc: '模型档案与工作区 model/<供应商>/<模型>' },
      { id: 'tasks', label: '题目', icon: SquareTerminal, key: 't', desc: '选题、复制提示词、评分细则' },
    ],
  },
  {
    id: 'run', label: '执行', items: [
      { id: 'runs', label: '运行', icon: ListChecks, key: 'r', desc: '交付检测、登记评分、预览与打分' },
      { id: 'stage', label: '预览舞台', icon: MonitorPlay, key: 's', desc: 'HTML / 开发服务器 / 视频预览与控制台' },
    ],
  },
  {
    id: 'result', label: '结果', items: [
      { id: 'board', label: '排行榜', icon: Trophy, key: 'b', desc: '总榜、维度热力、效率' },
      { id: 'compare', label: '对比', icon: GitCompareArrows, key: 'c', desc: '多模型雷达、逐题与维度差异' },
      { id: 'exports', label: '导出', icon: Download, key: 'e', desc: '图表打包、报表、存储文件' },
    ],
  },
  {
    id: 'docs', label: '文档', items: [
      { id: 'docs', label: '方法论', icon: BookOpen, key: 'd', desc: '设计原则、维度、题目矩阵、评分体系与运行协议' },
    ],
  },
];
export const SETTINGS_NAV: NavItem = { id: 'settings', label: '设置', icon: Settings2, key: ',', desc: 'Harness、提示词、评测机、存储文件与 CLI' };
export const NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_NAV];
export const navOf = (v: View) => NAV.find((n) => n.id === v) || NAV[0];
