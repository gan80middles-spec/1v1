import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
const pacing=process.argv.includes('phase3b');
const phase3=process.argv.includes('phase3a'),port=pacing?5176:phase3?5175:5174;
const web=resolve('dist/web'),data=resolve(pacing?'artifacts/phase-3b/review':phase3?'artifacts/phase-3a/style':'artifacts/phase-2/h2');
const server=createServer(async(req,res)=>{try{const url=new URL(req.url??'/','http://127.0.0.1'),pathname=decodeURIComponent(url.pathname);let path;
 if(pathname.startsWith('/review-data/')){const name=pathname.slice('/review-data/'.length);if(!/^(index|review-\d{2}|pair-\d{2}-[XY])\.json$/.test(name)){res.writeHead(404).end();return;}path=resolve(data,name);}
 else{path=resolve(web,`.${pathname==='/'?'/h2.html':pathname}`);const local=relative(web,path);if(local.startsWith('..')||local.includes(':')){res.writeHead(403).end();return;}}
 const body=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.json':'application/json'}[extname(path)]??'application/octet-stream'}).end(body);
 }catch{res.writeHead(404).end();}});
server.listen(port,'127.0.0.1',()=>console.log(`Blinded viewer: http://127.0.0.1:${port}/ (private key is not served)`));
