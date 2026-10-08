import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml'};
const port=Number(process.env.CAFE_PORT || 4173);
http.createServer(async(req,res)=>{
  try{
    const route=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const relative=route==='/'?'index.html':route.slice(1);
    const p=path.resolve(root,relative);
    if(!p.startsWith(root+path.sep) || relative.split(/[\\/]/).some(p=>p.startsWith('.')||p==='node_modules'))throw new Error('private');
    const body=await fs.readFile(p);
    res.writeHead(200,{'Content-Type':types[path.extname(p)] || 'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Cafe preview: http://127.0.0.1:${port}`));
