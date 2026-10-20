// v1 Txx、v2 创作 Vxx 与后端 B1–B8 共用同一套工作区路径语法。
export const TASK_DIR = /^(T\d{2}|V\d{2}|B[1-8])([A-Z])?$/;
export const WORKSPACE_REF = /^[^/\\]+\/[^/\\]+\/(?:T\d{2}|V\d{2}|B[1-8])[A-Z]?\/r[1-9]\d*$/;
export const WORKSPACE_REF_PREFIX = /^([^/\\]+\/[^/\\]+\/(?:T\d{2}|V\d{2}|B[1-8])[A-Z]?\/r[1-9]\d*)(\/|$)/;
