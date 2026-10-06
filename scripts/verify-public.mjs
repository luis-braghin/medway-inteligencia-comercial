import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=new Set(['.gitignore','README.md','package.json','package-lock.json','docs/ARCHITECTURE.md','docs/SECURITY.md','docs/DELIVERY.md','docs/demo.jpg','src/normalize.mjs','src/views.mjs','src/dashboard-dto.mjs','src/portal-client.mjs','src/hosted-app.mjs','src/demo-data.mjs','src/demo-server.mjs','scripts/demo.mjs','scripts/verify-public.mjs','tests/views.test.mjs','tests/portal-client.test.mjs','tests/hosted-app.test.mjs','tests/dashboard-interactions.test.mjs','tests/demo.test.mjs','dashboard/dist/index.html','dashboard/dist/app.js','dashboard/dist/presentation.js','dashboard/dist/styles.css']);
const findings=[];let count=0;
async function walk(dir='') {
  for(const item of await readdir(path.join(root,dir),{withFileTypes:true})) {
    if(!dir&&['.git','node_modules'].includes(item.name))continue;
    const name=path.posix.join(dir,item.name);
    if(item.isSymbolicLink()){findings.push(name+':SYMLINK');continue;}
    if(item.isDirectory()){await walk(name);continue;}
    count++;
    if(!allowed.has(name))findings.push(name+':OUTSIDE_ALLOWLIST');
    if(name.endsWith('.jpg'))continue;
    const text=await readFile(path.join(root,name),'utf8');
    if(/(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]{24,}|\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text))findings.push(name+':CREDENTIAL_PATTERN');
    if(name!=='scripts/verify-public.mjs' && /[A-Z]:[\\/](?:Users|Desktop)[\\/]|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|B2C_AGGREGATE_SIGNATURE|RESEARCH_VERSION/.test(text))findings.push(name+':PRIVATE_ARTIFACT');
  }
}
await walk();
console.log(JSON.stringify({passed:findings.length===0,files:count,findings}));
if(findings.length)process.exitCode=1;
