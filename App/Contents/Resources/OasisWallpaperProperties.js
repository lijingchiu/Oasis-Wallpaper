/* Wallpaper Engine display conditions are data from an untrusted package.
   Interpret a small expression grammar; never execute the author's code. */
(()=>{'use strict';
 function visible(condition,properties){
  if(typeof condition!=='string'||!condition.trim())return true;condition=condition.trim();if(condition.length>1024)return true;
  try{
   const tokens=[],pattern=/\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*(?:\.value)?)|(===|!==|==|!=|>=|<=|&&|\|\||[()!<>-]))/gy;let at=0;
   while(at<condition.length){pattern.lastIndex=at;const match=pattern.exec(condition);if(!match)throw Error('condition');tokens.push(match[1]??match[2]??match[3]??match[4]);at=pattern.lastIndex;if(tokens.length>256)throw Error('condition')}
   let index=0,depth=0;const peek=()=>tokens[index],take=()=>tokens[index++];
   function primary(){if(++depth>32)throw Error('condition');const token=take();let value;
    if(token==='('){value=or();if(take()!==')')throw Error('condition')}
    else if(token==='!')value=!primary();else if(token==='-'){const n=primary();if(typeof n!=='number')throw Error('condition');value=-n}
    else if(token==='true'||token==='false')value=token==='true';else if(token==='null')value=null;
    else if(/^\d/.test(token||''))value=Number(token);else if(/^['"]/.test(token||'')){const body=token.slice(1,-1);value=body.replace(/\\(['"\\])/g,'$1')}
    else {const key=(token||'').replace(/\.value$/,'');if(!Object.hasOwn(properties,key))throw Error('condition');value=properties[key]?.value}
    depth--;return value;
   }
   function comparison(){let left=primary();while(['==','===','!=','!==','>','<','>=','<='].includes(peek())){const op=take(),right=primary();if(op==='==')left=left==right;else if(op==='===')left=left===right;else if(op==='!=')left=left!=right;else if(op==='!==')left=left!==right;else if(op==='>')left=left>right;else if(op==='<')left=left<right;else if(op==='>=')left=left>=right;else left=left<=right}return left}
   function and(){let result=comparison();while(peek()==='&&'){take();const next=comparison();result=Boolean(result)&&Boolean(next)}return result}
   function or(){let result=and();while(peek()==='||'){take();const next=and();result=Boolean(result)||Boolean(next)}return result}
   const result=or();if(index!==tokens.length)throw Error('condition');return Boolean(result);
  }catch{return true}
 }
 function ordered(properties){return Object.entries(properties||{}).map((row,index)=>({key:row[0],property:row[1],index})).sort((a,b)=>(a.property.order??a.property.index??a.index)-(b.property.order??b.property.index??b.index)||a.index-b.index)}
 globalThis.OasisWallpaperProperties={visible,ordered};
})();
