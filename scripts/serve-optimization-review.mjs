import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {argumentsFor} from './optimization-common.mjs';
const args=argumentsFor(['--directory','--port'],{'--port':'5180'});assert(args['--directory']);
const web=resolve('dist/web'),data=resolve(args['--directory']),port=Number(args['--port']);assert(Number.isInteger(port)&&port>=1024&&port<=65535);
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??'/','http://127.0.0.1'),pathname=decodeURIComponent(url.pathname);let path;
  if(pathname.startsWith('/review-data/')){
    const name=pathname.slice('/review-data/'.length);if(!/^(index|pair-\d{2}-[XY])\.json$/.test(name)){res.writeHead(404).end();return;}path=resolve(data,name);
  }else{path=resolve(web,`.${pathname==='/'?'/h2.html':pathname}`);const local=relative(web,path);if(local.startsWith('..')||local.includes(':')){res.writeHead(403).end();return;}}
  res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.json':'application/json'}[extname(path)]??'application/octet-stream'}).end(await readFile(path));
}catch{res.writeHead(404).end();}});
server.listen(port,'127.0.0.1',()=>console.log(`AI paired viewer: http://127.0.0.1:${port}/ (private key is not served)`));
