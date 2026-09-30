// 用 esbuild 把服务端、CLI、桌面壳打包为单文件 CommonJS（运行时零依赖，只需要 Node）。
import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: false, logLevel: 'info', legalComments: 'none' };
await build({ ...common, entryPoints: ['server/index.ts'], outfile: 'dist-node/server.cjs' });
await build({ ...common, entryPoints: ['cli/wb.ts'], outfile: 'dist-node/wb.cjs' }); // 源文件自带 shebang，esbuild 会保留
if (fs.existsSync('desktop/main.ts')) {
  await build({ ...common, entryPoints: ['desktop/main.ts'], outfile: 'desktop/app/main.cjs', external: ['electron'] });
  await build({ ...common, entryPoints: ['desktop/preload.ts'], outfile: 'desktop/app/preload.cjs', external: ['electron'] });
  await build({ ...common, entryPoints: ['desktop/pet.ts'], outfile: 'desktop/app/pet.cjs', external: ['electron'] });
  await build({ ...common, entryPoints: ['desktop/pet-preload.ts'], outfile: 'desktop/app/pet-preload.cjs', external: ['electron'] });
}
