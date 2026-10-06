import { createDemoServer } from '../src/demo-server.mjs';
const port=Number(process.env.PORT||4517);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT_INVALID');
const server=createDemoServer();
server.listen(port,'127.0.0.1',()=>console.log(`Demonstração com dados fictícios: http://127.0.0.1:${port}`));
server.on('error',()=>{console.error('SERVER_START_FAILED');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
