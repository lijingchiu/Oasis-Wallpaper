// The local UI accepts only its loopback origin, including before serving HTML.
export function isLocalRequest(req,port){
 const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
 if(!hosts.has(String(req.headers.host||'').toLowerCase()))return false;
 const origin=req.headers.origin;
 if(origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]).has(origin))return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 return true;
}
