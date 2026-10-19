// 用法（在仓库根目录）：npx tsx <本文件> [样例目录]，默认用本文件旁边的 samples/
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
const here=path.dirname(fileURLToPath(import.meta.url))
const S=(process.argv[2]||path.join(here,'samples'))+path.sep
const { MermaidWysiwygEditor } = await import(pathToFileURL(path.resolve(process.env.MW_CORE||'packages/core/src/index.ts')).href)
const E=(e:any)=>e._result.flowchart.edges.map((x:any)=>x.entityId)
function run(file:string, title:string, f:(e:any)=>void){
  const code=fs.readFileSync(S+file,'utf8'); const e=new MermaidWysiwygEditor({code})
  try{ f(e) }catch(err:any){ console.log(`## ${title}: 异常 ${err.message}`); return }
  const out=e.code; fs.writeFileSync(path.join(here,'out')+path.sep+title.replace(/\W+/g,'_')+'.mmd',out)
  const a=code.split('\n'), b=out.split('\n')
  const diff=[...a.filter(l=>!b.includes(l)).map(l=>'- '+l),...b.filter(l=>!a.includes(l)).map(l=>'+ '+l)]
  console.log(`## ${title}\n${diff.join('\n')||'(无改动)'}`)
  while(e.undo()); if(e.code!==code) console.log('  !! 撤销后不一致')
}
fs.mkdirSync(path.join(here,'out'),{recursive:true})
run('11-linkstyle-split.mmd','edges',e=>console.log(E(e)))
run('11-linkstyle-split.mmd','c24 delete B-C',e=>e.dispatch({type:'deleteEdge',edgeId:E(e)[1]}))
run('11-linkstyle-split.mmd','c25 delete A-C',e=>e.dispatch({type:'deleteEdge',edgeId:E(e)[0]}))
run('11-linkstyle-split.mmd','delete node C',e=>e.deleteEntities(['node:C']))
run('11-linkstyle-split.mmd','connect B-F',e=>e.dispatch({type:'connect',source:'B',target:'F'}))
run('01-chinese-basic.mmd','rename 校验',e=>e.dispatch({type:'renameNode',id:'校验',label:'校验通过了吗？'}))
run('01-chinese-basic.mmd','edge label 是',e=>e.dispatch({type:'setEdgeLabel',edgeId:E(e).find((x:string)=>x.includes('首页')),label:'通过'}))
run('02-arrows.mmd','label dotted inline',e=>e.dispatch({type:'setEdgeLabel',edgeId:E(e).find((x:string)=>x.includes('>L')),label:'新文字'}))
run('03-subgraph.mmd','connect DB-UI',e=>e.dispatch({type:'connect',source:'DB',target:'UI'}))
run('03-subgraph.mmd','delete SVC',e=>e.deleteEntities(['node:SVC']))
run('04-styles-comments.mmd','delete edge0',e=>e.dispatch({type:'deleteEdge',edgeId:E(e)[0]}))
run('05-shapes-multi.mmd','delete A-C in &',e=>e.dispatch({type:'deleteEdge',edgeId:E(e)[0]}))
run('05-shapes-multi.mmd','rename quote',e=>e.dispatch({type:'renameNode',id:'A',label:'含 "引号" 和 end'}))
run('06-edge-cases.mmd','delete second on line',e=>{const x=E(e).find((x:string)=>x.includes('D1->E1'));e.dispatch({type:'deleteEdge',edgeId:x})})
run('07-crlf-trailing.mmd','crlf rename',e=>e.dispatch({type:'renameNode',id:'R',label:'新'}))
run('03-subgraph.mmd','addNode',e=>e.dispatch({type:'addNode',label:'新节点'}))
