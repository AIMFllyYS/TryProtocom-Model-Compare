// 工作台前后端共享的领域类型。数据来源：bench-grader（Python）+ 模型工作区（model/<供应商>/<模型>）+ 可移植存储文件。
import type { DetectResult } from './deliverables';
export type { DetectResult } from './deliverables';

export type DimKind = 'quality' | 'efficiency';
export interface Dimension { id: string; name: string; kind: DimKind; weight?: number; desc: string }

export type Tier = 'basic' | 'advanced' | 'excellent' | 'clean';
export type Method = 'auto' | 'agent' | 'human';

export interface SpecItem {
  id: string; dim: string; tier: Tier; tier_label: string; method: Method; method_label: string; weight: number;
  desc: string; metric: string; rule: string; anchors: string[]; evidence: string; variants: string[];
}
export interface SpecGate { id: string; desc: string; variants: string[] }
export interface SpecBug { issue: string; title: string; root: string; test: string }
export interface SpecTask {
  id: string; name: string; short: string; dims: Record<string, number>;
  variants: Record<string, { dims: Record<string, number>; desc?: string }>;
  condition: string; materials: string[]; time_limit: number | null; deliverable: string; probes: string[];
  prompt: string; items: SpecItem[]; gates: SpecGate[]; hidden: string[]; bugs?: Record<string, SpecBug> | null;
}
export interface BenchConfig {
  name: string; version: string; frozen_date: string | null; runs_per_task: number; pass_threshold: number;
  efficiency: { cost: { best: number; worst: number }; speed: { best: number; worst: number } };
  low_confidence_na_ratio: number;
}
export interface FullConfig extends BenchConfig {
  statistics?: { bootstrap_samples?: number; ci?: number };
  composite?: { enabled?: boolean; quality_weight: number; cost_weight: number; speed_weight: number };
  blinding?: { alias_prefix?: string };
  external?: Record<string, unknown>;
}
export interface SpecData {
  cfg: BenchConfig; config_full: FullConfig; dims: Dimension[]; tasks: SpecTask[];
  relations: { title: string; tasks: string[]; text: string }[];
  prices?: { as_of?: string | null; currency?: string; models?: Record<string, Record<string, number>> | null };
  materials_state?: Record<string, { dir: string; files: string[]; missing: string[] }>;
  _source?: 'python' | 'cache' | 'html';
}

// ---------- 评分结果（与 benchlib/scoring.py score_run 输出一致） ----------
export type ItemStatus = 'scored' | 'missing' | 'na' | 'pending';
export interface ItemScore {
  id: string; dim: string; tier: Tier; method: Method; weight: number; desc: string;
  status: ItemStatus; s: number | null; value?: unknown; by?: string; note?: string; na_reason?: string;
}
export interface RunScore {
  gate_pass: boolean; gate_fail: { id: string; desc: string; value: unknown }[]; total: number;
  dims: Record<string, number | null>; dim_weights: Record<string, number>; tiers: Record<string, number | null>;
  items: ItemScore[]; na_ratio: number; low_confidence: boolean; pending: string[]; complete: boolean; passed: boolean;
}
export interface Usage {
  wall_min?: number; active_min?: number; input_tokens?: number; output_tokens?: number;
  cache_read_tokens?: number; cache_write_tokens?: number; cost_usd?: number; cost_estimated?: boolean;
  price_as_of?: string | null; source?: string; missing?: string[]; log_files?: string[]; log_model?: string;
}
export interface ManualScore { score: number; note?: string; by?: string; at?: string }

/** 存储文件中的一次已登记运行（bench-grader run）。 */
export interface StoreRun {
  run_id: string; task: string; variant: string | null; tkey: string; model: string; vendor: string | null; harness: string;
  entrant: string; run_index: number | null; date: string | null; alias: string | null; ws_ref: string | null;
  started_at?: string | null; ended_at?: string | null; timed_out?: boolean; failure_tag?: string | null;
  graded: boolean; score: RunScore | null; usage: Usage; manual: Record<string, ManualScore>;
  artifacts: Record<string, string>; notes: string[]; dir: string; has_final_message: boolean;
  synced_at: string; origin?: string;
}

// ---------- 模型工作区 ----------
export interface ModelProfile {
  schema: 1; vendor: string; name: string; display?: string; harness?: string; family?: string;
  release?: string; notes?: string; tags?: string[]; created_at: string; color?: string;
  billing?: Billing;
}
/** 计费方式：按 token（费用来自日志 / 单价）或订阅额度（用开跑前后的剩余额度差 × 单位价格换算） */
export interface Billing {
  mode: 'token' | 'subscription' | 'free';
  plan?: string;            // 例如 ChatGPT Pro、Claude Max 20x、DeepSeek 包月
  unit?: string;            // 额度单位：次、条消息、点、%、美元
  monthly_fee?: number;     // 每个额度周期的费用（美元）
  monthly_quota?: number;   // 每个额度周期的总额度（与 unit 同单位）
}
/** 单次运行的额度记录：复制提示词时记下开跑前剩余，结束时记下剩余 */
export interface RunQuota { unit?: string; before?: number | null; after?: number | null; at_before?: string | null; at_after?: string | null; used?: number | null; cost_usd?: number | null }
export type WsStatus = 'prepared' | 'running' | 'finished' | 'registered' | 'graded' | 'reviewed';
export interface WorkspaceRun {
  schema: 1; ref: string;            // 例：OpenAI/GPT-6.1-Sol/T05/r1
  vendor: string; model: string; task: string; variant: string | null; tkey: string; index: number;
  harness: string; created_at: string; started_at: string | null; ended_at: string | null;
  deliverable_dir: string; grader_run_id: string | null; timed_out?: boolean; notes?: string;
  usage?: Partial<Usage>; status?: WsStatus; workspace?: string; has_final?: boolean; has_deliverable?: boolean;
  entry?: string | null;               // 相对 workspace 的预览入口（dist/index.html、index.html、final.mp4…）
  detect?: DetectResult;               // 交付检测（服务端实时计算）
  auto_finished?: boolean;             // 由 FINAL_MESSAGE.md 自动结束计时
  quota?: RunQuota;                    // 订阅额度记录
}

export interface WbSettings {
  tts_command?: string;
  default_harness?: string;            // harness id，例如 deepseek-harness
  prompt_header?: boolean;             // 复制提示词时附带统一运行约定（默认 true）
  open_harness?: boolean;              // 复制提示词后自动打开 harness（默认 false）
  auto_start?: boolean;                // 复制提示词即开始计时（默认 true）
  current_model?: string;              // 当前测评模型 供应商/模型
  github?: string;                     // 开源仓库地址
}

export interface StoreNote { id: string; target: string; text: string; at: string }
export interface StoreHistory { at: string; action: string; detail?: string }

export interface BenchStore {
  schema: 'bench-store/1'; updated_at: string; created_at: string; machine?: string;
  benchmark: { name?: string; version?: string };
  settings: WbSettings;
  models: ModelProfile[]; runs: StoreRun[]; workspaces: WorkspaceRun[]; notes: StoreNote[];
  history: StoreHistory[]; spec?: SpecData | null;
}

// ---------- 汇总 ----------
export interface TaskRow {
  entrant: string; task: string; runs: number; mean: number; sd: number; min: number; max: number; pass_rate: number;
  pass_at_k: boolean; gate_fail_runs: number; complete: boolean; low_confidence: boolean;
  mean_cost_usd: number | null; mean_min: number | null; exp_cost_usd: number | null; exp_min: number | null;
  dims: Record<string, number | null>; dim_weights: Record<string, number>; tiers: Record<string, number | null>;
  cost_score: number | null; speed_score: number | null;
}
export interface BoardRow {
  rank: string; entrant: string; model: string; vendor: string | null; harness: string; quality: number | null;
  ci_low: number | null; ci_high: number | null; dims: Record<string, number | null>; runs: number; tasks: number;
  pass_rate: number; suite_exp_cost_usd: number | null; suite_exp_min: number | null; cost_coverage: string;
  complete: boolean; na_ratio: number; composite?: number;
}
export interface ItemAnalysisRow {
  task: string; item_id: string; dim: string; tier: string; method: string; desc: string; mean: number;
  between_sd: number; within_sd: number; n: number; flag: string; by_entrant: Record<string, number>;
}
export interface Aggregate {
  board: BoardRow[]; tasks: TaskRow[]; items: ItemAnalysisRow[];
  uplift: { entrant: string; task: string; A_mean: number; C_mean: number; uplift: number; A_anim: number | null; C_anim: number | null; anim_uplift: number; A_cost: number | null; C_cost: number | null; A_min: number | null; C_min: number | null }[];
  failures: { entrant: string; task: string; run_id: string; total: number; tags: string }[];
  entrants: string[]; tkeys: string[]; generated_at: string;
  pending: { human: number; agent: number; usage_missing: number; ungraded: number; low_confidence: number };
}

// ---------- 预览 / 进程 / 任务 ----------
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result' | 'network' | 'resource' | 'system' | 'stdout' | 'stderr';
export interface LogEntry {
  seq: number; ts: number; level: LogLevel; text: string; src: 'page' | 'server' | 'proc' | 'native' | 'eval';
  url?: string; line?: number; col?: number; stack?: string; status?: number; method?: string; ms?: number; count?: number;
}
export interface RequestEntry { seq: number; ts: number; method: string; url: string; status: number; bytes: number; ms: number; type: string; src: 'server' | 'page' }
export type PreviewKind = 'static' | 'proxy' | 'url';
export interface PreviewSession {
  id: string; kind: PreviewKind; label: string; root?: string; entry?: string; target?: string; port?: number;
  url: string; created_at: number; inject: boolean; proc_id?: string; counts: { error: number; warn: number; log: number; failed: number };
}
export interface ProcInfo {
  id: string; name: string; cwd: string; cmd: string; pid: number | null; status: 'running' | 'exited' | 'failed';
  code: number | null; started_at: number; ended_at: number | null; url: string | null; session_id: string | null;
}
export type JobKind = 'grade' | 'review' | 'export' | 'doctor' | 'materials' | 'validate' | 'build-spec' | 'register' | 'aggregate' | 'probe' | 'sync' | 'npm-install' | 'custom';
export interface JobInfo {
  id: string; kind: JobKind; title: string; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  started_at: number; ended_at: number | null; code: number | null; lines: number; result?: unknown; error?: string;
}

export interface SessionInfo {
  version: string; token: string; port: number; preview_ports: [number, number]; root: string;
  paths: { model: string; bench_data: string; store: string; reports: string; grader: string; skill: string; agents_skills: string };
  python: string | null; desktop: boolean; started_at: number; github: string;
}

/** SSE 事件 */
export type WbEvent =
  | { type: 'hello'; at: number }
  | { type: 'store'; updated_at: string }
  | { type: 'job'; job: JobInfo }
  | { type: 'job-line'; id: string; line: string }
  | { type: 'log'; session: string; entries: LogEntry[] }
  | { type: 'request'; session: string; entries: RequestEntry[] }
  | { type: 'session'; session: PreviewSession | null; id: string }
  | { type: 'proc'; proc: ProcInfo }
  | { type: 'proc-line'; id: string; line: string; stream: 'stdout' | 'stderr' }
  | { type: 'ui'; action: string; params: Record<string, unknown> }
  | { type: 'nav'; session: string; url: string; title?: string };
