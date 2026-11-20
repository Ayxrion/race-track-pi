// Explicit allowlist: runtime bundle contains no local secrets, saves or firmware.
import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(root,'release');
await access(resolve(root,'dist/index.html'));
// Refuse to mix a fresh release with stale files from an earlier packaging run.
await mkdir(out);
for(const name of ['dist','relay','shared','package.json','package-lock.json','compose.tunnel.yaml','compose.yaml','Caddyfile','.env.example','deploy','README.md']) {
  await cp(resolve(root,name),resolve(out,name),{recursive:true});
}
await cp(resolve(root,'Dockerfile.release'),resolve(out,'Dockerfile'));
await writeFile(resolve(out,'.dockerignore'),'node_modules\n.git\n.env\n.env.*\nsecrets\n*.log\n');
await writeFile(resolve(out,'build.json'),JSON.stringify({ref:process.env.GITHUB_REF_NAME||'local',commit:process.env.GITHUB_SHA||'local'},null,2)+'\n');
console.log('Packaged compiled spectator and relay in spectator/release');
