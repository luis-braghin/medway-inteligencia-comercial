import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syntheticSources,DEMO_VERSION} from '../src/demo-data.mjs';
import {normalizeB2C} from '../src/normalize.mjs';
import {buildSegmentArtifact} from '../src/segment-analysis.mjs';
const {csv}=syntheticSources(),sha=createHash('sha256').update(csv).digest('hex');
const artifact=buildSegmentArtifact({records:normalizeB2C(csv,sha).records,versionId:DEMO_VERSION,sourceSha256:sha,
 currencyDeclaration:{code:'BRL',authority:'synthetic-demo-contract',sourceCurrencyField:null}});
const engine=await readFile(new URL('../src/segment-analysis.mjs',import.meta.url),'utf8');
await writeFile(new URL('../dashboard/dist/segments.js',import.meta.url),engine+'\nexport const segmentArtifact='+JSON.stringify(artifact)+';\n');
console.log(JSON.stringify({synthetic:true,pairs:Object.keys(artifact.pairs).length}));
